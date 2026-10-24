import { useEffect, useRef, useState } from 'react';
import type { HygieneCheck } from '@analysis/prHygiene';
import { Markdown } from './Markdown';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrDetails as Details, ReviewThreadView, ThreadMessage } from '@shared/ipc';
import { call, errText, open, refOf } from '../api';
import { useApp } from '../store';
import { Avatar, Icon, ICONS, Pill, Seg, Spinner, StateBadge } from './ui';

export function PrDetails() {
  const s = useApp();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'threads' | 'conversation'>('threads');
  const q = useQuery({ queryKey: ['details', s.current], queryFn: () => call('prs:details', refOf(s.current!)), enabled: !!s.current });

  if (!s.current)
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--text3)' }}><Icon d={ICONS.graph} size={44} stroke={1.3} /></span>
          <span style={{ fontSize: 17, fontWeight: 600 }}>No Pull Request Selected</span>
          <span className="t2" style={{ lineHeight: 1.5 }}>Click a pull request to read its comments. Tick two or more and choose Build Report to see how their files connect.</span>
          {s.buildError && <span style={{ color: 'var(--gap)' }}>Report failed: {s.buildError}</span>}
        </div>
      </div>
    );
  if (q.isLoading) return <div className="t3" style={{ padding: 28, display: 'flex', gap: 8, alignItems: 'center' }}><Spinner /> Loading…</div>;
  if (q.error || !q.data) return <div style={{ padding: 28, color: 'var(--gap)' }}>Couldn’t load this pull request: {errText(q.error)}</div>;

  const d = q.data;
  const refresh = () => void qc.invalidateQueries({ queryKey: ['details', s.current] });
  const items = tab === 'threads' ? d.threads : null;
  const effTab = d.threads.length === 0 && tab === 'threads' ? 'conversation' : tab;
  const titleIssues = (d.hygiene ?? []).filter((c) => c.area === 'title' && c.level === 'warn');
  const draft = s.reviewOpen && s.reviewDraft?.prId === d.pr.id ? s.reviewDraft : null;
  const descIssues = (d.hygiene ?? []).filter((c) => c.area === 'description' && c.level === 'warn');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '22px 28px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {s.report && (
        <button className="push" onClick={() => s.set({ section: 'report' })} title={`Back to ${s.report.title}`} style={{ alignSelf: 'flex-start', fontSize: 12.5 }}>
          ‹ {s.report.prIds.includes(s.current) ? 'Back to Report' : 'Open Report'}
        </button>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="t3" style={{ fontSize: 12, flex: 1, minWidth: 160, display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{d.pr.repo} · #{d.pr.number} <StateBadge state={d.pr.state} draft={d.pr.draft} /></span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="push" onClick={() => open(d.pr.url)}><Icon d={ICONS.ext} size={14} />Open on GitHub</button>
            <button className="push" onClick={() => s.toggleSel(d.pr.id)}>{s.selected.includes(d.pr.id) ? '✓ In Report' : 'Add to Report'}</button>
            <button className="prominent" onClick={() => s.set({ reviewOpen: !s.reviewOpen, reviewDraft: null })} aria-expanded={s.reviewOpen}>Review…</button>
          </div>
        </div>
          <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, lineHeight: 1.25, ...(titleIssues.length ? { textDecoration: 'underline wavy var(--warn)', textUnderlineOffset: 5, textDecorationThickness: 1.5 } : {}) }} title={titleIssues.map((c) => c.text).join('\n') || undefined}>{d.pr.title}</h1>
          <span className="t2" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>
            <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}><Avatar login={d.pr.author} size={18} /></span><b style={{ fontWeight: 600 }}>{d.pr.author}</b> wants to merge <span className="mono" style={{ fontSize: 11.5 }}>{d.pr.branch}</span> into <span className="mono" style={{ fontSize: 11.5 }}>{d.pr.base}</span> · {d.pr.changedFiles} files, +{d.pr.additions} −{d.pr.deletions}
          </span>
      </div>
      {s.reviewOpen && <ReviewPanel key={draft ? draft.n : 'manual'} d={d} draft={draft} onDone={() => { s.set({ reviewOpen: false, reviewDraft: null }); refresh(); }} />}
      {d.myReview && <MyReview state={d.myReview.state} at={d.myReview.at} />}
      <Hygiene checks={d.hygiene ?? []} />
      {/* Opened from the Report tab's Request changes / Approve: the description starts collapsed so the review comes first. */}
      <Description key={draft ? `d-${draft.n}` : 'd'} body={d.pr.body} issues={descIssues} startOpen={!draft} />
      <Seg value={effTab} onChange={setTab} label="Comments" options={[['threads', `Review Threads (${d.threads.length})`], ['conversation', `Conversation (${d.conversation.length})`]]} />
      {effTab === 'threads' && items ? (
        items.map((t) => <Thread key={t.id} t={t} d={d} onPosted={refresh} />)
      ) : (
        <>
          {d.conversation.map((m) => (
            <div className="card" key={m.id} style={{ overflow: 'hidden' }}><Message m={m} /></div>
          ))}
          <Composer label="Add a comment to this pull request" send="Comment" onSend={async (body) => { await call('prs:comment', { ref: refOf(d.pr.id), body }); refresh(); }} url={d.pr.url} />
        </>
      )}
    </div>
  );
}

