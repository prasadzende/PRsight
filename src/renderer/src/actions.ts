import { call, errText, refOf } from './api';
import { useApp } from './store';

export async function buildReport(): Promise<void> {
  const st = useApp.getState();
  if (st.selected.length === 0 || st.building) return;
  st.set({ building: { step: 1, total: 4, label: 'Starting' }, buildError: null, section: 'report', report: null });
  try {
    const report = await call('report:build', { refs: st.selected.map(refOf), manualTickets: st.manualTickets });
    useApp.getState().set({ report, building: null, view: 'report', mapView: 'story', node: null, link: null, visited: [], checks: {}, tour: 0 });
    // AI is added during the build when it is on; if that step was skipped, try once more now.
    if (report.aiError) void autoExplain();
  } catch (e) {
    useApp.getState().set({ building: null, buildError: errText(e) });
  }
}

/** Ticks every open PR that shares a ticket with the ticked ones (searching GitHub too), and says what it found. */
export async function selectRelated(): Promise<void> {
  const st = useApp.getState();
  if (!st.selected.length || st.relatedBusy) return;
  st.set({ relatedBusy: true, relatedMsg: null });
  try {
    const res = await call('prs:related', { selected: st.selected, all: st.prs.map((p) => p.id), state: st.stateFilter });
    const cur = useApp.getState();
    const added = res.related.map((r) => r.id).filter((id) => !cur.selected.includes(id));
    const all = [...new Set([...cur.selected, ...added])];
    const next = all.slice(0, 10);
    const visible = new Set(cur.prs.filter((p) => !cur.repo || p.repo === cur.repo).map((p) => p.id));
    const hidden = next.filter((id) => !visible.has(id)).length;
    const keys = res.keys.join(', ');
    const text = !res.keys.length
      ? 'The ticked pull requests have no ticket number, so there’s nothing to match.'
      : !added.length
        ? `No other ${st.stateFilter === 'open' ? 'open' : 'closed or merged'} pull requests mention ${keys}.`
        : `Added ${added.length} related pull request${added.length === 1 ? '' : 's'} for ${keys}.${all.length > 10 ? ' A report takes up to 10, so only the first 10 are ticked.' : ''}`;
    const items = new Map([...cur.relatedItems, ...res.items].map((p) => [p.id, p]));
    cur.set({ selected: next, relatedItems: [...items.values()], relatedMsg: { text, hidden, tone: added.length ? 'ok' : 'none' }, relatedBusy: false });
  } catch (e) {
    useApp.getState().set({ relatedBusy: false, relatedMsg: { text: `Couldn’t look for related pull requests: ${errText(e)}`, hidden: 0, tone: 'error' } });
  }
}


/** Adds AI explanations to the open report. If AI is off, opens Settings › AI first. */
export async function explainReport(): Promise<void> {
  const st = useApp.getState();
  if (!st.report || st.explaining) return;
  const settings = await call('settings:get');
  if (!settings.ai.enabled) {
    st.set({ settingsOpen: true, setTab: 'ai' });
    return;
  }
  st.set({ explaining: true, explainError: null });
  try {
    const report = await call('report:explain', { id: st.report.id });
    useApp.getState().set({ report, explaining: false });
  } catch (e) {
    useApp.getState().set({ explaining: false, explainError: errText(e) });
  }
}

/** When AI is on and a report has no AI notes yet, add them without the user asking. */
export async function autoExplain(): Promise<void> {
  const st = useApp.getState();
  if (!st.report || st.report.ai || st.explaining) return;
  const settings = await call('settings:get');
  if (settings.ai.enabled) await explainReport();
}

/** From a report: open the Pull Requests screen with just the report's PRs, ticked, and the first one's details. */
export function reviewReportPrs(): void {
  const st = useApp.getState();
  const r = st.report;
  if (!r) return;
  st.set({ section: 'prs', reviewSet: r.prIds, selected: r.prIds, current: st.current && r.prIds.includes(st.current) ? st.current : r.prIds[0], repo: null, reviewOpen: false });
}
