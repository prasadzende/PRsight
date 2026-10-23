import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call, errText, isMac, mod, open } from './api';
import { buildReport, reviewReportPrs, selectRelated } from './actions';
import { useApp } from './store';
import { SignIn } from './components/SignIn';
import { Sidebar } from './components/Sidebar';
import { PrList } from './components/PrList';
import { PrDetails } from './components/PrDetails';
import { ReportView } from './components/Report';
import { Inspector } from './components/Inspector';
import { Settings } from './components/Settings';
import { Icon, ICONS, Resizer, Seg, Spinner } from './components/ui';

import { useDarkMode } from './theme';

export function App() {
  const s = useApp();
  const dark = useDarkMode();
  const qc = useQueryClient();
  // Menus and pop-ups render outside .app, so the colour tokens also live on <html>.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    void call('auth:status').then((a) => s.set({ auth: a }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get'), enabled: !!s.auth?.signedIn });
  const every = (settings.data?.refreshMinutes ?? 2) * 60_000;
  const listArgs = { scope: s.scope, state: s.stateFilter, q: s.q, repo: s.repo ?? undefined };
  // The last list saved on this computer shows at once; the live list replaces it when GitHub answers.
  const cached = useQuery({ queryKey: ['prsCached', s.scope, s.stateFilter, s.q, s.repo], queryFn: () => call('prs:cached', listArgs), enabled: !!s.auth?.signedIn, staleTime: Infinity });
  const prs = useQuery({
    queryKey: ['prs', s.scope, s.stateFilter, s.q, s.repo],
    queryFn: () => call('prs:list', listArgs),
    enabled: !!s.auth?.signedIn,
    refetchInterval: every > 0 ? every : false,
    refetchIntervalInBackground: settings.data ? !settings.data.refreshOnlyActive : false,
  });
  useEffect(() => {
    const list = prs.data ?? cached.data?.items;
    // Remember repo counts from the unfiltered list so the sidebar keeps every repo while one is picked.
    const counts = (items: typeof s.prs) => items.reduce<Record<string, number>>((m, p) => ((m[p.repo] = (m[p.repo] ?? 0) + 1), m), {});
    const extra = list && !s.repo ? { repoCounts: counts(list) } : {};
    if (prs.data) s.set({ prs: prs.data, listUpdatedAt: prs.dataUpdatedAt, listCached: false, ...extra });
    else if (cached.data) s.set({ prs: cached.data.items, listUpdatedAt: cached.data.at, listCached: true, ...extra });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prs.data, cached.data]);

  const refreshRef = useRef<() => Promise<void>>(async () => undefined);
  // Refresh: the PR list, the organisation's repo names, and the sidebar's repo counts (even while one repo is picked).
  const refreshAll = async () => {
    const st = useApp.getState();
    // A fresh list starts with nothing ticked, so the next report is chosen from it.
    if (!st.reviewSet) st.set({ selected: [] });
    void prs.refetch();
    void qc.invalidateQueries({ queryKey: ['prStatus'] });
    void call('repos:refresh').then(() => { void qc.invalidateQueries({ queryKey: ['repoSearch'] }); void qc.invalidateQueries({ queryKey: ['repoAll'] }); }).catch(() => undefined);
    if (st.repo) {
      const all = await call('prs:list', { scope: st.scope, state: st.stateFilter, q: st.q }).catch(() => null);
      if (all) useApp.getState().set({ repoCounts: all.reduce<Record<string, number>>((m, p) => ((m[p.repo] = (m[p.repo] ?? 0) + 1), m), {}) });
    }
  };
  refreshRef.current = refreshAll;
  useEffect(() => api.on('report:progress', (p) => useApp.getState().set({ building: p })), []);
  // Zoom changed from the menu or keyboard: refresh the settings shown in the app.
  useEffect(() => api.on('settings:changed', () => void qc.invalidateQueries({ queryKey: ['settings'] })), [qc]);
  useEffect(
    () =>
      api.on('menu:command', ({ command }) => {
        const st = useApp.getState();
        if (command === 'settings') st.set({ settingsOpen: true });
        else if (command === 'build') void buildReport();
        else if (command === 'refresh') void refreshRef.current();
        else if (command === 'selectRelated') void selectRelated();
        else if (command === 'deselectAll') st.set({ selected: [] });
        else if (command === 'toggleSidebar') st.set({ sideOpen: !st.sideOpen });
        else if (command === 'toggleInspector') st.set({ inspOpen: !st.inspOpen });
        else if (command.startsWith('view:')) st.set({ view: command.slice(5) as never, section: st.report ? 'report' : st.section });
        else if (command === 'find') document.getElementById('search')?.focus();
        else if (command === 'openGithub') {
          const p = st.prs.find((x) => x.id === st.current);
          if (p) open(p.url);
        } else if (command === 'toggleSelect' && st.current) st.toggleSel(st.current);
        else if (command === 'review') st.set({ reviewOpen: true, section: 'prs' });
      }),
    [qc],
  );

  if (!s.auth) return <div className={`app ${dark ? 'dark' : ''}`} />;
  if (!s.auth.signedIn) return <div className={`app ${dark ? 'dark' : ''} ${isMac ? 'mac' : ''}`}><SignIn /></div>;

  // Show the report pane while building (progress) or after an error, not only once a report exists.
  const inReport = s.section === 'report' && (!!s.report || !!s.building || !!s.buildError);
  const showInsp = inReport && !!s.report && !s.building && s.inspOpen;
  const fullMap = inReport && s.mapFull && s.view === 'map';

  return (
    <div className={`app ${dark ? 'dark' : ''} ${isMac ? 'mac' : 'win'}`} style={{ flexDirection: 'row' }}>
      {s.sideOpen && !fullMap && <Sidebar />}
      {s.sideOpen && !fullMap && <Resizer label="Resize sidebar" width={s.widths.side} onResize={(w) => s.setWidth('side', w)} />}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
        <Toolbar inReport={inReport} loading={prs.isFetching} onRefresh={() => void refreshAll()} />
        {prs.error && !inReport && <div className="card" style={{ margin: 12, padding: '8px 12px', color: 'var(--gap)', fontSize: 12.5 }}>Couldn’t load pull requests: {errText(prs.error)}</div>}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {!inReport && <PrList loading={prs.isLoading && !cached.data?.items.length} />}
          {!inReport && <Resizer label="Resize pull request list" width={s.widths.list} onResize={(w) => s.setWidth('list', w)} />}
          <main style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>{inReport ? <ReportView /> : <PrDetails />}</main>
          {showInsp && <Resizer label="Resize inspector" grow="left" width={s.widths.insp} onResize={(w) => s.setWidth('insp', w)} />}
          {showInsp && <Inspector />}
        </div>
      </div>
      {s.settingsOpen && <Settings dark={dark} />}
    </div>
  );
}

