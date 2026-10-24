// Findings in the Report tab: a grouped list, and the selected finding beside it with everything
// a reviewer needs in one place (why it matters, the code, file risk, tests, ticket fit, the comment, actions).
import { useQuery } from '@tanstack/react-query';
import type { Report } from '@shared/model';
import { parsePatch } from '@analysis/diff';
import { SEV_ORDER, prLabel, reviewBody, type Issue, type Sev } from '@analysis/review';
import { call, open, refOf } from '../api';
import { useApp } from '../store';
import { Markdown } from './Markdown';
import { AiBadge, Spinner } from './ui';
import { usePrStatus } from './Report';

export const SEV_STYLE: Record<Sev, { c: string; bg: string; hint: string }> = {
  Blocking: { c: 'var(--gap)', bg: 'color-mix(in srgb, var(--gap) 10%, var(--card))', hint: 'fix before merging' },
  'Should fix': { c: 'var(--warn)', bg: 'color-mix(in srgb, var(--warn) 11%, var(--card))', hint: 'fix now or agree a follow-up' },
  Check: { c: 'var(--accent)', bg: 'color-mix(in srgb, var(--accent) 10%, var(--card))', hint: 'confirm it is intended' },
  FYI: { c: 'var(--text2)', bg: 'var(--field)', hint: 'for information' },
};

/** Key in the store's `checks` for an issue marked done (shared by the list, detail, cards and checklists). */
export const doneKey = (id: string): string => `i:${id}`;

