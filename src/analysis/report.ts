// Builds a complete, rule-based Report from PR snapshots. No AI, no network.
import type {
  CheckItem, Edge, Finding, FileNode, Link, MergeStep, NodeOverlay, PrCard, PrSnapshot, Report, StoryArrow, StoryBox, Ticket, TourStep, Verified,
} from '../shared/model';
import { prId } from '../shared/model';
import { changeKindOf, fileTypeOf, firstHeading, groupKey, isTestPath, pathPattern, plainName } from './classify';
import { findRenames, parsePatch, tokens } from './diff';
import { reviewFindings, ruleFindings } from './findings';
import { buildFacts, findLinks } from './links';
import { checkTeamRules } from './teamRules';
import { detectTickets, ticketSources, type DetectOptions, DEFAULT_DETECT } from './tickets';

export interface BuildOptions {
  detect?: DetectOptions;
  manualTickets?: string[];
  /** Ticket details from a board connector, keyed by Ticket.id. */
  ticketDetails?: Record<string, { title?: string; state?: string; url?: string; criteria?: string[] }>;
  now?: string;
}

/** Strip the shared prefix of repo names: acme-platform-hub -> hub (when every repo shares it). */
export function repoLabels(snaps: PrSnapshot[]): Record<string, string> {
  const repos = [...new Set(snaps.map((s) => s.pr.repo))];
  let prefix = '';
  if (repos.length > 1) {
    const parts = repos.map((r) => r.split('-'));
    const out: string[] = [];
    for (let i = 0; ; i++) {
      const v = parts[0][i];
      if (v === undefined || !parts.every((p) => p[i] === v)) break;
      out.push(v);
    }
    prefix = out.join('-');
  }
  const labels: Record<string, string> = {};
  for (const s of snaps) {
    const r = s.pr.repo;
    const short = prefix && r.startsWith(prefix + '-') ? r.slice(prefix.length + 1) : r;
    labels[prId(s.pr)] = `${short} #${s.pr.number}`;
  }
  return labels;
}

