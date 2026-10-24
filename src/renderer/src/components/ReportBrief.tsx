// The Report tab: the answer first (verdict, what to review next, progress), one card per PR with its
// review action, the findings with a detail panel, a checklist per PR that ends with the review, and the
// links between PRs when you want them. Everything comes from rules and GitHub; AI text is marked.
import { useState } from 'react';
import type { Report } from '@shared/model';
import { SEV_ORDER, countsFor, issuesOf, prLabel, reviewNext } from '@analysis/review';
import { useApp } from '../store';
import { explainReport, reviewReportPrs } from '../actions';
import { AiBadge, Spinner } from './ui';
import { Glossary, StatusPills, TicketLink, usePrStatus } from './Report';
import { FindingsPanel, SEV_STYLE, doneKey, showFinding } from './FindingsPanel';
import { PrChecklist } from './PrChecklist';

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function ReportBrief({ r }: { r: Report }) {
  const s = useApp();
  const [linksOpen, setLinksOpen] = useState(false);
  const [terms, setTerms] = useState(false);
  const status = usePrStatus(r);
  const issues = issuesOf(r, status);
  const isDone = (id: string) => !!s.checks[doneKey(id)];
  const open = issues.filter((i) => !isDone(i.id));
  const blockers = issues.filter((i) => i.sev === 'Blocking');
  const blockersLeft = open.filter((i) => i.sev === 'Blocking');
  const done = issues.length - open.length;
  const ai = r.ai;
  const t = r.tickets[0];

  const head = blockersLeft.length ? `Not ready to merge: ${blockersLeft.length} ${blockersLeft.length === 1 ? 'blocker' : 'blockers'}` : open.length ? 'No blockers left' : 'Nothing open';
  const tone = blockersLeft.length ? 'var(--gap)' : 'var(--al)';
  const lede = ai?.tldr ?? `${r.cards.map((c) => `${prLabel(r, c.prId)} ${c.head.charAt(0).toLowerCase()}${c.head.slice(1)}`).join('; ')}.`;
  const next = blockersLeft[0] ?? open[0];
  const cta = blockersLeft[0] ? `Start with blocker ${blockers.indexOf(blockersLeft[0]) + 1} →` : open.length ? 'Continue with the next issue →' : 'Review PRs →';
  const onCta = () => {
    if (next) showFinding(next.id);
    else reviewReportPrs();
  };
  const hot = r.links.filter((l) => l.tone === 'bad' || l.tone === 'check').length;

  return (
    <div className="brief">
      {/* The answer first */}
      <section aria-labelledby="rv-head" className="card brief-verdict" style={{ borderColor: `color-mix(in srgb, ${tone} 38%, var(--cardb))` }}>
        <div className="brief-verdict-row">
          <div style={{ flex: '1 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 id="rv-head" className="brief-h1" style={{ color: tone }}>{head}</h2>
            <p className="brief-lede">{lede}{ai?.tldr && <span style={{ marginLeft: 6 }}><AiBadge /></span>}</p>
            {t && (
              <span style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="t3">Ticket</span>
                {r.tickets.map((tk) => <TicketLink key={tk.id} t={tk} />)}
                {(ai?.ask ?? t.title) && <span className="t2">{ai?.ask ?? t.title}</span>}
              </span>
            )}
            {r.order.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <b style={{ fontWeight: 650 }}>Review next</b>
                <ol style={{ margin: 0, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {reviewNext(r).map((n, k) => <li key={k}><b style={{ fontWeight: 600 }}>{n.what}.</b> <span className="t2">{n.why}</span></li>)}
                </ol>
              </div>
            )}
          </div>
          <div style={{ flex: '0 1 270px', display: 'flex', flexDirection: 'column', gap: 9, justifyContent: 'center' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><b style={{ fontWeight: 600 }}>Your review</b><span className="t3">{done} of {issues.length} done</span></span>
            <div role="progressbar" aria-label="Review progress" aria-valuemin={0} aria-valuemax={issues.length} aria-valuenow={done} style={{ height: 8, borderRadius: 4, background: 'var(--field)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${issues.length ? Math.round((done / issues.length) * 100) : 100}%`, background: open.length ? 'var(--accent)' : 'var(--al)', borderRadius: 4, transition: 'width .3s' }} />
            </div>
            <button className="prominent" onClick={onCta} style={{ padding: '8px 14px' }}>{cta}</button>
            {!ai && <ExplainInline />}
          </div>
        </div>
      </section>

      {r.aiError && <div className="card" style={{ padding: '9px 13px', color: 'var(--warn)' }}>AI notes were skipped: {r.aiError} Everything below works without them.</div>}
      {ai?.summary && (
        <div className="brief-ai">
          <AiBadge title="Written by AI. Check it before relying on it." />
          <span style={{ flex: 1, lineHeight: 1.55, color: 'var(--text2)' }}>{ai.summary} <span className="t3">· {ai.provider}</span></span>
        </div>
      )}

      {/* One card per PR, with its review action */}
      <section aria-labelledby="sec-prs" className="brief-sec">
        <h2 id="sec-prs" className="brief-h2">Pull requests</h2>
        <div className="rv-prgrid">
          {r.cards.map((c) => {
            const counts = countsFor(issues, c.prId, isDone);
            const on = s.chkPr === c.prId;
            const any = SEV_ORDER.some((sev) => counts[sev] > 0);
            const aiPr = ai?.prs?.[c.prId];
            return (
              <article key={c.prId} className="card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 6, borderColor: on ? 'var(--accent)' : undefined }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <button className="mono brief-link" onClick={() => s.set({ current: c.prId, section: 'prs' })} title={`Open ${prLabel(r, c.prId)}`} style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{prLabel(r, c.prId)}</button>
                  <span className="t2">· {c.role}</span>
                </div>
                <span className="t2">{aiPr?.head ?? c.head}{aiPr && <span style={{ marginLeft: 6 }}><AiBadge /></span>}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                  {SEV_ORDER.filter((sev) => counts[sev] > 0).map((sev) => (
                    <span key={sev} className="rv-sev" style={{ color: SEV_STYLE[sev].c, background: SEV_STYLE[sev].bg }}>{counts[sev]} {sev.toUpperCase()}</span>
                  ))}
                  {!any && <span className="rv-sev" style={{ color: 'var(--al)', background: 'color-mix(in srgb, var(--al) 12%, var(--card))' }}>✓ NOTHING OPEN</span>}
                  <StatusPills st={status?.[c.prId]} />
                  <span style={{ flex: 1 }} />
                  <button className="prominent" onClick={() => { s.set({ chkPr: c.prId }); scrollTo('sec-chk'); }} aria-label={`Review ${prLabel(r, c.prId)}`}>Review</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Findings with everything in one place */}
      <section aria-labelledby="sec-find-h" id="sec-find" className="brief-sec" style={{ scrollMarginTop: 12 }}>
        <div className="brief-sec-head"><h2 id="sec-find-h" className="brief-h2">Findings</h2><span className="t3">{open.length} open · pick one to see the code, why it matters and what to do</span></div>
        <FindingsPanel r={r} issues={issues} />
      </section>

      {/* A checklist per PR that ends with the review */}
      <section aria-labelledby="sec-chk-h" id="sec-chk" className="brief-sec" style={{ scrollMarginTop: 12 }}>
        <div className="brief-sec-head">
          <h2 id="sec-chk-h" className="brief-h2">Review checklist</h2><span style={{ flex: 1 }} />
          <button className="push" onClick={() => s.set({ view: 'map' })}>Open the Map</button>
          <button className="push" onClick={() => s.set({ view: 'changes' })}>Open Changes</button>
        </div>
        <PrChecklist r={r} issues={issues} />
      </section>

      {/* Links between PRs, when you want them */}
      {r.links.length > 0 && (
        <section aria-labelledby="sec-links" className="card" style={{ overflow: 'hidden' }}>
          <div className="brief-band" style={{ flexWrap: 'wrap' }}>
            <h2 id="sec-links" className="brief-h2" style={{ fontSize: 16 }}>Links between PRs</h2>
            <span className="t3">{r.links.length} · {hot} need attention · also drawn in the File Map</span>
            <span style={{ flex: 1 }} />
            <button className="brief-link" onClick={() => setLinksOpen(!linksOpen)} aria-expanded={linksOpen}>{linksOpen ? 'Hide' : 'Show'}</button>
          </div>
          {linksOpen && r.links.map((l) => {
            const c = l.tone === 'bad' ? 'var(--gap)' : l.tone === 'check' ? 'var(--warn)' : 'var(--al)';
            return (
              <button key={l.id} className="brief-row brief-click" onClick={() => s.focusLink(l.id)}>
                <span className="badge" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{l.tone === 'bad' ? 'Ship together' : l.tone === 'check' ? 'Check' : 'Fine'}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <b style={{ fontWeight: 600 }}>{l.title}</b>
                  <span className="t2">{l.text}</span>
                  {ai?.links?.[l.id] && <span style={{ display: 'flex', gap: 6 }}><AiBadge /><span className="t2">{ai.links[l.id]}</span></span>}
                </span>
              </button>
            );
          })}
          <div className="brief-row"><button className="brief-link" onClick={() => setTerms(!terms)}>{terms ? 'Hide terms' : 'Terms explained'}</button></div>
          {terms && <div style={{ padding: '0 16px 14px' }}><Glossary r={r} /></div>}
        </section>
      )}
    </div>
  );
}

function ExplainInline() {
  const s = useApp();
  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <button className="push" disabled={s.explaining} onClick={() => void explainReport()} style={{ justifyContent: 'center', flex: 1 }}>{s.explaining ? 'Explaining…' : 'Explain with AI…'}</button>
      {s.explaining && <Spinner />}
      {s.explainError && <span style={{ color: 'var(--gap)', fontSize: 12.5 }}>{s.explainError}</span>}
    </span>
  );
}
