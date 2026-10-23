// Team rules read from AGENTS.md, CLAUDE.md and .github/copilot-instructions.md.
// Rules with a known shape become mechanical checks; rules that need judgement go to the checklist.
import type { CheckItem, Finding, PrSnapshot, TeamRuleCheck, Verified } from '../shared/model';
import { prId } from '../shared/model';
import { changeKindOf, dirOf, fileTypeOf } from './classify';
import { parsePatch } from './diff';

export const RULE_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];

interface Ctx {
  s: PrSnapshot;
  id: string;
  label: string;
  file: string;
  text: string;
  nodeOf: (pr: string, path: string) => string;
}

type Checker = (c: Ctx) => TeamRuleCheck[];

const strip = (s: string) => s.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** 1. "Every file in `.azdo/templates/` must be prefixed with its tool, `terraform-` or `bicep-`" */
const prefixRule: Checker = (c) => {
  const out: TeamRuleCheck[] = [];
  const re = /(?:every|all) files? in `([^`]+)`[^.\n]*?must be prefixed with[^`\n]*`([^`]+)`(?:\s*(?:or|,)\s*`([^`]+)`)?/gi;
  for (const m of c.text.matchAll(re)) {
    const dir = m[1].replace(/\/$/, '');
    const prefixes = [m[2], m[3]].filter(Boolean) as string[];
    const files = c.s.files.filter((f) => f.status !== 'removed' && f.path.startsWith(dir + '/'));
    for (const f of files) {
      const base = f.path.slice(f.path.lastIndexOf('/') + 1);
      const ok = prefixes.some((p) => base.startsWith(p));
      out.push({ id: `TR-${c.id}-prefix-${f.path}`, prId: c.id, ruleFile: c.file, rule: clip(strip(m[0])), passed: ok, where: `${c.label} · ${f.path}`,
        text: ok ? `${base} starts with its tool (${prefixes.join(' or ')}), as the rules require` : `${base} must start with ${prefixes.join(' or ')}`, nodeId: c.nodeOf(c.id, f.path) });
    }
  }
  return out;
};

/** 2. "Always use the `.yaml` extension. Never use `.yml`." */
const extensionRule: Checker = (c) => {
  const m = /always use the `\.?(\w+)` extension\.?\s*never use `\.?(\w+)`/i.exec(c.text);
  if (!m) return [];
  const [, good, bad] = m;
  // Folders the rule text exempts, e.g. "do not rename any `.yml` files under `.ci/`".
  const exempt = [...c.text.matchAll(/under\s+`(\.?[\w.-]+\/)`/gi)].map((x) => x[1]);
  const touched = c.s.files.filter((f) => f.status !== 'removed' && (f.path.endsWith('.' + good) || f.path.endsWith('.' + bad)) && !exempt.some((d) => f.path.startsWith(d)));
  if (!touched.length) return [];
  const badOnes = touched.filter((f) => f.path.endsWith('.' + bad) && f.status === 'added');
  return [{ id: `TR-${c.id}-ext`, prId: c.id, ruleFile: c.file, rule: clip(strip(m[0])), passed: badOnes.length === 0, where: `${c.label} · ${touched.length} files`,
    text: badOnes.length ? `New files use .${bad}: ${badOnes.map((f) => f.path).join(', ')}` : `Files use .${good}, never .${bad}`, nodeId: c.nodeOf(c.id, (badOnes[0] ?? touched[0]).path) }];
};

