// Optional AI explanations. Parsers decide the links; AI only explains and ranks them.
// Every AI claim must cite a file that is in the PRs, or it is dropped.
import type { AiNotes, Report } from '../../shared/model';
import { redact, redactDeep } from './redact';
import { complete, providerName } from './providers';
import { AI_RESPONSE_JSON_SCHEMA, extractJson, parseAiResponse, type AiResponse } from './schema';
import { getSettings } from '../settings';
import { PROMPTS, fill } from './prompts.config';

const P = PROMPTS.explain;


export function buildPrompt(r: Report, ruleText: string): string {
  const input = {
    tickets: r.tickets.map((t) => ({ key: t.key, title: t.title, criteria: t.criteria })),
    prs: r.cards.map((c) => ({ id: c.prId, role: c.role, description: c.text, files: c.files, fit: c.fit.label })),
    files: r.nodes.map((n) => ({ id: n.id, pr: n.prId, name: n.name, paths: n.paths.slice(0, 8), sub: n.sub })),
    links: r.links.map((l) => ({ id: l.id, title: l.title, text: l.text, shared: l.shared, evidence: l.evidence.map((e) => `${e.path}:${e.line ?? ''} ${e.snippet}`) })),
    findings: r.findings.filter((f) => f.status === 'Open').map((f) => ({ sev: f.sev, src: f.src, where: f.where, text: f.text })),
    checklist: r.checklist.map((c) => ({ id: c.id, label: c.label })),
    teamRules: ruleText.slice(0, P.teamRulesChars),
  };
  return JSON.stringify(redactDeep(input));
}

export async function explain(r: Report, ruleText: string): Promise<AiNotes> {
  const s = getSettings();
  if (!s.ai.enabled) throw new Error('AI is off. Turn it on in Settings › AI.');
  const prompt = buildPrompt(r, redact(ruleText));
  let reply = await complete(P.system, prompt, AI_RESPONSE_JSON_SCHEMA);
  let parsed = validate(reply);
  // One repair round, the way Pydantic-based tools (for example instructor) retry: send the exact validation errors back.
  if (!parsed.ok) {
    console.error('[prsight] AI reply failed validation, asking for a fix:', parsed.issues);
    const repair = fill(P.repair, { input: prompt, issues: parsed.issues.map((i) => `- ${i}`).join('\n'), previous: reply.slice(0, P.repairQuoteChars) });
    reply = await complete(P.system, repair, AI_RESPONSE_JSON_SCHEMA);
    parsed = validate(reply);
  }
  if (!parsed.ok) {
    console.error('[prsight] AI reply still invalid:', parsed.issues, reply.slice(0, 1500));
    throw new Error(`The AI reply did not match the expected format, so it was not used (${parsed.issues[0]}).`);
  }
  return toNotes(r, parsed.data, providerName(s.ai.provider));
}

function validate(reply: string): { ok: true; data: AiResponse } | { ok: false; issues: string[] } {
  let json: unknown;
  try {
    json = extractJson(reply);
  } catch (e) {
    return { ok: false, issues: [(e as Error).message] };
  }
  return parseAiResponse(json);
}

/** Map the validated model onto the report, keeping only ids and files that really exist. */
export function toNotes(r: Report, out: AiResponse, provider: string): AiNotes {
  const allPaths = new Set(r.nodes.flatMap((n) => n.paths));
  return {
    provider,
    tldr: out.tldr,
    summary: out.summary,
    ask: out.ask || undefined,
    prs: Object.fromEntries(out.prs.filter((p) => r.prIds.includes(p.id)).map((p) => [p.id, { head: p.head, text: p.text }])),
    links: Object.fromEntries(out.links.filter((l) => r.links.some((x) => x.id === l.id)).map((l) => [l.id, l.text])),
    // Drop any claim that does not cite a file in these PRs.
    findings: out.findings.filter((f) => allPaths.has(f.path)).map((f) => ({ sev: f.severity, where: f.where, text: f.text, path: f.path, line: f.line ?? undefined })),
    checklistOrder: out.checklistOrder.filter((id) => r.checklist.some((c) => c.id === id)),
  };
}
