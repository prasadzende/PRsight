import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@shared/ipc';
import type { Finding, Report, Ticket } from '@shared/model';
import { call, open, refOf } from '../api';
import { useApp } from '../store';
import { StoryView } from './StoryView';
import { FilesView } from './FilesView';
import { ChangesView } from './ChangesView';
import { ReportBrief } from './ReportBrief';
import { AiBadge, Pill, Seg, Spinner, StateBadge } from './ui';
import type { PrStatus } from '@shared/ipc';

export const prLabel = (r: Report, id: string): string => {
  const p = r.prs.find((x) => `${x.owner}/${x.repo}#${x.number}` === id);
  return p ? `${p.repo} #${p.number}` : id;
};

export function ReportView() {
  const s = useApp();
  if (s.building)
    return (
      <div style={{ padding: 40, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <Spinner />
        <span style={{ fontWeight: 600 }}>Building the report ({s.building.step} of {s.building.total})</span>
        <span className="t2">{s.building.label}</span>
      </div>
    );
  if (s.buildError) return <div style={{ padding: 28, color: 'var(--gap)' }}>Report failed: {s.buildError}</div>;
  const r = s.report;
  if (!r) return null;
  if (s.mapFull && s.view === 'map')
    return (
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MapSection r={r} />
      </div>
    );
  if (s.view === 'report') return <ReportBrief r={r} />;
  return (
    <div style={{ padding: '18px 22px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {s.view === 'map' && <MapSection r={r} />}
      {s.view === 'changes' && <ChangesView r={r} />}
      {s.view === 'tickets' && <Tickets r={r} />}
    </div>
  );
}

/** Split a summary into short points: one per sentence. */
export function toPoints(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z0-9(“"'])/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

const ticketLabel = (t: Ticket): string => (t.system === 'ado' ? `AB#${t.key}` : t.key);

/** The ticket's web link: from the report, or built from the organisation / site saved in Settings › Boards. */
export function ticketHref(t: Ticket, st?: Settings): string | undefined {
  if (t.url) return t.url;
  const b = st?.boards;
  if (t.system === 'ado' && b?.ado.org) return `https://dev.azure.com/${encodeURIComponent(b.ado.org)}/${b.ado.project ? `${encodeURIComponent(b.ado.project)}/` : ''}_workitems/edit/${encodeURIComponent(t.key)}`;
  if (t.system === 'jira' && b?.jira.site) return `https://${b.jira.site.replace(/^https?:\/\//, '').replace(/\/.*$/, '')}/browse/${encodeURIComponent(t.key)}`;
  return undefined;
}

const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => call('settings:get') }).data;

/** A ticket number that opens the ticket when a link is known, or the Tickets tab (to set one up) when not. */
export function TicketLink({ t }: { t: Ticket }) {
  const s = useApp();
  const href = ticketHref(t, useSettings());
  return (
    <button onClick={() => (href ? open(href) : s.set({ view: 'tickets' }))} title={href ?? 'No link yet. Set it up in the Tickets tab.'} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}>
      {ticketLabel(t)} {href ? '↗' : '›'}
    </button>
  );
}

/** Shown when some tickets have no link: save the Azure DevOps organisation / Jira site once and every ticket links. */
function LinkTickets({ r }: { r: Report }) {
  const st = useSettings();
  const qc = useQueryClient();
  const missing = r.tickets.filter((t) => !ticketHref(t, st));
  const ado = missing.some((t) => t.system === 'ado');
  const jira = missing.some((t) => t.system === 'jira');
  const [org, setOrg] = useState('');
  const [project, setProject] = useState('');
  const [site, setSite] = useState('');
  if (!st || (!ado && !jira)) return null;
  const save = async () => {
    const patch = { boards: { ...(ado && org.trim() ? { ado: { org: org.trim(), project: project.trim() } } : {}), ...(jira && site.trim() ? { jira: { site: site.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') } } : {}) } };
    qc.setQueryData(['settings'], await call('settings:set', patch));
  };
  return (
    <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderColor: 'color-mix(in srgb, var(--accent) 40%, var(--cardb))' }}>
      <span style={{ fontWeight: 600 }}>Link tickets</span>
      <span className="t2" style={{ fontSize: 12.5 }}>No link was found for {missing.map(ticketLabel).join(', ')}. Tell the app where your tickets live once; it is saved in Settings › Boards and nothing is fetched.</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {ado && <><label className="sr" htmlFor="lt-org">Azure DevOps organisation</label><input id="lt-org" className="field" value={org} onChange={(e) => setOrg(e.target.value)} placeholder="Azure DevOps organisation" style={{ padding: '5px 8px', width: 210 }} />
          <label className="sr" htmlFor="lt-proj">Project (optional)</label><input id="lt-proj" className="field" value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project (optional)" style={{ padding: '5px 8px', width: 170 }} /></>}
        {jira && <><label className="sr" htmlFor="lt-site">Jira site</label><input id="lt-site" className="field" value={site} onChange={(e) => setSite(e.target.value)} placeholder="yourcompany.atlassian.net" style={{ padding: '5px 8px', width: 220 }} /></>}
        <button className="push" disabled={!(org.trim() || site.trim())} onClick={() => void save()}>Save</button>
      </div>
      {ado && <span className="t3" style={{ fontSize: 11.5 }}>The organisation is the name after dev.azure.com/ in your Azure DevOps address.</span>}
    </div>
  );
}


const TERMS: Array<[RegExp, string, string]> = [
  [/\bAPIM\b|api management/i, 'APIM (API Management)', 'Azure’s gateway in front of APIs. Every call goes through it.'],
  [/entitlement/i, 'Entitlement record', 'A small record per project that tells the gateway what the project may use and its limits.'],
  [/rate.?limit/i, 'Rate limit', 'Calls allowed in a short window, for example 300 calls every 60 seconds.'],
  [/quota/i, 'Quota', 'An allowance over a longer period, such as calls or tokens per day.'],
  [/token/i, 'Tokens (AI)', 'Pieces of text an AI model reads and writes; limits are often per minute or per day.'],
  [/terraform|\.tf\b/i, 'Terraform', 'Code that describes cloud infrastructure. A plan shows what would change.'],
  [/\bADR\b/i, 'ADR', 'Architecture decision record: a document that records a design decision and why.'],
  [/schema/i, 'JSON Schema', 'Rules that a config file must follow, checked before anything is deployed.'],
  [/policy|policies/i, 'Policy', 'Gateway rules that run on every request, such as limits and checks.'],
];
export function Glossary({ r }: { r: Report }) {
  const text = JSON.stringify([r.summary, r.cards, r.links.map((l) => l.text)]);
  const items = TERMS.filter(([re]) => re.test(text));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px 18px' }}>
      {items.map(([, term, def]) => <div key={term} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontWeight: 600 }}>{term}</span><span className="t2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{def}</span></div>)}
    </div>
  );
}

export function PrStrip({ r }: { r: Report }) {
  const s = useApp();
  const status = usePrStatus(r);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
      {r.prs.map((p) => {
        const id = `${p.owner}/${p.repo}#${p.number}`;
        return (
          <div className="card" key={id} style={{ padding: '11px 13px', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span className="t3" style={{ fontSize: 11.5 }}>{prLabel(r, id)}</span>
            <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.title}>{p.title}</span>
            <span className="t2" style={{ fontSize: 12 }}>{p.changedFiles} files · +{p.additions} −{p.deletions}</span>
            <StatusPills st={status?.[id]} />
            <span style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12 }}>
              <button onClick={() => s.set({ current: id, section: 'prs' })} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer' }}>Comments</button>
              <button onClick={() => open(p.url)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer' }}>GitHub ↗</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MapSection({ r }: { r: Report }) {
  const s = useApp();
  useEffect(() => {
    if (!s.mapFull) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.overlay') && useApp.getState().set({ mapFull: false });
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [s.mapFull]);
  const T = s.tour ? r.tour[s.tour - 1] : null;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }} id="map-top">
        <span className="cap" style={{ marginRight: 4 }}>VIEW</span>
        <Seg value={s.mapView} onChange={(v) => s.set({ mapView: v, tour: 0 })} label="Map view" options={[['story', 'Story'], ['files', 'Files']]} />
        <button className="push" style={{ fontSize: 12 }} onClick={() => s.set({ tour: 1, mapView: 'story', node: null, link: null, filePr: null })}>▶ Walk Me Through It</button>
        <span style={{ flex: 1 }} />
        {(s.node || s.link || s.filePr) && <button className="push" style={{ fontSize: 12 }} onClick={() => s.set({ node: null, link: null, filePr: null })}>Clear Selection</button>}
        <button className="push" style={{ fontSize: 12 }} onClick={() => s.set({ mapFull: !s.mapFull })} aria-pressed={s.mapFull} title={s.mapFull ? 'Exit full screen (Esc)' : 'Fill the window with the map. Clicks still update the right panel.'}>
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }}><path d={s.mapFull ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} /></svg>
          {s.mapFull ? 'Exit Full Screen' : 'Full Screen'}
        </button>
      </div>
      {T && (
        <div className="card" role="status" style={{ padding: '12px 14px', display: 'flex', gap: 14, alignItems: 'center', borderColor: 'var(--accent)' }}>
          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: 'var(--accent)' }}>STEP {s.tour} OF {r.tour.length}</span>
          <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.5 }}>{T.text}</span>
          <button className="push" style={{ fontSize: 12, opacity: s.tour > 1 ? 1 : 0.4 }} onClick={() => s.tour > 1 && s.set({ tour: s.tour - 1 })}>Back</button>
          <button className="prominent" onClick={() => s.set({ tour: s.tour >= r.tour.length ? 0 : s.tour + 1 })}>{s.tour >= r.tour.length ? 'Done' : 'Next'}</button>
          <button className="push" aria-label="End walkthrough" onClick={() => s.set({ tour: 0 })}>✕</button>
        </div>
      )}
      {s.mapView === 'story' ? <StoryView r={r} /> : <FilesView r={r} />}
    </>
  );
}

export function Findings({ r }: { r: Report }) {
  const s = useApp();
  const aiF: Finding[] = (r.ai?.findings ?? []).map((f, i) => ({ id: `AI-${i}`, sev: f.sev, src: 'AI', aiReviewer: false, ai: true, where: f.where, text: f.text, prId: r.prIds[0], status: 'Open' as const, nodeId: r.nodes.find((n) => n.paths.includes(f.path))?.id }));
  const all = [...r.findings, ...aiF];
  const groups: Array<[string, Finding['sev'] | 'Fixed', string, string]> = [['Blocking', 'High', 'var(--gap)', 'Fix before merging'], ['Should fix', 'Medium', 'var(--warn)', 'Fix now or agree a follow-up'], ['Nice to have', 'Info', 'var(--accent)', 'Optional'], ['Verified', 'Fixed', 'var(--al)', 'Checked and fine']];
  const open = all.filter((f) => f.status !== 'Fixed');
  const noBlocking = !open.some((f) => f.sev === 'High');
  const ruleFiles = r.ruleFiles.filter((f, i, a) => a.findIndex((x) => x.repo === f.repo) === i);
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Findings</span><span className="t3">{open.length}</span>
        <span className="t3" style={{ fontSize: 12, marginLeft: 'auto' }}>Click a finding to show its file</span>
      </div>
      {ruleFiles.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text2)' }}>
          <span>Team rules read from</span>
          {ruleFiles.map((f) => {
            const n = r.ruleFiles.filter((x) => x.repo === f.repo).reduce((a, x) => a + x.checked, 0);
            return <span key={f.repo} title={r.ruleFiles.filter((x) => x.repo === f.repo).map((x) => x.path).join(', ')} style={{ padding: '1px 8px', borderRadius: 10, background: 'var(--field)', fontSize: 11.5 }}>{f.repo} <span className="t3">· {n ? `${n} checked` : 'none apply'}</span></span>;
          })}
          <span className="t3">· {r.teamRules.length} rules checked, {r.teamRules.filter((t) => !t.passed).length} broken · rules that need judgement go to the checklist</span>
        </div>
      )}
      {noBlocking && <div className="card" style={{ padding: '10px 14px', color: 'var(--al)', fontWeight: 600 }}>Nothing blocks merging.</div>}
      {groups.map(([label, sev, color, hint]) => {
        const items = sev === 'Fixed' ? r.verified.map((v) => ({ key: v.id, src: v.src, where: v.where, text: v.text, nodeId: v.nodeId, status: v.src === 'Review' ? 'Fixed' : 'Passed', ai: false, aiReviewer: false, mark: '✓ ' })) : open.filter((f) => f.sev === sev).map((f) => ({ key: f.id, src: f.src, where: f.where, text: f.text, nodeId: f.nodeId, status: f.status, ai: !!f.ai, aiReviewer: f.aiReviewer, mark: '' }));
        if (!items.length) return null;
        return (
          <div className="card" key={label} style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 14px', background: 'var(--list)', borderBottom: '.5px solid var(--sep)' }}>
              <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
              <span style={{ fontWeight: 600 }}>{label}</span><span className="t3">{items.length}</span>
              <span className="t3" style={{ fontSize: 12, marginLeft: 'auto' }}>{hint}</span>
            </div>
            {items.map((f) => (
              <button key={f.key} onClick={() => f.nodeId && s.focusNode(f.nodeId)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', padding: '9px 14px', border: 0, borderBottom: '.5px solid var(--sep)', background: 'var(--card)', color: 'var(--text)', cursor: f.nodeId ? 'pointer' : 'default' }}>
                <span style={{ flex: '0 0 150px', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  {f.ai && <AiBadge title="Found by AI. Check it before relying on it." />}
                  <span className="pill" title={f.aiReviewer ? `${f.src} is an AI reviewer. Treat its findings as a first pass; it is not an independent review.` : undefined} style={{ color: f.aiReviewer ? 'var(--ai)' : f.src === 'Team rule' ? 'var(--accent)' : 'var(--text2)' }}>{f.aiReviewer ? `AI reviewer · ${f.src}` : f.src}</span>
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ lineHeight: 1.45 }}>{f.mark}{f.text}</span><span className="mono t3" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.where}</span></span>
                <span className="t3" style={{ flex: '0 0 auto', fontSize: 12 }}>{f.status}</span>
              </button>
            ))}
          </div>
        );
      })}
      <span className="t3" style={{ fontSize: 12, lineHeight: 1.5 }}>AI reviewers such as Copilot are a first pass. Two AIs share blind spots, so an AI review never counts as the independent check: a person still decides.</span>
    </>
  );
}

