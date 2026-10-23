import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { call, isMac } from '../api';
import { autoExplain } from '../actions';
import { useApp, type Scope } from '../store';
import { Icon, ICONS, Spinner } from './ui';

const SCOPES: Array<[Scope, string, string]> = [
  ['all', 'All', ICONS.all],
  ['assigned', 'Assigned to Me', ICONS.person],
  ['mine', 'Opened by Me', ICONS.plus],
  ['drafts', 'Drafts', ICONS.draft],
];

export function Sidebar() {
  const s = useApp();
  const reports = useQuery({ queryKey: ['reports', s.report?.id], queryFn: () => call('report:list') });
  const openReport = async (id: string) => {
    const r = await call('report:get', { id });
    if (r) {
      s.set({ report: r, section: 'report', view: 'report', mapView: 'story', node: null, link: null, tour: 0, explainError: null });
      if (!r.ai) void autoExplain();
    }
  };

  return (
    <nav aria-label="Sidebar" style={{ width: s.widths.side, flex: `0 0 ${s.widths.side}px`, background: 'var(--side)', borderRight: '.5px solid var(--sep)', display: 'flex', flexDirection: 'column', padding: `${isMac ? 52 : 12}px 10px 10px`, overflow: 'auto' }} className="drag">
      <div className="nodrag" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <div className="side-h">Pull Requests</div>
        {SCOPES.map(([id, label, icon]) => (
          <button key={id} className={s.scope === id && s.section === 'prs' && !s.repo ? 'side-on' : 'side-row'} onClick={() => s.set({ scope: id, section: 'prs', repo: null, reviewSet: null, selected: [] })}>
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Icon d={icon} /></span>
            {label}
            {s.scope === id && <span className="count">{s.prs.length}</span>}
          </button>
        ))}
        <RepoList />
        <div className="side-h">Reports</div>
        {(reports.data ?? []).length === 0 && <span className="t3" style={{ fontSize: 12, padding: '2px 8px' }}>No reports yet</span>}
        {(reports.data ?? []).map((r) => (
          <button key={r.id} className={s.report?.id === r.id && s.section === 'report' ? 'side-on' : 'side-row'} onClick={() => void openReport(r.id)}>
            <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Icon d={ICONS.graph} /></span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
            <span className="count">{r.stale ? 'stale' : r.prIds.length}</span>
          </button>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      <button className="side-row nodrag" onClick={() => s.set({ settingsOpen: true })}>
        <span style={{ color: 'var(--text2)', display: 'inline-flex' }}><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></span>
        Settings
      </button>
    </nav>
  );
}

/** Strip the prefix every repo shares so names fit: acme-platform-hub -> hub. */
/** Repo names are always shown in full. (Kept as a function so every place names repos the same way.) */
export function shortName(repo: string, _all?: string[]): string {
  return repo;
}


/**
 * Repositories: every repo in the organisation, loaded at start, favourites first
 * (your GitHub stars in the organisation, and repos pinned here). Typing filters the list on each keystroke.
 */
const PAGE = 50;
function RepoList() {
  const s = useApp();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const fav = useQuery({ queryKey: ['repoFavs'], queryFn: () => call('repos:favourites'), staleTime: 5 * 60_000 });
  const all = useQuery({ queryKey: ['repoAll'], queryFn: () => call('repos:all', { offset: 0, limit: 10000 }), staleTime: 10 * 60_000 });

  const counts = new Map<string, number>(Object.entries(s.repoCounts));
  if (!counts.size) for (const p of s.prs) counts.set(p.repo, (counts.get(p.repo) ?? 0) + 1);
  const pinned = fav.data?.pinned ?? [];
  const starred = fav.data?.starred ?? [];
  const favs = [...new Set([...pinned, ...starred])].sort((a, b) => a.localeCompare(b));
  const favSet = new Set(favs);
  const everyRepo = [...new Set([...(all.data?.names ?? []), ...counts.keys()])].filter((r) => !favSet.has(r)).sort((a, b) => a.localeCompare(b));

  const togglePin = async (r: string) => {
    const next = pinned.includes(r) ? pinned.filter((x) => x !== r) : [...pinned, r];
    qc.setQueryData(['settings'], await call('settings:set', { pinnedRepos: next }));
    void qc.invalidateQueries({ queryKey: ['repoFavs'] });
  };

  const needle = q.trim().toLowerCase();
  const words = needle.split(/\s+/).filter(Boolean);
  const match = (r: string) => words.every((w) => r.toLowerCase().includes(w));
  const rank = (r: string) => (r.toLowerCase().startsWith(needle) ? 0 : r.toLowerCase().split(/[-_.]/).some((p) => p.startsWith(words[0] ?? '')) ? 1 : 2);
  const order = (list: string[]) => (needle ? list.filter(match).sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)) : list);
  const favShown = order(favs);
  const restAll = order(everyRepo);
  const restShown = restAll.slice(0, limit);

  const row = (r: string, names: string[]) => <RepoRow key={r} r={r} label={shortName(r, names)} count={counts.get(r)} kind={pinned.includes(r) ? 'pin' : starred.includes(r) ? 'star' : null} on={s.repo === r && s.section === 'prs' && !s.reviewSet}
    onOpen={() => s.set({ repo: s.repo === r ? null : r, section: 'prs', reviewSet: null, selected: [] })} onPin={() => void togglePin(r)} />;

  return (
    <>
      <div className="side-h">Repositories</div>
      <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 7px', margin: '0 4px 4px' }}>
        <Icon d={ICONS.search} size={13} />
        <span className="sr">Filter repositories</span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setLimit(PAGE); } }} placeholder="Filter repositories" style={{ border: 0, background: 'transparent', outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 12.5, width: '100%' }} />
        {q && <button onClick={() => setQ('')} aria-label="Clear repository filter" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--text3)' }}>×</button>}
      </label>
      {favShown.length > 0 && <div className="t3" style={{ fontSize: 11, padding: '4px 8px 2px' }}>Favourites</div>}
      {favShown.map((r) => row(r, favShown))}
      {restShown.length > 0 && <div className="t3" style={{ fontSize: 11, padding: '6px 8px 2px' }}>{needle ? 'Matching repositories' : `All repositories${all.data ? ` · ${all.data.total}` : ''}`}</div>}
      {restShown.map((r) => row(r, restShown))}
      {all.isLoading && <span className="t3" style={{ fontSize: 12, padding: '2px 8px', display: 'flex', gap: 6, alignItems: 'center' }}><Spinner /> Loading repositories…</span>}
      {all.error && <span style={{ fontSize: 11.5, padding: '2px 8px', color: 'var(--gap)' }}>Couldn’t load repositories: {(all.error as Error).message}</span>}
      {needle && !favShown.length && !restAll.length && !all.isLoading && <span className="t3" style={{ fontSize: 12, padding: '2px 8px' }}>No matching repositories</span>}
      {restAll.length > restShown.length && (
        <button className="side-row" onClick={() => setLimit(limit + PAGE)} style={{ color: 'var(--accent)', fontSize: 12.5 }}>
          Load More ({restAll.length - restShown.length} more)
        </button>
      )}
    </>
  );
}

function RepoRow({ r, label, count, kind, on, onOpen, onPin }: { r: string; label: string; count?: number; kind: 'pin' | 'star' | null; on: boolean; onOpen: () => void; onPin: () => void }) {
  return (
    <div className="repo-row">
      <button className={on ? 'side-on' : 'side-row'} onClick={onOpen} title={r} style={{ paddingRight: 44 }}>
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><Icon d={ICONS.repo} /></span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {count != null && <span className="count">{count}</span>}
      </button>
      {kind === 'star' ? (
        <span className="pin on" title="Starred on GitHub" aria-label="Starred on GitHub">★</span>
      ) : (
        <button className={kind === 'pin' ? 'pin on' : 'pin'} onClick={onPin} aria-label={kind === 'pin' ? `Unpin ${r}` : `Pin ${r} to favourites`} title={kind === 'pin' ? 'Unpin from favourites' : 'Pin to favourites'}>{kind === 'pin' ? '★' : '☆'}</button>
      )}
    </div>
  );
}
