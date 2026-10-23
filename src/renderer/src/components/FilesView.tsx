import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, MarkerType, Position, type Edge as RFEdge, type Node as RFNode, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FileNode, Report } from '@shared/model';
import { FILE_TYPES, fileTypeOf } from '@analysis/classify';
import { useApp } from '../store';
import { prLabel } from './Report';
import { MenuItem, PopupMenu, SEV_COLOR, TONE_COLOR } from './ui';

const COL_W = 240;
const COL_GAP = 100;
const NODE_H = 66;
const NODE_GAP = 18;
const TOP = 44;

type FileData = { n: FileNode; sub: string; subColor: string; border: string; dim: boolean; fCount: number; fColor: string; fTitle: string; isNew: boolean; path: string };
type ColData = { label: string; h: number; dim: boolean };
type ChipData = { label: string; onClick: () => void };

function FileBox({ data }: NodeProps<RFNode<FileData>>) {
  const { n } = data;
  return (
    <div className="node" style={{ position: 'relative', width: COL_W - 32, height: NODE_H, border: data.border, opacity: data.dim ? 0.3 : 1 }} aria-label={`${n.name}, ${n.path}`}>
      <Handle type="target" position={Position.Left} id="l" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="r" style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Top} id="t" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Top} id="ts" style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Left} id="ls" style={{ opacity: 0 }} />
      <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 28 }}>{n.name}</span>
      <span style={{ display: 'block', fontSize: 11.5, color: data.subColor, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.sub}</span>
      <span className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--text3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 12 }}>{data.path}</span>
      {data.fCount > 0 && <span title={data.fTitle} style={{ position: 'absolute', right: 7, top: 7, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: data.fColor, color: '#fff', fontSize: 10.5, fontWeight: 700, lineHeight: '18px', textAlign: 'center' }}>{data.fCount}</span>}
      {data.isNew && <span title="Changed since your last review" style={{ position: 'absolute', right: 8, bottom: 8, width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />}
    </div>
  );
}

function ColBox({ data }: NodeProps<RFNode<ColData>>) {
  return (
    <div style={{ width: COL_W, height: data.h, background: 'var(--colbg)', borderRadius: 10, opacity: data.dim ? 0.5 : 1, pointerEvents: 'none' }}>
      <div style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{data.label}</div>
    </div>
  );
}