function Tickets({ r }: { r: Report }) {
  const s = useApp();
  const st = useSettings();
  const [input, setInput] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontWeight: 600 }}>Tickets in this report</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {r.tickets.map((t) => <Pill key={t.id}>{ticketLabel(t)} · {t.foundIn.join(', ')}</Pill>)}
          {s.manualTickets.map((t) => <Pill key={t} color="var(--accent)">{t} · added by you (rebuild to use)</Pill>)}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <label className="sr" htmlFor="tk">Add a ticket number</label>
          <input id="tk" className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="AB#1234 or PLAT-123" style={{ padding: '5px 8px', width: 220 }} />
          <button className="push" disabled={!input.trim()} onClick={() => { s.set({ manualTickets: [...new Set([...s.manualTickets, input.trim()])] }); setInput(''); }}>Add</button>
        </div>
        <span className="t3" style={{ fontSize: 12 }}>Numbers are found in PR titles, branches, descriptions and commits. Connect Azure DevOps or Jira in Settings › Boards to see titles and acceptance criteria.</span>
      </div>
      <LinkTickets r={r} />
      {r.tickets.map((t) => (
        <div className="card" key={t.id} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 4, background: t.system === 'ado' ? '#0a6fe0' : '#2684ff', color: '#fff', fontSize: 9, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{t.system === 'ado' ? 'DO' : 'J'}</span>
            {ticketHref(t, st) ? <button onClick={() => open(ticketHref(t, st)!)} title={ticketHref(t, st)} style={{ background: 'none', border: 0, padding: 0, color: 'var(--accent)', cursor: 'pointer', fontWeight: 700, font: 'inherit' }}>{ticketLabel(t)} ↗</button> : <b>{ticketLabel(t)}</b>}{t.title && <span>{t.title}</span>}{t.state && <Pill>{t.state}</Pill>}
            <span style={{ flex: 1 }} />
            {ticketHref(t, st) && <button className="push" style={{ fontSize: 12 }} onClick={() => open(ticketHref(t, st)!)}>Open ↗</button>}
          </span>
          <span className="t2" style={{ fontSize: 12.5 }}>Found in {t.foundIn.join(', ')} · {t.prIds.map((p) => prLabel(r, p)).join(', ')}</span>
          {(t.criteria ?? []).map((c, i) => <span key={i} style={{ fontSize: 12.5 }}>• {c}</span>)}
          {r.ticketErrors?.[t.id] && <span style={{ fontSize: 12.5, color: 'var(--warn)' }}>Details not loaded: {r.ticketErrors[t.id]}</span>}
        </div>
      ))}
    </div>
  );
}

