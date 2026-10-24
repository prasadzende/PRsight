// The review checklist for one PR: its open issues (so "all done" really means done), the questions only
// a person can answer, what was verified, and the review action at the end, pre-filled from what is still open.
import type { Report } from '@shared/model';
import { humanFor, issuesFor, mergeRule, prLabel, reviewBody, verifiedFor, type Issue } from '@analysis/review';
import { useApp } from '../store';
import { SevBadge, doneKey, showFinding } from './FindingsPanel';
import { Seg } from './ui';
import { usePrStatus } from './Report';

export function PrChecklist({ r, issues }: { r: Report; issues: Issue[] }) {
  const s = useApp();
  const prId = s.chkPr && r.prIds.includes(s.chkPr) ? s.chkPr : r.prIds[0];
  const mine = issuesFor(issues, prId);
  const human = humanFor(r, prId);
  const verified = verifiedFor(r, prId);
  const hKey = (id: string) => `h:${prId}:${id}`;
  const openItems = mine.filter((i) => !s.checks[doneKey(i.id)]);
  const humanLeft = human.filter((h) => !s.checks[hKey(h.id)]);
  const total = mine.length + human.length + verified.length;
  const left = openItems.length + humanLeft.length;
  const blocking = openItems.filter((i) => i.sev === 'Blocking').length;
  const name = prLabel(r, prId);
  const live = usePrStatus(r)?.[prId]?.state ?? r.prs.find((p) => `${p.owner}/${p.repo}#${p.number}` === prId)?.state;
  const shut = live === 'merged' || live === 'closed';
  const tick = (key: string) => s.set({ checks: { ...s.checks, [key]: !s.checks[key] } });
  const review = (kind: 'REQUEST_CHANGES' | 'APPROVE' | 'COMMENT') =>
    s.set({ section: 'prs', current: prId, reviewOpen: true, reviewDraft: { prId, kind, body: kind === 'APPROVE' ? '' : reviewBody(r, prId, openItems), n: Date.now() } });

  return (
    <>
      <Seg value={prId} onChange={(v) => s.set({ chkPr: v })} label="Pull request to review" options={r.prIds.map((id) => [id, prLabel(r, id)] as [string, string])} />
      <div className="card" role="region" aria-label={`Review checklist for ${name}`} style={{ overflow: 'hidden' }}>
        <div style={{ padding: '13px 16px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <b style={{ fontSize: 15 }}>Review checklist · {name}</b>
          <span className="t3">{total - left} of {total} done</span>
        </div>
        <div style={{ margin: '0 16px 8px', padding: '11px 14px', borderRadius: 10, background: 'color-mix(in srgb, var(--warn) 10%, var(--card))', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: '0 0 18px', marginTop: 2, fill: 'none', stroke: 'var(--warn)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M12 3l10 18H2z" /><path d="M12 10v5" /><path d="M12 18h.01" /></svg>
          <span><b>Merge rule</b> <span className="t2">(the same as Review next):</span> {mergeRule(r)}</span>
        </div>
        {mine.map((i) => {
          const d = !!s.checks[doneKey(i.id)];
          return (
            <div key={i.id} className="rv-chk">
              <label style={{ flex: 1, minWidth: 0, display: 'flex', gap: 12, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={d} onChange={() => tick(doneKey(i.id))} style={{ margin: 0, width: 18, height: 18, flex: '0 0 18px', accentColor: 'var(--accent)' }} />
                <SevBadge sev={i.sev} />
                <span style={{ flex: 1, textDecoration: d ? 'line-through' : 'none', color: d ? 'var(--text3)' : 'var(--text)' }}>{i.title}</span>
              </label>
              <button className="brief-link" onClick={() => showFinding(i.id)} aria-label={`Show details: ${i.title}`}>Details</button>
            </div>
          );
        })}
        {human.map((h) => {
          const d = !!s.checks[hKey(h.id)];
          return (
            <label key={h.id} className="rv-chk" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={d} onChange={() => tick(hKey(h.id))} style={{ margin: 0, width: 18, height: 18, flex: '0 0 18px', accentColor: 'var(--accent)' }} />
              <span className="badge" style={{ color: 'var(--accent)' }} title="Only a person can judge this. No rule or AI decides it.">PERSON ONLY</span>
              <span style={{ flex: 1, textDecoration: d ? 'line-through' : 'none', color: d ? 'var(--text3)' : 'var(--text)' }}>{h.label}</span>
            </label>
          );
        })}
        {verified.map((v, k) => (
          <div key={k} className="rv-chk" style={{ color: 'var(--text3)' }}>
            <input type="checkbox" checked readOnly disabled aria-label={`Verified: ${v}`} style={{ margin: 0, width: 18, height: 18, flex: '0 0 18px', accentColor: 'var(--accent)' }} />
            <span className="badge" style={{ color: 'var(--al)', background: 'color-mix(in srgb, var(--al) 12%, transparent)' }}>VERIFIED</span>
            <span style={{ flex: 1 }}>{v} ✓</span>
          </div>
        ))}
        <div style={{ margin: '10px 16px 16px', padding: '12px 14px', border: '.5px solid var(--cardb)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1, minWidth: 200 }}>
            <b>{left ? `${left} open ${left === 1 ? 'item' : 'items'} left` : 'Everything is checked'}</b>{' '}
            <span className="t3">{left ? (blocking ? `· ${blocking} blocking` : openItems.length ? '· none blocking' : '· questions only you can answer') : '· nothing open on this PR'}</span>
          </span>
          {shut ? (
            <button className="push" onClick={() => review('COMMENT')} title={`${name} is ${live}: you can still comment`}>Comment on {name}</button>
          ) : openItems.length ? (
            <button className="rv-danger" onClick={() => review('REQUEST_CHANGES')} title="Opens the review with the open items listed">Request changes on {name}</button>
          ) : (
            <button className="prominent" onClick={() => review('APPROVE')}>Approve {name}</button>
          )}
        </div>
      </div>
    </>
  );
}