/** 3. "Whenever a key is added or removed, you must update `config/<deployment>/config.schema.json`" */
const pairedSchemaRule: Checker = (c) => {
  const m = /key is added or removed,? you \*{0,2}must\*{0,2} update `([^`]+)`/i.exec(c.text);
  if (!m) return [];
  const pattern = m[1];
  const schemaRe = new RegExp('^' + pattern.split(/<[^>]+>/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '$');
  const cfgDir = dirOf(pattern);
  const cfgRe = new RegExp('^' + cfgDir.split(/<[^>]+>/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+') + '/[^/]+\\.ya?ml$');
  const out: TeamRuleCheck[] = [];
  const cfgFiles = c.s.files.filter((f) => cfgRe.test(f.path));
  const byDir = new Map<string, string[]>();
  for (const f of cfgFiles) {
    const added = parsePatch(f.patch).flatMap((h) => h.lines).filter((l) => l.type === '+' && /^[A-Za-z_][\w]*:\s*($|[^\s])/.test(l.text)).map((l) => l.text.split(':')[0].trim());
    if (!added.length) continue;
    const d = dirOf(f.path);
    byDir.set(d, [...new Set([...(byDir.get(d) ?? []), ...added])]);
  }
  for (const [d, keys] of byDir) {
    const schema = c.s.files.find((f) => schemaRe.test(f.path) && dirOf(f.path) === d);
    const missing = schema ? keys.filter((k) => !(schema.patch ?? '').includes(`"${k}"`)) : keys;
    out.push({ id: `TR-${c.id}-schema-${d}`, prId: c.id, ruleFile: c.file, rule: clip(strip(m[0])), passed: missing.length === 0, where: `${c.label} · ${d}/`,
      text: missing.length === 0 ? `New config keys ${keys.slice(0, 3).join(', ')} are also added to ${schema?.path.split('/').pop()}` : `Config keys added without a schema change: ${missing.slice(0, 4).join(', ')}`,
      nodeId: c.nodeOf(c.id, (schema ?? cfgFiles[0]).path) });
  }
  return out;
};

/** 4. "Always give variables a `description` and `type`" */
const tfVariableRule: Checker = (c) => {
  const m = /always give variables a `description` and `type`/i.exec(c.text);
  if (!m) return [];
  const out: TeamRuleCheck[] = [];
  for (const f of c.s.files) {
    if (!/variables\.tf$/.test(f.path) || f.status === 'removed') continue;
    const lines = parsePatch(f.patch).flatMap((h) => h.lines);
    const newVars: string[] = [];
    for (const l of lines) {
      const v = /^\s*variable\s+"([^"]+)"/.exec(l.text);
      if (v && l.type === '+') newVars.push(v[1]);
    }
    if (!newVars.length) continue;
    const content = c.s.contents[f.path] ?? '';
    const missing = newVars.filter((v) => {
      const block = blockOf(content, `variable "${v}"`);
      return !/\bdescription\s*=/.test(block) || !/\btype\s*=/.test(block);
    });
    out.push({ id: `TR-${c.id}-tfvar-${f.path}`, prId: c.id, ruleFile: c.file, rule: clip(strip(m[0])), passed: missing.length === 0, where: `${c.label} · ${f.path}`,
      text: missing.length === 0 ? `${newVars.length === 1 ? 'The new variable has' : `All ${newVars.length} new variables have`} a description and a type` : `Missing description or type: ${missing.join(', ')}`, nodeId: c.nodeOf(c.id, f.path) });
  }
  return out;
};

/** 5. "`docs/index.md` ... must list every `.md` file" */
const docsIndexRule: Checker = (c) => {
  const m = /`([^`]*index\.md)`[^.]*\. It must maintain|`([^`]*index\.md)` is the single entry point/i.exec(c.text);
  const idx = m?.[1] ?? m?.[2];
  if (!idx) return [];
  const newDocs = c.s.files.filter((f) => f.status === 'added' && f.path.endsWith('.md') && f.path.startsWith(dirOf(idx) + '/') && f.path !== idx);
  const touchedIdx = c.s.files.some((f) => f.path === idx);
  const anyDocs = c.s.files.some((f) => f.path.endsWith('.md') && f.path.startsWith(dirOf(idx) + '/'));
  if (!anyDocs) return [];
  const ok = newDocs.length === 0 || touchedIdx;
  return [{ id: `TR-${c.id}-docsindex`, prId: c.id, ruleFile: c.file, rule: `${idx} must list every .md file`, passed: ok, where: c.label,
    text: newDocs.length === 0 ? `No new doc files, so ${idx} needs no update` : ok ? `${idx} updated for the new docs` : `New docs not added to ${idx}: ${newDocs.map((f) => f.path).join(', ')}`,
    nodeId: c.nodeOf(c.id, (newDocs[0] ?? c.s.files.find((f) => f.path.endsWith('.md')))!.path) }];
};

/** 6. "Do not modify files in `/auth/` without human approval" */
const protectedPathRule: Checker = (c) => {
  const out: TeamRuleCheck[] = [];
  const re = /do not (?:modify|change|touch|edit) (?:any )?(?:files? )?(?:in|under) `([^`]+)`[^.\n]*/gi;
  for (const m of c.text.matchAll(re)) {
    const dir = m[1].replace(/^\//, '').replace(/\/$/, '');
    const hit = c.s.files.filter((f) => f.path.startsWith(dir + '/'));
    if (!hit.length) continue;
    out.push({ id: `TR-${c.id}-protect-${dir}`, prId: c.id, ruleFile: c.file, rule: clip(strip(m[0])), passed: false, where: `${c.label} · ${dir}/`,
      text: `Touches a protected path (${dir}/): needs human approval`, nodeId: c.nodeOf(c.id, hit[0].path) });
  }
  return out;
};

const CHECKERS: Checker[] = [prefixRule, extensionRule, pairedSchemaRule, tfVariableRule, docsIndexRule, protectedPathRule];

export function checkTeamRules(snaps: PrSnapshot[], labels: Record<string, string>, nodeOf: (pr: string, path: string) => string) {
  const checks: TeamRuleCheck[] = [];
  const files: Array<{ prId: string; repo: string; path: string; checked: number }> = [];
  const human: CheckItem[] = [];
  for (const s of snaps) {
    const id = prId(s.pr);
    for (const [file, text] of Object.entries(s.ruleFiles)) {
      const ctx: Ctx = { s, id, label: labels[id], file, text, nodeOf };
      const found = CHECKERS.flatMap((ch) => {
        try {
          return ch(ctx);
        } catch {
          return [];
        }
      });
      checks.push(...found);
      files.push({ prId: id, repo: s.pr.repo, path: file, checked: found.length });
      human.push(...judgementRules(ctx).slice(0, 2));
    }
  }
  const findings: Finding[] = checks.filter((c) => !c.passed).map((c) => ({
    id: `F-${c.id}`, sev: /protected path/.test(c.text) ? 'High' : 'Medium', src: 'Team rule', aiReviewer: false, where: c.where, text: c.text, nodeId: c.nodeId, prId: c.prId, status: 'Open',
  }));
  const verified: Verified[] = checks.filter((c) => c.passed).map((c) => ({ id: `V-${c.id}`, src: 'Team rule', where: c.where, text: c.text, nodeId: c.nodeId }));
  return { checks, files, findings, verified, human: human.slice(0, 3) };
}

/** Bold-lead bullet rules that need a person, filtered to what the PR touches. */
function judgementRules(c: Ctx): CheckItem[] {
  const kinds = new Set(c.s.files.map((f) => fileTypeOf(f.path)));
  const logic = c.s.files.some((f) => changeKindOf(f.path) === 'Logic');
  const out: CheckItem[] = [];
  for (const m of c.text.matchAll(/^\s*-\s+\*\*([^*]{8,90})\*\*:?\s*(.*)$/gm)) {
    const head = m[1].replace(/[.:]$/, '').trim();
    const rest = m[2];
    const judgement = /\b(focused|keep .* (small|simple)|one (job|logical unit)|consistent|symmetric|don'?t fold|avoid|readable|descriptive)\b/i.test(head + ' ' + rest);
    if (!judgement) continue;
    const relevant = (/module|terraform/i.test(head + rest) && kinds.has('tf')) || (/yaml|config/i.test(head + rest) && kinds.has('yaml')) || (logic && /code|logic/i.test(head + rest));
    if (!relevant) continue;
    out.push({ id: `H-${c.id}-${out.length}`, label: `${c.label} rule “${head.toLowerCase()}”: does this change follow it? (rules can’t check this)`, human: true });
  }
  return out;
}

function blockOf(content: string, opener: string): string {
  const i = content.indexOf(opener);
  if (i < 0) return '';
  let depth = 0;
  let started = false;
  for (let j = content.indexOf('{', i); j < content.length && j >= 0; j++) {
    const ch = content[j];
    if (ch === '{') {
      depth++;
      started = true;
    } else if (ch === '}') {
      depth--;
      if (started && depth === 0) return content.slice(i, j + 1);
    }
  }
  return content.slice(i);
}
