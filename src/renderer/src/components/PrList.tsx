import type { PrListItem } from '@shared/ipc';
import { selectRelated } from '../actions';
import { useApp } from '../store';
import { shortName } from './Sidebar';
import { Avatar, Seg, Spinner, StateBadge } from './ui';

export const age = (iso: string): string => {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 1) return 'today';
  if (d < 30) return `${Math.floor(d)}d`;
  return `${Math.floor(d / 30)}mo`;
};
const size = (p: PrListItem) => {
  const n = p.additions + p.deletions;
  return n < 30 ? 'XS' : n < 150 ? 'S' : n < 600 ? 'M' : n < 2000 ? 'L' : 'XL';
};

export function PrList({ loading }: { loading: boolean }) {
  const s = useApp();
  const repos = s.prs.map((p) => p.repo);
  // Reviewing a report: only its PRs, taking any that are not in the current list from the report itself.
  const fromReport = (id: string): PrListItem | null => {
    const p = s.report?.prs.find((x) => `${x.owner}/${x.repo}#${x.number}` === id);
    return p ? { id, owner: p.owner, repo: p.repo, number: p.number, title: p.title, author: p.author, draft: p.draft, state: p.state, branch: p.branch, base: p.base, url: p.url, body: p.body, additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles, updatedAt: p.updatedAt, reviewRequested: false, teamRequested: false, mine: false, hasDescription: !!p.body?.trim(), hasTicket: true } : null;
  };
  const list = s.reviewSet
    ? s.reviewSet.map((id) => s.prs.find((p) => p.id === id) ?? fromReport(id)).filter((p): p is PrListItem => !!p)
    : s.prs.filter((p) => !s.repo || p.repo === s.repo);
  const noneTicked = s.selected.length === 0;
  return (
    <section aria-label="Pull requests" style={{ width: s.widths.list, flex: `0 0 ${s.widths.list}px`, borderRight: '.5px solid var(--sep)', display: 'flex', flexDirection: 'column', background: 'var(--list)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '.5px solid var(--sep)' }}>
        <Seg value={s.stateFilter} onChange={(v) => s.set({ stateFilter: v, selected: [] })} label="State" options={[['open', 'Open'], ['closed', 'Closed']]} />
        <span className="t3" style={{ fontSize: 12 }}>{list.length} pull requests</span>
        <span style={{ flex: 1 }} />
        <button className="push" style={{ fontSize: 12, padding: '2px 8px', opacity: noneTicked ? 0.45 : 1, cursor: noneTicked ? 'default' : 'pointer' }} aria-disabled={noneTicked}
          title={noneTicked ? 'Tick at least one pull request first' : 'Tick every open pull request for the same ticket'} onClick={() => !noneTicked && void selectRelated()}>
          Select Related
        </button>
      </div>
      {s.reviewSet && (
        <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px', borderBottom: '.5px solid var(--sep)', background: 'color-mix(in srgb, var(--accent) 8%, var(--list))' }}>
          <span style={{ fontSize: 12.5 }}>Reviewing the <b style={{ fontWeight: 600 }}>{list.length} PRs</b> in {s.report?.title ?? 'this report'}</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="push" style={{ fontSize: 12 }} onClick={() => s.set({ section: 'report' })}>‹ Back to Report</button>
            <button className="push" style={{ fontSize: 12 }} onClick={() => s.set({ reviewSet: null })}>Show All PRs</button>
          </span>
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
        {loading && <div className="t3" style={{ padding: 16, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading pull requests…</div>}
        {!loading && list.length === 0 && <div className="t3" style={{ padding: 16 }}>No pull requests here.</div>}
        {list.map((p) => {
          const on = s.selected.includes(p.id);
          return (
            <div key={p.id} className={s.current === p.id ? 'row-on' : 'row'} onClick={() => s.set({ current: p.id, reviewOpen: false })} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') s.set({ current: p.id }); if (e.key === ' ') { e.preventDefault(); s.toggleSel(p.id); } }}>
              <input type="checkbox" checked={on} onChange={() => s.toggleSel(p.id)} onClick={(e) => e.stopPropagation()} aria-label={`Include ${p.repo} #${p.number} in report`} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  <span className="t3" style={{ fontSize: 11.5 }}>{age(p.updatedAt)}</span>
                </span>
                <span className="t2" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}><Avatar login={p.author} size={16} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.author} · {p.changedFiles} files · +{p.additions} −{p.deletions}</span></span>
                <span style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="pill">{shortName(p.repo, repos)} #{p.number}</span>
                  <span className="pill">{size(p)}</span>
                  {p.reviewRequested && <span className="pill" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>Review requested</span>}
                  <StateBadge state={p.state} draft={p.draft} />
                  {p.teamRequested && <span className="pill">Team review</span>}
                  {p.mine && <span className="pill">Opened by you</span>}
                  {!p.hasDescription && <span className="pill" style={{ color: 'var(--warn)' }} title="This pull request has no description">No description</span>}
                  {!p.hasTicket && <span className="pill" style={{ color: 'var(--warn)' }} title="No ticket number in the title, branch or description">No ticket</span>}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
