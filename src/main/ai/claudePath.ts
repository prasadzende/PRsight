// Finding the Claude Code CLI on macOS and Windows. Pure functions (no Electron), so they are unit-tested on any OS.
import { posix, win32 } from 'node:path';

const pathFor = (platform: string) => (platform === 'win32' ? win32 : posix);

/** Only these file names are accepted as Claude Code, whether found automatically or chosen in Settings. */
export function isClaudeFile(file: string, platform: string): boolean {
  const path = pathFor(platform);
  if (!file || !path.isAbsolute(file)) return false;
  const name = path.basename(file);
  return platform === 'win32' ? /^claude\.(exe|cmd)$/i.test(name) : name === 'claude';
}

/** The usual install locations, most likely first. */
export function claudeCandidates(home: string, env: Record<string, string | undefined>, platform: string): string[] {
  const path = pathFor(platform);
  if (platform === 'win32') {
    return [
      // Native installer (irm https://claude.ai/install.ps1 | iex)
      path.join(home, '.local', 'bin', 'claude.exe'),
      // npm install -g @anthropic-ai/claude-code
      path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm', 'claude.cmd'),
    ];
  }
  return [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.npm-global', 'bin', 'claude'),
    path.join(home, '.bun', 'bin', 'claude'),
  ];
}

/** From the lines `where.exe` prints, a real .exe first, then an npm .cmd. */
export function preferExe(lines: string[]): string | null {
  return lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => /\.cmd$/i.test(l)) ?? null;
}

export type ClaudeSource = 'auto' | 'chosen' | 'none';

/** Detection order: automatic first (PATH, then the usual locations); if that finds nothing, the path chosen in Settings. */
export function resolveClaude(auto: string | null, chosen: string, usable: (file: string) => boolean): { bin: string | null; source: ClaudeSource; chosenMissing: boolean } {
  if (auto) return { bin: auto, source: 'auto', chosenMissing: false };
  if (chosen && usable(chosen)) return { bin: chosen, source: 'chosen', chosenMissing: false };
  return { bin: null, source: 'none', chosenMissing: !!chosen };
}

/**
 * npm installs `claude.cmd`, a batch-file shim. Windows can't start a .cmd without cmd.exe, and cmd.exe can't pass the
 * multi-line system prompt, so read the shim to find what it really runs: a .js file (started with node) or an .exe.
 */
export function readCmdShim(content: string, dir: string): { kind: 'js' | 'exe'; target: string } | null {
  const hits = [...content.matchAll(/"%~?dp0%?\\?([^"%]+\.(c?js|mjs|exe))"/gi)].filter((m) => !/(^|\\)node\.exe$/i.test(m[1]));
  const last = hits.pop();
  if (!last) return null;
  return { kind: /\.exe$/i.test(last[1]) ? 'exe' : 'js', target: win32.join(dir, last[1]) };
}
