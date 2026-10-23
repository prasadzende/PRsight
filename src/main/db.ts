// Local storage: SQLite (better-sqlite3) with Drizzle. Everything stays on this computer.
import { app } from 'electron';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { eq, lt, sql } from 'drizzle-orm';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const settingsT = sqliteTable('settings', { key: text('key').primaryKey(), value: text('value').notNull() });
export const secretsT = sqliteTable('secrets', { name: text('name').primaryKey(), value: blob('value', { mode: 'buffer' }).notNull() });
export const cacheT = sqliteTable('cache', {
  key: text('key').primaryKey(),
  etag: text('etag'),
  body: text('body').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const reportsT = sqliteTable('reports', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  prIds: text('pr_ids').notNull(),
  heads: text('heads').notNull(),
  json: text('json').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const memoryT = sqliteTable('memory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  repo: text('repo').notNull(),
  kind: text('kind').notNull(), // 'request' | 'open-finding'
  text: text('text').notNull(),
  source: text('source').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const lastReviewT = sqliteTable('last_review', { prId: text('pr_id').primaryKey(), sha: text('sha').notNull(), at: integer('at').notNull() });

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value BLOB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, etag TEXT, body TEXT NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, title TEXT NOT NULL, pr_ids TEXT NOT NULL, heads TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY AUTOINCREMENT, repo TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS last_review (pr_id TEXT PRIMARY KEY, sha TEXT NOT NULL, at INTEGER NOT NULL)`,
];

export const dataDir = (): string => join(app.getPath('userData'));
export const dbPath = (): string => join(dataDir(), 'pr-graph.sqlite');

let sqlite: Database.Database | null = null;
let orm: ReturnType<typeof drizzle> | null = null;

export function db() {
  if (!orm) {
    mkdirSync(dataDir(), { recursive: true });
    sqlite = new Database(dbPath());
    sqlite.pragma('journal_mode = WAL');
    for (const m of MIGRATIONS) sqlite.exec(m);
    orm = drizzle(sqlite);
  }
  return orm;
}

export function closeDb(): void {
  sqlite?.close();
  sqlite = null;
  orm = null;
}

export function cacheGet(key: string): { etag: string | null; body: string } | null {
  const r = db().select().from(cacheT).where(eq(cacheT.key, key)).get();
  return r ? { etag: r.etag, body: r.body } : null;
}

export function cachePut(key: string, etag: string | null, body: string): void {
  db().insert(cacheT).values({ key, etag, body, updatedAt: Date.now() }).onConflictDoUpdate({ target: cacheT.key, set: { etag, body, updatedAt: Date.now() } }).run();
}

/** Deletes data older than the chosen age. Runs at start-up and once a day. */
export function pruneOlderThan(days: number): void {
  const cutoff = Date.now() - days * 86_400_000;
  db().delete(cacheT).where(lt(cacheT.updatedAt, cutoff)).run();
  db().delete(reportsT).where(lt(reportsT.createdAt, cutoff)).run();
  // Review memory is small and useful for longer, so it is kept at least 90 days.
  db().delete(memoryT).where(lt(memoryT.createdAt, Date.now() - Math.max(days, 90) * 86_400_000)).run();
}

export function usage() {
  const cache = db().select({ n: sql<number>`coalesce(sum(length(body)), 0)` }).from(cacheT).get();
  const reports = db().select({ n: sql<number>`count(*)` }).from(reportsT).get();
  const memory = db().select({ n: sql<number>`count(*)` }).from(memoryT).get();
  let file = 0;
  try {
    file = statSync(dbPath()).size;
  } catch {
    /* new install */
  }
  return { cacheBytes: Math.max(cache?.n ?? 0, 0), reports: reports?.n ?? 0, memoryNotes: memory?.n ?? 0, fileBytes: file };
}
