// Settings (SQLite) and secrets (encrypted with Electron safeStorage: macOS Keychain, Windows DPAPI).
import { safeStorage } from 'electron';
import { eq } from 'drizzle-orm';
import { SettingsZ, type SecretName, type Settings } from '../shared/ipc';
import { db, dbPath as dbFile, secretsT, settingsT } from './db';

let cached: Settings | null = null;

/** Reads the saved settings from disk. A field that fails validation is dropped on its own; the rest are kept. */
function load(): Settings {
  const row = db().select().from(settingsT).where(eq(settingsT.key, 'settings')).get();
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.value) : {};
  } catch {
    console.error('[prsight] saved settings are not valid JSON; using defaults');
    raw = {};
  }
  for (let i = 0; i < 20; i++) {
    const parsed = SettingsZ.safeParse(raw);
    if (parsed.success) return parsed.data;
    console.error('[prsight] dropping invalid saved settings:', parsed.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`));
    for (const issue of parsed.error.issues) dropPath(raw, issue.path as Array<string | number>);
  }
  return SettingsZ.parse({});
}

function dropPath(obj: unknown, path: Array<string | number>): void {
  if (!path.length || !obj || typeof obj !== 'object') return;
  let cur = obj as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) {
    const next = cur[k];
    if (!next || typeof next !== 'object') return;
    cur = next as Record<string | number, unknown>;
  }
  delete cur[path[path.length - 1]];
}

/** Environment overrides for admins and CI (never secrets). Applied in memory only, never saved. */
function withEnv(s: Settings): Settings {
  if (process.env.PRGRAPH_GITHUB_CLIENT_ID && !s.github.clientId) s.github.clientId = process.env.PRGRAPH_GITHUB_CLIENT_ID;
  if (process.env.PRGRAPH_UPDATE_FEED && !s.privacy.updateFeed) s.privacy.updateFeed = process.env.PRGRAPH_UPDATE_FEED;
  return s;
}

export function getSettings(): Settings {
  if (cached) return cached;
  cached = withEnv(load());
  console.log(`[prsight] settings loaded from ${dbFile()}: AI ${cached.ai.enabled ? 'on' : 'off'} (${cached.ai.provider}), appearance ${cached.appearance}, zoom ${cached.zoom}`);
  return cached;
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (Array.isArray(patch) || typeof patch !== 'object' || patch === null) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const cur = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' ? deepMerge(cur, v as never) : v;
  }
  return out as T;
}

export function setSettings(patch: Partial<Settings>): Settings {
  // Merge with what is on disk now, not a copy held in memory, so nothing saved elsewhere is overwritten.
  getSettings();
  const next = SettingsZ.parse(deepMerge(load(), patch));
  db().insert(settingsT).values({ key: 'settings', value: JSON.stringify(next) }).onConflictDoUpdate({ target: settingsT.key, set: { value: JSON.stringify(next) } }).run();
  cached = withEnv(structuredClone(next));
  console.log(`[prsight] settings saved: AI ${next.ai.enabled ? 'on' : 'off'} (${next.ai.provider}), appearance ${next.appearance}, zoom ${next.zoom}`);
  return cached;
}

export function resetSettingsCache(): void {
  cached = null;
}

export function setSecret(name: SecretName, value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the key was not saved.');
  const enc = safeStorage.encryptString(value);
  db().insert(secretsT).values({ name, value: enc }).onConflictDoUpdate({ target: secretsT.name, set: { value: enc } }).run();
}

export function getSecret(name: SecretName): string | null {
  const row = db().select().from(secretsT).where(eq(secretsT.name, name)).get();
  if (!row) return null;
  try {
    return safeStorage.decryptString(row.value);
  } catch {
    return null;
  }
}

export function deleteSecret(name: SecretName): void {
  db().delete(secretsT).where(eq(secretsT.name, name)).run();
}

export function hasSecrets(): Record<SecretName, boolean> {
  const names: SecretName[] = ['github', 'anthropic', 'openai', 'azureopenai', 'foundry', 'gemini', 'jira', 'ado'];
  const rows = new Set(db().select({ name: secretsT.name }).from(secretsT).all().map((r) => r.name));
  return Object.fromEntries(names.map((n) => [n, rows.has(n)])) as Record<SecretName, boolean>;
}

export const keychainName = (): string => (process.platform === 'darwin' ? 'the macOS Keychain' : process.platform === 'win32' ? 'Windows Credential Manager' : 'the system keyring');
