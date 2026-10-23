// "Changes" tab: every changed file of one PR, like GitHub's Files changed, with line comments.
// Comments go to GitHub through the reviews endpoint: one now ("Add single comment") or
// collected as pending and sent together ("Start a review" → "Finish review").
import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LineComment, PrFileView, ReviewThreadView } from '@shared/ipc';
import type { Report } from '@shared/model';
import { parsePatch } from '@analysis/diff';
import { call, errText, open, refOf } from '../api';
import { useApp } from '../store';
import { prLabel } from './Report';
import { Avatar, Spinner } from './ui';
import { Markdown } from './Markdown';

type Side = 'LEFT' | 'RIGHT';
type Sel = { path: string; side: Side; line: number; startLine: number };
type Row = { kind: 'hunk'; text: string } | { kind: 'line'; type: '+' | '-' | ' '; oldNo: number | null; newNo: number | null; text: string };

const BIG = 600;
const STATUS: Record<string, [string, string]> = {
  added: ['A', 'var(--al)'],
  removed: ['D', 'var(--gap)'],
  modified: ['M', 'var(--warn)'],
  renamed: ['R', 'var(--accent)'],
  copied: ['C', 'var(--accent)'],
  changed: ['M', 'var(--warn)'],
};
const sideOf = (t: string): Side => (t === '-' ? 'LEFT' : 'RIGHT');
const numOf = (r: Extract<Row, { kind: 'line' }>): number => (r.type === '-' ? r.oldNo! : r.newNo!);
const anchor = (path: string) => `chg-${path.replace(/[^\w-]/g, '_')}`;

export function ChangesView({ r }: { r: Report }) {
  const s = useApp();
  const ids = r.prs.map((p) => `${p.owner}/${p.repo}#${p.number}`);
  const pr = s.changesPr && ids.includes(s.changesPr) ? s.changesPr : ids[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="cap" style={{ marginRight: 4 }}>
          PULL REQUEST
        </span>
        {ids.map((id) => {
          const p = r.prs.find((x) => `${x.owner}/${x.repo}#${x.number}` === id)!;
          const n = (s.pending[id] ?? []).length;
          return (
            <button
              key={id}
              className={id === pr ? 'seg-on' : 'push'}
              onClick={() => s.set({ changesPr: id })}
              title={p.title}
              style={{ fontSize: 12.5, padding: '4px 10px', border: id === pr ? '.5px solid var(--accent)' : undefined }}
            >
              {prLabel(r, id)} <span className="t3">· {p.changedFiles} files</span>
              {n > 0 && (
                <span style={{ marginLeft: 6, padding: '0 6px', borderRadius: 8, background: 'var(--warn)', color: '#fff', fontSize: 10.5, fontWeight: 700 }}>
                  {n} pending
                </span>
              )}
            </button>
          );
        })}
      </div>
      <PrChanges key={pr} r={r} prId={pr} />
    </div>
  );
}

