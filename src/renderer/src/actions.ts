import { call, errText, refOf } from './api';
import { useApp } from './store';

export async function buildReport(): Promise<void> {
  const st = useApp.getState();
  if (st.selected.length === 0 || st.building) return;
  st.set({ building: { step: 1, total: 4, label: 'Starting' }, buildError: null, section: 'report', report: null });
  try {
    const report = await call('report:build', { refs: st.selected.map(refOf), manualTickets: st.manualTickets });
    useApp.getState().set({ report, building: null, view: 'report', mapView: 'story', node: null, link: null, checks: {}, tour: 0 });
    // AI is added during the build when it is on; if that step was skipped, try once more now.
    if (report.aiError) void autoExplain();
  } catch (e) {
    useApp.getState().set({ building: null, buildError: errText(e) });
  }
}

export async function selectRelated(): Promise<void> {
  const st = useApp.getState();
  if (!st.selected.length) return;
  const extra = await call('prs:related', { selected: st.selected, all: st.prs.map((p) => p.id) });
  const next = [...new Set([...st.selected, ...extra.map((e) => e.id)])].slice(0, 10);
  st.set({ selected: next });
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
