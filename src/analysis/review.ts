// What a reviewer acts on, built from a report: every open issue (findings, links to check,
// failing checks), the merge rule, and per-PR counts, checklists and review text.
// Pure: no React, no network. The Report tab, PR cards, finding detail and checklists all read from here,
// so "all done" means every open issue really was looked at.
import type { Finding, Link, Report } from '../shared/model';

export type Sev = 'Blocking' | 'Should fix' | 'Check' | 'FYI';
export const SEV_ORDER: Sev[] = ['Blocking', 'Should fix', 'Check', 'FYI'];

/** Live PR state from GitHub, as the Report tab fetches it (same shape as PrStatus in shared/ipc). */
export interface LiveStatus {
  state: 'open' | 'draft' | 'merged' | 'closed';
  review: 'approved' | 'changes' | 'required' | 'none';
  approvals: number;
  checks: 'passing' | 'failing' | 'running' | 'none';
  conflicts: boolean;
}

export interface Issue {
  id: string;
  sev: Sev;
  title: string;
  /** Short source: Copilot, Rule, Team rule, GitHub checks, AI. */
  src: string;
  /** Longer source for the detail panel: "Copilot (AI reviewer)". */
  srcLong: string;
  aiReviewer: boolean;
  /** Written by this app's optional AI. */
  ai: boolean;
  prIds: string[];
  where: string;
  path?: string;
  line?: number;
  nodeId?: string;
  why: string;
  /** GitHub review comment id, when the issue comes from a review thread. */
  commentId?: number;
}

export const prLabel = (r: Report, id: string): string => {
  const p = r.prs.find((x) => `${x.owner}/${x.repo}#${x.number}` === id);
  return p ? `${p.repo} #${p.number}` : id;
};

const SEV_OF: Record<Finding['sev'], Sev> = { High: 'Blocking', Medium: 'Should fix', Info: 'FYI' };

function whyOf(f: Finding, r: Report): string {
  const link = f.id.startsWith('F-rule-') ? r.links.find((l) => `F-rule-${l.id}` === f.id) : undefined;
  if (link) return link.impactWhy;
  if (/^Operational impact/.test(f.text)) return 'A big change to a limit, quota or timeout. Confirm it is intended for every environment it touches.';
  if (/^Logic changed with no test/.test(f.text)) return 'No test changed with it, so a mistake here would only show up after it ships.';
  if (f.src === 'Team rule') {
    const rule = r.teamRules.find((t) => `F-${t.id}` === f.id);
    return rule ? `The team rules ask for this: “${rule.rule}” (${rule.ruleFile}).` : 'The team rules ask for this.';
  }
  if (/^Title says \[/.test(f.text)) return 'The title names a different target branch, so the PR may be aimed at the wrong place.';
  if (/no description/i.test(f.text)) return 'Reviewers have nothing to go on but the diff.';
  if (/No ticket number|Ticket number found only/.test(f.text)) return 'Without a ticket, it is hard to check the change does what was asked.';
  if (f.aiReviewer) return 'From an AI reviewer’s first pass. Read the code yourself before relying on it.';
  if (/findings reported/.test(f.text)) return 'A scanner reported problems on this PR. Check whether any are new.';
  if (f.ai) return 'Suggested by AI. Check it before relying on it.';
  return 'Found by a rule on the diff.';
}

function srcLongOf(f: Finding): string {
  if (f.aiReviewer) return `${f.src} (AI reviewer)`;
  if (f.ai) return 'AI (this app)';
  if (f.src === 'Rule') return 'a rule';
  if (f.src === 'Team rule') return 'the team rules';
  return f.src;
}

/** Every open issue, Blocking first. Pass live status to add failing checks and merge conflicts. */
export function issuesOf(r: Report, status?: Record<string, LiveStatus>): Issue[] {
  const out: Issue[] = [];
  const aiF: Finding[] = (r.ai?.findings ?? []).map((f, i) => {
    const node = r.nodes.find((n) => n.paths.includes(f.path));
    const prId = node?.prId ?? r.prIds[0];
    return { id: `AI-${i}`, sev: f.sev, src: 'AI', aiReviewer: false, ai: true, where: f.where, text: f.text, prId, status: 'Open' as const, nodeId: node?.id, evidence: { prId, path: f.path, line: f.line, snippet: '' } };
  });
  for (const f of [...r.findings, ...aiF]) {
    if (f.status !== 'Open') continue;
    const link = f.id.startsWith('F-rule-') ? r.links.find((l) => `F-rule-${l.id}` === f.id) : undefined;
    const rc = /-rc(\d+)$/.exec(f.id);
    const ev = f.evidence ?? link?.evidence[0];
    out.push({
      id: f.id, sev: SEV_OF[f.sev], title: f.text, src: f.src, srcLong: srcLongOf(f), aiReviewer: f.aiReviewer, ai: !!f.ai,
      prIds: link ? link.prIds : [f.prId], where: f.where, path: ev?.path, line: ev?.line, nodeId: f.nodeId ?? link?.nodes[0], why: whyOf(f, r),
      commentId: rc ? Number(rc[1]) : undefined,
    });
  }
  for (const l of r.links.filter((x) => x.tone === 'check')) out.push(checkIssue(l, r));
  for (const id of r.prIds) {
    const st = status?.[id];
    if (!st || st.state === 'merged' || st.state === 'closed' || (st.checks !== 'failing' && !st.conflicts)) continue;
    const what = st.checks === 'failing' && st.conflicts ? 'Checks failing and merge conflicts' : st.checks === 'failing' ? 'Checks failing' : 'Merge conflicts';
    out.push({ id: `S-${id}`, sev: 'Blocking', title: what, src: 'GitHub checks', srcLong: 'GitHub', aiReviewer: false, ai: false, prIds: [id], where: prLabel(r, id),
      why: 'GitHub won’t merge it until the checks pass and any conflicts are fixed.' });
  }
  return out.sort((a, b) => SEV_ORDER.indexOf(a.sev) - SEV_ORDER.indexOf(b.sev));
}

function checkIssue(l: Link, r: Report): Issue {
  const ev = l.evidence[0];
  return { id: `L-${l.id}`, sev: 'Check', title: l.title, src: 'Rule', srcLong: 'a rule (link between PRs)', aiReviewer: false, ai: false,
    prIds: l.prIds, where: l.prIds.map((p) => prLabel(r, p)).join(' + '), path: ev?.path, line: ev?.line, nodeId: l.nodes[l.nodes.length - 1], why: l.text };
}

export const issuesFor = (issues: Issue[], prId: string): Issue[] => issues.filter((i) => i.prIds.includes(prId));

export function countsFor(issues: Issue[], prId: string, done: (id: string) => boolean = () => false): Record<Sev, number> {
  const c: Record<Sev, number> = { Blocking: 0, 'Should fix': 0, Check: 0, FYI: 0 };
  for (const i of issuesFor(issues, prId)) if (!done(i.id)) c[i.sev]++;
  return c;
}

/** The merge order as one rule, in the same words wherever it appears. */
export function mergeRule(r: Report): string {
  const parts = r.order.map((o) => {
    const names = o.prIds.map((p) => prLabel(r, p));
    if (o.tone === 'bad') return `merge ${names.join(' and ')} together`;
    if (/any time/.test(o.what)) return `${names[0]} can merge any time`;
    if (o.tone === 'check') return `merge ${names[0]} after its fixes`;
    return `then merge ${names[0]}`;
  });
  const text = parts.join('; ');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) + '.' : 'No order needed: the PRs don’t depend on each other.';
}

