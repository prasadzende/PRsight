// Unified-diff helpers: parse GitHub `patch` text, find renamed identifiers and changed values.

export interface DiffLine {
  type: '+' | '-' | ' ';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  oldStart: number;
  newStart: number;
  header: string;
  lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(patch: string | null | undefined): Hunk[] {
  if (!patch) return [];
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of patch.split('\n')) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      cur = { oldStart: +m[1], newStart: +m[2], header: m[3].trim(), lines: [] };
      hunks.push(cur);
      o = +m[1];
      n = +m[2];
      continue;
    }
    if (!cur) continue;
    const c = raw.charAt(0);
    if (c === '\\') continue; // "\ No newline at end of file"
    if (c === '+') cur.lines.push({ type: '+', text: raw.slice(1), oldNo: null, newNo: n++ });
    else if (c === '-') cur.lines.push({ type: '-', text: raw.slice(1), oldNo: o++, newNo: null });
    else cur.lines.push({ type: ' ', text: raw.slice(1), oldNo: o++, newNo: n++ });
  }
  return hunks;
}

export const IDENT_RE = /[A-Za-z_][A-Za-z0-9_-]*[A-Za-z0-9_]|[A-Za-z_]/g;

export function tokens(line: string): string[] {
  return line.match(IDENT_RE) ?? [];
}

export function addedLines(hunks: Hunk[]): DiffLine[] {
  return hunks.flatMap((h) => h.lines.filter((l) => l.type === '+'));
}

export function removedLines(hunks: Hunk[]): DiffLine[] {
  return hunks.flatMap((h) => h.lines.filter((l) => l.type === '-'));
}

/** Pairs of removed/added blocks that sit next to each other in a hunk (a "change" block). */
export function changeBlocks(h: Hunk): Array<{ removed: DiffLine[]; added: DiffLine[] }> {
  const out: Array<{ removed: DiffLine[]; added: DiffLine[] }> = [];
  let i = 0;
  while (i < h.lines.length) {
    if (h.lines[i].type === ' ') {
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < h.lines.length && h.lines[i].type === '-') removed.push(h.lines[i++]);
    while (i < h.lines.length && h.lines[i].type === '+') added.push(h.lines[i++]);
    if (removed.length || added.length) out.push({ removed, added });
  }
  return out;
}

export interface Rename {
  from: string;
  to: string;
  line: number;
  snippet: string;
}

/**
 * Finds identifiers renamed in place: a removed line and an added line whose token
 * sequences are the same except for one or more positions that changed consistently.
 */
export function findRenames(hunks: Hunk[]): Rename[] {
  const out: Rename[] = [];
  for (const h of hunks) {
    for (const b of changeBlocks(h)) {
      const pairs = Math.min(b.removed.length, b.added.length);
      for (let k = 0; k < pairs; k++) {
        const a = tokens(b.removed[k].text);
        const c = tokens(b.added[k].text);
        if (a.length !== c.length || a.length === 0) continue;
        const diffs: Array<[string, string]> = [];
        for (let j = 0; j < a.length; j++) if (a[j] !== c[j]) diffs.push([a[j], c[j]]);
        if (diffs.length === 0 || diffs.length > 4) continue;
        const uniq = new Map<string, string>();
        let consistent = true;
        for (const [x, y] of diffs) {
          if (uniq.has(x) && uniq.get(x) !== y) consistent = false;
          uniq.set(x, y);
        }
        if (!consistent) continue;
        for (const [from, to] of uniq) {
          if (from.length < 2 || to.length < 2) continue;
          if (/^\d/.test(from) || /^\d/.test(to)) continue;
          out.push({ from, to, line: b.added[k].newNo ?? 0, snippet: b.added[k].text.trim() });
        }
      }
    }
  }
  return out;
}

export interface ValueChange {
  key: string;
  from: number;
  to: number;
  line: number;
  snippet: string;
}

const KV_NUM = /^\s*["']?([A-Za-z_][\w-]*)["']?\s*[:=]\s*["']?(-?\d[\d_,.]*)["']?\s*,?\s*$/;

/** Numeric values that changed for the same key, e.g. periodLimit: 2000000 -> 100000. */
export function findValueChanges(hunks: Hunk[]): ValueChange[] {
  const out: ValueChange[] = [];
  for (const h of hunks) {
    for (const b of changeBlocks(h)) {
      const before = new Map<string, number>();
      for (const l of b.removed) {
        const m = KV_NUM.exec(l.text);
        if (m) before.set(m[1], Number(m[2].replace(/[_,]/g, '')));
      }
      for (const l of b.added) {
        const m = KV_NUM.exec(l.text);
        if (!m) continue;
        const prev = before.get(m[1]);
        const next = Number(m[2].replace(/[_,]/g, ''));
        if (prev !== undefined && prev !== next) out.push({ key: m[1], from: prev, to: next, line: l.newNo ?? 0, snippet: l.text.trim() });
      }
    }
  }
  return out;
}

/** Last `n` lines of a hunk (for showing the code a review comment sits on). */
export function tailOfHunk(diffHunk: string, n = 6): DiffLine[] {
  const hunks = parsePatch(diffHunk);
  const lines = hunks.flatMap((h) => h.lines);
  return lines.slice(-n);
}