/** Select a finding and scroll its detail into view (it sits under the list when the pane is narrow). */
export function showFinding(id: string): void {
  useApp.getState().set({ findSel: id, view: 'report' });
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('fd-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })));
}

export function SevBadge({ sev }: { sev: Sev }) {
  const st = SEV_STYLE[sev];
  return <span className="rv-sev" style={{ color: st.c, background: st.bg }}>{sev.toUpperCase()}</span>;
}

export function FindingsPanel({ r, issues }: { r: Report; issues: Issue[] }) {
  const s = useApp();
  const sel = issues.find((i) => i.id === s.findSel) ?? issues[0];
  return (
    <div className="rv-grid">
      <div className="card" style={{ overflow: 'hidden' }}>
        {!issues.length && <div style={{ padding: '14px 16px', color: 'var(--al)', fontWeight: 600 }}>✓ Nothing open</div>}
        {SEV_ORDER.map((sev) => {
          const items = issues.filter((i) => i.sev === sev);
          if (!items.length) return null;
          const st = SEV_STYLE[sev];
          return (
            <div key={sev} role="group" aria-label={`${sev} findings`}>
              <div className="rv-band" style={{ background: st.bg }}>
                <b style={{ color: st.c }}>{sev}</b>
                <span className="t3">{items.length} · {st.hint}</span>
              </div>
              {items.map((i) => {
                const on = sel?.id === i.id;
                const done = !!s.checks[doneKey(i.id)];
                return (
                  <button key={i.id} className={on ? 'rv-row rv-row-on' : 'rv-row'} aria-pressed={on} aria-controls="fd-panel" onClick={() => showFinding(i.id)}>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontWeight: 600, textDecoration: done ? 'line-through' : 'none', color: done ? 'var(--text3)' : 'var(--text)' }}>
                        {i.title}
                        {i.ai && <span style={{ marginLeft: 6 }}><AiBadge /></span>}
                      </span>
                      <span className="t3"><span className="mono">{i.prIds.map((p) => prLabel(r, p)).join(' + ')}</span> · {i.aiReviewer ? `AI reviewer · ${i.src}` : i.src}</span>
                    </span>
                    <span className="t3" style={{ whiteSpace: 'nowrap', display: 'inline-flex', gap: 8, alignItems: 'center' }}>{done && 'Done ✓'}<span aria-hidden="true" style={{ fontSize: 16, color: on ? 'var(--accent)' : 'var(--text3)' }}>›</span></span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {sel && <FindingDetail key={sel.id} r={r} i={sel} />}
    </div>
  );
}

type Row = { n: number | null; type: string; text: string; flag: boolean };

/** A few lines of the diff around the evidence line (or the start of the first hunk). */
function around(data: Record<string, { patch: string | null }>, path: string | undefined, line: number | undefined): Row[] {
  const p = path && data[path] ? path : Object.keys(data)[0];
  if (!p) return [];
  const rows = parsePatch(data[p]?.patch).flatMap((h) => h.lines.map((l) => ({ n: l.newNo ?? l.oldNo, type: l.type, text: l.text, b: l.newNo })));
  if (!rows.length) return [];
  const at = line ? rows.findIndex((x) => x.b === line) : -1;
  const slice = at >= 0 ? rows.slice(Math.max(0, at - 3), at + 2) : rows.slice(0, 8);
  return slice.map((x) => ({ n: x.n, type: x.type, text: x.text, flag: at >= 0 && x === rows[at] }));
}

function FindingDetail({ r, i }: { r: Report; i: Issue }) {
  const s = useApp();
  const prId = i.prIds[0];
  const pr = r.prs.find((p) => `${p.owner}/${p.repo}#${p.number}` === prId);
  const node = i.nodeId ? r.nodes.find((n) => n.id === i.nodeId) : undefined;
  const fromThread = i.commentId != null;
  const details = useQuery({ queryKey: ['details', prId], queryFn: () => call('prs:details', refOf(prId)), enabled: fromThread });
  const diff = useQuery({ queryKey: ['diff', i.nodeId], queryFn: () => call('report:diff', { ref: refOf(node!.prId), paths: node!.paths.slice(0, 20) }), enabled: !!node && !fromThread });
  const thread = fromThread ? details.data?.threads.find((t) => t.id === i.commentId) : undefined;
  const rows: Row[] = thread
    ? thread.code.map((l, k) => ({ n: l.b ?? l.a, type: l.type, text: l.text, flag: k === thread.code.length - 1 }))
    : diff.data ? around(diff.data, i.path ?? node?.paths[0], i.line) : [];
  const loading = (fromThread && details.isLoading) || (!fromThread && !!node && diff.isLoading);
  const ov = i.nodeId ? r.overlays[i.nodeId] : undefined;
  const done = !!s.checks[doneKey(i.id)];
  const first = thread?.messages[0];
  const file = i.path ?? node?.path;

  // Merged or closed PRs can't take Request changes, only a comment.
  const live = usePrStatus(r)?.[prId]?.state ?? pr?.state;
  const shut = live === 'merged' || live === 'closed';
  const requestChanges = () => s.set({ section: 'prs', current: prId, reviewOpen: true, reviewDraft: { prId, kind: shut ? 'COMMENT' : 'REQUEST_CHANGES', body: reviewBody(r, prId, [i]), n: Date.now() } });

  return (
    <article id="fd-panel" className="card rv-detail" aria-live="polite" aria-labelledby="fd-title" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <SevBadge sev={i.sev} />
        <span className="t2">{i.prIds.map((p) => prLabel(r, p)).join(' + ')} · from {i.srcLong}</span>
        {i.ai && <AiBadge />}
      </div>
      <h3 id="fd-title" style={{ margin: 0, fontSize: 18, fontWeight: 700, lineHeight: 1.3 }}>{i.title}</h3>
      <p style={{ margin: 0, color: 'var(--text2)' }}><b style={{ color: 'var(--text)' }}>Why it matters:</b> {i.why}</p>
      {loading && <span className="t3" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading the code…</span>}
      {rows.length > 0 && (
        <div className="rv-code mono" role="figure" aria-label={`Code from ${file ?? 'the change'}`}>
          {rows.map((l, k) => (
            <div key={k} className="rv-ln" style={{ background: l.flag ? 'color-mix(in srgb, var(--gap) 12%, var(--card))' : l.type === '+' ? 'var(--addbg)' : l.type === '-' ? 'var(--delbg)' : 'transparent', fontWeight: l.flag ? 600 : 400 }}>
              <span className="t3" style={{ textAlign: 'right' }}>{l.n ?? ''}</span>
              <span style={{ color: l.type === '+' ? 'var(--addfg)' : l.type === '-' ? 'var(--delfg)' : 'var(--text2)' }}>{l.type === ' ' ? ' ' : l.type}{l.text}</span>
              <span style={{ color: 'var(--gap)', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>{l.flag ? '◄ flagged line' : ''}</span>
            </div>
          ))}
        </div>
      )}
      <div className="rv-facts">
        <span className="t3">File</span><span className="mono" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{file ? `${file}${i.line ? ` · line ${i.line}` : ''}` : '—'}</span>
        <span className="t3">File risk</span><span>{ov ? `${ov.risk.level}: ${ov.risk.why}` : 'Not scored'}</span>
        <span className="t3">Tests</span><span>{ov?.tests ?? '—'}</span>
        <span className="t3">Ticket</span><span>{ov ? (ov.fit ?? 'In scope') : r.tickets.length ? 'In scope' : 'No ticket found'}</span>
      </div>
      {first && (
        <div style={{ border: '.5px solid var(--cardb)', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span><b>{first.author}</b> <span className="t3">· review comment · {thread?.resolved ? 'Resolved' : 'Open'}</span></span>
          <div className="t2"><Markdown text={first.body} /></div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {fromThread && <button className="push" onClick={() => s.set({ section: 'prs', current: prId, reviewOpen: false })}>Reply</button>}
        {i.sev !== 'FYI' && pr && (shut ? <button className="push" onClick={requestChanges}>Comment on {prLabel(r, prId)}</button> : <button className="rv-danger" onClick={requestChanges}>Request changes on {prLabel(r, prId)}</button>)}
        {pr && <button className="push" onClick={() => open(`${pr.url}/files`)}>Open on GitHub ↗</button>}
        {i.nodeId && <button className="push" onClick={() => s.focusNode(i.nodeId!)}>Show in File Map</button>}
        <button className="push" onClick={() => s.set({ checks: { ...s.checks, [doneKey(i.id)]: !done } })}>{done ? 'Mark as Open' : 'Mark as Done'}</button>
      </div>
    </article>
  );
}
