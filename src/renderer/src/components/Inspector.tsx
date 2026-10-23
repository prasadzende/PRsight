import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Report } from '@shared/model';
import { parsePatch } from '@analysis/diff';
import { call, isMac, open, refOf } from '../api';
import { explainReport } from '../actions';
import { useApp } from '../store';
import { CodeBlock } from './PrDetails';
import { prLabel } from './Report';
import { AiBadge, Pill, SEV_COLOR, Spinner } from './ui';

export function Inspector() {
  const s = useApp();
  const r = s.report!;
  return (
    <aside aria-label="Inspector" style={{ width: s.widths.insp, flex: `0 0 ${s.widths.insp}px`, borderLeft: '.5px solid var(--sep)', background: 'var(--list)', overflow: 'auto' }}>
      {s.node ? <NodePane r={r} id={s.node} /> : s.link ? <LinkPane r={r} id={s.link} /> : <Summary r={r} />}
    </aside>
  );
}

function Summary({ r }: { r: Report }) {
  const s = useApp();
  const done = r.checklist.filter((c) => s.checks[c.id]).length;
  const aiOn = !!useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get') }).data?.ai.enabled;
  // Say what really happened: AI off, AI on but not run yet, or AI on but it failed.
  const ruleCap = !aiOn ? 'SUMMARY · FROM RULES (AI OFF)' : s.explaining ? 'SUMMARY · FROM RULES · AI IS WRITING ITS NOTES…' : r.aiError || s.explainError ? 'SUMMARY · FROM RULES · AI ON, BUT IT FAILED' : 'SUMMARY · FROM RULES · AI ON, NOT RUN YET';
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="cap">{r.ai?.summary ? `SUMMARY · WRITTEN BY AI · ${r.ai.provider.toUpperCase()}` : ruleCap}</span>{r.ai?.summary && <AiBadge />}</span>
      <span style={{ lineHeight: 1.55 }}>{r.ai?.summary ?? r.summary.text}</span>
      {!r.ai && (
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="push" style={{ fontSize: 12 }} disabled={s.explaining} onClick={() => void explainReport()}>{s.explaining ? 'Explaining with AI…' : 'Explain This Report with AI…'}</button>
          {s.explaining && <Spinner />}
          {s.explainError && <span style={{ color: 'var(--gap)', fontSize: 12 }}>{s.explainError}</span>}
        </span>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Stat n={r.totals.files} label="files changed" />
        <Stat n={r.totals.links} label="cross-PR links" />
        <Stat n={r.totals.high} label="high findings" color={r.totals.high ? 'var(--gap)' : undefined} />
        <Stat n={`${done}/${r.checklist.length}`} label="reviewed" />
      </div>
      {!!r.memory?.length && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="cap">FROM PAST REVIEWS</span>
          {r.memory.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ flex: '0 0 16px', fontWeight: 700, color: m.ok ? 'var(--al)' : 'var(--warn)' }}>{m.ok ? '✓' : '!'}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}><span className="t3" style={{ fontSize: 11 }}>{m.when}</span><span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{m.text}</span></span>
            </div>
          ))}
          <span className="t3" style={{ fontSize: 11, lineHeight: 1.4 }}>Kept on this computer from your past reports and resolved threads in these repos.</span>
        </div>
      )}
      <span className="t3" style={{ fontSize: 11.5 }}>Select a file or link to inspect it. Head SHAs {r.prs.map((p) => p.headSha.slice(0, 7)).join(' · ')}.</span>
    </div>
  );
}

const Stat = ({ n, label, color }: { n: number | string; label: string; color?: string }) => (
  <div className="card" style={{ padding: 10 }}><div style={{ fontSize: 20, fontWeight: 600, color }}>{n}</div><div className="t2" style={{ fontSize: 12 }}>{label}</div></div>
);