function Toolbar({ inReport, loading, onRefresh }: { inReport: boolean; loading: boolean; onRefresh: () => void }) {
  const s = useApp();
  const n = s.selected.length;
  const sideShown = s.sideOpen && !(inReport && s.mapFull && s.view === 'map');
  const title = inReport ? (s.building ? 'Building Report…' : s.report?.title ?? 'Report') : s.reviewSet ? `Reviewing ${s.report?.title ?? 'report'}` : 'Pull Requests';
  const sub = inReport && s.building ? `${s.selected.length} pull requests` : inReport && s.report ? `${s.report.prs.length} PRs · ${s.report.totals.files} files · ${s.report.totals.links} cross-PR links` : `${s.prs.length} ${s.stateFilter} · ${n} selected${s.listUpdatedAt ? ` · ${s.listCached ? 'saved list from' : 'updated'} ${ago(s.listUpdatedAt)}` : ''}`;
  return (
    <header className="drag" style={{ height: 52, flex: '0 0 52px', display: 'flex', alignItems: 'center', gap: 10, padding: `0 ${isMac ? 14 : 150}px 0 ${sideShown ? 14 : isMac ? 86 : 14}px`, borderBottom: '.5px solid var(--sep)', background: 'var(--bar)' }}>
      <button className="tb-btn" onClick={() => s.set({ sideOpen: !s.sideOpen })} aria-label="Toggle sidebar" title={`Toggle Sidebar (${mod('⌃⌘S', 'Ctrl+Shift+S')})`}>
        <Icon d={ICONS.sidebar} />
      </button>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}>
        <span style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span className="t3" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
      </div>
      <span style={{ flex: 1 }} />
      {inReport ? (
        <>
          <Seg value={s.view} onChange={(v) => s.set({ view: v })} label="Report view" options={[['report', 'Report'], ['map', 'File Map'], ['changes', 'Changes'], ['tickets', 'Tickets']]} />
          <span style={{ flex: 1 }} />
          <button className="prominent" onClick={reviewReportPrs} title="Open these PRs to read comments and review them">Review PRs</button>
          <button className="push" onClick={() => s.set({ section: 'prs', reviewSet: null })}>Pull Requests</button>
          <button className={s.inspOpen ? 'tb-btn-on' : 'tb-btn'} onClick={() => s.set({ inspOpen: !s.inspOpen })} aria-label="Toggle inspector" title={`Toggle Inspector (${mod('⌥⌘I', 'Ctrl+Alt+I')})`}>
            <Icon d={ICONS.inspector} />
          </button>
        </>
      ) : (
        <>
          <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', width: 240, minWidth: 120, flex: '0 1 240px' }}>
            <Icon d={ICONS.search} size={14} />
            <span className="sr">Search pull requests</span>
            <input id="search" value={s.q} onChange={(e) => s.set({ q: e.target.value, selected: [] })} placeholder="Search" style={{ border: 0, background: 'transparent', outline: 'none', color: 'var(--text)', font: 'inherit', width: '100%' }} />
          </label>
          <button className="push" onClick={onRefresh} disabled={loading} aria-label="Refresh pull requests" title={`Get the latest pull requests from GitHub (${mod('⌘R', 'Ctrl+R')})`} style={{ fontSize: 12.5 }}>
            {loading ? <Spinner /> : <Icon d={ICONS.refresh} size={14} />}
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {s.report && <button className="push" onClick={() => s.set({ section: 'report' })}>Open Report</button>}
          <button className="prominent" disabled={n === 0 || !!s.building} style={{ opacity: n === 0 ? 0.45 : 1 }} onClick={() => void buildReport()} title={`Build Report (${mod('⌘B', 'Ctrl+B')})`}>
            Build Report ({n})
          </button>
        </>
      )}
    </header>
  );
}

function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