function Chip({ data }: NodeProps<RFNode<ChipData>>) {
  return (
    <button onClick={data.onClick} style={{ width: COL_W - 32, height: 30, border: '1px dashed var(--cardb)', borderRadius: 8, background: 'transparent', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', padding: '0 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
      {data.label}
    </button>
  );
}

const nodeTypes = { file: FileBox, col: ColBox, chip: Chip };
const OVERLAYS: Array<[string, string]> = [['none', 'None'], ['tests', 'Tests'], ['kind', 'Change Type'], ['since', 'Since Last Review'], ['risk', 'Risk'], ['fit', 'Ticket Fit']];
const RISKC: Record<string, string> = { High: 'var(--gap)', Medium: 'var(--warn)', Low: 'var(--text3)', Unknown: 'var(--text3)' };

export function FilesView({ r }: { r: Report }) {
  const s = useApp();
  const ov = s.overlay;

  const ftCount = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of r.nodes) for (const p of n.paths) c.set(fileTypeOf(p), (c.get(fileTypeOf(p)) ?? 0) + 1);
    return c;
  }, [r]);
  const ftAct = s.ftSel;
  const matching = (n: FileNode) => n.paths.filter((p) => ftAct.includes(fileTypeOf(p)));

  const { nodes, edges } = useMemo(() => {
    const order = r.story.boxes.map((b) => b.prId);
    const linkNodes = new Set(s.link ? r.links.find((l) => l.id === s.link)?.nodes ?? [] : []);
    const shown = (n: FileNode) =>
      ftAct.length ? matching(n).length > 0 : s.allFiles || n.key || (ov === 'fit' && !!r.overlays[n.id]?.fit) || s.expanded.includes(n.prId) || s.node === n.id || linkNodes.has(n.id);
    const fid = s.hover ?? s.node;
    let focus: Set<string> | null = null;
    if (s.link) focus = linkNodes;
    else if (fid) {
      focus = new Set([fid]);
      for (const e of r.edges) {
        if (e.from === fid) focus.add(e.to);
        if (e.to === fid) focus.add(e.from);
      }
    } else if (s.filePr) focus = new Set(r.nodes.filter((n) => n.prId === s.filePr).map((n) => n.id));

    const out: RFNode[] = [];
    const pos = new Map<string, { x: number; y: number; col: number }>();
    let maxH = 0;
    const colNodes: RFNode[] = [];
    order.forEach((pr, ci) => {
      const x0 = ci * (COL_W + COL_GAP);
      let y = TOP;
      const hidden: FileNode[] = [];
      for (const n of r.nodes.filter((x) => x.prId === pr)) {
        if (!shown(n)) {
          hidden.push(n);
          continue;
        }
        pos.set(n.id, { x: x0 + 16, y, col: ci });
        const o = r.overlays[n.id];
        const fl = r.findings.filter((f) => f.nodeId === n.id && f.status === 'Open');
        const worst = fl.some((f) => f.sev === 'High') ? 'High' : fl.some((f) => f.sev === 'Medium') ? 'Medium' : 'Info';
        const sub = ov === 'tests' ? o.tests : ov === 'kind' ? o.kind : ov === 'since' ? (o.since == null ? 'First review' : o.since ? 'Changed since your last review' : 'No change since your last review') : ov === 'risk' ? `${o.risk.level} risk · ${o.risk.why}` : ov === 'fit' ? o.fit ?? 'In ticket scope' : n.sub;
        const subColor = ov === 'risk' ? RISKC[o.risk.level] : (ov === 'fit' && o.fit) || (ov === 'tests' && o.noTest) ? 'var(--warn)' : 'var(--text2)';
        const sel = s.node === n.id;
        const border = sel ? '2px solid var(--accent)' : ov === 'risk' && o.risk.level === 'High' ? '1.5px solid var(--gap)' : (ov === 'risk' && o.risk.level === 'Medium') || (ov === 'fit' && o.fit) || (ov === 'tests' && o.noTest) ? '1.5px solid var(--warn)' : '1px solid var(--nodeb)';
        const path = ftAct.length ? (() => { const m = matching(n); return (m.length < n.paths.length ? `${m.length} of ${n.paths.length}: ` : '') + m.map((p) => p.split('/').pop()).join(', '); })() : n.path;
        out.push({
          id: n.id, type: 'file', position: { x: x0 + 16, y }, draggable: false, selectable: false, zIndex: 2,
          data: { n, sub, subColor, border, dim: (focus ? !focus.has(n.id) : false) || (ov === 'since' && o.since === false), fCount: fl.length, fColor: SEV_COLOR[worst], fTitle: `${fl.length} open findings`, isNew: ov === 'since' && !!o.since, path } satisfies FileData,
        });
        y += NODE_H + NODE_GAP;
      }
      const canFold = !ftAct.length && !s.allFiles && s.expanded.includes(pr);
      if (ftAct.length && y === TOP) {
        out.push({ id: `chip-${pr}`, type: 'chip', position: { x: x0 + 16, y }, draggable: false, selectable: false, zIndex: 2, data: { label: 'No matching files in this PR', onClick: () => undefined } satisfies ChipData });
        y += 46;
      } else if (!ftAct.length && hidden.length) {
        out.push({ id: `chip-${pr}`, type: 'chip', position: { x: x0 + 16, y }, draggable: false, selectable: false, zIndex: 2, data: { label: `+${hidden.length} more: ${hidden.map((h) => h.name).join(', ')}`, onClick: () => s.set({ expanded: [...s.expanded, pr] }) } satisfies ChipData });
        y += 46;
      } else if (canFold) {
        out.push({ id: `chip-${pr}`, type: 'chip', position: { x: x0 + 16, y }, draggable: false, selectable: false, zIndex: 2, data: { label: 'Show fewer files', onClick: () => s.set({ expanded: s.expanded.filter((e) => e !== pr), filePr: s.filePr === pr ? null : s.filePr }) } satisfies ChipData });
        y += 46;
      }
      maxH = Math.max(maxH, y + 8);
      colNodes.push({ id: `col-${pr}`, type: 'col', position: { x: x0, y: 0 }, draggable: false, selectable: false, zIndex: 0, data: { label: prLabel(r, pr), h: 0, dim: !!s.filePr && s.filePr !== pr && !s.link && !fid } satisfies ColData });
    });
    for (const c of colNodes) (c.data as ColData).h = maxH;

    const es: RFEdge[] = [];
    const labelled = new Set<string>();
    for (const e of r.edges) {
      const A = pos.get(e.from);
      const B = pos.get(e.to);
      if (!A || !B) continue;
      if (e.kind === 'int' && !s.showInt && !(fid && (e.from === fid || e.to === fid))) continue;
      const l = e.linkId ? r.links.find((x) => x.id === e.linkId) : undefined;
      const selected = !!s.link && e.linkId === s.link;
      const tone = e.kind === 'int' ? 'int' : selected ? 'acc' : l?.tone ?? 'n';
      const color = tone === 'int' ? 'var(--int)' : TONE_COLOR[tone];
      const hot = !focus || (s.link ? selected : e.from === fid || e.to === fid || (!fid && focus.has(e.from) && focus.has(e.to)));
      const sameCol = A.col === B.col;
      const far = Math.abs(A.col - B.col) > 1;
      const [srcH, tgtH] = sameCol ? ['ls', 'l'] : far ? ['ts', 't'] : A.col < B.col ? ['r', 'l'] : ['ls', 'r'];
      const showLabel = !!l && !labelled.has(l.id) && !sameCol;
      if (l) labelled.add(l.id);
      es.push({
        id: e.id, source: e.from, target: e.to, sourceHandle: srcH, targetHandle: tgtH, type: far ? 'smoothstep' : 'default', zIndex: 1,
        style: { stroke: color, strokeWidth: e.kind === 'int' ? 1.2 : selected ? 2.8 : 2, strokeDasharray: tone === 'check' ? '6 4' : e.kind === 'matches' && !selected ? '2 4' : undefined, opacity: hot ? 1 : 0.1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: tone === 'int' ? '#9a9aa3' : undefined, width: 14, height: 14 },
        label: showLabel ? l!.label : undefined,
        labelStyle: { fontSize: 11, fontWeight: 600, fill: tone === 'n' ? 'var(--text2)' : color },
        labelBgStyle: { fill: 'var(--card)' },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 10,
      });
    }
    return { nodes: [...colNodes, ...out], edges: es };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, s.link, s.node, s.hover, s.filePr, s.expanded, s.allFiles, s.showInt, ov, ftAct]);

  const ftLabel = ftAct.length === 0 ? 'All types' : ftAct.length === 1 ? FILE_TYPES.find((t) => t.id === ftAct[0])?.label ?? '1 type' : `${ftAct.length} types`;
  const hint = ftAct.length ? `Filtered: ${FILE_TYPES.filter((t) => ftAct.includes(t.id)).map((t) => t.label).join(', ')}` : 'Key files only · hover a file for its links, click for its diff';
  const ovNote = {
    none: '', tests: 'Which boxes come with a test change. Logic with no test change is marked amber.', kind: 'Each box by change type: config, logic, test, docs, pipeline or script.',
    since: 'Boxes changed since you last built a report on these PRs are marked with a dot.', risk: 'Risk from rules: bug-fix commits in the file’s history, how often it changes, hotspots and what the file does. New files say “not enough history” instead of guessing.',
    fit: 'Ticket fit compares each box with the ticket and PR description. Amber boxes hold changes the ticket may not cover.',
  }[ov];

  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <PopupMenu prefix="Files:" label={ftLabel}>
          {FILE_TYPES.filter((t) => ftCount.get(t.id)).map((t) => (
            <MenuItem key={t.id} checked={ftAct.includes(t.id)} right={ftCount.get(t.id)} onClick={() => s.set({ ftSel: ftAct.includes(t.id) ? ftAct.filter((x) => x !== t.id) : [...ftAct, t.id], hover: null })}>{t.label}</MenuItem>
          ))}
          <div className="msep" />
          <MenuItem onClick={() => s.set({ ftSel: [] })}>Show all file types</MenuItem>
        </PopupMenu>
        <PopupMenu prefix="Overlay:" label={OVERLAYS.find(([v]) => v === ov)?.[1] ?? 'None'}>
          {OVERLAYS.map(([v, l]) => <MenuItem key={v} checked={ov === v} onClick={() => s.set({ overlay: v as never })}>{l}</MenuItem>)}
        </PopupMenu>
        <PopupMenu label="Options">
          <MenuItem checked={s.allFiles} onClick={() => s.set({ allFiles: !s.allFiles })}>Show every file</MenuItem>
          <MenuItem checked={s.showInt} onClick={() => s.set({ showInt: !s.showInt })}>Show links inside a PR</MenuItem>
        </PopupMenu>
        {ftAct.map((id) => (
          <button key={id} onClick={() => s.set({ ftSel: ftAct.filter((x) => x !== id) })} aria-label={`Remove filter ${id}`} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 6px 2px 9px', borderRadius: 11, border: 0, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>
            {FILE_TYPES.find((t) => t.id === id)?.label}<span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      {ovNote && <div className="card" style={{ padding: '8px 12px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>{ovNote}</div>}
      <div className="card" style={{ height: s.mapFull ? 'calc(100vh - 210px)' : 560, minHeight: 360, background: 'var(--list)', overflow: 'hidden' }}>
        <ReactFlow
          key={`${r.id}-${ftAct.join()}-${s.allFiles}-${s.expanded.join()}-${s.mapFull}`}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.06 }}
          minZoom={0.3}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_e, n) => n.type === 'file' && s.focusNode(n.id)}
          onNodeMouseEnter={(_e, n) => n.type === 'file' && s.set({ hover: n.id })}
          onNodeMouseLeave={() => s.set({ hover: null })}
          onEdgeClick={(_e, e) => {
            const l = r.edges.find((x) => x.id === e.id)?.linkId;
            if (l) s.focusLink(l);
          }}
        >
          <Background gap={24} size={1} color="var(--sep)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', fontSize: 12, color: 'var(--text3)' }}>
        {[['Connects', 'var(--text3)', undefined], ['Matches', 'var(--text3)', '2 4'], ['Check it', 'var(--warn)', '6 4'], ['Fix before merge', 'var(--gap)', undefined]].map(([l, c, d]) => (
          <span key={l} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" style={{ stroke: c, strokeWidth: 2, strokeDasharray: d, strokeLinecap: 'round' }} /></svg>{l}</span>
        ))}
        <span style={{ flex: 1, minWidth: 12 }} />
        <span>{hint}</span>
      </div>
    </>
  );
}
