// Cross-PR link rules. Parsers and token rules decide links; AI only explains them later.
import type { Evidence, FileNode, Impact, Link, LinkKind, PrSnapshot, Tone } from '../shared/model';
import { prId } from '../shared/model';
import { fileTypeOf, isTestPath } from './classify';
import { findRenames, parsePatch, tokens, type Hunk } from './diff';

export interface FileFacts {
  prId: string;
  path: string;
  nodeId: string;
  hunks: Hunk[];
  added: Map<string, { line: number; snippet: string }>;
  content: Set<string>;
  addedLiterals: Map<string, { line: number; snippet: string }>;
  addedNumbers: Map<string, { line: number; snippet: string }>;
  contentText: string;
}

const STOP = new Set(
  `additionalProperties description descriptions properties required validation condition error_message for_each depends_on
   default defaults optional variable variables resource resources module modules output outputs locals provider providers terraform
   string number object boolean integer null true false enabled disabled minimum maximum pattern items enum const type types
   value values name names parameters parameter displayName workingDirectory inputs script steps templates template
   dynamic content lifecycle ignore_changes tags location resource_group_name subscription subscriptions environment environments
   response_export_values schema_validation_enabled parent_id ignore_missing_property README readme example examples import export function return assert expected actual mock_provider run_test
   properties_ policies policy backend backends allOf anyOf oneOf definitions ref`.split(/\s+/).filter(Boolean),
);

const COMMON_LITERALS = new Set(['true', 'false', 'null', 'yes', 'no', 'none', 'string', 'number', 'object', 'array', 'integer', 'boolean', 'main', 'dev', 'prod', 'nonprod', 'test', 'type', 'required', 'properties', 'minimum', 'maximum', 'description', 'items', 'enum', 'const', 'pattern', 'default', 'title', 'additionalproperties', 'name', 'value', 'id', 'key', 'ref', 'schema', 'format']);

const PROVIDER_PREFIX = /^(azurerm|azapi|azuread|aws|google|random|null|time|local|kubernetes|helm|github)_/;
const unescapeXml = (t: string) => t.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function specific(tok: string): boolean {
  if (STOP.has(tok)) return false;
  if (PROVIDER_PREFIX.test(tok)) return false;
  if (tok.length < 4) return false;
  if (/[a-z][A-Z]/.test(tok)) return true; // camelCase
  if (/[_-]/.test(tok) && tok.length >= 6) return true;
  return tok.length >= 10;
}

