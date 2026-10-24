import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Report } from '@shared/model';
import { parsePatch } from '@analysis/diff';
import { call, isMac, open, refOf } from '../api';
import { useApp } from '../store';
import { CodeBlock } from './PrDetails';
import { prLabel, usePrStatus } from './Report';
import { issuesOf } from '@analysis/review';
import { SevBadge, doneKey, showFinding } from './FindingsPanel';
import { AiBadge, Pill, SEV_COLOR, Spinner } from './ui';

export function Inspector() {
  const s = useApp();
  const r = s.report!;
  return (
    <aside aria-label="Inspector" style={{ width: s.widths.insp, flex: `0 0 ${s.widths.insp}px`, borderLeft: '.5px solid var(--sep)', background: 'var(--list)', overflow: 'auto' }}>
      {s.node ? <NodePane r={r} id={s.node} /> : s.link ? <LinkPane r={r} id={s.link} /> : <Overview r={r} />}
    </aside>
  );
}

/** The panel when nothing is selected: what to look at next, not another summary. */
function Overview({ r }: { r: Report }) {
  const s = useApp();
  const status = usePrStatus(r);
  const issues = issuesOf(r, status);
  const open = issues.filter((i) => !s.checks[doneKey(i.id)]);
  const next = open[0];
  const openF = r.findings.filter((f) => f.status === 'Open');
  const scoreOf = (id: string) => {
    const fl = openF.filter((f) => f.nodeId === id);
    const risk = r.overlays[id]?.risk.level;
    return fl.filter((f) => f.sev === 'High').length * 4 + fl.filter((f) => f.sev === 'Medium').length * 2 + (risk === 'High' ? 3 : risk === 'Medium' ? 1 : 0);
  };
  const files = r.nodes.filter((n) => !n.isTest && n.kind !== 'Docs').map((n) => ({ n, score: scoreOf(n.id) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 6).map((x) => x.n);
  const since = r.nodes.filter((n) => r.overlays[n.id]?.since === true);
  const visited = s.visited.filter((v) => (v.kind === 'node' ? r.nodes.some((n) => n.id === v.id) : r.links.some((l) => l.id === v.id))).slice(0, 5);

  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13 }}>
      <section aria-labelledby="ov-next" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="ov-next" className="ov-h">Next up</h2>
          <span className="t3">{issues.length - open.length} of {issues.length} done</span>
        </span>
        {next ? (
          <div className="card" style={{ padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><SevBadge sev={next.sev} /><span className="t3">{next.prIds.map((p) => prLabel(r, p)).join(' + ')}</span></span>
            <span style={{ fontWeight: 600, lineHeight: 1.4 }}>{next.title}</span>
            <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="prominent" onClick={() => showFinding(next.id)}>Show Finding</button>
              {next.nodeId && <button className="push" onClick={() => s.inspect('node', next.nodeId!)}>Open File</button>}
            </span>
          </div>
        ) : (
          <div className="card" style={{ padding: '12px 13px', color: 'var(--al)', fontWeight: 600 }}>✓ Every issue is checked</div>
        )}
      </section>

      {files.length > 0 && (
        <section aria-labelledby="ov-files" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="ov-files" className="ov-h">Files to look at</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {files.map((n) => <FileRow key={n.id} r={r} id={n.id} />)}
          </div>
          <span className="t3" style={{ lineHeight: 1.45 }}>Ranked by open findings and file risk.</span>
        </section>
      )}

      {since.length > 0 && (
        <section aria-labelledby="ov-since" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="ov-since" className="ov-h">Changed since your last review</h2>
          <div className="card" style={{ overflow: 'hidden' }}>{since.slice(0, 8).map((n) => <FileRow key={n.id} r={r} id={n.id} />)}</div>
        </section>
      )}

      {visited.length > 0 && (
        <section aria-labelledby="ov-recent" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 id="ov-recent" className="ov-h">Recently viewed</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {visited.map((v) => v.kind === 'node' ? <FileRow key={`n${v.id}`} r={r} id={v.id} /> : <LinkRow key={`l${v.id}`} r={r} id={v.id} />)}
          </div>
        </section>
      )}

      <History r={r} />

      <span className="t3" style={{ lineHeight: 1.45 }}>Head commits {r.prs.map((p) => `${p.repo} #${p.number} ${p.headSha.slice(0, 7)}`).join(' · ')}</span>
    </div>
  );
}

function FileRow({ r, id }: { r: Report; id: string }) {
  const s = useApp();
  const n = r.nodes.find((x) => x.id === id);
  if (!n) return null;
  const o = r.overlays[id];
  const fl = r.findings.filter((f) => f.nodeId === id && f.status === 'Open');
  const worst = fl.some((f) => f.sev === 'High') ? 'High' : fl.some((f) => f.sev === 'Medium') ? 'Medium' : fl.length ? 'Info' : null;
  return (
    <button className="ov-row" onClick={() => s.inspect('node', id)} title={n.path}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.name}</span>
        <span className="t3" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prLabel(r, n.prId)}{o ? ` · ${o.risk.level} risk` : ''}</span>
      </span>
      {worst && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10, background: SEV_COLOR[worst], color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: '20px', textAlign: 'center' }} title={`${fl.length} open findings`}>{fl.length}</span>}
      <span aria-hidden="true" className="t3" style={{ fontSize: 16 }}>›</span>
    </button>
  );
}