/** Live PR status for the report's PRs (refetched on window focus and with Refresh). */
export const usePrStatus = (r: Report) =>
  useQuery({ queryKey: ['prStatus', r.id], queryFn: () => call('prs:status', { refs: r.prIds.map(refOf) }), staleTime: 60_000, refetchOnWindowFocus: true }).data;


export function StatusPills({ st }: { st?: PrStatus }) {
  if (!st) return null;
  const review = st.state === 'merged' || st.state === 'closed' ? null
    : st.review === 'approved' ? ['✓ Approved' + (st.approvals > 1 ? ` (${st.approvals})` : ''), 'var(--al)']
    : st.review === 'changes' ? ['Changes requested', 'var(--gap)']
    : st.review === 'required' ? [`Review needed${st.approvals ? ` · ${st.approvals} approval${st.approvals === 1 ? '' : 's'}` : ''}`, 'var(--warn)']
    : st.approvals ? [`✓ ${st.approvals} approval${st.approvals === 1 ? '' : 's'}`, 'var(--al)'] : null;
  const checks = st.state === 'merged' || st.state === 'closed' || st.checks === 'none' ? null
    : st.checks === 'passing' ? ['Checks passing', 'var(--al)'] : st.checks === 'failing' ? ['Checks failing', 'var(--gap)'] : ['Checks running', 'var(--warn)'];
  return (
    <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }} aria-label="Pull request status">
      <StateBadge state={st.state} />
      {review && <Pill color={review[1]} title="Review decision on GitHub">{review[0]}</Pill>}
      {checks && <Pill color={checks[1]} title="Status of checks on the latest commit">{checks[0]}</Pill>}
      {st.conflicts && <Pill color="var(--gap)" bold title="This branch has conflicts that must be resolved">Conflicts</Pill>}
    </span>
  );
}