/** Lines that only describe things (descriptions, comments, messages) don't make links. */
const DESCRIPTIVE = /^\s*(["']?(description|error_message|message|title|summary|comment)["']?\s*[:=]|#|\/\/|<!--|\*)/i;

const LIT_RE = /["']([a-z][a-z0-9-]{2,24})["']/g;
const NUM_RE = /(?<![\w.])(\d{3,})(?![\w.])/g;

export function buildFacts(snaps: PrSnapshot[], nodeOf: (pr: string, path: string) => string): FileFacts[] {
  const out: FileFacts[] = [];
  for (const s of snaps) {
    const id = prId(s.pr);
    for (const f of s.files) {
      if (f.status === 'removed') continue;
      const hunks = parsePatch(f.patch);
      const added = new Map<string, { line: number; snippet: string }>();
      const addedLiterals = new Map<string, { line: number; snippet: string }>();
      const addedNumbers = new Map<string, { line: number; snippet: string }>();
      for (const h of hunks)
        for (const l of h.lines) {
          if (l.type !== '+') continue;
          if (DESCRIPTIVE.test(l.text) && !/\.md$/.test(f.path)) continue;
          const lineText = /\.xml$/.test(f.path) ? unescapeXml(l.text) : l.text;
          const at = { line: l.newNo ?? 0, snippet: lineText.trim().slice(0, 160) };
          for (const t of tokens(lineText)) if (!added.has(t)) added.set(t, at);
          for (const m of lineText.matchAll(LIT_RE)) if (!COMMON_LITERALS.has(m[1]) && !addedLiterals.has(m[1])) addedLiterals.set(m[1], at);
          for (const m of lineText.matchAll(NUM_RE)) if (!addedNumbers.has(m[1])) addedNumbers.set(m[1], at);
        }
      const raw = s.contents[f.path] ?? '';
      const text = /\.xml$/.test(f.path) ? unescapeXml(raw) : raw;
      const contentTokens = new Set(/\.md$/.test(f.path) ? tokens(text) : text.split('\n').filter((l) => !DESCRIPTIVE.test(l)).flatMap(tokens));
      out.push({ prId: id, path: f.path, nodeId: nodeOf(id, f.path), hunks, added, content: contentTokens, addedLiterals, addedNumbers, contentText: text });
    }
  }
  return out;
}

interface Draft {
  kind: LinkKind;
  tone: Tone;
  impact: Impact;
  impactWhy: string;
  title: string;
  text: string;
  label: string;
  files: FileFacts[];
  evidence: Evidence[];
  shared: string[];
  score: number;
  /** producer -> consumer order of nodes for drawing arrows */
  direction?: Array<[string, string]>;
}

const typeRank = (path: string): number => {
  // Data-flow order used to point arrows: config -> schema/validation -> module -> policy; docs describe.
  const t = fileTypeOf(path);
  if (t === 'md') return 9;
  if (t === 'yaml' || t === 'json') return 1;
  if (t === 'schema') return 2;
  if (t === 'py') return 3;
  if (t === 'tf') return 4;
  if (t === 'apim') return 6;
  return 5;
};

const prLabel = (id: string, names: Record<string, string>) => names[id] ?? id;

export function findLinks(facts: FileFacts[], names: Record<string, string>): Link[] {
  const drafts: Draft[] = [];
  const prs = [...new Set(facts.map((f) => f.prId))];
  const nonTest = facts.filter((f) => !isTestPath(f.path));

  // ---- A + B. Same rename in several PRs, and the old name still in use ----
  const renames = new Map<string, Map<string, { file: FileFacts; line: number; snippet: string }[]>>();
  for (const f of facts) {
    if (fileTypeOf(f.path) === 'md') continue;
    for (const r of findRenames(f.hunks)) {
      const key = `${r.from}→${r.to}`;
      const byPr = renames.get(key) ?? new Map();
      const arr = byPr.get(f.prId) ?? [];
      arr.push({ file: f, line: r.line, snippet: r.snippet });
      byPr.set(f.prId, arr);
      renames.set(key, byPr);
    }
  }
  for (const [key, byPr] of renames) {
    if (byPr.size < 2) continue;
    const [from, to] = key.split('→');
    const prList = [...byPr.keys()];
    const hits = [...byPr.values()].flat();
    const files = uniqFiles(hits.filter((h) => !isTestPath(h.file.path)).map((h) => h.file).concat(hits.map((h) => h.file)));
    drafts.push({
      kind: 'connects', tone: 'bad', impact: 'Interface', impactWhy: 'A shared name changes. Everything that reads it must change at the same time.',
      title: `Same rename in ${prList.length} PRs`,
      text: `${prList.map((p) => prLabel(p, names)).join(' and ')} ${prList.length === 2 ? 'both' : 'all'} rename ${from} to ${to}. Merge them together: one without the other breaks whatever reads the new name.`,
      label: 'same rename · ship together',
      files: files.slice(0, 4),
      evidence: hits.slice(0, 4).map((h) => ({ prId: h.file.prId, path: h.file.path, line: h.line, snippet: h.snippet })),
      shared: [from, to], score: 100,
    });
    // B. old name still in use elsewhere (other PRs, or new lines in the renaming PRs)
    const wordRe = new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(from)}([^A-Za-z0-9_]|$)`);
    const stillUsing: Array<{ f: FileFacts; line: number; snippet: string }> = [];
    for (const f of nonTest.filter((x) => fileTypeOf(x.path) !== 'md')) {
      const renamedHere = hits.some((h) => h.file === f);
      const keyRe = new RegExp(`^\\s*["']?${escapeRe(from)}["']?\\s*[:=]`);
      const addedHit = [...f.hunks.flatMap((h) => h.lines)].find((l) => l.type === '+' && ((wordRe.test(l.text) && !l.text.includes(to)) || keyRe.test(l.text)));
      if (addedHit) stillUsing.push({ f, line: addedHit.newNo ?? 0, snippet: addedHit.text.trim().slice(0, 160) });
      else if (!renamedHere && !byPr.has(f.prId) && f.content.has(from) && wordRe.test(f.contentText)) {
        const idx = f.contentText.split('\n').findIndex((l) => wordRe.test(l));
        stillUsing.push({ f, line: idx + 1, snippet: f.contentText.split('\n')[idx]?.trim().slice(0, 160) ?? from });
      }
    }
    // docs that describe the rename
    const docHits = facts.filter((f) => fileTypeOf(f.path) === 'md' && !byPr.has(f.prId) && (f.added.has(to) || findRenames(f.hunks).some((r) => r.from === from && r.to === to)));
    for (const d of docHits) {
      const at = d.added.get(to) ?? { line: 0, snippet: to };
      const target = hits.find((h) => h.file.prId !== d.prId) ?? hits[0];
      drafts.push({
        kind: 'docs', tone: 'n', impact: 'Docs only', impactWhy: 'No runtime effect.', title: 'Docs match the rename',
        text: `${prLabel(d.prId, names)} updates ${base(d.path)} to say ${to}, matching ${prLabel(target.file.prId, names)}.`,
        label: 'documents the name', files: [d, target.file], evidence: [ev(d, at)], shared: [to], score: 36,
      });
    }
    const rankUse = (x: { f: FileFacts }) => (byPr.has(x.f.prId) ? 0 : fileTypeOf(x.f.path) === 'apim' ? 1 : 2);
    stillUsing.sort((p, q) => rankUse(p) - rankUse(q));
    const seenNode = new Set<string>();
    for (let k = stillUsing.length - 1; k >= 0; k--) void k;
    const uniqUse = stillUsing.filter((x) => (seenNode.has(x.f.nodeId) ? false : (seenNode.add(x.f.nodeId), true)));
    stillUsing.length = 0;
    stillUsing.push(...uniqUse);
    if (stillUsing.length) {
      const otherPrs = [...new Set(stillUsing.map((s) => s.f.prId))];
      drafts.push({
        kind: 'differs', tone: 'check', impact: 'Interface', impactWhy: 'Two names for one value.',
        title: 'Old name still in use',
        text: `${prList.map((p) => prLabel(p, names)).join(' and ')} rename ${from} to ${to}, but ${otherPrs.map((p) => prLabel(p, names)).join(' and ')} still use ${from} (${stillUsing.slice(0, 3).map((s) => base(s.f.path)).join(', ')}). Check this is intended.`,
        label: `name differs: ${from}`,
        files: uniqFiles([hits[0].file, ...stillUsing.map((s) => s.f)]).slice(0, 5),
        evidence: stillUsing.slice(0, 4).map((s) => ({ prId: s.f.prId, path: s.f.path, line: s.line, snippet: s.snippet })),
        shared: [from], score: 80,
      });
    }
  }

  // ---- C. Shared identifiers between files in different PRs ----
  const df = new Map<string, number>();
  for (const f of facts) for (const t of new Set([...f.added.keys(), ...f.content])) df.set(t, (df.get(t) ?? 0) + 1);
  const maxDf = Math.max(3, Math.ceil(facts.length * 0.4));
  const pairScores: Array<{ a: FileFacts; b: FileFacts; shared: string[] }> = [];
  const repoNames = [...new Set(prs.map((p) => p.split('/')[1]?.split('#')[0] ?? ''))].filter(Boolean);
  for (let i = 0; i < facts.length; i++)
    for (let j = i + 1; j < facts.length; j++) {
      const a = facts[i];
      const b = facts[j];
      if (a.prId === b.prId) continue;
      if (isTestPath(a.path) || isTestPath(b.path)) continue;
      const shared: string[] = [];
      for (const t of a.added.keys()) if (specific(t) && (df.get(t) ?? 0) <= maxDf && (b.added.has(t) || b.content.has(t))) shared.push(t);
      for (const t of b.added.keys()) if (specific(t) && (df.get(t) ?? 0) <= maxDf && a.content.has(t) && !shared.includes(t)) shared.push(t);
      const clean = shared.filter((t) => !repoNames.some((r) => t.includes(r)));
      const strong = clean.filter((t) => t.length >= 10 && /[a-z][A-Z]/.test(t));
      const script = /\.(sh|ipynb)$/.test(a.path) || /\.(sh|ipynb)$/.test(b.path);
      if (script) continue; // test scripts mention everything; they link through "old name" checks only
      const docs = fileTypeOf(a.path) === 'md' || fileTypeOf(b.path) === 'md';
      const cls = typeRank(a.path) <= typeRank(b.path) ? linkClass(a.path, b.path) : linkClass(b.path, a.path);
      const need = docs || cls === 'shared' ? 3 : 2;
      if (clean.length >= need || (!docs && cls !== 'shared' && strong.length >= 1)) pairScores.push({ a, b, shared: clean });
    }
  // group pairs by PR pair + link class
  const groups = new Map<string, { a: FileFacts; b: FileFacts; shared: string[] }[]>();
  for (const p of pairScores) {
    const [x, y] = typeRank(p.a.path) <= typeRank(p.b.path) ? [p.a, p.b] : [p.b, p.a];
    const cls = linkClass(x.path, y.path);
    const k = `${x.prId}|${y.prId}|${cls}`;
    const arr = groups.get(k) ?? [];
    arr.push({ a: x, b: y, shared: p.shared });
    groups.set(k, arr);
  }
  for (const [k, pairs] of groups) {
    const [pa, pb, cls] = k.split('|');
    const shared = [...new Set(pairs.flatMap((p) => p.shared))].sort((u, v) => v.length - u.length);
    const files = uniqFiles(pairs.flatMap((p) => [p.a, p.b]));
    const ev: Evidence[] = pairs.slice(0, 3).flatMap((p) => {
      const t = p.shared[0];
      const ea = p.a.added.get(t);
      const eb = p.b.added.get(t);
      return [ea && { prId: p.a.prId, path: p.a.path, line: ea.line, snippet: ea.snippet }, eb && { prId: p.b.prId, path: p.b.path, line: eb.line, snippet: eb.snippet }].filter(Boolean) as Evidence[];
    });
    const A = prLabel(pa, names);
    const B = prLabel(pb, names);
    const list = shared.slice(0, 5).join(', ');
    const d = describeClass(cls, A, B, list);
    drafts.push({ ...d, files: files.slice(0, 5), evidence: ev.slice(0, 4), shared: shared.slice(0, 8), score: 40 + Math.min(shared.length, 6) * 3 + ({ contract: 25, feeds: 20, 'same-config': 5, shared: 0, docs: -30 } as Record<string, number>)[cls] + (pairs.some((p) => /\.(sh|ipynb)$/.test(p.a.path + p.b.path)) ? -15 : 0),
      direction: pairs.map((p) => [p.a.nodeId, p.b.nodeId] as [string, string]) });
  }

  // ---- D. Same values: shared quoted names and shared limits/constants ----
  for (let i = 0; i < prs.length; i++)
    for (let j = i + 1; j < prs.length; j++) {
      const A = nonTest.filter((f) => f.prId === prs[i] && fileTypeOf(f.path) !== 'md');
      const B = nonTest.filter((f) => f.prId === prs[j] && fileTypeOf(f.path) !== 'md');
      const lits = new Map<string, [FileFacts, FileFacts]>();
      const nums = new Map<string, [FileFacts, FileFacts]>();
      for (const fa of A)
        for (const fb of B) {
          for (const v of fa.addedLiterals.keys()) if (fb.addedLiterals.has(v) || fb.contentText.includes(`"${v}"`)) lits.set(v, lits.get(v) ?? [fa, fb]);
          for (const v of fa.addedNumbers.keys()) if (Number(v) >= 100 && (fb.addedNumbers.has(v))) nums.set(v, nums.get(v) ?? [fa, fb]);
        }
      if (lits.size >= 3) {
        const vals = [...lits.keys()].slice(0, 6);
        const [fa, fb] = lits.get(vals[0])!;
        drafts.push({
          kind: 'matches', tone: 'n', impact: 'Interface', impactWhy: 'Names must match on both sides.',
          title: 'Same names on both sides',
          text: `${prLabel(prs[i], names)} and ${prLabel(prs[j], names)} both use ${vals.join(', ')}. They match today; keep them in step.`,
          label: 'same names', files: uniqFiles([...lits.values()].flat()).slice(0, 4),
          evidence: [ev(fa, fa.addedLiterals.get(vals[0])!), ev(fb, fb.addedLiterals.get(vals[0]) ?? { line: 0, snippet: vals[0] })],
          shared: vals, score: 22 + vals.length,
        });
      }
      const bigNums = [...nums.keys()].filter((v) => !/^(19|20)\d\d$/.test(v));
      if (bigNums.length >= 1) {
        const [fa, fb] = nums.get(bigNums[0])!;
        drafts.push({
          kind: 'matches', tone: 'n', impact: 'Behaviour', impactWhy: 'The same rule is checked in several places. Change one and the others must follow.',
          title: 'Same limits in several places',
          text: `${prLabel(prs[i], names)} and ${prLabel(prs[j], names)} both use ${bigNums.slice(0, 4).join(', ')}. Change one and the others must follow.`,
          label: 'same limits', files: uniqFiles([...nums.values()].flat()).slice(0, 4),
          evidence: [ev(fa, fa.addedNumbers.get(bigNums[0])!), ev(fb, fb.addedNumbers.get(bigNums[0])!)],
          shared: bigNums.slice(0, 4), score: 34 + bigNums.length,
        });
      }
    }

  // rank, cap and number
  drafts.sort((a, b) => b.score - a.score);
  const docsSeen = new Set<string>();
  const kept = dedupe(drafts).filter((d) => {
    if (d.kind !== 'docs') return true;
    const k = d.files.filter((f) => fileTypeOf(f.path) === 'md').map((f) => f.prId).sort().join(',');
    if (docsSeen.has(k)) return false;
    docsSeen.add(k);
    return true;
  }).slice(0, 10);
  return kept.map((d, i) => {
    const prIds = [...new Set(d.files.map((f) => f.prId))];
    return {
      id: `L${i + 1}`, n: i + 1, kind: d.kind, tone: d.tone, impact: d.impact, impactWhy: d.impactWhy, title: d.title, text: d.text, label: d.label,
      nodes: [...new Set(orderNodes(d))], prIds, evidence: d.evidence, shared: d.shared,
    } satisfies Link;
  });
}

function orderNodes(d: Draft): string[] {
  const files = d.files.slice().sort((a, b) => typeRank(a.path) - typeRank(b.path));
  return files.map((f) => f.nodeId);
}

function linkClass(a: string, b: string): string {
  const ta = fileTypeOf(a);
  const tb = fileTypeOf(b);
  if (ta === 'md' || tb === 'md') return 'docs';
  const cfg = (t: string) => t === 'yaml' || t === 'json' || t === 'schema';
  if (cfg(ta) && tb === 'tf') return 'feeds';
  if (ta === 'tf' && (tb === 'apim' || tb === 'json')) return 'contract';
  if (cfg(ta) && cfg(tb)) return 'same-config';
  if (cfg(ta) && (tb === 'apim' || tb === 'py')) return 'feeds';
  return 'shared';
}

function describeClass(cls: string, A: string, B: string, list: string): Pick<Draft, 'kind' | 'tone' | 'impact' | 'impactWhy' | 'title' | 'text' | 'label'> {
  switch (cls) {
    case 'feeds':
      return { kind: 'connects', tone: 'n', impact: 'Interface', impactWhy: 'Config keys are read as inputs. Names and shapes must match.', title: `${A} config feeds ${B}`, text: `${B} reads settings that ${A} changes: ${list}.`, label: 'config feeds in' };
    case 'contract':
      return { kind: 'connects', tone: 'n', impact: 'Interface', impactWhy: 'The record shape is a contract between the writer and the reader.', title: 'Record contract', text: `${A} writes fields that ${B} reads: ${list}.`, label: 'record fields' };
    case 'same-config':
      return { kind: 'matches', tone: 'n', impact: 'Interface', impactWhy: 'The same settings live in two places.', title: 'Same settings in two places', text: `${A} and ${B} both change ${list}.`, label: 'same settings' };
    case 'docs':
      return { kind: 'docs', tone: 'n', impact: 'Docs only', impactWhy: 'No runtime effect.', title: 'Docs describe the change', text: `${A === B ? A : `${A} and ${B}`} mention ${list}.`, label: 'documents it' };
    default:
      return { kind: 'connects', tone: 'n', impact: 'Interface', impactWhy: 'Both sides use the same names.', title: `${A} and ${B} share names`, text: `Both change code that uses ${list}.`, label: 'shared names' };
  }
}

function dedupe(ds: Draft[]): Draft[] {
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const d of ds) {
    const key = d.kind + ':' + d.files.map((f) => f.nodeId).sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function uniqFiles(fs: FileFacts[]): FileFacts[] {
  const seen = new Set<string>();
  return fs.filter((f) => (seen.has(f.prId + f.path) ? false : (seen.add(f.prId + f.path), true)));
}
const ev = (f: FileFacts, at: { line: number; snippet: string }): Evidence => ({ prId: f.prId, path: f.path, line: at.line, snippet: at.snippet });
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type { FileNode };
