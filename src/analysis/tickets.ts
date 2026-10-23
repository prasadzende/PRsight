// Ticket number detection from PR title, branch, description and commits.
import type { PrSnapshot, Ticket } from '../shared/model';
import { prId } from '../shared/model';

export interface DetectOptions {
  title: boolean;
  branch: boolean;
  description: boolean;
  commits: boolean;
  /** Jira project keys to accept (empty = accept any KEY-123 that looks like a Jira key). */
  jiraKeys?: string[];
  /** Accept bare 6–8 digit numbers as Azure DevOps work items (common in branch names). */
  bareAdoNumbers?: boolean;
}

export const DEFAULT_DETECT: DetectOptions = { title: true, branch: true, description: true, commits: true, bareAdoNumbers: true };

const ADO_RE = /\bAB#(\d{1,9})\b/gi;
const BARE_RE = /(?:^|[^\w#.-])(\d{6,8})(?=$|[^\w.])/g;
const BRANCH_BARE_RE = /(?:^|[/_-])(\d{6,8})(?=$|[/_-])/g;
const JIRA_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;
const NOT_JIRA = new Set(['UTF', 'SHA', 'ISO', 'RFC', 'ADR', 'HTTP', 'TLS', 'AES', 'GPT', 'CVE', 'PR', 'A2A']);

type Source = Ticket['foundIn'][number];

export function findTicketKeys(text: string, source: Source, opts: DetectOptions): Array<{ system: 'ado' | 'jira'; key: string; source: Source }> {
  const out: Array<{ system: 'ado' | 'jira'; key: string; source: Source }> = [];
  if (!text) return out;
  for (const m of text.matchAll(ADO_RE)) out.push({ system: 'ado', key: m[1], source });
  if (opts.bareAdoNumbers) {
    const re = source === 'branch' ? BRANCH_BARE_RE : BARE_RE;
    for (const m of text.matchAll(re)) out.push({ system: 'ado', key: m[1], source });
  }
  for (const m of text.matchAll(JIRA_RE)) {
    if (NOT_JIRA.has(m[1])) continue;
    if (opts.jiraKeys?.length && !opts.jiraKeys.includes(m[1])) continue;
    out.push({ system: 'jira', key: `${m[1]}-${m[2]}`, source });
  }
  return out;
}

export function detectTickets(snaps: PrSnapshot[], opts: DetectOptions = DEFAULT_DETECT, manual: string[] = []): Ticket[] {
  const map = new Map<string, Ticket>();
  const add = (system: 'ado' | 'jira', key: string, source: Source, pr?: string) => {
    const id = `${system}-${key}`;
    const t = map.get(id) ?? { id, system, key, foundIn: [], prIds: [] };
    if (!t.foundIn.includes(source)) t.foundIn.push(source);
    if (pr && !t.prIds.includes(pr)) t.prIds.push(pr);
    map.set(id, t);
  };
  for (const s of snaps) {
    const id = prId(s.pr);
    const hits = [
      ...(opts.title ? findTicketKeys(s.pr.title, 'title', opts) : []),
      ...(opts.branch ? findTicketKeys(s.pr.branch, 'branch', opts) : []),
      ...(opts.description ? findTicketKeys(s.pr.body, 'description', opts) : []),
      ...(opts.commits ? s.commits.flatMap((c) => findTicketKeys(c.message.split('\n')[0], 'commits', opts)) : []),
    ];
    for (const h of hits) add(h.system, h.key, h.source, id);
  }
  for (const raw of manual) {
    const k = raw.trim().replace(/^AB#/i, '');
    if (/^\d+$/.test(k)) add('ado', k, 'manual');
    else if (/^[A-Z][A-Z0-9]+-\d+$/.test(k)) add('jira', k, 'manual');
  }
  return [...map.values()].sort((a, b) => b.prIds.length - a.prIds.length);
}

/** Where a PR's ticket number was found, for the hygiene line. */
export function ticketSources(s: PrSnapshot, opts: DetectOptions = DEFAULT_DETECT): string[] {
  const src = new Set<string>();
  if (findTicketKeys(s.pr.title, 'title', opts).length) src.add('title');
  if (findTicketKeys(s.pr.branch, 'branch', opts).length) src.add('branch');
  if (findTicketKeys(s.pr.body, 'description', opts).length) src.add('description');
  if (s.commits.some((c) => findTicketKeys(c.message.split('\n')[0], 'commits', opts).length)) src.add('commits');
  return [...src];
}

/** PRs (from a list) that share a ticket with any of the selected PRs. Used by Select Related. */
export function relatedPrs<T extends { title: string; branch: string; body?: string; state: string }>(
  selected: T[],
  all: T[],
  opts: DetectOptions = DEFAULT_DETECT,
  boardLinked: Record<string, string[]> = {},
  key: (p: T) => string = (p) => p.title,
): Array<{ pr: T; reason: string }> {
  const keysOf = (p: T) =>
    new Set([
      ...findTicketKeys(p.title, 'title', opts),
      ...findTicketKeys(p.branch, 'branch', opts),
      ...findTicketKeys(p.body ?? '', 'description', opts),
    ].map((k) => `${k.system}-${k.key}`));
  const wanted = new Set<string>();
  selected.forEach((p) => keysOf(p).forEach((k) => wanted.add(k)));
  if (wanted.size === 0) return [];
  const selKeys = new Set(selected.map(key));
  const out: Array<{ pr: T; reason: string }> = [];
  for (const p of all) {
    if (selKeys.has(key(p)) || p.state !== 'open') continue;
    const k = [...keysOf(p)].find((x) => wanted.has(x));
    const linked = [...wanted].find((w) => (boardLinked[w] ?? []).includes(key(p)));
    if (k) out.push({ pr: p, reason: `same ticket ${k.replace(/^ado-/, 'AB#').replace(/^jira-/, '')}` });
    else if (linked) out.push({ pr: p, reason: `linked on the board to ${linked.replace(/^ado-/, 'AB#').replace(/^jira-/, '')}` });
  }
  return out;
}
