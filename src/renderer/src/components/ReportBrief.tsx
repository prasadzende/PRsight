// The Report tab: the answer first (verdict and progress), then What, Risk and How to review it.
// Design: one headline, red and amber only for risk, detail collapsed until asked for,
// visible progress towards a clear end state. The verdict comes from rules, never from AI.
import { useState } from 'react';
import type { Finding, Report } from '@shared/model';
import { useApp } from '../store';
import { explainReport, reviewReportPrs } from '../actions';
import { Markdown } from './Markdown';
import { AiBadge, Spinner } from './ui';
import { Findings, Glossary, PrStrip, TicketLink, prLabel, toPoints } from './Report';

type Item = { id: string; label: string; why: string; human?: boolean; blocker?: boolean; nodeId?: string };

export function ReportBrief({ r }: { r: Report }) {
  const s = useApp();
  const [fixMore, setFixMore] = useState(false);
  const [fineOpen, setFineOpen] = useState(false);
  const [allFindings, setAllFindings] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [terms, setTerms] = useState(false);

  const aiF: Finding[] = (r.ai?.findings ?? []).map((f, i) => ({ id: `AI-${i}`, sev: f.sev, src: 'AI', aiReviewer: false, ai: true, where: f.where, text: f.text, prId: r.prIds[0], status: 'Open' as const, nodeId: r.nodes.find((n) => n.paths.includes(f.path))?.id }));
  const open = [...r.findings, ...aiF].filter((f) => f.status === 'Open');
  const blockers = open.filter((f) => f.sev === 'High');
  const shouldFix = open.filter((f) => f.sev === 'Medium');
  const niceToHave = open.filter((f) => f.sev === 'Info');
  const hotLinks = r.links.filter((l) => l.tone === 'bad' || l.tone === 'check');
  const fineLinks = r.links.filter((l) => l.tone !== 'bad' && l.tone !== 'check');
  const shipTogether = r.order.find((o) => o.tone === 'bad');

  // Checklist: blockers first, then the report's checklist (in the AI's risk order when there is one).
  const order = r.ai?.checklistOrder?.length ? [...r.ai.checklistOrder, ...r.checklist.map((c) => c.id).filter((id) => !r.ai!.checklistOrder!.includes(id))] : r.checklist.map((c) => c.id);
  const items: Item[] = [
    ...blockers.map((f, i) => ({ id: `blk-${f.id}`, label: `Blocker ${i + 1}: ${f.text}`, why: f.where, blocker: true, nodeId: f.nodeId })),
    ...order.map((id) => r.checklist.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => ({ id: c.id, label: c.label, why: c.human ? 'Only a person can judge this' : '', human: c.human, nodeId: c.nodeId })),
  ];
  const done = items.filter((c) => s.checks[c.id]).length;
  const blockersLeft = blockers.filter((f) => !s.checks[`blk-${f.id}`]);
  const allDone = items.length > 0 && done === items.length;
  const toCheck = shouldFix.length + r.links.filter((l) => l.tone === 'check').length;

  const tick = (id: string) => s.set({ checks: { ...s.checks, [id]: !s.checks[id] } });
  const openFile = (nodeId?: string) => {
    if (!nodeId) return;
    s.focusNode(nodeId);
    s.set({ view: 'map' });
  };
  const next = blockersLeft[0];
  const cta = next ? `Start with blocker ${blockers.indexOf(next) + 1} →` : allDone ? 'Review PRs →' : 'Continue the checklist →';
  const onCta = () => {
    if (next) openFile(next.nodeId);
    else if (allDone) reviewReportPrs();
    else document.getElementById('sec-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const head = blockersLeft.length ? `Not ready to merge: ${blockersLeft.length} ${blockersLeft.length === 1 ? 'blocker' : 'blockers'}` : blockers.length ? 'No blockers left' : 'Nothing blocks merging';
  const sub = blockersLeft.length
    ? `Fix ${blockersLeft.slice(0, 2).map((f) => f.text.charAt(0).toLowerCase() + f.text.slice(1)).join(', and ')}.${shipTogether ? ` Merge ${shipTogether.what}.` : ''}`
    : toCheck ? `${toCheck} ${toCheck === 1 ? 'thing' : 'things'} to check, then approve on GitHub.` : 'Finish the checklist below, then approve on GitHub.';
  const tone = blockersLeft.length ? 'var(--gap)' : 'var(--al)';
  const ai = r.ai;
  const t = r.tickets[0];

  return (
    <div className="brief">
      {/* 1. The answer first */}
      <section aria-label="Verdict" className="card brief-verdict" style={{ borderColor: `color-mix(in srgb, ${tone} 38%, var(--cardb))` }}>
        <div className="brief-verdict-row">
          <div style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="eyebrow">Verdict · from rules and GitHub</span>
            <h2 className="brief-h1" style={{ color: tone }}>{head}</h2>
            <p className="brief-lede">{sub}</p>
          </div>
          <div style={{ flex: '0 0 270px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontWeight: 600 }}>Your review</b><span className="t3" style={{ fontSize: 12 }}>{done} of {items.length} checked</span></span>
            <div role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} style={{ height: 8, borderRadius: 4, background: 'var(--field)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${items.length ? Math.round((done / items.length) * 100) : 0}%`, background: allDone ? 'var(--al)' : 'var(--accent)', borderRadius: 4, transition: 'width .3s' }} />
            </div>
            <button className="prominent" onClick={onCta} style={{ padding: '8px 14px', justifyContent: 'center', display: 'inline-flex' }}>{cta}</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {blockers.length > 0 && <span className="badge" style={{ color: 'var(--gap)', background: 'color-mix(in srgb, var(--gap) 12%, transparent)' }}>{blockersLeft.length ? `${blockersLeft.length} ${blockersLeft.length === 1 ? 'blocker' : 'blockers'}` : '✓ Blockers done'}</span>}
          {toCheck > 0 && <span className="badge" style={{ color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>{toCheck} to check</span>}
          {shipTogether && <span className="badge">Merge {shipTogether.what}</span>}
          <span className="badge">{r.prs.length} PRs · {r.totals.files} files</span>
        </div>
      </section>

      <PrStrip r={r} />

      {r.aiError && <div className="card" style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--warn)' }}>AI notes were skipped: {r.aiError} Everything below works without them.</div>}

      {/* 2. What */}
      <section aria-labelledby="sec-what" className="brief-sec">
        <div className="brief-sec-head"><h2 id="sec-what" className="brief-h2">Changes</h2><span style={{ flex: 1 }} />
          {!ai && <ExplainInline />}
        </div>
        <div className="card brief-card">
          <ul className="start-points">{toPoints(ai?.tldr ?? r.summary.tldr).map((p, i) => <li key={i}>{p}</li>)}</ul>
          {t && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 760 }}>
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}><span className="t3" style={{ fontSize: 12 }}>The ask</span>{r.tickets.map((tk) => <TicketLink key={tk.id} t={tk} />)}</span>
              {(ai?.ask ?? t.title) && <span className="brief-prose">{ai?.ask ?? t.title}</span>}
              {r.ticketErrors?.[t.id] && <span style={{ fontSize: 12, color: 'var(--warn)' }}>Ticket details not loaded: {r.ticketErrors[t.id]}</span>}
              {(t.criteria ?? []).slice(0, 5).map((c, i) => (
                <span key={i} style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--text2)' }}><span aria-hidden="true" style={{ color: 'var(--al)', fontWeight: 700 }}>✓</span><Markdown text={c} /></span>
              ))}
            </div>
          )}
          <div className="brief-prs">
            {r.cards.map((c) => {
              const aiPr = ai?.prs?.[c.prId];
              return (
                <div key={c.prId} className="brief-pr">
                  <button className="mono brief-pr-name" onClick={() => s.set({ current: c.prId, section: 'prs' })} title={`Open ${prLabel(r, c.prId)}`}>{prLabel(r, c.prId)}</button>
                  <span style={{ lineHeight: 1.5 }}>
                    <b style={{ fontWeight: 600 }}>{aiPr?.head ?? c.head}.</b> <span className="t2">{aiPr?.text ?? c.text}</span>
                    {aiPr && <span style={{ marginLeft: 6 }}><AiBadge /></span>}
                    {c.fit.tone === 'check' && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--warn)', marginTop: 2 }}>{c.fit.why}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {ai?.summary && (aiOpen ? (
            <div className="brief-ai">
              <AiBadge title="Written by AI. Check it before relying on it." />
              <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.55, color: 'var(--text2)' }}>{ai.summary} <span className="t3" style={{ fontSize: 12 }}>· {ai.provider}</span></span>
              <button className="brief-link" onClick={() => setAiOpen(false)} aria-label="Hide AI note" style={{ color: 'var(--text3)' }}>Hide</button>
            </div>
          ) : <button className="brief-link" onClick={() => setAiOpen(true)} style={{ alignSelf: 'flex-start' }}>Show AI note</button>)}
          <button className="brief-link" onClick={() => setTerms(!terms)} style={{ alignSelf: 'flex-start' }}>{terms ? 'Hide terms' : 'Terms explained'}</button>
          {terms && <Glossary r={r} />}
        </div>
      </section>

      {/* 3. Risk */}
      <section aria-labelledby="sec-risk" className="brief-sec">
        <div className="brief-sec-head"><h2 id="sec-risk" className="brief-h2">Risks</h2></div>
        {blockers.length > 0 ? (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="brief-band" style={{ background: 'color-mix(in srgb, var(--gap) 9%, var(--card))' }}><b style={{ color: 'var(--gap)' }}>Blocking</b><span className="t3" style={{ fontSize: 12 }}>Fix before merging</span></div>
            {blockers.map((f) => (
              <div key={f.id} className="brief-row">
                <span className="brief-dot" style={{ background: 'var(--gap)' }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 600, textDecoration: s.checks[`blk-${f.id}`] ? 'line-through' : 'none' }}>{f.text}{f.ai && <span style={{ marginLeft: 6 }}><AiBadge /></span>}</span>
                  <span className="t3 mono" style={{ fontSize: 11.5 }}>{f.where} · {f.aiReviewer ? `AI reviewer · ${f.src}` : f.src}</span>
                </span>
                {f.nodeId && <button className="push" style={{ fontSize: 12 }} onClick={() => openFile(f.nodeId)}>Open file →</button>}
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ padding: '12px 16px', color: 'var(--al)', fontWeight: 600 }}>✓ Nothing blocks merging</div>
        )}
        {shouldFix.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="brief-band" style={{ background: 'color-mix(in srgb, var(--warn) 9%, var(--card))' }}><b style={{ color: 'var(--warn)' }}>Should fix</b><span className="t3" style={{ fontSize: 12 }}>Fix now or agree a follow-up · {shouldFix.length}</span></div>
            {(fixMore ? shouldFix : shouldFix.slice(0, 2)).map((f) => (
              <button key={f.id} className="brief-row brief-click" onClick={() => openFile(f.nodeId)}>
                <span className="brief-dot" style={{ background: 'var(--warn)' }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>{f.text}{f.ai && <span style={{ marginLeft: 6 }}><AiBadge /></span>}</span>
                  <span className="t3 mono" style={{ fontSize: 11.5 }}>{f.where} · {f.aiReviewer ? `AI reviewer · ${f.src}` : f.src}</span>
                </span>
              </button>
            ))}
            {shouldFix.length > 2 && <div className="brief-row"><button className="brief-link" onClick={() => setFixMore(!fixMore)}>{fixMore ? 'Show fewer' : `Show ${shouldFix.length - 2} more`}</button></div>}
          </div>
        )}
        {r.links.length > 0 && (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="brief-band"><b style={{ fontWeight: 600 }}>Links between PRs that need attention</b><span className="t3" style={{ fontSize: 12 }}>{hotLinks.length} of {r.links.length}</span></div>
            {hotLinks.map((l) => (
              <button key={l.id} className="brief-row brief-click" onClick={() => s.focusLink(l.id)}>
                <span className="badge" style={l.tone === 'bad' ? { color: 'var(--gap)', background: 'color-mix(in srgb, var(--gap) 12%, transparent)' } : { color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, transparent)' }}>{l.tone === 'bad' ? 'Fix' : 'Check'}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontWeight: 600 }}>{l.title}</b>
                  <span className="t2" style={{ fontSize: 13.5, maxWidth: 760 }}>{l.text}</span>
                  {ai?.links?.[l.id] && <span style={{ display: 'flex', gap: 6, fontSize: 13 }}><AiBadge /><span className="t2">{ai.links[l.id]}</span></span>}
                </span>
              </button>
            ))}
            {hotLinks.length === 0 && <div className="brief-row t2">None: every link between these PRs looks consistent.</div>}
            {fineOpen && fineLinks.map((l) => (
              <button key={l.id} className="brief-row brief-click" onClick={() => s.focusLink(l.id)}>
                <span className="badge" style={{ color: 'var(--al)', background: 'color-mix(in srgb, var(--al) 12%, transparent)' }}>Fine</span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><span>{l.title}</span><span className="t3" style={{ fontSize: 12.5 }}>{l.text}</span></span>
              </button>
            ))}
            {fineLinks.length > 0 && <div className="brief-row"><button className="brief-link" onClick={() => setFineOpen(!fineOpen)}>{fineOpen ? 'Hide the links that are fine' : `${fineLinks.length} more ${fineLinks.length === 1 ? 'link is' : 'links are'} fine · Show`}</button></div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="t3" style={{ fontSize: 12 }}>Also</span>
          {niceToHave.length > 0 && <span className="badge">{niceToHave.length} nice to have</span>}
          {r.verified.length > 0 && <span className="badge" style={{ color: 'var(--al)', background: 'color-mix(in srgb, var(--al) 12%, transparent)' }}>✓ {r.verified.length} verified</span>}
          <span className="badge">{r.teamRules.length} team rules checked, {r.teamRules.filter((x) => !x.passed).length} broken</span>
          <button className="brief-link" style={{ fontSize: 12.5 }} onClick={() => setAllFindings(!allFindings)}>{allFindings ? 'Hide all findings' : 'Show all findings'}</button>
        </div>
        {allFindings && <Findings r={r} />}
      </section>

      {/* 4. How to review it */}
      <section aria-labelledby="sec-review" id="sec-review" className="brief-sec" style={{ scrollMarginTop: 12 }}>
        <div className="brief-sec-head">
          <h2 className="brief-h2">Review</h2><span style={{ flex: 1 }} />
          <button className="push" style={{ fontSize: 12.5 }} onClick={() => s.set({ view: 'map' })}>Open the Map</button>
          <button className="push" style={{ fontSize: 12.5 }} onClick={() => s.set({ view: 'changes' })}>Open Changes</button>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="brief-band"><b style={{ fontWeight: 600 }}>Checklist</b><span className="t3" style={{ fontSize: 12 }}>{r.ai?.checklistOrder?.length ? 'Blockers first, then in the AI’s risk order' : 'Blockers first, then by risk from rules'}</span></div>
          {items.map((c) => {
            const d = !!s.checks[c.id];
            return (
              <label key={c.id} className="brief-row" style={{ cursor: 'pointer', background: c.blocker && !d ? 'color-mix(in srgb, var(--gap) 5%, transparent)' : undefined }}>
                <input type="checkbox" checked={d} onChange={() => tick(c.id)} style={{ margin: '3px 0 0', width: 16, height: 16, flex: '0 0 16px', accentColor: 'var(--accent)' }} />
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ textDecoration: d ? 'line-through' : 'none', color: d ? 'var(--text3)' : 'var(--text)' }}>{c.label}</span>
                  {c.why && <span className="t3" style={{ fontSize: 12 }}>{c.why}</span>}
                </span>
                {c.human && <span className="badge" style={{ color: 'var(--accent)' }} title="Only a person can judge this. No rule or AI decides it.">Person only</span>}
                {c.nodeId && <button className="brief-link" style={{ fontSize: 12 }} onClick={(e) => { e.preventDefault(); openFile(c.nodeId); }}>Diff</button>}
              </label>
            );
          })}
        </div>
        {allDone && (
          <div className="card" role="status" style={{ padding: '18px 22px', display: 'flex', gap: 16, alignItems: 'center', background: 'color-mix(in srgb, var(--al) 10%, var(--card))', borderColor: 'transparent' }}>
            <span aria-hidden="true" style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: '50%', background: 'var(--al)', color: '#fff', fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✓</span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 16 }}>You’ve checked everything</b><span className="t2">Approve on GitHub, or leave a comment for the author.</span></span>
            <button className="prominent" onClick={reviewReportPrs}>Review PRs →</button>
          </div>
        )}
      </section>
    </div>
  );
}

function ExplainInline() {
  const s = useApp();
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      {s.explaining && <Spinner />}
      {s.explainError && <span style={{ color: 'var(--gap)', fontSize: 12, maxWidth: 360 }}>{s.explainError}</span>}
      <button className="push" style={{ fontSize: 12 }} disabled={s.explaining} onClick={() => void explainReport()}>{s.explaining ? 'Explaining…' : 'Explain with AI…'}</button>
    </span>
  );
}
