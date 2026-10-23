import { useLayoutEffect, useRef, useState } from 'react';
import type { Report } from '@shared/model';
import { useApp } from '../store';
import { prLabel } from './Report';
import { SEV_COLOR, TONE_COLOR } from './ui';

const W = 260;
const H = 166;
const DOC_H = 108;
const GAP = 110;
const TOP = 40;
const ROW_GAP = 62;

export function StoryView({ r }: { r: Report }) {
  const s = useApp();
  const [hov, setHov] = useState<string | null>(null);
  const T = s.tour ? r.tour[s.tour - 1] : null;
  const main = r.story.boxes.filter((b) => b.row === 0);
  const docs = r.story.boxes.filter((b) => b.row === 1);
  // Boxes grow to fit their text. Each row is a grid so its boxes share the tallest height;
  // the measured row heights place the second row and the arrows.
  const row0 = useRef<HTMLDivElement>(null);
  const row1 = useRef<HTMLDivElement>(null);
  const [rowH, setRowH] = useState<[number, number]>([H, DOC_H]);
  useLayoutEffect(() => {
    const measure = () =>
      setRowH((cur) => {
        const next: [number, number] = [row0.current?.offsetHeight || H, row1.current?.offsetHeight || DOC_H];
        return next[0] === cur[0] && next[1] === cur[1] ? cur : next;
      });
    measure();
    const ro = new ResizeObserver(measure);
    if (row0.current) ro.observe(row0.current);
    if (row1.current) ro.observe(row1.current);
    return () => ro.disconnect();
  }, [r]);
  const docTop = TOP + rowH[0] + ROW_GAP;
  const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
  main.forEach((b, i) => pos.set(b.prId, { x: 20 + i * (W + GAP), y: TOP, w: W, h: rowH[0] }));
  docs.forEach((b, i) => pos.set(b.prId, { x: 20 + i * (W + GAP), y: docTop, w: W, h: rowH[1] }));
  const width = Math.max(main.length, docs.length, 1) * (W + GAP) - GAP + 40;
  const height = docs.length ? docTop + rowH[1] + 20 : TOP + rowH[0] + 40;

  const openF = r.findings.filter((f) => f.status === 'Open');
  const worst = (list: typeof openF) =>
    list.some((f) => f.sev === 'High') ? 'High' : list.some((f) => f.sev === 'Medium') ? 'Medium' : list.length ? 'Info' : null;

  const arrows = r.story.arrows
    .map((a) => {
      const A = pos.get(a.from)!;
      const B = pos.get(a.to)!;
      if (!A || !B) return null;
      const lit = hov ? a.from === hov || a.to === hov : !T || T.arrows.includes(a.id);
      const tone = (T || hov) && lit ? 'acc' : a.tone;
      let d: string;
      let lx: number;
      let ly: number;
      if (A.y === B.y) {
        const forward = B.x > A.x;
        const x1 = forward ? A.x + A.w + 2 : A.x - 2;
        const x2 = forward ? B.x - 4 : B.x + B.w + 4;
        const y = A.y + Math.min(83, A.h / 2);
        const adjacent = Math.abs(B.x - A.x) === W + GAP;
        d = adjacent
          ? `M${x1} ${y} L${x2} ${y}`
          : `M${A.x + A.w / 2} ${A.y - 2} C${A.x + A.w / 2} ${A.y - 34} ${B.x + B.w / 2} ${B.y - 34} ${B.x + B.w / 2} ${B.y - 4}`;
        lx = adjacent ? (x1 + x2) / 2 : (A.x + B.x + W) / 2;
        ly = adjacent ? y - 58 : A.y - 36;
      } else {
        const x = A.x + A.w / 2;
        const tx = B.x + B.w / 2;
        d = `M${x} ${A.y - 2} L${tx} ${B.y + B.h + 4}`;
        lx = (x + tx) / 2 + 92;
        ly = (A.y + B.y + B.h) / 2 - 14;
      }
      return { a, d, lx, ly, lit, tone };
    })
    .filter(Boolean) as Array<{ a: Report['story']['arrows'][number]; d: string; lx: number; ly: number; lit: boolean; tone: string }>;

  return (
    <>
      <div className="card" style={{ overflow: 'auto', background: 'var(--list)', ...(s.mapFull ? { height: 'calc(100vh - 210px)', minHeight: 360 } : {}) }}>
        <div style={{ position: 'relative', width, height }}>
          <svg width={width} height={height} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            <defs>
              {(['bad', 'check', 'n', 'acc'] as const).map((t) => (
                <marker key={t} id={`sm-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M0 0L10 5L0 10z" style={{ fill: TONE_COLOR[t] }} />
                </marker>
              ))}
            </defs>
            {arrows.map(({ a, d, lit, tone }) => (
              <path
                key={a.id}
                d={d}
                style={{
                  fill: 'none',
                  stroke: TONE_COLOR[tone],
                  strokeWidth: 2.4,
                  opacity: lit ? 1 : 0.2,
                  strokeDasharray: a.tone === 'check' && tone !== 'acc' ? '7 4' : undefined,
                }}
                markerEnd={`url(#sm-${tone})`}
              />
            ))}
          </svg>
          {(
            [
              [main, row0, TOP],
              [docs, row1, docTop],
            ] as const
          ).map(([boxes, ref, top], ri) =>
            boxes.length ? (
              <div
                key={ri}
                ref={ref}
                style={{
                  position: 'absolute',
                  left: 20,
                  top,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${boxes.length}, ${W}px)`,
                  columnGap: GAP,
                  alignItems: 'stretch',
                }}
              >
                {boxes.map((b) => {
                  const fl = openF.filter((f) => f.prId === b.prId);
                  const w = worst(fl);
                  const near = hov
                    ? hov === b.prId || r.story.arrows.some((a) => (a.from === hov && a.to === b.prId) || (a.to === hov && a.from === b.prId))
                    : true;
                  const lit = hov ? near : !T || T.boxes.includes(b.prId);
                  return (
                    <button
                      key={b.prId}
                      className={hov === b.prId ? 'sbox sbox-hot' : 'sbox'}
                      onMouseEnter={() => setHov(b.prId)}
                      onMouseLeave={() => setHov(null)}
                      onFocus={() => setHov(b.prId)}
                      onBlur={() => setHov(null)}
                      onClick={() => s.set({ mapView: 'files', filePr: b.prId, expanded: [b.prId], node: null, link: null, tour: 0 })}
                      aria-label={`Step ${b.step}: ${b.head}. Show its files`}
                      style={{
                        position: 'relative',
                        left: 0,
                        top: 0,
                        width: W,
                        minHeight: b.row ? DOC_H : H,
                        border:
                          T && !hov && lit
                            ? '2px solid var(--accent)'
                            : w === 'High'
                              ? '1.5px solid color-mix(in srgb, var(--gap) 60%, transparent)'
                              : '1px solid var(--nodeb)',
                        opacity: lit ? 1 : hov ? 0.45 : 0.3,
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            flexShrink: 0,
                            width: 20,
                            height: 20,
                            borderRadius: '50%',
                            background: 'var(--field)',
                            color: 'var(--text2)',
                            fontSize: 11,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {b.step}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{b.head}</span>
                        <span style={{ flex: 1 }} />
                        {w && (
                          <span
                            title={`${fl.length} open findings`}
                            style={{
                              flexShrink: 0,
                              padding: '1px 7px',
                              borderRadius: 9,
                              background: SEV_COLOR[w],
                              color: '#fff',
                              fontSize: 10.5,
                              fontWeight: 700,
                            }}
                          >
                            {fl.length} finding{fl.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.45, marginTop: 7, overflowWrap: 'anywhere' }}>{b.text}</span>
                      <span className="mono" style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginTop: 'auto', paddingTop: 8 }}>
                        {prLabel(r, b.prId)} · {r.cards.find((c) => c.prId === b.prId)?.files ?? 0} files · {b.role}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null,
          )}
          {arrows.map(({ a, lx, ly, lit }) => (
            <button
              key={`l-${a.id}`}
              onClick={() => s.focusLink(a.linkId)}
              aria-label={`${a.label}: show link details`}
              style={{
                position: 'absolute',
                left: lx,
                top: ly,
                width: 100,
                transform: 'translateX(-50%)',
                background: 'transparent',
                border: 0,
                padding: 0,
                cursor: 'pointer',
                textAlign: 'center',
                opacity: lit ? 1 : 0.25,
                color: 'var(--text)',
              }}
            >
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{a.label}</span>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)', lineHeight: 1.3, marginTop: 1 }}>{a.sub}</span>
              {a.flag && (
                <span
                  style={{
                    display: 'inline-block',
                    marginTop: 30,
                    padding: '2px 8px',
                    borderRadius: 9,
                    fontSize: 11,
                    fontWeight: 600,
                    color: TONE_COLOR[a.tone],
                    background: `color-mix(in srgb, ${TONE_COLOR[a.tone]} 14%, transparent)`,
                  }}
                >
                  {a.flag}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <span className="t3" style={{ fontSize: 12 }}>
        Click a box to see its files. Click a label on an arrow to see that link. Red means fix before merging; amber means check it.
      </span>
    </>
  );
}