/** "Review next": the merge steps, each with what it is and why. */
export const reviewNext = (r: Report): Array<{ what: string; why: string; prIds: string[] }> => r.order.map((o) => ({ what: o.what, why: o.why, prIds: o.prIds }));

/** What was checked and found fine for one PR: passed team rules and links whose names match. */
export function verifiedFor(r: Report, prId: string): string[] {
  const rules = r.teamRules.filter((t) => t.passed && t.prId === prId).map((t) => t.text);
  const links = r.links.filter((l) => l.tone === 'n' && (l.kind === 'connects' || l.kind === 'matches') && l.prIds.includes(prId)).map((l) => `${l.title}: names match on both sides`);
  return [...rules, ...links];
}

/** Questions only a person can answer, for one PR: that PR's judgement rules plus the general ones. */
export function humanFor(r: Report, prId: string): Array<{ id: string; label: string }> {
  const names = [prLabel(r, prId), shortLabel(r, prId)];
  return r.checklist.filter((c) => c.human && (names.some((n) => c.label.startsWith(`${n} `)) || /^H-(right-change|prod)$/.test(c.id))).map((c) => ({ id: c.id, label: c.label }));
}

/** The analysis labels PRs without the prefix every repo shares (acme-platform-gateway #34 -> gateway #34). */
export function shortLabel(r: Report, prId: string): string {
  const repos = [...new Set(r.prs.map((p) => p.repo))];
  let prefix = '';
  if (repos.length > 1) {
    const parts = repos.map((x) => x.split('-'));
    const same: string[] = [];
    for (let i = 0; parts[0][i] !== undefined && parts.every((q) => q[i] === parts[0][i]); i++) same.push(parts[0][i]);
    prefix = same.join('-');
  }
  const p = r.prs.find((x) => `${x.owner}/${x.repo}#${x.number}` === prId);
  if (!p) return prId;
  return `${prefix && p.repo.startsWith(prefix + '-') ? p.repo.slice(prefix.length + 1) : p.repo} #${p.number}`;
}

/** The review summary that goes with "Request changes", listing what is still open. */
export function reviewBody(r: Report, prId: string, open: Issue[]): string {
  if (!open.length) return '';
  const lines = open.map((i) => `- **${i.sev}:** ${i.title}${i.path ? ` (\`${i.path}${i.line ? `:${i.line}` : ''}\`)` : ''}`);
  const rule = r.order.find((o) => o.tone === 'bad' && o.prIds.includes(prId));
  return [`Before ${prLabel(r, prId)} can merge:`, '', ...lines, ...(rule ? ['', `It must merge together with ${rule.prIds.filter((p) => p !== prId).map((p) => prLabel(r, p)).join(' and ')}.`] : [])].join('\n');
}