function LinkRow({ r, id }: { r: Report; id: string }) {
  const s = useApp();
  const l = r.links.find((x) => x.id === id);
  if (!l) return null;
  return (
    <button className="ov-row" onClick={() => s.inspect('link', id)}>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600 }}>Link {l.n}: {l.title}</span>
        <span className="t3">{l.prIds.map((p) => prLabel(r, p)).join(' + ')}</span>
      </span>
      <span aria-hidden="true" className="t3" style={{ fontSize: 16 }}>›</span>
    </button>
  );
}

const HIST: Record<'asked' | 'open' | 'gone', { label: string; icon: string; c: string }> = {
  asked: { label: 'A reviewer asked', icon: '“', c: 'var(--accent)' },
  open: { label: 'Still open', icon: '!', c: 'var(--warn)' },
  gone: { label: 'No longer reported', icon: '✓', c: 'var(--al)' },
};

function ago(iso?: string): string {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Notes from past reviews of these repos, grouped by PR, newest first, each said plainly. */
function History({ r }: { r: Report }) {
  const items = r.memory ?? [];
  if (!items.length) return null;
  const groups = new Map<string, typeof items>();
  for (const m of items) {
    const k = m.source ?? m.when.split(' · ')[0] ?? m.repo;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return (
    <section aria-labelledby="ov-hist" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 id="ov-hist" className="ov-h">Review history</h2>
      {[...groups.entries()].map(([pr, list]) => (
        <div key={pr} className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--colbg)', borderBottom: '.5px solid var(--sep)' }}>
            <b style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{pr}</b>
            <span className="t3" style={{ whiteSpace: 'nowrap' }}>{ago(list[0].at) || list[0].when.split(' · ')[1]}</span>
          </div>
          {list.map((m, i) => {
            const kind = m.kind ?? (m.ok ? 'gone' : 'open');
            const h = HIST[kind];
            const text = m.quote ?? m.text.replace(/^(Reviewers asked|Still open|No longer reported):\s*/, '');
            return (
              <div key={i} style={{ padding: '10px 12px', display: 'flex', gap: 10, borderTop: i ? '.5px solid var(--sep)' : 0 }}>
                <span aria-hidden="true" style={{ flex: '0 0 22px', width: 22, height: 22, borderRadius: '50%', background: `color-mix(in srgb, ${h.c} 15%, transparent)`, color: h.c, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{h.icon}</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontWeight: 600, color: h.c }}>{h.label}</span>
                  <span style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>{kind === 'asked' ? `“${text}”` : text}</span>
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <span className="t3" style={{ lineHeight: 1.45 }}>Kept on this computer from your past reports and the review comments on these repos.</span>
    </section>
  );
}

/** Top of a file or link pane: back to the overview, or to the item you looked at before. */
function NavBar({ r }: { r: Report }) {
  const s = useApp();
  const prev = s.visited[1];
  const prevName = prev ? (prev.kind === 'node' ? r.nodes.find((n) => n.id === prev.id)?.name : `Link ${r.links.find((l) => l.id === prev.id)?.n ?? ''}`) : null;
  return (
    <nav aria-label="Inspector navigation" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '8px 10px', borderBottom: '.5px solid var(--sep)', background: 'var(--bar)', position: 'sticky', top: 0, zIndex: 2 }}>
      <button className="push" style={{ fontSize: 12.5 }} onClick={() => s.set({ node: null, link: null })}>‹ Overview</button>
      {prev && prevName && <button className="push" style={{ fontSize: 12.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => s.inspectBack()} title={`Back to ${prevName}`}>‹ {prevName}</button>}
    </nav>
  );
}

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
      <NavBar r={r} />
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
    <div style={{ display: 'flex', flexDirection: 'column' }}>
    <NavBar r={r} />
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
        return n ? <button key={nid} className="side-row" onClick={() => s.inspect('node', nid)}><span>{n.name}</span><span className="mono t3" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{prLabel(r, n.prId)}</span></button> : null;
      })}
    </div>
    </div>
  );
}
