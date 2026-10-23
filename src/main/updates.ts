// App updates from GitHub Releases (or a custom feed set in Settings), with electron-updater.
// Nothing downloads or installs without a click: the window shows an update bar and the person chooses.
import { app, shell } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { UpdateState } from '../shared/ipc';
import { getSettings } from './settings';

export const RELEASES_URL = 'https://github.com/prasadzende/PRsight/releases/latest';

let state: UpdateState = { status: 'idle', current: app.getVersion(), manual: false };
let notify: (s: UpdateState) => void = () => undefined;
let manual = false;
let timer: NodeJS.Timeout | null = null;
let wired = false;

const set = (next: UpdateState) => {
  state = next;
  notify(state);
};

/** Release notes as short plain text (GitHub gives HTML or Markdown). */
export function plainNotes(notes: UpdateInfo['releaseNotes']): string {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '');
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > 2000 ? text.slice(0, 1999) + '…' : text;
}

/**
 * Whether this copy can replace itself. Windows and Linux can. macOS only installs updates for apps
 * signed with a paid Apple Developer ID, and PRsight's Mac builds are unsigned, so on a Mac the update
 * bar offers Download (the GitHub release page) instead.
 */
export const canInstall = (): Promise<boolean> => Promise.resolve(process.platform !== 'darwin');

function wire(): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', current: app.getVersion(), manual }));
  autoUpdater.on('update-not-available', () => set({ status: 'none', current: app.getVersion(), manual, checkedAt: new Date().toISOString() }));
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    void canInstall().then((ok) =>
      set({ status: 'available', current: app.getVersion(), manual, version: info.version, notes: plainNotes(info.releaseNotes), canInstall: ok, url: RELEASES_URL }),
    );
  });
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    if (state.status === 'available' || state.status === 'downloading') set({ status: 'downloading', current: app.getVersion(), manual, version: state.version, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => set({ status: 'ready', current: app.getVersion(), manual, version: info.version }));
  autoUpdater.on('error', (e: Error) => set({ status: 'error', current: app.getVersion(), manual: manual || state.status === 'downloading', message: friendly(e) }));
}

function friendly(e: Error): string {
  const m = e?.message ?? String(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::ERR_/i.test(m)) return 'Couldn’t reach GitHub. Check your connection and try again.';
  if (/404|No published versions|Cannot find latest/i.test(m)) return 'No releases are published yet.';
  if (/code signature|signature/i.test(m)) return 'This copy can’t install updates itself. Download the new version from GitHub instead.';
  return m.split('\n')[0].slice(0, 200);
}

function feed(): void {
  const custom = getSettings().privacy.updateFeed;
  // No custom feed: electron-updater reads app-update.yml (GitHub Releases), written by electron-builder.
  if (custom) autoUpdater.setFeedURL({ provider: 'generic', url: custom });
}

/** Check for an update. `byUser` shows the result even when there's nothing new. */
export async function check(byUser = false): Promise<UpdateState> {
  if (!app.isPackaged) {
    set({ status: 'error', current: app.getVersion(), manual: byUser, message: 'Updates only work in an installed copy, not with pnpm dev.' });
    return state;
  }
  if (state.status === 'downloading' || state.status === 'ready') return state;
  wire();
  feed();
  manual = byUser;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* reported through the 'error' event */
  }
  return state;
}

/** Download the update (or open the release page when this copy can't install it). */
export async function download(): Promise<void> {
  if (state.status !== 'available') return;
  if (!state.canInstall) {
    await shell.openExternal(RELEASES_URL);
    return;
  }
  manual = true;
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    /* reported through the 'error' event */
  }
}

/** Quit and install the downloaded update. */
export function install(): void {
  if (state.status !== 'ready') return;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
}

export const current = (): UpdateState => state;

/** Start the schedule from Settings › Privacy & Data: shortly after launch, then daily or weekly. */
export function start(onChange: (s: UpdateState) => void): void {
  notify = onChange;
  reschedule(true);
}

/** Apply a changed schedule (called after Settings are saved). */
export function reschedule(checkSoon = false): void {
  if (timer) clearInterval(timer);
  timer = null;
  const every = getSettings().privacy.updateCheck;
  if (!app.isPackaged || every === 'off') return;
  if (checkSoon) setTimeout(() => void check(false), 15_000);
  timer = setInterval(() => void check(false), every === 'daily' ? 86_400_000 : 7 * 86_400_000);
}
