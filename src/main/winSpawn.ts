// Starting .cmd / .bat programs on Windows (for example az.cmd). Node refuses to start them directly since
// CVE-2024-27980, so they go through cmd.exe with every argument quoted and escaped (the cross-spawn rules).
const META = /([()\][%!^"`<>&|;, *?])/g;
const escCommand = (s: string): string => s.replace(META, '^$1');
function escArg(s: string): string {
  const a = s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  return `"${a}"`.replace(META, '^$1');
}

export function viaCmd(file: string, args: string[], platform: string = process.platform, comspec: string | undefined = process.env.ComSpec): { file: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, windowsVerbatimArguments: false };
  if ([file, ...args].some((a) => /[\r\n\0]/.test(a))) throw new Error('Arguments for a .cmd program cannot contain line breaks.');
  const line = [escCommand(file), ...args.map(escArg)].join(' ');
  return { file: comspec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], windowsVerbatimArguments: true };
}
