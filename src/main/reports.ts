// Builds, stores and explains reports. Snapshots come from GitHub; analysis runs in a utilityProcess.
import { utilityProcess, type UtilityProcess } from 'electron';
import { join } from 'node:path';
import { desc, eq, inArray } from 'drizzle-orm';
import type { BuildProgress, ReportListItem } from '../shared/ipc';
import type { PrRef, PrSnapshot, Report } from '../shared/model';
import { prId } from '../shared/model';
import { detectTickets } from '../analysis/tickets';
import type { BuildOptions } from '../analysis/report';
import { db, lastReviewT, memoryT, reportsT } from './db';
import { snapshot } from './github';
import { ticketDetails, ticketUrl } from './boards';
import { explain } from './ai/explain';
import { getSettings } from './settings';

let worker: UtilityProcess | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: Report) => void; reject: (e: Error) => void }>();

function getWorker(): UtilityProcess {
  if (worker) return worker;
  worker = utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'prsight-analysis' });
  worker.on('message', (m: { id: number; report?: Report; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.report) p.resolve(m.report);
    else p.reject(new Error(m.error ?? 'Analysis failed'));
  });
  worker.on('exit', () => {
    worker = null;
    for (const p of pending.values()) p.reject(new Error('The analysis process stopped'));
    pending.clear();
  });
  return worker;
}

function analyse(snaps: PrSnapshot[], opts: BuildOptions): Promise<Report> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, snaps, opts });
  });
}

export async function build(refs: PrRef[], manualTickets: string[], progress: (p: BuildProgress) => void): Promise<Report> {
  const s = getSettings();
  const total = 4;
  progress({ step: 1, total, label: 'Fetching pull requests, files and comments' });
  const last = db().select().from(lastReviewT).where(inArray(lastReviewT.prId, refs.map(prId))).all();
  const lastSha = new Map(last.map((l) => [l.prId, l.sha]));
  const snaps: PrSnapshot[] = [];
  for (const r of refs) snaps.push(await snapshot(r, (label) => progress({ step: 1, total, label }), lastSha.get(prId(r)) ?? null));

  progress({ step: 2, total, label: 'Looking up tickets' });
  const detect = { ...s.boards.detect, jiraKeys: s.boards.jira.projectKeys, bareAdoNumbers: true };
  const tickets = detectTickets(snaps, detect, manualTickets);
  const { details, errors: ticketErrors } = s.boards.ado.enabled || s.boards.jira.enabled ? await ticketDetails(tickets) : { details: {}, errors: {} };

  progress({ step: 3, total, label: 'Parsing Terraform, YAML, JSON Schema, Python, scripts and policy XML; linking files across PRs' });
  const report = await analyse(snaps, { detect, manualTickets, ticketDetails: details });
  report.memory = memoryFor(report);
  if (Object.keys(ticketErrors).length) report.ticketErrors = ticketErrors;
  // Link every ticket we can, even without a connected board.
  const texts = snaps.flatMap((x) => [x.pr.body, ...x.issueComments.map((c) => c.body), ...Object.values(x.contents)]).filter(Boolean);
  for (const t of report.tickets) if (!t.url) t.url = ticketUrl(t, texts);

  progress({ step: 4, total, label: s.ai.enabled ? 'Writing the summary with AI' : 'Writing the summary from rules' });
  if (s.ai.enabled) {
    try {
      report.ai = await explain(report, ruleTextOf(snaps));
    } catch (e) {
      report.aiError = (e as Error).message;
    }
  }
  save(report, snaps);
  remember(report, snaps);
  return report;
}

const ruleTextOf = (snaps: PrSnapshot[]): string => snaps.flatMap((s) => Object.entries(s.ruleFiles).map(([p, t]) => `# ${s.pr.repo}/${p}\n${t}`)).join('\n\n');

function save(r: Report, snaps: PrSnapshot[]): void {
  const heads = JSON.stringify(Object.fromEntries(snaps.map((s) => [prId(s.pr), s.pr.headSha])));
  db().insert(reportsT).values({ id: r.id, title: r.title, prIds: JSON.stringify(r.prIds), heads, json: JSON.stringify(r), createdAt: Date.now() }).run();
  for (const s of snaps) {
    db().insert(lastReviewT).values({ prId: prId(s.pr), sha: s.pr.headSha, at: Date.now() }).onConflictDoUpdate({ target: lastReviewT.prId, set: { sha: s.pr.headSha, at: Date.now() } }).run();
  }
}

/** Keeps what reviewers asked for (resolved human threads) and what is still open, per repo. */
function remember(r: Report, snaps: PrSnapshot[]): void {
  const now = Date.now();
  for (const s of snaps) {
    const repo = `${s.pr.owner}/${s.pr.repo}`;
    const asked = s.reviewComments.filter((c) => !c.inReplyTo && !c.isBot && s.resolvedThreads?.[String(c.id)]).slice(0, 5);
    for (const c of asked) db().insert(memoryT).values({ repo, kind: 'request', text: c.body.replace(/\s+/g, ' ').slice(0, 200), source: `${s.pr.repo} #${s.pr.number}`, createdAt: now }).run();
    for (const f of r.findings.filter((x) => x.prId === prId(s.pr) && x.sev === 'High' && x.status === 'Open'))
      db().insert(memoryT).values({ repo, kind: 'open-finding', text: f.text.slice(0, 200), source: `${s.pr.repo} #${s.pr.number}`, createdAt: now }).run();
  }
}

function memoryFor(r: Report): Report['memory'] {
  const repos = [...new Set(r.prs.map((p) => `${p.owner}/${p.repo}`))];
  const rows = db().select().from(memoryT).where(inArray(memoryT.repo, repos)).orderBy(desc(memoryT.createdAt)).limit(12).all();
  const current = new Set(r.findings.map((f) => f.text.slice(0, 200)));
  return rows.slice(0, 5).map((m) => ({
    repo: m.repo.split('/')[1] ?? m.repo,
    when: `${m.source} · ${new Date(m.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    text: m.kind === 'request' ? `Reviewers asked: “${m.text}”` : current.has(m.text) ? `Still open: ${m.text}` : `No longer reported: ${m.text}`,
    ok: m.kind === 'request' || !current.has(m.text),
  }));
}

export function list(): ReportListItem[] {
  return db().select({ id: reportsT.id, title: reportsT.title, prIds: reportsT.prIds, createdAt: reportsT.createdAt }).from(reportsT).orderBy(desc(reportsT.createdAt)).limit(30).all()
    .map((r) => ({ id: r.id, title: r.title, prIds: JSON.parse(r.prIds) as string[], createdAt: new Date(r.createdAt).toISOString(), stale: Date.now() - r.createdAt > 86_400_000 }));
}

export function get(id: string): Report | null {
  const r = db().select().from(reportsT).where(eq(reportsT.id, id)).get();
  return r ? (JSON.parse(r.json) as Report) : null;
}

export function remove(id: string): void {
  db().delete(reportsT).where(eq(reportsT.id, id)).run();
}

export async function explainStored(id: string): Promise<Report> {
  const r = get(id);
  if (!r) throw new Error('Report not found');
  r.ai = await explain(r, '');
  delete r.aiError;
  db().update(reportsT).set({ json: JSON.stringify(r) }).where(eq(reportsT.id, id)).run();
  return r;
}

export function stopWorker(): void {
  worker?.kill();
  worker = null;
}
