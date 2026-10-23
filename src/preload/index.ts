// The only bridge between the UI and the main process. Exposes typed invoke/on for declared channels only.
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from '../shared/ipc';
import { CHANNEL_NAMES } from '../shared/channelNames';

const allowed = new Set<string>(CHANNEL_NAMES);
const events = new Set(['report:progress', 'menu:command', 'settings:changed', 'update:state']);

const api: Api = {
  invoke: (channel, input) => {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Unknown channel ${channel}`));
    return ipcRenderer.invoke(channel, input);
  },
  on: (event, cb) => {
    if (!events.has(event)) return () => undefined;
    const fn = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload as never);
    ipcRenderer.on(event, fn);
    return () => ipcRenderer.removeListener(event, fn);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
