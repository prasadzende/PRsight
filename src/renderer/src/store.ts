import { create } from 'zustand';
import type { AuthStatus, BuildProgress, LineComment, PrListItem } from '@shared/ipc';
import type { Report } from '@shared/model';

export type Scope = 'all' | 'assigned' | 'mine' | 'drafts';
export type View = 'report' | 'map' | 'changes' | 'tickets';
export type Overlay = 'none' | 'tests' | 'kind' | 'since' | 'risk' | 'fit';

interface State {
  auth: AuthStatus | null;
  section: 'prs' | 'report';
  scope: Scope;
  stateFilter: 'open' | 'closed';
  q: string;
  repo: string | null;
  /** Repos seen in the unfiltered list, with open PR counts (the sidebar keeps them while one repo is picked). */
  repoCounts: Record<string, number>;
  /** PR ids from a report being reviewed: the PR list shows only these until cleared. */
  reviewSet: string[] | null;
  prs: PrListItem[];
  selected: string[];
  current: string | null;
  report: Report | null;
  building: BuildProgress | null;
  buildError: string | null;
  view: View;
  mapView: 'story' | 'files';
  /** The File Map canvas fills the window (the inspector stays). */
  mapFull: boolean;
  /** Changes tab: the PR shown, pending review comments and files marked viewed (per PR, kept on this computer). */
  changesPr: string | null;
  pending: Record<string, LineComment[]>;
  viewed: Record<string, Record<string, boolean>>;
  tour: number;
  overlay: Overlay;
  ftSel: string[];
  allFiles: boolean;
  showInt: boolean;
  expanded: string[];
  filePr: string | null;
  node: string | null;
  link: string | null;
  hover: string | null;
  sideOpen: boolean;
  inspOpen: boolean;
  settingsOpen: boolean;
  setTab: 'general' | 'accounts' | 'boards' | 'ai' | 'privacy';
  checks: Record<string, boolean>;
  manualTickets: string[];
  reviewOpen: boolean;
  /** Select Related: list items found outside the loaded list, the result line, and whether only ticked PRs are shown. */
  /** Sidebar: the All repositories list is collapsed until opened (favourites always show). */
  reposOpen: boolean;
  relatedItems: PrListItem[];
  relatedMsg: { text: string; hidden: number; tone: 'ok' | 'none' | 'error' } | null;
  relatedBusy: boolean;
  showSelected: boolean;
  /** Opens the review panel pre-filled (from the Report tab's Request changes / Approve). `n` changes per request. */
  reviewDraft: { prId: string; kind: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; n: number } | null;
  /** Report tab: the finding shown in the detail panel, and the PR whose checklist is shown. */
  findSel: string | null;
  chkPr: string | null;
  explaining: boolean;
  listUpdatedAt: number | null;
  listCached: boolean;
  explainError: string | null;
  widths: { side: number; list: number; insp: number };
  setWidth: (k: 'side' | 'list' | 'insp', w: number) => void;
  set: (p: Partial<State>) => void;
  toggleSel: (id: string) => void;
  focusNode: (id: string | null) => void;
  focusLink: (id: string | null) => void;
  /** Show a file or link in the right-hand panel without leaving the current view. */
  inspect: (kind: 'node' | 'link', id: string) => void;
  /** Files and links opened in the right-hand panel, most recent first (for Back and Recently viewed). */
  visited: Array<{ kind: 'node' | 'link'; id: string }>;
  /** Back to the item viewed before the current one. */
  inspectBack: () => void;
}

const WIDTH_LIMITS = { side: [180, 360], list: [280, 560], insp: [260, 620] } as const;
const loadWidths = (): State['widths'] => {
  try {
    const w = JSON.parse(localStorage.getItem('prgraph.widths') ?? '{}');
    return { side: Number(w.side) || 230, list: Number(w.list) || 360, insp: Number(w.insp) || 340 };
  } catch {
    return { side: 230, list: 360, insp: 340 };
  }
};

/** Most recent first, each item once, at most 8. */
const remember = (list: Array<{ kind: 'node' | 'link'; id: string }>, kind: 'node' | 'link', id: string) => [{ kind, id }, ...list.filter((v) => !(v.kind === kind && v.id === id))].slice(0, 8);

