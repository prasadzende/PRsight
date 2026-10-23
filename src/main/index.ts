import { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, session, shell, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { Channels, type Channel, type LineComment, type Outputs, type PrListItem } from '../shared/ipc';
import type { PrRef } from '../shared/model';
import { relatedPrs } from '../analysis/tickets';
import * as auth from './auth';
import * as gh from './github';
import * as reports from './reports';
import { eq } from 'drizzle-orm';
import { settingsT, cacheGet, cachePut, closeDb, dataDir, db, dbPath, pruneOlderThan, usage, cacheT, reportsT, memoryT, lastReviewT } from './db';
import { deleteSecret, getSettings, hasSecrets, keychainName, resetSettingsCache, setSecret, setSettings } from './settings';
import { listModels, providerInfo, testProvider } from './ai/providers';
import { testBoard } from './boards';
import * as updates from './updates';
import { existsSync, rmSync } from 'node:fs';

const isMac = process.platform === 'darwin';
// Not packaged (pnpm dev): show the PRsight icon in the Dock and on the window; packaged builds use the bundle icon.
const DEV_ICON = join(__dirname, '../../build/icon.png');

// The app was called "PR Graph" before. Keep using that data folder so settings, cache and reports carry over.
const LEGACY_DATA = join(app.getPath('appData'), 'PR Graph');
if (existsSync(LEGACY_DATA)) app.setPath('userData', LEGACY_DATA);
let win: BrowserWindow | null = null;
const prCache = new Map<string, { title: string; branch: string; body: string; state: string }>();

// In development the Vite dev server needs an inline React refresh preamble and a websocket; packaged builds get the strict policy.
const DEV = !!process.env.ELECTRON_RENDERER_URL;
const CSP = [
  "default-src 'self'",
  DEV ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  DEV ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function savedBounds(): { x: number; y: number; width: number; height: number; maximized?: boolean } | null {
  try {
    const row = db().select().from(settingsT).where(eq(settingsT.key, 'window')).get();
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

const onScreen = (b: { x: number; y: number; width: number; height: number }) =>
  screen.getAllDisplays().some((d) => b.x >= d.bounds.x - 50 && b.y >= d.bounds.y - 50 && b.x + 200 <= d.bounds.x + d.bounds.width && b.y + 100 <= d.bounds.y + d.bounds.height);

function createWindow(): void {
  const s = getSettings();
  nativeTheme.themeSource = s.appearance;
  const bounds = savedBounds();
  win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    ...(bounds && onScreen(bounds) ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'PRsight',
    ...(!isMac && !app.isPackaged && existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e20' : '#ffffff',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 }, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#f2f2f5' : '#1d1d1f', height: 52 }, backgroundMaterial: 'mica' as const }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
    },
  });
  // Zoom keys: ⌘/Ctrl with + = − 0, including the number pad. Ctrl+scroll or pinch zooms the same way.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    // Handled here (and the menu event cancelled) so + / = / − / 0 work the same on every keyboard and platform.
    if (input.alt) return;
    if (input.code === 'NumpadAdd' || input.code === 'Equal') { e.preventDefault(); zoom(1); }
    else if (input.code === 'NumpadSubtract' || input.code === 'Minus') { e.preventDefault(); zoom(-1); }
    else if ((input.code === 'Numpad0' || input.code === 'Digit0') && !input.shift) { e.preventDefault(); zoom(0); }
  });
  win.webContents.on('did-finish-load', applyZoom);
  win.webContents.on('zoom-changed', (_e, dir) => zoom(dir === 'in' ? 1 : -1));
  win.once('ready-to-show', () => {
    if (bounds?.maximized) win?.maximize();
    win?.show();
  });
  // Remember size and position for next launch.
  win.on('close', () => {
    if (!win) return;
    const b = win.getNormalBounds();
    db().insert(settingsT).values({ key: 'window', value: JSON.stringify({ ...b, maximized: win.isMaximized() }) }).onConflictDoUpdate({ target: settingsT.key, set: { value: JSON.stringify({ ...b, maximized: win.isMaximized() }) } }).run();
  });
  // Show the window even if the first paint is slow (for example the dev server is still compiling).
  setTimeout(() => {
    if (win && !win.isVisible()) win.show();
  }, 3000);
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.error(`[prsight] page failed to load (${code} ${desc}): ${url}`));
  win.webContents.on('render-process-gone', (_e, d) => console.error(`[prsight] renderer stopped: ${d.reason}`));
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.error(`[renderer] ${e.message}`);
  });
  // No navigation away from the app, no new windows: links open in the default browser (allow-listed).
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '\u0000')) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const EXTERNAL_OK = [/^https:\/\/github\.com\//, /^https:\/\/dev\.azure\.com\//, /^https:\/\/[\w-]+\.atlassian\.net\//, /^https:\/\/[\w.-]+\.visualstudio\.com\//, /^https:\/\/docs\.anthropic\.com\//, /^https:\/\/claude\.com\//];
async function openExternal(url: string): Promise<boolean> {
  const host = getSettings().github.host;
  const jira = getSettings().boards.jira.site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const ok = EXTERNAL_OK.some((r) => r.test(url)) || (host !== 'github.com' && url.startsWith(`https://${host}/`)) || (!!jira && url.startsWith(`https://${jira}/browse/`));
  if (ok) await shell.openExternal(url);
  return ok;
}

function send(event: string, payload: unknown): void {
  win?.webContents.send(event, payload);
}

type Handler = { [C in Channel]: (input: never) => Promise<Outputs[C]> | Outputs[C] };

const handlers: Handler = {
  'auth:status': () => auth.status(),
  'auth:startDevice': () => auth.startDevice(),
  'auth:pollDevice': (i: { deviceCode: string }) => auth.pollDevice(i.deviceCode),
  'auth:useGhCli': () => auth.useGhCli(),
  'auth:useToken': (i: { token: string }) => auth.useToken(i.token),
  'auth:signOut': () => auth.signOut(),

  'prs:list': async (i: { scope: 'all' | 'assigned' | 'mine' | 'drafts'; state: 'open' | 'closed'; q: string; repo?: string }) => {
    const list = await gh.listPrs(i.scope, i.state, i.q, i.repo);
    for (const p of list) prCache.set(p.id, { title: p.title, branch: p.branch, body: p.body, state: p.state });
    // Keep the last list on this computer so the app opens with it straight away.
    cachePut(`prlist:${i.scope}:${i.state}:${i.q}${i.repo ? `:${i.repo}` : ''}`, null, JSON.stringify({ at: Date.now(), items: list }));
    return list;
  },
  'prs:cached': (i: { scope: 'all' | 'assigned' | 'mine' | 'drafts'; state: 'open' | 'closed'; q: string; repo?: string }) => {
    const c = cacheGet(`prlist:${i.scope}:${i.state}:${i.q}${i.repo ? `:${i.repo}` : ''}`);
    if (!c) return null;
    try {
      const v = JSON.parse(c.body) as { at: number; items: PrListItem[] };
      for (const p of v.items) prCache.set(p.id, { title: p.title, branch: p.branch, body: p.body, state: p.state });
      return v;
    } catch {
      return null;
    }
  },
  'prs:details': (i: PrRef) => gh.prDetails(i),
  'prs:reply': async (i: { ref: PrRef; commentId: number; body: string }) => {
    await gh.reply(i.ref, i.commentId, i.body);
    return { ok: true as const };
  },
  'prs:comment': async (i: { ref: PrRef; body: string }) => {
    await gh.comment(i.ref, i.body);
    return { ok: true as const };
  },
  'prs:files': (i: PrRef) => gh.prFiles(i),
  'prs:resolve': async (i: { threadId: string; resolve: boolean }) => ({ resolved: await gh.setThreadResolved(i.threadId, i.resolve) }),
  'prs:status': (i: { refs: PrRef[] }) => gh.prStatuses(i.refs),
  'repos:refresh': async () => ({ count: await gh.refreshRepos() }),
  'avatars:get': (i: { logins: string[] }) => gh.avatars(i.logins),
  'repos:favourites': async () => ({ starred: await gh.starredRepos().catch(() => []), pinned: getSettings().pinnedRepos }),
  'repos:all': (i: { offset: number; limit: number }) => gh.allRepos(i.offset, i.limit),
  'prs:review': async (i: { ref: PrRef; event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'; body: string; comments?: LineComment[]; commitId?: string }) => {
    const d = await gh.prDetails(i.ref);
    if (i.event !== 'COMMENT' && d.pr.author === d.viewer) throw new Error('You can’t approve or request changes on your own pull request.');
    if (i.event !== 'COMMENT' && d.pr.state !== 'open') throw new Error('This pull request is not open.');
    if (i.event !== 'APPROVE' && !i.body.trim() && !i.comments?.length) throw new Error('Add a summary first.');
    if (i.event === 'REQUEST_CHANGES' && !i.body.trim()) throw new Error('Say what needs to change in the summary.');
    return { ok: true as const, state: await gh.review(i.ref, i.event, i.body, i.comments ?? [], i.commitId) };
  },
  'prs:related': (i: { selected: string[]; all: string[] }) => {
    const pick = (ids: string[]) => ids.map((id) => ({ id, ...(prCache.get(id) ?? { title: '', branch: '', body: '', state: 'closed' }) }));
    const s = getSettings();
    return relatedPrs(pick(i.selected), pick(i.all), { ...s.boards.detect, jiraKeys: s.boards.jira.projectKeys, bareAdoNumbers: true }, {}, (p) => p.id).map((r) => ({ id: r.pr.id, reason: r.reason }));
  },

  'report:build': (i: { refs: PrRef[]; manualTickets: string[] }) => reports.build(i.refs, i.manualTickets, (p) => send('report:progress', p)),
  'report:list': () => reports.list(),
  'report:get': (i: { id: string }) => reports.get(i.id),
  'report:delete': (i: { id: string }) => {
    reports.remove(i.id);
    return { ok: true as const };
  },
  'report:explain': (i: { id: string }) => reports.explainStored(i.id),
  'report:diff': (i: { ref: PrRef; paths: string[] }) => gh.filePatches(i.ref, i.paths),

  'settings:get': () => getSettings(),
  'repos:search': (i: { q: string }) => gh.searchRepos(i.q),
  'ai:models': (i: { provider: Parameters<typeof listModels>[0] }) => listModels(i.provider),
  'settings:set': (i: Parameters<typeof setSettings>[0]) => {
    const s = setSettings(i);
    nativeTheme.themeSource = s.appearance;
    applyZoom();
    if ((i as { privacy?: unknown }).privacy) updates.reschedule();
    return s;
  },
  'secrets:set': (i: { name: Parameters<typeof setSecret>[0]; value: string }) => {
    setSecret(i.name, i.value);
    return { ok: true as const };
  },
  'secrets:has': () => hasSecrets(),
  'secrets:delete': (i: { name: Parameters<typeof deleteSecret>[0] }) => {
    deleteSecret(i.name);
    return { ok: true as const };
  },

  'ai:providers': () => providerInfo(),
  'ai:test': (i: { provider: Parameters<typeof testProvider>[0] }) => testProvider(i.provider),
  'boards:test': (i: { system: 'ado' | 'jira' }) => testBoard(i.system),

  'data:usage': () => {
    const u = usage();
    return { cacheBytes: u.cacheBytes, reports: u.reports, memoryNotes: u.memoryNotes, path: dataDir() };
  },

  'data:clear': (i: { what: 'cache' | 'reports' | 'memory' }) => {
    if (i.what === 'cache') db().delete(cacheT).run();
    if (i.what === 'reports') {
      db().delete(reportsT).run();
      db().delete(lastReviewT).run();
    }
    if (i.what === 'memory') db().delete(memoryT).run();
    return { ok: true as const };
  },
  'data:deleteAll': async () => {
    reports.stopWorker();
    for (const n of ['github', 'anthropic', 'openai', 'azureopenai', 'gemini', 'jira'] as const) deleteSecret(n);
    closeDb();
    for (const f of [dbPath(), `${dbPath()}-wal`, `${dbPath()}-shm`]) rmSync(f, { force: true });
    resetSettingsCache();
    gh.forgetViewer();
    await session.defaultSession.clearStorageData();
    return { ok: true as const };
  },

  'app:openExternal': async (i: { url: string }) => ({ ok: await openExternal(i.url) }),
  'app:info': () => ({ platform: process.platform, version: app.getVersion(), keychain: keychainName(), dataPath: dataDir() }),
  'update:get': () => updates.current(),
  'update:check': () => updates.check(true),
  'update:download': async () => {
    await updates.download();
    return { ok: true as const };
  },
  'update:install': () => {
    updates.install();
    return { ok: true as const };
  },
};

function registerIpc(): void {
  for (const [channel, schema] of Object.entries(Channels)) {
    ipcMain.handle(channel, async (e, raw) => {
      if (!win || e.sender !== win.webContents) throw new Error('Unknown sender');
      const parsed = schema.safeParse(raw);
      if (!parsed.success) throw new Error(`Invalid input for ${channel}`);
      try {
        return await (handlers[channel as Channel] as (i: unknown) => unknown)(parsed.data);
      } catch (err) {
        // Never include tokens or file contents in errors that reach the UI.
        throw new Error((err as Error).message.replace(/gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g, '[token]'));
      }
    });
  }
}

// Zoom: the whole window scales (layout and text together). Saved in settings so it survives restarts.
const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
function applyZoom(): void {
  win?.webContents.setZoomFactor(getSettings().zoom);
}
function zoom(dir: 1 | -1 | 0): void {
  const cur = getSettings().zoom;
  const next = dir === 0 ? 1 : dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.001) ?? cur : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001) ?? cur;
  setSettings({ zoom: next });
  applyZoom();
  send('settings:changed', { zoom: next });
}