export function buildReport(snaps: PrSnapshot[], opts: BuildOptions = {}): Report {
  const labels = repoLabels(snaps);
  const detect = opts.detect ?? DEFAULT_DETECT;

  // ---------- nodes ----------
  const nodes: FileNode[] = [];
  const nodeIdx = new Map<string, string>(); // `${pr}|${path}` -> node id
  for (const s of snaps) {
    const id = prId(s.pr);
    const groups = new Map<string, string[]>();
    for (const f of s.files) {
      const k = groupKey(f.path);
      groups.set(k, [...(groups.get(k) ?? []), f.path]);
    }
    for (const [k, paths] of groups) {
      const nid = `${id}::${k}`;
      const files = s.files.filter((f) => paths.includes(f.path));
      const renames = files.flatMap((f) => findRenames(parsePatch(f.patch)));
      const added = files.every((f) => f.status === 'added');
      const sub = renames.length ? `${renames[0].from} → ${renames[0].to}` : added ? (paths.length > 1 ? `${paths.length} new files` : 'New file') : files.some((f) => f.status === 'removed') ? 'Removed' : `+${sum(files, 'additions')} −${sum(files, 'deletions')}`;
      const types = [...new Set(paths.map(fileTypeOf))];
      nodes.push({
        id: nid, prId: id, name: plainName(k, paths, firstHeading(s.contents[paths[0]])), path: pathPattern(paths), paths, sub, fileTypes: types,
        kind: changeKindOf(paths[0]), isTest: paths.every(isTestPath), additions: sum(files, 'additions'), deletions: sum(files, 'deletions'), key: false,
      });
      for (const p of paths) nodeIdx.set(`${id}|${p}`, nid);
    }
  }
  const nodeOf = (pr: string, path: string): string => nodeIdx.get(`${pr}|${path}`) ?? nodes.find((n) => n.prId === pr)?.id ?? '';
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // ---------- links ----------
  const facts = buildFacts(snaps, nodeOf);
  const links: Link[] = findLinks(facts, labels);

  // ---------- edges ----------
  const edges: Edge[] = [];
  for (const l of links) {
    for (let i = 0; i + 1 < l.nodes.length; i++) {
      const a = nodeById.get(l.nodes[i]);
      const b = nodeById.get(l.nodes[i + 1]);
      if (!a || !b || a.prId === b.prId) continue;
      edges.push({ id: `E-${l.id}-${i}`, from: a.id, to: b.id, kind: l.kind, linkId: l.id });
    }
    // make sure every PR touched by the link is reached
    const first = l.nodes[0];
    for (const n of l.nodes.slice(1)) if (!edges.some((e) => e.linkId === l.id && (e.to === n || e.from === n)) && nodeById.get(n)?.prId !== nodeById.get(first)?.prId) edges.push({ id: `E-${l.id}-x${n}`, from: first, to: n, kind: l.kind, linkId: l.id });
  }
  edges.push(...internalEdges(snaps, nodes, facts));

  // ---------- findings ----------
  const reviewF = snaps.flatMap((s) => reviewFindings(s, nodeOf, labels[prId(s.pr)].replace(/ #\d+$/, '')));
  const rules = checkTeamRules(snaps, labels, nodeOf);
  const ruleF = ruleFindings(snaps, links, nodeOf, labels);
  const findings: Finding[] = dedupeFindings([...reviewF, ...ruleF, ...rules.findings]);

  // ---------- verified ----------
  const verified: Verified[] = [...rules.verified];
  for (const l of links.filter((x) => x.kind === 'matches' || (x.kind === 'connects' && x.tone === 'n'))) {
    verified.push({ id: `V-${l.id}`, src: 'Rule', where: `link ${l.n}`, text: l.kind === 'matches' ? `${l.title}: ${l.shared.slice(0, 4).join(', ')}` : `${l.title}: names match on both sides`, nodeId: l.nodes[0] });
  }
  const logicNodes = nodes.filter((n) => !n.isTest && (n.kind === 'Logic' || n.kind === 'Config'));
  const overlays = buildOverlays(snaps, nodes, findings, links, opts);
  const tested = logicNodes.filter((n) => !overlays[n.id].noTest).length;
  if (logicNodes.length) verified.push({ id: 'V-tests', src: 'Rule', where: 'all PRs', text: `${tested} of ${logicNodes.length} changed areas come with a test change` });
  for (const f of findings.filter((x) => x.status === 'Fixed')) verified.push({ id: `V-${f.id}`, src: 'Review', where: f.where, text: f.text, nodeId: f.nodeId });

  // key nodes: in a link, or with a High finding
  const linked = new Set(links.flatMap((l) => l.nodes));
  for (const n of nodes) n.key = linked.has(n.id) || findings.some((f) => f.nodeId === n.id && f.sev === 'High' && f.status === 'Open');

  // ---------- tickets ----------
  const tickets: Ticket[] = detectTickets(snaps, detect, opts.manualTickets ?? []).map((t) => ({ ...t, ...(opts.ticketDetails?.[t.id] ?? {}) }));

  // ---------- cards, story, tour, order ----------
  const cards = snaps.map((s) => card(s, nodes, findings, links, tickets, labels, overlays));
  const story = buildStory(snaps, cards, links, labels, nodes);
  const order = mergeOrder(snaps, links, findings, labels, story.boxes);
  const tour = buildTour(story, cards, findings, labels);
  const checklist = buildChecklist(nodes, links, findings, rules.human, labels);

  const open = findings.filter((f) => f.status === 'Open');
  const totals = { files: snaps.reduce((a, s) => a + s.files.length, 0), links: links.length, high: open.filter((f) => f.sev === 'High').length, medium: open.filter((f) => f.sev === 'Medium').length, info: open.filter((f) => f.sev === 'Info').length };
  const together = links.filter((l) => l.tone === 'bad').map((l) => l.prIds.map((p) => labels[p].split(' ')[1]).join(' and '));
  const tk = tickets[0] ? (tickets[0].system === 'ado' ? `AB#${tickets[0].key}` : tickets[0].key) : null;
  const tldr = [
    `${snaps.length} PR${snaps.length === 1 ? '' : 's'}${tk ? ` for ${tk}` : ''}`,
    together.length ? `${together[0]} must merge together` : null,
    `${totals.high} high finding${totals.high === 1 ? '' : 's'}, ${totals.medium} medium`,
  ].filter(Boolean).join(' · ') + '.';
  const text = `${snaps.length} PRs, ${totals.files} files, ${links.length} cross-PR links. ` +
    (together.length ? `${together.join('; ')} must merge together. ` : '') +
    links.filter((l) => l.kind === 'connects' && l.tone === 'n').slice(0, 2).map((l) => `${l.title} (link ${l.n}).`).join(' ') +
    ` ${totals.high} high findings.`;
  const watch = rankFindings(open).slice(0, 3).map((f) => ({ sev: f.sev === 'High' ? 'Blocking' : f.sev === 'Medium' ? 'Should fix' : 'Check', head: headline(f), text: `${f.aiReviewer ? 'AI reviewer · ' : ''}${f.src}, ${f.where}` }));

  return {
    id: `R-${Date.now().toString(36)}`, createdAt: opts.now ?? new Date().toISOString(), title: reportTitle(snaps, tickets),
    prs: snaps.map((s) => s.pr), prIds: snaps.map((s) => prId(s.pr)), tickets, nodes, edges, links, findings, verified, teamRules: rules.checks, ruleFiles: rules.files,
    cards, story, tour, order, checklist, overlays, summary: { tldr, text: text.replace(/\s+/g, ' ').trim(), watch }, totals,
  };
}

const sum = (fs: Array<{ additions: number; deletions: number }>, k: 'additions' | 'deletions') => fs.reduce((a, f) => a + f[k], 0);

function reportTitle(snaps: PrSnapshot[], tickets: Ticket[]): string {
  const t = snaps[0]?.pr.title.replace(/^\[[^\]]+]\s*/, '').replace(/^\d{5,8}\s*-\s*/, '').replace(/\s*-\s*Part \d+$/i, '') ?? 'Report';
  return t.length > 40 ? t.slice(0, 39) + '…' : t || (tickets[0] ? `Ticket ${tickets[0].key}` : 'Report');
}

function dedupeFindings(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((f) => {
    const k = f.prId + f.where + f.text.slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sevRank = { High: 3, Medium: 2, Info: 1 } as const;
export const rankFindings = (fs: Finding[]): Finding[] => fs.slice().sort((a, b) => sevRank[b.sev] - sevRank[a.sev] || Number(b.aiReviewer) - Number(a.aiReviewer));

function headline(f: Finding): string {
  const t = f.text.replace(/\s*\([^)]*\)\s*$/, '');
  return t.length > 70 ? t.slice(0, 69) + '…' : t;
}

function internalEdges(snaps: PrSnapshot[], nodes: FileNode[], facts: ReturnType<typeof buildFacts>): Edge[] {
  const out: Edge[] = [];
  for (const s of snaps) {
    const id = prId(s.pr);
    const ns = nodes.filter((n) => n.prId === id);
    const tok = new Map<string, Set<string>>();
    for (const n of ns) {
      const set = new Set<string>();
      for (const f of facts.filter((x) => x.prId === id && n.paths.includes(x.path))) for (const t of f.added.keys()) if (/[a-z][A-Z]|_/.test(t) && t.length >= 6) set.add(t);
      tok.set(n.id, set);
    }
    for (let i = 0; i < ns.length; i++)
      for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i];
        const b = ns[j];
        const shared = [...tok.get(a.id)!].filter((t) => tok.get(b.id)!.has(t));
        const testLink = (a.isTest || b.isTest) && shared.length >= 1;
        if (shared.length >= 3 || testLink) {
          const [from, to] = a.isTest ? [a, b] : b.isTest ? [b, a] : rank(a) <= rank(b) ? [a, b] : [b, a];
          out.push({ id: `I-${from.id}-${to.id}`, from: from.id, to: to.id, kind: 'int' });
        }
      }
  }
  return out;
}
const rank = (n: FileNode) => ({ Config: 1, Logic: 3, Script: 4, Pipeline: 5, Test: 6, Docs: 7 })[n.kind];

function buildOverlays(snaps: PrSnapshot[], nodes: FileNode[], findings: Finding[], links: Link[], opts: BuildOptions): Record<string, NodeOverlay> {
  const out: Record<string, NodeOverlay> = {};
  for (const s of snaps) {
    const id = prId(s.pr);
    const tests = s.files.filter((f) => isTestPath(f.path));
    const testText = tests.map((t) => (s.contents[t.path] ?? '') + '\n' + (t.patch ?? '')).join('\n');
    const topic = topicWords(s, opts);
    const since = s.changedSinceLastReview ?? null;
    for (const n of nodes.filter((x) => x.prId === id)) {
      const covered = n.isTest || tests.some((t) => n.paths.some((p) => t.path.startsWith(dirOfPath(p) + '/'))) || n.paths.some((p) => testText.includes(baseName(p).replace(/\.(tf|ya?ml|json|py|sh|xml)$/, '')));
      const noTest = !covered && (n.kind === 'Logic');
      const tests_ = n.isTest ? 'Test files' : n.kind === 'Docs' ? 'Docs' : covered ? '✓ Test changed' : n.kind === 'Logic' ? 'No test changed' : 'Covered by config validation';
      out[n.id] = {
        tests: tests_, noTest, kind: n.kind, since: since ? n.paths.some((p) => since.includes(p)) : null,
        risk: risk(s, n, findings), fit: scopeNote(s, n, topic, links),
      };
    }
  }
  return out;
}
const dirOfPath = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function risk(s: PrSnapshot, n: FileNode, findings: Finding[]): NodeOverlay['risk'] {
  if (n.isTest || n.kind === 'Docs') return { level: 'Low', why: n.isTest ? 'Tests' : 'Docs' };
  const hist = n.paths.map((p) => s.history?.[p]).filter(Boolean) as Array<{ commits: number; fixes: number; sample: number }>;
  const high = findings.some((f) => f.nodeId === n.id && f.sev === 'High' && f.status === 'Open');
  const deletes = n.paths.some((p) => /"DELETE"|\bdestroy\b|azapi_resource_action/.test(s.files.find((f) => f.path === p)?.patch ?? ''));
  const policy = n.fileTypes.includes('apim');
  const reasons: string[] = [];
  let score = 0;
  if (hist.length) {
    const commits = Math.max(...hist.map((h) => h.commits));
    const fixes = Math.max(...hist.map((h) => h.fixes));
    const sample = Math.max(...hist.map((h) => h.sample));
    if (commits >= sample * 0.35) { score += 2; reasons.push(`hotspot: changed in ${commits} of the last ${sample} commits`); }
    else if (commits >= 3) { score += 1; reasons.push(`changed in ${commits} of the last ${sample} commits`); }
    if (fixes >= 2) { score += 2; reasons.push(`${fixes} bug fixes recently`); } else if (fixes === 1) { score += 1; reasons.push('1 bug fix recently'); }
  }
  if (high) { score += 2; reasons.push('1 high finding'); }
  if (deletes) { score += 2; reasons.push('deletes resources'); }
  if (policy) { score += 2; reasons.push('policy runs on every call'); }
  if (n.kind === 'Pipeline') { score += 1; reasons.push('CI change affects every build'); }
  if (n.kind === 'Logic' && !reasons.length) { score += 1; reasons.push('logic change'); }
  if (!hist.length && score < 2) {
    const isNew = n.paths.every((p) => s.files.find((f) => f.path === p)?.status === 'added');
    return { level: 'Unknown', why: isNew ? 'Not enough history: new file' : 'Not enough history to score' };
  }
  const level = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';
  return { level, why: cap(reasons.join('; ')) || (n.kind === 'Config' ? 'Config only' : 'Small change') };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function topicWords(s: PrSnapshot, opts: BuildOptions): Set<string> {
  const extra = Object.values(opts.ticketDetails ?? {}).flatMap((t) => [t.title ?? '', ...(t.criteria ?? [])]).join(' ');
  const text = `${s.pr.title} ${s.pr.body.split(/\n\s*\n/)[0] ?? ''} ${extra}`.toLowerCase();
  const words = text.match(/[a-z][a-z0-9]{3,}/g) ?? [];
  const stop = new Set(['this', 'that', 'with', 'from', 'pull', 'request', 'introduces', 'adds', 'into', 'main', 'part', 'updates', 'update', 'including', 'changes', 'more', 'flexible', 'new']);
  return new Set(words.filter((w) => !stop.has(w)).map((w) => w.replace(/(ies|es|s)$/, '')));
}

function scopeNote(s: PrSnapshot, n: FileNode, topic: Set<string>, links: Link[]): string | null {
  if (n.isTest || n.kind === 'Docs' || n.kind === 'Pipeline') return null;
  if (links.some((l) => l.nodes.includes(n.id))) return null;
  const text = n.paths.map((p) => (s.files.find((f) => f.path === p)?.patch ?? '')).join('\n').toLowerCase();
  const changed = text.split('\n').filter((l) => /^[+-]/.test(l)).join('\n');
  if (!changed) return null;
  const hits = [...topic].filter((w) => changed.includes(w));
  if (hits.length >= 2) return null;
  const removedBlocks = (changed.match(/^-\s*resource\s+"/gm) ?? []).length;
  return removedBlocks ? `Check: removes ${removedBlocks} resource block${removedBlocks === 1 ? '' : 's'} the ticket may not cover` : 'Check: these changes may not be about the ticket';
}

function role(s: PrSnapshot): string {
  const w = new Map<string, number>();
  for (const f of s.files) {
    if (isTestPath(f.path)) continue;
    const t = fileTypeOf(f.path);
    const r = t === 'md' ? 'Docs' : t === 'apim' ? 'Gateway' : t === 'tf' ? (/modules\//.test(f.path) ? 'Module' : 'Infrastructure') : t === 'yaml' || t === 'json' || t === 'schema' ? 'Config' : t === 'py' ? 'Code' : t === 'ado' || t === 'gha' ? 'Pipeline' : 'Scripts';
    const weight = ({ Gateway: 3, Module: 2, Infrastructure: 2, Config: 1.5, Code: 1.5, Docs: 1, Pipeline: 0.3, Scripts: 0.2 } as Record<string, number>)[r] ?? 1;
    w.set(r, (w.get(r) ?? 0) + (f.additions + f.deletions + 1) * weight);
  }
  const docsOnly = s.files.every((f) => fileTypeOf(f.path) === 'md');
  if (docsOnly) return 'Design doc';
  const best = [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Code';
  return best === 'Config' ? 'Team config' : best;
}

const HEADS: Record<string, string> = {
  'Team config': 'Changes the config', Module: 'Changes the Terraform module', Infrastructure: 'Changes the infrastructure', Gateway: 'Changes the gateway policies',
  'Design doc': 'Updates the design doc', Docs: 'Updates the docs', Code: 'Changes the code', Pipeline: 'Changes the pipeline', Scripts: 'Changes scripts',
};

function descSentence(body: string): string {
  return shortSentence(fullSentence(body));
}
const shortSentence = (t: string): string => {
  const x = t.replace(/^This pull request (introduces|adds|updates|makes|changes)\s+/i, (_m, v: string) => v.charAt(0).toUpperCase() + v.slice(1) + ' ');
  if (x.length <= 150) return x;
  const cut = x.slice(0, 150);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' by '), cut.lastIndexOf(' to '));
  return (at > 60 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))) + '…';
};
function fullSentence(body: string): string {
  const para = body.replace(/<!--[\s\S]*?-->/g, '').replace(/^#+.*$/gm, '').split(/\n\s*\n/).map((p) => p.trim()).find((p) => p.length > 20) ?? '';
  const m = /^(.{20,240}?[.!?])(\s|$)/.exec(para.replace(/\s+/g, ' '));
  return (m ? m[1] : para.slice(0, 200)).replace(/[*`_]/g, '');
}

function card(s: PrSnapshot, nodes: FileNode[], findings: Finding[], links: Link[], tickets: Ticket[], labels: Record<string, string>, ov: Record<string, NodeOverlay>): PrCard {
  const id = prId(s.pr);
  const r = role(s);
  const desc = descSentence(s.pr.body);
  const part = /part\s*(\d+)(?:\s*(?:of|\/)\s*(\d+))?/i.exec(s.pr.title);
  const outOfScope = nodes.filter((n) => n.prId === id && ov[n.id]?.fit);
  const fit: PrCard['fit'] = part
    ? { label: part[2] ? `Part ${part[1]} of ${part[2]}` : `Part ${part[1]}`, tone: 'n', why: 'A follow-up PR. Earlier parts may hold the rest of the work.' }
    : outOfScope.length
      ? { label: 'Has extra changes', tone: 'check', why: `${outOfScope.length} ${outOfScope.length === 1 ? 'box holds' : 'boxes hold'} changes the ticket may not cover: ${outOfScope.slice(0, 3).map((n) => n.name).join(', ')}.` }
      : { label: 'Matches ticket', tone: 'ok', why: 'Every changed area relates to the ticket.' };
  void findings; void links; void tickets; void labels;
  return {
    prId: id, role: r, head: HEADS[r] ?? 'Changes files', text: desc ? `From its description: “${desc}”` : 'No description.', files: s.files.length,
    fit, hygiene: { description: !!s.pr.body.trim(), ticketIn: ticketSources(s) },
  };
}

function flowRank(s: PrSnapshot): number {
  const r = role(s);
  return ({ 'Team config': 1, Config: 1, Code: 2, Module: 3, Infrastructure: 4, Pipeline: 5, Scripts: 5, Gateway: 6, Docs: 9, 'Design doc': 9 } as Record<string, number>)[r] ?? 5;
}

function buildStory(snaps: PrSnapshot[], cards: PrCard[], links: Link[], labels: Record<string, string>, nodes: FileNode[]): Report['story'] {
  // Data-flow order: PRs whose files feed others come first (net out-weight of directed links).
  const weight: Record<string, number> = {};
  const w = (l: Link) => (l.label === 'record fields' ? 3 : l.label === 'config feeds in' ? 2 : l.tone === 'bad' ? 2 : 1);
  for (const l of links) {
    if (l.kind !== 'connects') continue;
    const order = l.nodes.map((n) => nodes.find((x) => x.id === n)?.prId).filter(Boolean) as string[];
    const seq = order.filter((p, i) => order.indexOf(p) === i);
    for (let i = 0; i + 1 < seq.length; i++) {
      weight[seq[i]] = (weight[seq[i]] ?? 0) + w(l);
      weight[seq[i + 1]] = (weight[seq[i + 1]] ?? 0) - w(l);
    }
  }
  const ordered = snaps.slice().sort((a, b) => (flowRank(a) >= 9 ? 1 : 0) - (flowRank(b) >= 9 ? 1 : 0) || (weight[prId(b.pr)] ?? 0) - (weight[prId(a.pr)] ?? 0) || flowRank(a) - flowRank(b));
  const main = ordered.filter((s) => flowRank(s) < 9);
  const docs = ordered.filter((s) => flowRank(s) >= 9);
  const boxes: StoryBox[] = [...main, ...docs].map((s, i) => {
    const c = cards.find((x) => x.prId === prId(s.pr))!;
    return { prId: c.prId, step: i + 1, role: c.role, head: c.head, text: c.text.replace(/^From its description: “|”$/g, ''), row: flowRank(s) >= 9 ? 1 : 0 };
  });
  const arrows: StoryArrow[] = [];
  const between = (a: string, b: string) => links.filter((l) => l.prIds.includes(a) && l.prIds.includes(b));
  const prOfNode = (id: string) => nodes.find((n) => n.id === id)?.prId;
  const pick = (ls: Link[]) => ls.slice().sort((x, y) => (x.tone === 'bad' ? -2 : x.tone === 'check' ? -1 : 0) - (y.tone === 'bad' ? -2 : y.tone === 'check' ? -1 : 0))[0];
  for (let i = 0; i + 1 < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      const a = prId(main[i].pr);
      const b = prId(main[j].pr);
      const ls = between(a, b);
      if (!ls.length) continue;
      const bad = ls.find((l) => l.tone === 'bad');
      const best = bad ?? pick(ls.filter((l) => l.kind !== 'differs')) ?? pick(ls);
      const check = ls.find((l) => l.tone === 'check');
      const kinds = new Set(ls.map((l) => l.label));
      arrows.push({
        id: `A${arrows.length + 1}`, from: a, to: b, label: best.tone === 'bad' ? 'same rename' : best.label, sub: best.shared.slice(0, 2).join(', ') + (kinds.size > 1 ? ` +${kinds.size - 1}` : ''),
        tone: bad ? 'bad' : check ? 'check' : 'n', flag: bad ? 'must ship together' : check ? check.label : '', linkId: best.id,
      });
      break; // one arrow from each PR to its nearest linked neighbour downstream
    }
  }
  for (const d of docs) {
    const a = prId(d.pr);
    const l = links.find((x) => x.prIds.includes(a) && x.prIds.length > 1);
    const target = l?.prIds.find((p) => p !== a) ?? (l ? prOfNode(l.nodes.find((n) => prOfNode(n) !== a) ?? '') : undefined);
    if (l && target) arrows.push({ id: `A${arrows.length + 1}`, from: a, to: target, label: 'describes it', sub: 'doc only', tone: 'n', flag: '', linkId: l.id });
  }
  void labels;
  return { boxes, arrows };
}

function mergeOrder(snaps: PrSnapshot[], links: Link[], findings: Finding[], labels: Record<string, string>, boxes: StoryBox[]): MergeStep[] {
  const steps: MergeStep[] = [];
  const done = new Set<string>();
  for (const l of links.filter((x) => x.tone === 'bad')) {
    const prs = l.prIds.filter((p) => !done.has(p));
    if (prs.length < 2) continue;
    prs.forEach((p) => done.add(p));
    steps.push({ n: steps.length + 1, what: `${prs.map((p) => labels[p]).join(' + ')}, together`, why: `Link ${l.n}: ${l.shared.length === 2 ? `both rename ${l.shared[0]} to ${l.shared[1]}` : l.title.toLowerCase()}.`, tone: 'bad', prIds: prs });
  }
  for (const b of boxes) {
    if (done.has(b.prId)) continue;
    done.add(b.prId);
    const highs = findings.filter((f) => f.prId === b.prId && f.sev === 'High' && f.status === 'Open').length;
    const docsOnly = b.role === 'Design doc' || b.role === 'Docs';
    const ls = links.filter((l) => l.prIds.includes(b.prId) && l.kind !== 'docs').sort((x, y) => Number(x.kind !== 'connects') - Number(y.kind !== 'connects'));
    steps.push({ n: steps.length + 1, what: `${labels[b.prId]}${docsOnly ? ', any time' : ''}`, tone: highs ? 'check' : 'n', prIds: [b.prId],
      why: docsOnly ? 'Docs only. Nothing depends on it.' : `${ls.length ? `Link ${ls[0].n}: ${ls[0].title.toLowerCase()}.` : 'No cross-PR links.'}${highs ? ` ${highs} high finding${highs === 1 ? '' : 's'} open: fix first.` : ''}` });
  }
  void snaps;
  return steps;
}

function buildTour(story: Report['story'], cards: PrCard[], findings: Finding[], labels: Record<string, string>): TourStep[] {
  const steps: TourStep[] = [];
  story.boxes.forEach((b, i) => {
    const c = cards.find((x) => x.prId === b.prId)!;
    const into = story.arrows.find((a) => a.to === b.prId && a.from === story.boxes[i - 1]?.prId) ?? story.arrows.find((a) => a.from === b.prId);
    const flag = into?.flag ? ` ${into.flag.charAt(0).toUpperCase() + into.flag.slice(1)}.` : '';
    steps.push({ boxes: into && into.to === b.prId ? [into.from, b.prId] : [b.prId], arrows: into && into.to === b.prId ? [into.id] : [],
      text: `${i === 0 ? 'Start here. ' : ''}${labels[b.prId]} ${c.head.charAt(0).toLowerCase() + c.head.slice(1)}. ${b.text}${flag}`.replace(/\s+/g, ' ') });
  });
  const top = rankFindings(findings.filter((f) => f.status === 'Open' && f.sev === 'High'))[0];
  if (top) steps.splice(Math.min(steps.length, 3), 0, { boxes: [top.prId], arrows: [], text: `The biggest risk is in ${labels[top.prId]}: ${top.text.replace(/\.$/, '')}. Check this before you approve.` });
  return steps;
}

function buildChecklist(nodes: FileNode[], links: Link[], findings: Finding[], human: CheckItem[], labels: Record<string, string>): CheckItem[] {
  const items: CheckItem[] = [];
  const score = (n: FileNode) => links.filter((l) => l.nodes.includes(n.id)).length * 2 + findings.filter((f) => f.nodeId === n.id && f.status === 'Open').reduce((a, f) => a + (f.sev === 'High' ? 3 : f.sev === 'Medium' ? 1 : 0), 0) + (n.kind === 'Logic' ? 1 : 0);
  const ranked = nodes.filter((n) => !n.isTest && n.kind !== 'Docs').map((n) => ({ n, s: score(n) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8);
  for (const { n } of ranked) {
    const f = findings.find((x) => x.nodeId === n.id && x.status === 'Open');
    const why = f ? (/^[A-Z][a-z]/.test(f.text) ? f.text.charAt(0).toLowerCase() + f.text.slice(1) : f.text) : n.sub;
    items.push({ id: `C-${n.id}`, label: `${labels[n.prId].split(' ').pop()} ${n.name}: ${why}`, nodeId: n.id, human: false });
  }
  items.push(...human);
  items.push({ id: 'H-right-change', label: 'Is this the right change? Does it fit how teams use the platform?', human: true });
  items.push({ id: 'H-prod', label: 'Are the values right for production?', human: true });
  return items;
}

export { tokens };