function PrChanges({ r, prId }: { r: Report; prId: string }) {
  const s = useApp();
  const qc = useQueryClient();
  const ref = refOf(prId);
  const files = useQuery({ queryKey: ['prFiles', prId], queryFn: () => call('prs:files', ref) });
  const details = useQuery({ queryKey: ['details', prId], queryFn: () => call('prs:details', ref) });
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState<Sel | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [finish, setFinish] = useState(false);
  const pending = s.pending[prId] ?? [];
  const viewed = s.viewed[prId] ?? {};
  const pr = r.prs.find((p) => `${p.owner}/${p.repo}#${p.number}` === prId)!;

  const threads = useMemo(() => {
    const m = new Map<string, ReviewThreadView[]>();
    for (const t of details.data?.threads ?? []) {
      if (t.outdated || t.line == null) continue;
      const k = `${t.path}:${t.line}`;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [details.data]);

  if (files.isLoading)
    return (
      <div className="t3" style={{ padding: 20, display: 'flex', gap: 8 }}>
        <Spinner /> Loading the changes…
      </div>
    );
  if (files.error || !files.data) return <div style={{ padding: 20, color: 'var(--gap)' }}>Couldn’t load the changes: {errText(files.error)}</div>;
  const all = files.data.files;
  const shown = filter.trim() ? all.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase())) : all;
  const add = all.reduce((a, f) => a + f.additions, 0);
  const del = all.reduce((a, f) => a + f.deletions, 0);
  const seen = all.filter((f) => viewed[f.path]).length;
  const setPending = (list: LineComment[]) => s.set({ pending: { ...s.pending, [prId]: list } });
  const setViewed = (path: string, v: boolean) => {
    s.set({ viewed: { ...s.viewed, [prId]: { ...viewed, [path]: v } } });
    if (v) setCollapsed((c) => ({ ...c, [path]: true }));
  };
  const own = !!details.data && details.data.pr.author === details.data.viewer;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        className="card"
        style={{ padding: '8px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 3 }}
      >
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 380 }} title={pr.title}>
          {pr.title}
        </span>
        <span className="t2" style={{ fontSize: 12.5 }}>
          {all.length} files · <span style={{ color: 'var(--addfg)' }}>+{add}</span> <span style={{ color: 'var(--delfg)' }}>−{del}</span>
        </span>
        <span className="t3" style={{ fontSize: 12 }}>
          {seen} of {all.length} viewed
        </span>
        <span style={{ flex: 1 }} />
        <span className="t3" style={{ fontSize: 11.5 }}>
          Click a line number to comment · Shift-click for a range
        </span>
        <button className="push" style={{ fontSize: 12 }} onClick={() => open(`${pr.url}/files`)}>
          GitHub ↗
        </button>
        <button className={pending.length ? 'prominent' : 'push'} style={{ fontSize: 12.5 }} onClick={() => setFinish(!finish)}>
          {pending.length ? `Finish Review (${pending.length})` : 'Review…'}
        </button>
      </div>
      {finish && (
        <FinishReview
          prId={prId}
          headSha={files.data.headSha}
          pending={pending}
          own={own}
          onDone={() => {
            setPending([]);
            setFinish(false);
            void qc.invalidateQueries({ queryKey: ['details', prId] });
          }}
          onClose={() => setFinish(false)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) minmax(0, 1fr)', gap: 12, alignItems: 'start' }}>
        <div className="card" style={{ position: 'sticky', top: 52, maxHeight: 'calc(100vh - 190px)', overflow: 'auto', padding: 6 }}>
          <label className="field" style={{ display: 'flex', padding: '3px 7px', margin: '2px 2px 6px' }}>
            <span className="sr">Filter files</span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter files"
              style={{ border: 0, background: 'transparent', outline: 'none', color: 'var(--text)', font: 'inherit', fontSize: 12.5, width: '100%' }}
            />
          </label>
          {shown.map((f) => {
            const [letter, color] = STATUS[f.status] ?? ['M', 'var(--warn)'];
            const name = f.path.split('/').pop()!;
            const dir = f.path.slice(0, -name.length);
            const n = pending.filter((c) => c.path === f.path).length;
            return (
              <button
                key={f.path}
                className="side-row"
                title={f.path}
                onClick={() => {
                  setCollapsed((c) => ({ ...c, [f.path]: false }));
                  document.getElementById(anchor(f.path))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                style={{ alignItems: 'flex-start', opacity: viewed[f.path] ? 0.55 : 1 }}
              >
                <span className="mono" style={{ flex: '0 0 12px', fontSize: 11, fontWeight: 700, color, marginTop: 1 }}>
                  {letter}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                    {n > 0 && <span style={{ color: 'var(--warn)', fontWeight: 700 }}> · {n}</span>}
                  </span>
                  {dir && (
                    <span className="mono t3" style={{ fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dir}
                    </span>
                  )}
                </span>
                <span className="mono" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--addfg)' }}>+{f.additions}</span> <span style={{ color: 'var(--delfg)' }}>−{f.deletions}</span>
                </span>
              </button>
            );
          })}
          {!shown.length && (
            <div className="t3" style={{ fontSize: 12, padding: 8 }}>
              No matching files
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          {shown.map((f) => (
            <FileDiff
              key={f.path}
              f={f}
              url={pr.url}
              collapsed={!!collapsed[f.path]}
              onToggle={() => setCollapsed((c) => ({ ...c, [f.path]: !c[f.path] }))}
              viewed={!!viewed[f.path]}
              onViewed={(v) => setViewed(f.path, v)}
              sel={sel?.path === f.path ? sel : null}
              onSelect={setSel}
              threads={threads}
              pending={pending.filter((c) => c.path === f.path)}
              onAddPending={(c) => {
                setPending([...pending, c]);
                setSel(null);
              }}
              onRemovePending={(c) => setPending(pending.filter((x) => x !== c))}
              prId={prId}
              headSha={files.data!.headSha}
              hasPending={pending.length > 0}
              onPosted={() => {
                setSel(null);
                void qc.invalidateQueries({ queryKey: ['details', prId] });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FileDiff(props: {
  f: PrFileView;
  url: string;
  collapsed: boolean;
  onToggle: () => void;
  viewed: boolean;
  onViewed: (v: boolean) => void;
  sel: Sel | null;
  onSelect: (s: Sel | null) => void;
  threads: Map<string, ReviewThreadView[]>;
  pending: LineComment[];
  onAddPending: (c: LineComment) => void;
  onRemovePending: (c: LineComment) => void;
  prId: string;
  headSha: string;
  hasPending: boolean;
  onPosted: () => void;
}) {
  const { f, sel } = props;
  const [full, setFull] = useState(false);
  const rows = useMemo<Row[]>(
    () =>
      parsePatch(f.patch).flatMap((h): Row[] => [
        { kind: 'hunk', text: `@@ -${h.oldStart} +${h.newStart} @@ ${h.header}` },
        ...h.lines.map((l): Row => ({ kind: 'line', type: l.type as '+' | '-' | ' ', oldNo: l.oldNo, newNo: l.newNo, text: l.text })),
      ]),
    [f.patch],
  );
  const big = rows.length > BIG && !full;
  const [letter, color] = STATUS[f.status] ?? ['M', 'var(--warn)'];

  const click = (row: Extract<Row, { kind: 'line' }>, shift: boolean) => {
    const side = sideOf(row.type);
    const n = numOf(row);
    if (shift && sel && sel.side === side) props.onSelect({ path: f.path, side, line: Math.max(n, sel.startLine), startLine: Math.min(n, sel.startLine) });
    else props.onSelect({ path: f.path, side, line: n, startLine: n });
  };
  const inSel = (row: Extract<Row, { kind: 'line' }>) => !!sel && sel.side === sideOf(row.type) && numOf(row) >= sel.startLine && numOf(row) <= sel.line;

  return (
    <div id={anchor(f.path)} className="card" style={{ overflow: 'hidden', scrollMarginTop: 60 }}>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '7px 12px',
          background: 'var(--list)',
          borderBottom: props.collapsed ? 0 : '.5px solid var(--sep)',
        }}
      >
        <button
          onClick={props.onToggle}
          aria-label={props.collapsed ? 'Show diff' : 'Hide diff'}
          aria-expanded={!props.collapsed}
          style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text2)', width: 18, padding: 0 }}
        >
          {props.collapsed ? '›' : '⌄'}
        </button>
        <span className="mono" style={{ fontSize: 11, fontWeight: 700, color }}>
          {letter}
        </span>
        <span
          className="mono"
          style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
          title={f.path}
        >
          {f.previous ? (
            <>
              <span className="t3">{f.previous} → </span>
              {f.path}
            </>
          ) : (
            f.path
          )}
        </span>
        <span className="mono" style={{ fontSize: 11 }}>
          <span style={{ color: 'var(--addfg)' }}>+{f.additions}</span> <span style={{ color: 'var(--delfg)' }}>−{f.deletions}</span>
        </span>
        <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={props.viewed} onChange={(e) => props.onViewed(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          Viewed
        </label>
      </div>
      {!props.collapsed &&
        (!f.patch ? (
          <div className="t3" style={{ padding: '10px 14px', fontSize: 12.5 }}>
            No text diff from GitHub (binary, renamed without changes, or too large).{' '}
            <button onClick={() => open(`${props.url}/files`)} style={{ background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
              Open on GitHub ↗
            </button>
          </div>
        ) : big ? (
          <div style={{ padding: '10px 14px', fontSize: 12.5, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="t2">Large diff: {rows.length} lines.</span>
            <button className="push" style={{ fontSize: 12 }} onClick={() => setFull(true)}>
              Load Diff
            </button>
          </div>
        ) : (
          <div className="mono" role="table" aria-label={`Diff of ${f.path}`} style={{ fontSize: 12, lineHeight: 1.6, overflowX: 'auto' }}>
            {rows.map((row, i) => {
              if (row.kind === 'hunk')
                return (
                  <div
                    key={i}
                    style={{ background: 'var(--hunkbg)', color: 'var(--hunkfg)', padding: '2px 12px 2px 108px', whiteSpace: 'pre', minWidth: 'max-content' }}
                  >
                    {row.text}
                  </div>
                );
              const bg = inSel(row)
                ? 'color-mix(in srgb, var(--accent) 20%, transparent)'
                : row.type === '+'
                  ? 'var(--addbg)'
                  : row.type === '-'
                    ? 'var(--delbg)'
                    : 'transparent';
              const fg = row.type === '+' ? 'var(--addfg)' : row.type === '-' ? 'var(--delfg)' : 'var(--text)';
              const n = numOf(row);
              const side = sideOf(row.type);
              const here = props.threads.get(`${f.path}:${row.newNo}`);
              const pend = props.pending.filter((c) => c.side === side && c.line === n);
              const formHere = !!sel && sel.side === side && sel.line === n;
              const label = `Comment on line ${n}${side === 'LEFT' ? ' (removed)' : ''}`;
              return (
                <Fragment key={i}>
                  <div className="dl" style={{ display: 'flex', minWidth: 'max-content', background: bg }}>
                    <button className="ln" aria-label={label} title={`${label}. Shift-click to select a range.`} onClick={(e) => click(row, e.shiftKey)}>
                      {row.oldNo ?? ''}
                    </button>
                    <button className="ln" aria-label={label} title={`${label}. Shift-click to select a range.`} onClick={(e) => click(row, e.shiftKey)}>
                      {row.newNo ?? ''}
                    </button>
                    <button className="addc" aria-label={label} tabIndex={-1} onClick={(e) => click(row, e.shiftKey)}>
                      +
                    </button>
                    <span style={{ whiteSpace: 'pre', paddingRight: 16, color: fg }}>
                      {row.type === ' ' ? ' ' : row.type}
                      {row.text}
                    </span>
                  </div>
                  {row.type !== '-' && here?.map((t) => <Thread key={t.id} t={t} prId={props.prId} onPosted={props.onPosted} />)}
                  {pend.map((c, k) => (
                    <PendingNote key={k} c={c} onRemove={() => props.onRemovePending(c)} />
                  ))}
                  {formHere && (
                    <CommentForm
                      sel={sel!}
                      prId={props.prId}
                      headSha={props.headSha}
                      hasPending={props.hasPending}
                      onCancel={() => props.onSelect(null)}
                      onAddPending={props.onAddPending}
                      onPosted={props.onPosted}
                    />
                  )}
                </Fragment>
              );
            })}
          </div>
        ))}
    </div>
  );
}

const box = { margin: '4px 12px 8px 108px', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5, maxWidth: 820 } as const;
const sans = '-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif';

function CommentForm({
  sel,
  prId,
  headSha,
  hasPending,
  onCancel,
  onAddPending,
  onPosted,
}: {
  sel: Sel;
  prId: string;
  headSha: string;
  hasPending: boolean;
  onCancel: () => void;
  onAddPending: (c: LineComment) => void;
  onPosted: () => void;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const c: LineComment = {
    path: sel.path,
    line: sel.line,
    side: sel.side,
    ...(sel.startLine !== sel.line ? { startLine: sel.startLine, startSide: sel.side } : {}),
    body: body.trim(),
  };
  const single = async () => {
    setBusy(true);
    setErr(null);
    try {
      await call('prs:review', { ref: refOf(prId), event: 'COMMENT', body: '', comments: [c], commitId: headSha });
      onPosted();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const lines = sel.startLine !== sel.line ? `lines ${sel.startLine}–${sel.line}` : `line ${sel.line}`;
  return (
    <div className="card" style={{ ...box, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, fontFamily: sans }}>
      <span className="t3" style={{ fontSize: 11.5 }}>
        Comment on {lines}
        {sel.side === 'LEFT' ? ' of the old version' : ''}
      </span>
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Leave a comment (Markdown works, as on GitHub)"
        aria-label="Comment"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
            if (hasPending) onAddPending(c);
            else void single();
          }
        }}
        style={{ padding: 8, resize: 'vertical', fontFamily: sans, fontSize: 13 }}
      />
      {err && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {busy && <Spinner />}
        <button className="push" onClick={onCancel}>
          Cancel
        </button>
        {!hasPending && (
          <button className="push" disabled={!body.trim() || busy} onClick={() => void single()} title="Post this comment on GitHub now">
            Add Single Comment
          </button>
        )}
        <button
          className="prominent"
          disabled={!body.trim() || busy}
          style={{ opacity: body.trim() ? 1 : 0.5 }}
          onClick={() => onAddPending(c)}
          title="Keep it as pending and send it with your review"
        >
          {hasPending ? 'Add Review Comment' : 'Start a Review'}
        </button>
      </div>
    </div>
  );
}

function PendingNote({ c, onRemove }: { c: LineComment; onRemove: () => void }) {
  return (
    <div
      className="card"
      style={{
        ...box,
        padding: '8px 10px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        fontFamily: sans,
        borderColor: 'color-mix(in srgb, var(--warn) 50%, var(--cardb))',
      }}
    >
      <span
        style={{
          padding: '0 6px',
          borderRadius: 8,
          background: 'color-mix(in srgb, var(--warn) 16%, transparent)',
          color: 'var(--warn)',
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        Pending
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <Markdown text={c.body} />
        {c.startLine ? (
          <span className="t3" style={{ fontSize: 11.5 }}>
            {' '}
            · lines {c.startLine}–{c.line}
          </span>
        ) : null}
      </span>
      <button onClick={onRemove} style={{ background: 'none', border: 0, color: 'var(--gap)', cursor: 'pointer', fontSize: 12 }}>
        Delete
      </button>
    </div>
  );
}

function Thread({ t, prId, onPosted }: { t: ReviewThreadView; prId: string; onPosted: () => void }) {
  const [reply, setReply] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open1, setOpen] = useState(!t.resolved);
  const send = async () => {
    if (!reply?.trim()) return;
    try {
      await call('prs:reply', { ref: refOf(prId), commentId: t.id, body: reply.trim() });
      setReply(null);
      onPosted();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="card" style={{ ...box, padding: 0, fontFamily: sans, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open1)}
        style={{
          display: 'flex',
          gap: 8,
          width: '100%',
          alignItems: 'center',
          padding: '6px 10px',
          background: 'var(--list)',
          border: 0,
          borderBottom: open1 ? '.5px solid var(--sep)' : 0,
          color: 'var(--text2)',
          cursor: 'pointer',
          fontSize: 12,
          textAlign: 'left',
        }}
      >
        {open1 ? '⌄' : '›'} {t.messages.length} comment{t.messages.length === 1 ? '' : 's'} · {t.messages[0]?.author}
        {t.resolved && (
          <span className="pill" style={{ color: 'var(--al)' }}>
            Resolved
          </span>
        )}
      </button>
      {open1 && (
        <>
          {t.messages.map((m) => (
            <div key={m.id} style={{ padding: '8px 10px', borderBottom: '.5px solid var(--sep)' }}>
              <div style={{ fontSize: 12, marginBottom: 2, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <Avatar login={m.author} size={18} />
                <b>{m.author}</b>
                {m.aiReviewer && (
                  <span className="pill" style={{ marginLeft: 6, color: 'var(--ai)' }}>
                    AI reviewer
                  </span>
                )}{' '}
                <span className="t3">· {new Date(m.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </div>
              <Markdown text={m.body} />
            </div>
          ))}
          <div style={{ padding: 8 }}>
            {reply == null ? (
              <span style={{ display: 'flex', gap: 8 }}>
                <button className="push" style={{ fontSize: 12 }} onClick={() => setReply('')}>
                  Reply…
                </button>
                {t.threadId && (
                  <button className="push" style={{ fontSize: 12 }} onClick={() => void call('prs:resolve', { threadId: t.threadId!, resolve: !t.resolved }).then(onPosted).catch((e) => setErr(errText(e)))}>
                    {t.resolved ? 'Unresolve Conversation' : 'Resolve Conversation'}
                  </button>
                )}
              </span>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <textarea
                  autoFocus
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  aria-label="Reply"
                  style={{ padding: 8, fontFamily: sans, fontSize: 13 }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setReply(null);
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
                  }}
                />
                {err && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{err}</span>}
                <span style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="push" onClick={() => setReply(null)}>
                    Cancel
                  </button>
                  <button className="prominent" disabled={!reply.trim()} onClick={() => void send()}>
                    Reply
                  </button>
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FinishReview({
  prId,
  headSha,
  pending,
  own,
  onDone,
  onClose,
}: {
  prId: string;
  headSha: string;
  pending: LineComment[];
  own: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>('COMMENT');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await call('prs:review', { ref: refOf(prId), event, body, comments: pending, commitId: headSha });
      onDone();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const opts: Array<[typeof event, string, string]> = [
    ['COMMENT', 'Comment', 'General feedback without approving.'],
    ['APPROVE', 'Approve', 'Give your approval to merge.'],
    ['REQUEST_CHANGES', 'Request changes', 'Feedback that must be addressed before merging.'],
  ];
  return (
    <div
      className="card"
      role="dialog"
      aria-label="Finish your review"
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--accent)' }}
    >
      <span style={{ fontWeight: 600 }}>
        Finish your review{pending.length ? ` · ${pending.length} pending comment${pending.length === 1 ? '' : 's'}` : ''}
      </span>
      <textarea
        autoFocus
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a summary (optional for Comment with line comments, and for Approve)"
        aria-label="Review summary"
        style={{ padding: 8 }}
      />
      <div role="radiogroup" aria-label="Review type" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {opts.map(([v, l, d]) => {
          const off = own && v !== 'COMMENT';
          return (
            <label
              key={v}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-start', opacity: off ? 0.45 : 1, cursor: off ? 'default' : 'pointer' }}
              title={off ? 'You can’t approve or request changes on your own pull request.' : undefined}
            >
              <input
                type="radio"
                name={`ev-${prId}`}
                checked={event === v}
                disabled={off}
                onChange={() => setEvent(v)}
                style={{ marginTop: 3, accentColor: 'var(--accent)' }}
              />
              <span style={{ display: 'flex', flexDirection: 'column' }}>
                <b style={{ fontWeight: 600 }}>{l}</b>
                <span className="t3" style={{ fontSize: 12 }}>
                  {d}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {msg && <span style={{ color: 'var(--gap)', fontSize: 12.5 }}>{msg}</span>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        {busy && <Spinner />}
        <button className="push" onClick={onClose}>
          Cancel
        </button>
        <button className="prominent" disabled={busy || (!pending.length && !body.trim() && event !== 'APPROVE')} onClick={() => void submit()}>
          Submit Review
        </button>
      </div>
    </div>
  );
}