function MyReview({ state, at }: { state: string; at: string }) {
  const color = state === 'APPROVED' ? 'var(--al)' : state === 'CHANGES_REQUESTED' ? 'var(--gap)' : 'var(--text3)';
  const text = state === 'APPROVED' ? 'You approved these changes' : state === 'CHANGES_REQUESTED' ? 'You requested changes' : 'You left a review comment';
  return (
    <div className="card" style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', borderColor: color }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: color, color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{state === 'APPROVED' ? '✓' : state === 'CHANGES_REQUESTED' ? '!' : '…'}</span>
      <span style={{ fontWeight: 600 }}>{text}</span>
      <span className="t3" style={{ fontSize: 12 }}>· {new Date(at).toLocaleString('en-GB')}</span>
    </div>
  );
}

function ReviewPanel({ d, draft, onDone }: { d: Details; draft: { kind: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string } | null; onDone: () => void }) {
  const [kind, setKind] = useState<'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'>(draft?.kind ?? 'COMMENT');
  const [body, setBody] = useState(draft?.body ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Opened from the Report tab: bring the review into view and put the cursor in the summary.
  useEffect(() => {
    if (!draft) return;
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    area.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const own = d.pr.author === d.viewer;
  const shut = d.pr.state !== 'open';
  const opts: Array<[typeof kind, string, string]> = [
    ['COMMENT', 'Comment', 'Submit general feedback without approving.'],
    ['APPROVE', 'Approve', 'Give your approval to merge these changes.'],
    ['REQUEST_CHANGES', 'Request changes', 'Feedback that must be addressed before merging.'],
  ];
  const needBody = kind !== 'APPROVE' && !body.trim();
  const submit = async () => {
    if (needBody) return;
    setBusy(true);
    setErr(null);
    try {
      await call('prs:review', { ref: refOf(d.pr.id), event: kind, body });
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={box} className="card" role="region" aria-label="Finish your review" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, scrollMarginTop: 12, ...(draft ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : {}) }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>Finish your review</span>
      <label htmlFor="rv-body" className="sr">Review summary</label>
      <textarea ref={area} id="rv-body" rows={draft?.body ? 6 : 3} placeholder="Leave a summary (optional for Approve)" value={body} onChange={(e) => setBody(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical', width: '100%' }} />
      <div role="radiogroup" aria-label="Review type" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {opts.map(([k, label, desc]) => {
          const dis = k !== 'COMMENT' && (own || shut);
          return (
            <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.5 : 1 }}>
              <input type="radio" name="rv-kind" checked={kind === k} disabled={dis} onChange={() => setKind(k)} style={{ accentColor: 'var(--accent)', margin: '3px 0 0' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <b style={{ fontWeight: 600 }}>{label}</b>
                <span className="t2" style={{ fontSize: 12 }}>{dis ? (shut ? `Not available: this pull request is ${d.pr.state}.` : `Not available: you can’t ${k === 'APPROVE' ? 'approve' : 'request changes on'} your own pull request.`) : desc}</span>
              </span>
            </label>
          );
        })}
      </div>
      {needBody && <span style={{ fontSize: 12, color: 'var(--warn)' }}>{kind === 'REQUEST_CHANGES' ? 'Add a summary so the author knows what to change.' : 'Add a summary to comment.'}</span>}
      {err && <span style={{ fontSize: 12, color: 'var(--gap)' }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="t3" style={{ fontSize: 11.5, flex: 1 }}>Posts one review to GitHub as you. Copilot and other AI reviews don’t count as an independent review; yours does.</span>
        <button className="prominent" disabled={busy || needBody} style={{ opacity: needBody ? 0.45 : 1 }} onClick={() => void submit()}>Submit Review</button>
      </div>
    </div>
  );
}


function Message({ m }: { m: ThreadMessage }) {
  return (
    <div style={{ padding: '12px 14px', display: 'flex', gap: 10, borderBottom: '.5px solid var(--sep)' }}>
      <Avatar login={m.author} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span>
          <b style={{ fontWeight: 600 }}>{m.author}</b>
          {m.isBot && <span className="pill" style={{ marginLeft: 6 }} title={m.aiReviewer ? 'An AI reviewer. Treat its comments as a first pass.' : undefined}>{m.aiReviewer ? 'AI reviewer' : 'bot'}</span>}
          <span className="t3" style={{ fontSize: 11.5, marginLeft: 6 }}>{new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        </span>
        <Markdown text={m.body} />
      </div>
    </div>
  );
}

/** Title and description checks: amber for things to fix, grey for things to look at. */
function Hygiene({ checks }: { checks: HygieneCheck[] }) {
  if (!checks.length) return null;
  const warn = checks.filter((c) => c.level === 'warn').length;
  return (
    <div className="card" role="status" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, borderColor: warn ? 'color-mix(in srgb, var(--warn) 55%, var(--cardb))' : undefined, background: warn ? 'color-mix(in srgb, var(--warn) 6%, var(--card))' : undefined }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span aria-hidden="true" style={{ color: warn ? 'var(--warn)' : 'var(--text3)', fontWeight: 700 }}>{warn ? '!' : 'i'}</span>
        <b style={{ fontWeight: 600 }}>Title &amp; description</b>
        <span className="t3" style={{ fontSize: 12 }}>{warn ? `${warn} to fix` : 'Worth a look'}{checks.length > warn ? ` · ${checks.length - warn} to check` : ''}</span>
      </span>
      {checks.map((c) => (
        <span key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, lineHeight: 1.45 }}>
          <span className="pill" style={{ flex: '0 0 auto', color: c.level === 'warn' ? 'var(--warn)' : 'var(--text2)' }}>{c.area === 'title' ? 'Title' : 'Description'}</span>
          <span style={{ flex: 1 }}>{c.text}</span>
          <span className="t3 mono" style={{ fontSize: 10.5, flex: '0 0 auto' }} title="Where this check comes from">{c.source}</span>
        </span>
      ))}
    </div>
  );
}

/** The PR description, rendered like GitHub, collapsible when long. */
function Description({ body, issues, startOpen = true }: { body: string; issues: HygieneCheck[]; startOpen?: boolean }) {
  const [openD, setOpen] = useState(startOpen);
  const empty = !body?.replace(/<!--[\s\S]*?-->/g, '').trim();
  return (
    <div className="card" style={{ overflow: 'hidden', borderColor: issues.length ? 'color-mix(in srgb, var(--warn) 55%, var(--cardb))' : undefined }}>
      <button onClick={() => setOpen(!openD)} aria-expanded={openD} style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '9px 14px', background: 'var(--list)', border: 0, borderBottom: openD ? '.5px solid var(--sep)' : 0, color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
        <span className="t2" style={{ width: 12 }}>{openD ? '⌄' : '›'}</span>
        <b style={{ fontWeight: 600 }}>Description</b>
        {issues.length > 0 && <span className="pill" style={{ color: 'var(--warn)' }}>{issues.length} issue{issues.length === 1 ? '' : 's'}</span>}
      </button>
      {openD && (empty ? <div className="t3" style={{ padding: '12px 14px', fontStyle: 'italic' }}>No description provided.</div> : <div style={{ padding: '10px 16px 12px', maxHeight: 520, overflow: 'auto' }}><Markdown text={body} /></div>)}
    </div>
  );
}

function Thread({ t, d, onPosted }: { t: ReviewThreadView; d: Details; onPosted: () => void }) {
  // Resolved threads start collapsed, as on GitHub.
  const [openT, setOpenT] = useState(!t.resolved);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stateColor = t.resolved ? 'var(--al)' : 'var(--warn)';
  const first = t.messages[0];
  const toggleResolved = async () => {
    if (!t.threadId) return;
    setBusy(true);
    setErr(null);
    try {
      await call('prs:resolve', { threadId: t.threadId, resolve: !t.resolved });
      setOpenT(t.resolved);
      onPosted();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ overflow: 'hidden', opacity: t.resolved && !openT ? 0.85 : 1 }}>
      <button onClick={() => setOpenT(!openT)} aria-expanded={openT} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 14px', border: 0, borderBottom: openT ? '.5px solid var(--sep)' : 0, background: 'var(--list)', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', font: 'inherit' }}>
        <span className="t2" style={{ width: 12, flex: '0 0 12px' }}>{openT ? '⌄' : '›'}</span>
        <span className="mono" style={{ fontSize: 11.5, overflowWrap: 'anywhere', flex: 1, minWidth: 0 }}>{t.path}{t.line ? ` · line ${t.line}` : ''}</span>
        {!openT && first && <span className="t3" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}><Avatar login={first.author} size={16} />{first.author}{t.messages.length > 1 ? ` · ${t.messages.length} comments` : ''}</span>}
        <span style={{ fontSize: 11.5, fontWeight: 600, color: stateColor, whiteSpace: 'nowrap' }}>{t.outdated && <Pill>Outdated</Pill>} {t.resolved ? '✓ Resolved' : 'Open'}</span>
      </button>
      {openT && (
        <>
          {t.code.length > 0 && <CodeBlock lines={t.code} label={`Code at line ${t.line ?? ''}`} markLast />}
          {t.messages.map((m) => <Message key={m.id} m={m} />)}
          <Composer label="Reply to this thread" send="Reply" url={d.pr.url} onSend={async (body) => { await call('prs:reply', { ref: refOf(d.pr.id), commentId: t.id, body }); onPosted(); }} />
          {t.threadId && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: '.5px solid var(--sep)' }}>
              <button className="push" style={{ fontSize: 12 }} disabled={busy} onClick={() => void toggleResolved()} title={t.resolved ? 'Reopen this conversation on GitHub' : 'Mark this conversation as resolved on GitHub'}>
                {busy ? <Spinner /> : null}{t.resolved ? 'Unresolve Conversation' : 'Resolve Conversation'}
              </button>
              {err && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{err}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CodeBlock({ lines, label, markLast }: { lines: Array<{ a: number | null; b: number | null; type: string; text: string }>; label: string; markLast?: boolean }) {
  return (
    <div className="mono" role="figure" aria-label={label} style={{ fontSize: 11.5, lineHeight: 1.6, borderBottom: '.5px solid var(--sep)', overflowX: 'auto', padding: '4px 0' }}>
      {lines.map((l, i) => {
        const bg = l.type === '+' ? 'var(--addbg)' : l.type === '-' ? 'var(--delbg)' : 'transparent';
        const fg = l.type === '+' ? 'var(--addfg)' : l.type === '-' ? 'var(--delfg)' : 'var(--text2)';
        return (
          <div key={i} style={{ display: 'flex', minWidth: 'max-content', background: bg, boxShadow: markLast && i === lines.length - 1 ? 'inset 3px 0 0 var(--accent)' : 'none' }}>
            <span aria-hidden="true" style={{ width: 40, flex: '0 0 40px', textAlign: 'right', paddingRight: 6, color: 'var(--text3)', userSelect: 'none' }}>{l.a ?? ''}</span>
            <span aria-hidden="true" style={{ width: 40, flex: '0 0 40px', textAlign: 'right', paddingRight: 8, color: 'var(--text3)', userSelect: 'none' }}>{l.b ?? ''}</span>
            <span style={{ whiteSpace: 'pre', paddingRight: 14, color: fg }}>{l.type === ' ' ? ' ' : l.type}{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function Composer({ label, send, onSend, url }: { label: string; send: string; onSend: (body: string) => Promise<void>; url: string }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = `c-${label}-${url}`.replace(/\W+/g, '-');
  return (
    <div className="card" style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor={id} className="sr">{label}</label>
      <textarea id={id} rows={2} placeholder={label} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ padding: '8px 10px', resize: 'vertical', width: '100%' }} />
      {err && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{err}</span>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="t3" style={{ fontSize: 11.5, flex: 1 }}>Posts to GitHub as you</span>
        <button className="push" style={{ fontSize: 12 }} onClick={() => open(url)}>View on GitHub</button>
        <button className="prominent" disabled={busy || !draft.trim()} style={{ opacity: draft.trim() ? 1 : 0.45 }}
          onClick={async () => { setBusy(true); setErr(null); try { await onSend(draft.trim()); setDraft(''); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } }}>
          {send}
        </button>
      </div>
    </div>
  );
}
