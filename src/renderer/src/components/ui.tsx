import * as RSwitch from '@radix-ui/react-switch';
import * as Popover from '@radix-ui/react-popover';
import type React from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { call } from '../api';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className="swrap" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)' }}>
      {checked ? 'On' : 'Off'}
      <RSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1 }}>
        <RSwitch.Thumb className="switch-thumb" />
      </RSwitch.Root>
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} className={value === v ? 'seg-on' : 'seg-i'} role="tab" aria-selected={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export const Pill = ({ children, color, title, bold }: { children: ReactNode; color?: string; title?: string; bold?: boolean }) => (
  <span className="pill" title={title} style={color ? { color, background: `color-mix(in srgb, ${color} 13%, transparent)`, fontWeight: bold ? 600 : undefined } : undefined}>
    {children}
  </span>
);

export const AiBadge = ({ title = 'Written by AI. Check it before relying on it.' }: { title?: string }) => (
  <span className="aibadge" title={title}>
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'currentColor' }}>
      <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" />
    </svg>
    AI
  </span>
);

/** A macOS-style pop-up button with a menu of items (checkbox or radio). */
export function PopupMenu({ label, prefix, children }: { label: string; prefix?: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="popup" style={{ cursor: 'pointer', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        {prefix && <span className="t3">{prefix}</span>}
        {label} ⌄
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu" side="bottom" align="start" sideOffset={4} style={{ position: 'relative' }}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const MenuItem = ({ checked, onClick, children, right }: { checked?: boolean; onClick: () => void; children: ReactNode; right?: ReactNode }) => (
  <button className="mi" role="menuitemcheckbox" aria-checked={!!checked} onClick={onClick} style={{ alignItems: 'center' }}>
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <span aria-hidden="true" style={{ width: 14, fontWeight: 700 }}>
        {checked ? '✓' : ''}
      </span>
      {children}
    </span>
    {right != null && <span className="t3" style={{ fontSize: 12 }}>{right}</span>}
  </button>
);

export const Spinner = () => (
  <span aria-hidden="true" style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--cardb)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
);

export const SEV_COLOR: Record<string, string> = { High: 'var(--gap)', Medium: 'var(--warn)', Info: 'var(--accent)', Blocking: 'var(--gap)', 'Should fix': 'var(--warn)', Check: 'var(--text2)' };
export const TONE_COLOR: Record<string, string> = { bad: 'var(--gap)', check: 'var(--warn)', n: 'var(--text3)', acc: 'var(--accent)' };

export function Icon({ d, size = 16, stroke = 1.6 }: { d: string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  sidebar: 'M3 5h18v14H3zM9 5v14',
  inspector: 'M3 5h18v14H3zM15 5v14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
  all: 'M4 6h16M4 12h16M4 18h16',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
  plus: 'M12 5v14M5 12h14',
  draft: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  repo: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12',
  graph: 'M3 4h6v5H3zM15 4h6v5h-6zM9 15h6v5H9zM6 9v3h12V9M12 12v3',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
};

/** A thin vertical drag handle between panes. `side` says which way dragging grows the pane. */
export function Resizer({ width, onResize, grow = 'right', label }: { width: number; onResize: (w: number) => void; grow?: 'right' | 'left'; label: string }) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(w0 + (grow === 'right' ? ev.clientX - x0 : x0 - ev.clientX));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={width} tabIndex={0} className="resizer nodrag" onPointerDown={start}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onResize(width + (grow === 'right' ? -16 : 16)); if (e.key === 'ArrowRight') onResize(width + (grow === 'right' ? 16 : -16)); }}
      onDoubleClick={() => onResize(label.includes('sidebar') ? 230 : label.includes('list') ? 360 : 340)} />
  );
}

const AVATAR_BG = ['#0a63d6', '#8a4fd8', '#1f8a4c', '#c2306a', '#b26b00', '#2a7f9e'];

/** A GitHub profile picture (fetched once by the main process), or a coloured initial when there is none. */
export function Avatar({ login, size = 26 }: { login: string; size?: number }) {
  const pic = useQuery({ queryKey: ['avatar', login], queryFn: () => call('avatars:get', { logins: [login] }).then((r) => r[login] ?? ''), staleTime: Infinity, gcTime: Infinity }).data;
  const box = { width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%' } as const;
  if (pic) return <img src={pic} alt="" aria-hidden="true" width={size} height={size} style={{ ...box, objectFit: 'cover', background: 'var(--field)' }} />;
  const bg = AVATAR_BG[[...login].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_BG.length];
  return <span aria-hidden="true" style={{ ...box, background: bg, color: '#fff', fontSize: Math.round(size * 0.42), fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{login.charAt(0).toUpperCase()}</span>;
}

const STATE_BG: Record<string, [string, string]> = { open: ['Open', '#1f883d'], draft: ['Draft', '#6e7781'], merged: ['Merged', '#8250df'], closed: ['Closed', '#cf222e'] };
/** A solid state badge, like GitHub's: Open green, Draft grey, Merged purple, Closed red. */
export function StateBadge({ state, draft, title }: { state: string; draft?: boolean; title?: string }) {
  const [label, bg] = STATE_BG[state === 'open' && draft ? 'draft' : state] ?? [state, '#6e7781'];
  return <span title={title ?? 'State on GitHub'} style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 10, background: bg, color: '#fff', fontSize: 11, fontWeight: 600, lineHeight: 1.5, flex: '0 0 auto' }}>{label}</span>;
}
