// Typed data models for the AI reply (the Zod equivalent of Pydantic models).
// One definition gives three things:
//   1. the TypeScript types the app uses,
//   2. a JSON Schema sent to the model so it replies in this shape (structured output where the provider supports it),
//   3. strict validation of whatever comes back.
import { z } from 'zod';

export const LIMITS = { tldr: 400, summary: 1500, ask: 600, head: 90, text: 400, where: 160, findingText: 300, findings: 8 } as const;

export const Severity = z.enum(['High', 'Medium', 'Info']).describe('High blocks merging, Medium should be fixed, Info is optional');

export const PrNote = z
  .object({
    id: z.string().min(1).describe('The PR id exactly as given in the input, e.g. owner/repo#12'),
    head: z.string().min(1).max(LIMITS.head).describe('A short plain-English headline for what this PR does'),
    text: z.string().min(1).max(LIMITS.text).describe('One or two short sentences a newcomer can follow'),
  })
  .strict();

export const LinkNote = z
  .object({
    id: z.string().min(1).describe('The link id exactly as given in the input, e.g. L1'),
    text: z.string().min(1).max(LIMITS.text).describe('Why this link matters, in one or two sentences'),
  })
  .strict();

export const AiFinding = z
  .object({
    severity: Severity,
    path: z.string().min(1).describe('Exact path of a file changed in one of the PRs; findings without a real path are dropped'),
    line: z.number().int().positive().nullable().describe('Line number in that file, or null'),
    where: z.string().min(1).max(LIMITS.where).describe('Short location label, e.g. "hub · apim/main.tf:164"'),
    text: z.string().min(1).max(LIMITS.findingText).describe('What is wrong and why, in one sentence'),
  })
  .strict();

export const AiResponse = z
  .object({
    tldr: z.string().min(1).max(LIMITS.tldr).describe('2 to 4 short sentences, one point each: what these PRs do together and the main thing to check'),
    summary: z.string().min(1).max(LIMITS.summary).describe('Three to five short sentences for a reviewer new to the feature'),
    ask: z.string().max(LIMITS.ask).describe('What the ticket asks for, in plain words; empty string if unknown'),
    prs: z.array(PrNote).describe('One entry per PR in the input'),
    links: z.array(LinkNote).describe('One entry per link in the input'),
    findings: z.array(AiFinding).max(LIMITS.findings).describe('Extra problems the rules did not find; at most 8; may be empty'),
    checklistOrder: z.array(z.string()).describe('Checklist item ids from the input, most important first'),
  })
  .strict();

export type AiResponse = z.infer<typeof AiResponse>;

/** JSON Schema for providers that support structured output (tool input schema, response_format, responseJsonSchema). */
export const AI_RESPONSE_JSON_SCHEMA: Record<string, unknown> = (() => {
  // "$schema" is dropped: some providers reject unknown top-level keywords.
  const { $schema: _drop, ...rest } = z.toJSONSchema(AiResponse, { target: 'draft-7' }) as Record<string, unknown>;
  void _drop;
  return rest;
})();

// ---------- Coercion before validation (like Pydantic's lax mode) ----------
// Models drift a little: records instead of arrays, "Blocking" instead of "High", over-long text.
// These fixes are mechanical and safe; anything still wrong fails validation and is sent back for repair.

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, max);
const sev = (v: unknown): string => {
  const t = String(v ?? '').toLowerCase();
  return /high|block|critical|severe/.test(t) ? 'High' : /med|should|warn/.test(t) ? 'Medium' : /info|low|nice|minor/.test(t) ? 'Info' : String(v ?? '');
};
const listOf = (v: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(v)) return v.map(obj);
  // {"L1": "text"} or {"owner/repo#1": {head, text}} -> [{id, ...}]
  return Object.entries(obj(v)).map(([id, x]) => (typeof x === 'string' ? { id, text: x } : { id, ...obj(x) }));
};

export function coerceAiResponse(raw: unknown): unknown {
  const r = obj(raw);
  return {
    tldr: text(r.tldr ?? r.tl_dr ?? r.oneLine, LIMITS.tldr),
    summary: text(r.summary, LIMITS.summary),
    ask: text(r.ask ?? r.ticket ?? '', LIMITS.ask),
    prs: listOf(r.prs).map((p) => ({ id: text(p.id, 200), head: text(p.head ?? p.headline ?? p.title, LIMITS.head), text: text(p.text ?? p.summary ?? p.description, LIMITS.text) })),
    links: listOf(r.links).map((l) => ({ id: text(l.id, 40), text: text(l.text ?? l.explanation ?? l.why, LIMITS.text) })),
    findings: (Array.isArray(r.findings) ? r.findings : []).slice(0, LIMITS.findings).map((f0) => {
      const f = obj(f0);
      const line = f.line == null || f.line === '' ? null : Number(f.line);
      return {
        severity: sev(f.severity ?? f.sev),
        path: text(f.path ?? f.file, 400),
        line: Number.isInteger(line) && (line as number) > 0 ? line : null,
        where: text(f.where ?? f.path ?? f.file, LIMITS.where),
        text: text(f.text ?? f.message ?? f.finding, LIMITS.findingText),
      };
    }),
    checklistOrder: (Array.isArray(r.checklistOrder) ? r.checklistOrder : []).map((x) => String(x)),
  };
}

export type ParseResult = { ok: true; data: AiResponse } | { ok: false; issues: string[] };

/** Coerce, then validate strictly. Returns readable issues for the repair prompt. */
export function parseAiResponse(raw: unknown): ParseResult {
  const res = AiResponse.safeParse(coerceAiResponse(raw));
  if (res.success) return { ok: true, data: res.data };
  return { ok: false, issues: res.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

/** Pull the JSON object out of a reply that may have prose or code fences around it. */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const body = fenced ? fenced[1] : reply;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the reply');
  return JSON.parse(body.slice(start, end + 1));
}