function NodePane({ r, id }: { r: Report; id: string }) {
  const n = r.nodes.find((x) => x.id === id);
  const pr = r.prs.find((p) => `${p.owner}/${p.repo}#${p.number}` === n?.prId);
  const q = useQuery({ queryKey: ['diff', id], queryFn: () => call('report:diff', { ref: refOf(n!.prId), paths: n!.paths.slice(0, 20) }), enabled: !!n });
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [id]);
  useEffect(() => {
    if (!full) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [full]);
  if (!n || !pr) return null;
  const fl = r.findings.filter((f) => f.nodeId === id && f.status === 'Open');
  const links = r.links.filter((l) => l.nodes.includes(id));
  const o = r.overlays[id];
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '.5px solid var(--sep)' }}>
        <span className="t3" style={{ fontSize: 11.5 }}>{prLabel(r, n.prId)}</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{n.name}</span>
        <span className="mono t2" style={{ fontSize: 11 }}>{n.path}</span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          <Pill>{o.kind}</Pill>
          <Pill color={o.noTest ? 'var(--warn)' : undefined}>{o.tests}</Pill>
          <Pill color={o.risk.level === 'High' ? 'var(--gap)' : o.risk.level === 'Medium' ? 'var(--warn)' : undefined} title={o.risk.why}>{o.risk.level} risk</Pill>
        </span>
        <span style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <button className="push" style={{ fontSize: 12 }} onClick={() => open(`${pr.url}/files`)}>Open on GitHub</button>
          <button className="push" style={{ fontSize: 12 }} disabled={!q.data} onClick={() => setFull(true)} title="View the code full screen (Esc to close)">Full Screen</button>
        </span>
      </div>
      {fl.map((f) => (
        <div key={f.id} style={{ padding: '8px 14px', borderBottom: '.5px solid var(--sep)', fontSize: 12.5, display: 'flex', gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 5, background: SEV_COLOR[f.sev], flex: '0 0 8px' }} />
          <span><b>{f.aiReviewer ? `AI reviewer · ${f.src}` : f.src}:</b> {f.text}</span>
        </div>
      ))}
      {links.map((l) => (
        <div key={l.id} style={{ padding: '8px 14px', borderBottom: '.5px solid var(--sep)', fontSize: 12.5 }}><b>Link {l.n}:</b> {l.title}</div>
      ))}
      {q.isLoading && <div className="t3" style={{ padding: 14, display: 'flex', gap: 8 }}><Spinner /> Loading the diff…</div>}
      {q.data && <Diffs paths={n.paths} data={q.data} max={400} />}
      {full && q.data && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label={`${n.name} code, full screen`}>
          <div className="drag" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${isMac ? 30 : 10}px 18px 10px`, borderBottom: '.5px solid var(--sep)', background: 'var(--bar)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{n.name} <span className="t3" style={{ fontWeight: 400, fontSize: 12 }}>· {prLabel(r, n.prId)}</span></span>
              <span className="mono t3" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.paths.length} {n.paths.length === 1 ? 'file' : 'files'} · {n.path}</span>
            </span>
            <span style={{ flex: 1 }} />
            <button className="push" style={{ fontSize: 12 }} onClick={() => open(`${pr.url}/files`)}>Open on GitHub</button>
            <button className="prominent" autoFocus onClick={() => setFull(false)} title="Close (Esc)">Close</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', fontSize: 13 }}>
            <Diffs paths={n.paths} data={q.data} max={5000} big />
          </div>
        </div>
      )}
    </div>
  );
}

function Diffs({ paths, data, max, big }: { paths: string[]; data: Record<string, { patch: string | null; status: string }>; max: number; big?: boolean }) {
  return (
    <>
      {paths.map((p) => {
        const f = data[p];
        const lines = parsePatch(f?.patch).flatMap((h) => [{ a: null, b: null, type: ' ', text: `@@ ${h.header}` }, ...h.lines.map((l) => ({ a: l.oldNo, b: l.newNo, type: l.type, text: l.text }))]);
        return (
          <div key={p} style={{ borderBottom: '.5px solid var(--sep)' }}>
            <div className="mono" style={{ fontSize: big ? 12 : 11, padding: big ? '8px 18px' : '6px 14px', background: 'var(--card)', borderBottom: '.5px solid var(--sep)', position: big ? 'sticky' : undefined, top: 0, zIndex: 1 }}>{p} <span className="t3">· {f?.status ?? 'unchanged'}</span></div>
            {lines.length ? <div style={big ? { zoom: 1.12 } : undefined}><CodeBlock lines={lines.slice(0, max)} label={`Diff of ${p}`} /></div> : <div className="t3" style={{ padding: '8px 14px', fontSize: 12 }}>No text diff (binary or too large). Open it on GitHub.</div>}
          </div>
        );
      })}
    </>
  );
}

function LinkPane({ r, id }: { r: Report; id: string }) {
  const s = useApp();
  const l = r.links.find((x) => x.id === id);
  if (!l) return null;
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="cap">CROSS-PR LINK {l.n}</span>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{l.title}</span>
      <Pill>{l.impact} impact</Pill>
      <span className="t3" style={{ fontSize: 12 }}>{l.impactWhy}</span>
      <span className="t2" style={{ lineHeight: 1.5 }}>{l.text}</span>
      {r.ai?.links?.[l.id] && <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.5 }}><AiBadge /><span>{r.ai.links[l.id]}</span></span>}
      <span className="cap" style={{ marginTop: 8 }}>EVIDENCE</span>
      {l.evidence.map((e, i) => (
        <div key={i} className="card" style={{ padding: '6px 10px' }}>
          <div className="mono t3" style={{ fontSize: 10.5 }}>{prLabel(r, e.prId)} · {e.path}{e.line ? `:${e.line}` : ''}</div>
          <div className="mono" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.snippet}</div>
        </div>
      ))}
      <span className="cap" style={{ marginTop: 8 }}>FILES</span>
      {l.nodes.map((nid) => {
        const n = r.nodes.find((x) => x.id === nid);
        return n ? <button key={nid} className="side-row" onClick={() => s.focusNode(nid)}><span>{n.name}</span><span className="mono t3" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{prLabel(r, n.prId)}</span></button> : null;
      })}
    </div>
  );
}