function menu(): void {
  const cmd = (command: string) => () => send('menu:command', { command });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ label: 'PRsight', submenu: [{ role: 'about' as const }, { label: 'Check for Updates…', click: () => void updates.check(true) }, { type: 'separator' as const }, { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('settings') }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }]
      : []),
    { label: 'File', submenu: [{ label: 'Build Report', accelerator: 'CmdOrCtrl+B', click: cmd('build') }, { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: cmd('refresh') }, ...(isMac ? [] : [{ type: 'separator' as const }, { label: 'Settings…', accelerator: 'Ctrl+,', click: cmd('settings') }, { role: 'quit' as const }]), { type: 'separator' as const }, { role: 'close' as const }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, { label: 'Find', accelerator: 'CmdOrCtrl+F', click: cmd('find') }, { label: 'Select Related Pull Requests', accelerator: isMac ? 'Alt+Cmd+A' : 'Ctrl+Alt+A', click: cmd('selectRelated') }, { label: 'Deselect All', accelerator: 'Shift+CmdOrCtrl+A', click: cmd('deselectAll') }] },
    { label: 'View', submenu: [{ label: 'Toggle Sidebar', accelerator: isMac ? 'Ctrl+Cmd+S' : 'Ctrl+Shift+S', click: cmd('toggleSidebar') }, { label: 'Toggle Inspector', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Alt+I', click: cmd('toggleInspector') }, { type: 'separator' }, { label: 'Report', accelerator: 'CmdOrCtrl+1', click: cmd('view:report') }, { label: 'File Map', accelerator: 'CmdOrCtrl+2', click: cmd('view:map') }, { label: 'Changes', accelerator: 'CmdOrCtrl+3', click: cmd('view:changes') }, { label: 'Tickets', accelerator: 'CmdOrCtrl+4', click: cmd('view:tickets') }, { type: 'separator' }, { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) }, { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => zoom(1) }, { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-1) }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])] },
    { label: 'Pull Request', submenu: [{ label: 'Open on GitHub', accelerator: 'Shift+CmdOrCtrl+O', click: cmd('openGithub') }, { label: 'Add to Report', accelerator: 'CmdOrCtrl+D', click: cmd('toggleSelect') }, { label: 'Review…', accelerator: 'Shift+CmdOrCtrl+R', click: cmd('review') }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [...(isMac ? [] : [{ label: 'Check for Updates…', click: () => void updates.check(true) }, { type: 'separator' as const }]), { label: 'PRsight Releases', click: () => void shell.openExternal(updates.RELEASES_URL) }, { label: 'Claude Code (for the subscription option)', click: () => void shell.openExternal('https://claude.com/claude-code') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}


// One copy of the app at a time: a second copy would hold its own settings in memory and could save over yours.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[prsight] another copy is already running; bringing it to the front');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  if (!gotLock) return;
  if (isMac && !app.isPackaged && existsSync(DEV_ICON)) app.dock?.setIcon(DEV_ICON);
  app.setAboutPanelOptions({ applicationName: 'PRsight', applicationVersion: app.getVersion() });
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  // The renderer never reaches the network: block every non-local request it makes.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = u.startsWith('file:') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:') || (process.env.ELECTRON_RENDERER_URL && u.startsWith(process.env.ELECTRON_RENDERER_URL)) || /^wss?:\/\/localhost/.test(u);
    cb({ cancel: !local });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  db();
  pruneOlderThan(getSettings().privacy.keepDays);
  setInterval(() => pruneOlderThan(getSettings().privacy.keepDays), 86_400_000);
  registerIpc();
  menu();
  createWindow();
  updates.start((st) => send('update:state', st));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  reports.stopWorker();
  if (!isMac) app.quit();
});