export const useApp = create<State>((set, get) => ({
  auth: null,
  section: 'prs',
  scope: 'all',
  stateFilter: 'open',
  q: '',
  repo: null,
  prs: [],
  selected: [],
  current: null,
  report: null,
  building: null,
  buildError: null,
  view: 'report',
  mapView: 'story',
  mapFull: false,
  changesPr: null,
  pending: {},
  viewed: {},
  repoCounts: {},
  reviewSet: null,
  tour: 0,
  overlay: 'none',
  ftSel: [],
  allFiles: false,
  showInt: false,
  expanded: [],
  filePr: null,
  node: null,
  link: null,
  hover: null,
  sideOpen: true,
  inspOpen: true,
  settingsOpen: false,
  setTab: 'general',
  checks: {},
  manualTickets: [],
  reviewOpen: false,
  reposOpen: false,
  relatedItems: [],
  relatedMsg: null,
  relatedBusy: false,
  showSelected: false,
  reviewDraft: null,
  findSel: null,
  chkPr: null,
  explaining: false,
  listUpdatedAt: null,
  listCached: false,
  explainError: null,
  widths: loadWidths(),
  setWidth: (k, w) => {
    const [min, max] = WIDTH_LIMITS[k];
    const widths = { ...get().widths, [k]: Math.round(Math.min(max, Math.max(min, w))) };
    set({ widths });
    try {
      localStorage.setItem('prgraph.widths', JSON.stringify(widths));
    } catch {
      /* storage unavailable: widths reset next launch */
    }
  },
  set: (p) => set(p),
  toggleSel: (id) => {
    const s = get().selected;
    // A new tick or untick makes the last Select Related result out of date.
    set({ selected: s.includes(id) ? s.filter((x) => x !== id) : s.length >= 10 ? s : [...s, id], relatedMsg: null });
  },
  focusNode: (id) => set({ node: id, link: null, mapView: 'files', tour: 0, inspOpen: true, view: 'map', ...(id ? { visited: remember(get().visited, 'node', id) } : {}) }),
  focusLink: (id) => set({ link: id, node: null, mapView: 'files', tour: 0, inspOpen: true, view: 'map', ...(id ? { visited: remember(get().visited, 'link', id) } : {}) }),
  inspect: (kind, id) => set({ node: kind === 'node' ? id : null, link: kind === 'link' ? id : null, inspOpen: true, visited: remember(get().visited, kind, id) }),
  visited: [],
  inspectBack: () => {
    const [, prev, ...rest] = get().visited;
    if (!prev) return set({ node: null, link: null });
    set({ node: prev.kind === 'node' ? prev.id : null, link: prev.kind === 'link' ? prev.id : null, visited: [prev, ...rest] });
  },
}));

// ---- Remember UI preferences between launches (this computer only) ----
const PREF_KEYS = ['scope', 'stateFilter', 'repo', 'sideOpen', 'inspOpen', 'view', 'mapView', 'overlay', 'allFiles', 'showInt', 'current', 'selected', 'changesPr', 'pending', 'viewed'] as const;
type Prefs = Partial<Pick<State, (typeof PREF_KEYS)[number]>>;

try {
  const saved = JSON.parse(localStorage.getItem('prgraph.prefs') ?? '{}') as Prefs;
  const clean: Prefs = {};
  for (const k of PREF_KEYS) if (saved[k] !== undefined) (clean as Record<string, unknown>)[k] = saved[k];
  // 'My Team' was removed; fall back to All.
  if (!['all', 'assigned', 'mine', 'drafts'].includes(clean.scope as string)) delete clean.scope;
  if (!['report', 'map', 'changes', 'tickets'].includes(clean.view as string)) delete clean.view;
  useApp.setState(clean);
} catch {
  /* no saved preferences yet */
}

let last = '';
useApp.subscribe((st) => {
  const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, st[k]]));
  const json = JSON.stringify(prefs);
  if (json === last) return;
  last = json;
  try {
    localStorage.setItem('prgraph.prefs', json);
  } catch {
    /* storage unavailable */
  }
});
