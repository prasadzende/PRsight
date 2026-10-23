import type { Channel, Input, Outputs } from '@shared/ipc';

export const api = window.api;
export const call = <C extends Channel>(c: C, input?: Input<C>): Promise<Outputs[C]> => window.api.invoke(c, input);
export const isMac = window.api.platform === 'darwin';
export const mod = (mac: string, other: string): string => (isMac ? mac : other);
export const errText = (e: unknown): string => {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
};
export const open = (url: string): void => void call('app:openExternal', { url });
export const refOf = (id: string) => {
  const m = /^([^/]+)\/([^#]+)#(\d+)$/.exec(id)!;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
};
