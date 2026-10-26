import { describe, expect, it } from 'vitest';
import { claudeCandidates, isClaudeFile, preferExe, readCmdShim, resolveClaude } from '../src/main/ai/claudePath';
import { viaCmd } from '../src/main/winSpawn';

describe('Claude Code path', () => {
  it('accepts only a file named claude (claude.exe / claude.cmd on Windows), by absolute path', () => {
    expect(isClaudeFile('/Users/sam/.local/bin/claude', 'darwin')).toBe(true);
    expect(isClaudeFile('/Users/sam/.local/bin/node', 'darwin')).toBe(false);
    expect(isClaudeFile('claude', 'darwin')).toBe(false);
    expect(isClaudeFile('C:\\Users\\sam\\.local\\bin\\claude.exe', 'win32')).toBe(true);
    expect(isClaudeFile('C:\\Users\\sam\\AppData\\Roaming\\npm\\CLAUDE.CMD', 'win32')).toBe(true);
    expect(isClaudeFile('C:\\Windows\\System32\\cmd.exe', 'win32')).toBe(false);
    expect(isClaudeFile('C:\\tools\\claude', 'win32')).toBe(false);
    expect(isClaudeFile('', 'win32')).toBe(false);
  });

  it('lists the native installer first on Windows, then npm', () => {
    const c = claudeCandidates('C:\\Users\\sam', { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming' }, 'win32');
    expect(c).toEqual(['C:\\Users\\sam\\.local\\bin\\claude.exe', 'C:\\Users\\sam\\AppData\\Roaming\\npm\\claude.cmd']);
    expect(claudeCandidates('/Users/sam', {}, 'darwin')[0]).toBe('/Users/sam/.local/bin/claude');
  });

  it('prefers a real .exe from where.exe', () => {
    expect(preferExe(['C:\\npm\\claude.cmd', 'C:\\Users\\sam\\.local\\bin\\claude.exe'])).toBe('C:\\Users\\sam\\.local\\bin\\claude.exe');
    expect(preferExe(['C:\\npm\\claude', 'C:\\npm\\claude.cmd'])).toBe('C:\\npm\\claude.cmd');
    expect(preferExe([])).toBeNull();
  });

  it('checks automatic detection first, then the chosen path', () => {
    const yes = () => true;
    expect(resolveClaude('/auto/claude', '/chosen/claude', yes)).toEqual({ bin: '/auto/claude', source: 'auto', chosenMissing: false });
    expect(resolveClaude(null, '/chosen/claude', yes)).toEqual({ bin: '/chosen/claude', source: 'chosen', chosenMissing: false });
    expect(resolveClaude(null, '/chosen/claude', () => false)).toEqual({ bin: null, source: 'none', chosenMissing: true });
    expect(resolveClaude(null, '', yes)).toEqual({ bin: null, source: 'none', chosenMissing: false });
  });

  it('unwraps an npm claude.cmd shim to the script or exe it runs', () => {
    const js = '@ECHO off\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\nendLocal & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
    expect(readCmdShim(js, 'C:\\npm')).toEqual({ kind: 'js', target: 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js' });
    const exe = '@ECHO off\r\n"%~dp0\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
    expect(readCmdShim(exe, 'C:\\npm')).toEqual({ kind: 'exe', target: 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe' });
    expect(readCmdShim('@echo off\r\necho hi', 'C:\\npm')).toBeNull();
  });
});

describe('starting .cmd programs on Windows', () => {
  it('leaves other files and other platforms alone', () => {
    expect(viaCmd('/usr/local/bin/az', ['login'], 'darwin')).toEqual({ file: '/usr/local/bin/az', args: ['login'], windowsVerbatimArguments: false });
    expect(viaCmd('C:\\az.exe', ['login'], 'win32')).toEqual({ file: 'C:\\az.exe', args: ['login'], windowsVerbatimArguments: false });
  });
  it('runs a .cmd through cmd.exe with quoted, escaped arguments', () => {
    const r = viaCmd('C:\\Program Files\\az.cmd', ['account', 'a&b "c"'], 'win32', 'C:\\Windows\\system32\\cmd.exe');
    expect(r.file).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(r.windowsVerbatimArguments).toBe(true);
    expect(r.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(r.args[3]).toBe('"C:\\Program^ Files\\az.cmd ^"account^" ^"a^&b^ \\^"c\\^"^""');
  });
  it('refuses line breaks, which cmd.exe cannot pass safely', () => {
    expect(() => viaCmd('C:\\az.cmd', ['a\nb'], 'win32')).toThrow();
  });
});
