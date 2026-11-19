import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronBridge', {
  platform: process.platform,
  streamFetch: (payload: {
    requestId: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => ipcRenderer.invoke('http:stream-start', payload),

  abortStream: (requestId: string) => ipcRenderer.invoke('http:stream-abort', requestId),

  onStreamChunk: (cb: (data: { requestId: string; chunk: string }) => void) => {
    const handler = (_evt: Electron.IpcRendererEvent, data: { requestId: string; chunk: string }) =>
      cb(data);
    ipcRenderer.on('http:stream-chunk', handler);
    return () => ipcRenderer.removeListener('http:stream-chunk', handler);
  },

  onStreamEnd: (cb: (data: { requestId: string }) => void) => {
    const handler = (_evt: Electron.IpcRendererEvent, data: { requestId: string }) => cb(data);
    ipcRenderer.on('http:stream-end', handler);
    return () => ipcRenderer.removeListener('http:stream-end', handler);
  },

  onStreamError: (cb: (data: { requestId: string; error: string }) => void) => {
    const handler = (_evt: Electron.IpcRendererEvent, data: { requestId: string; error: string }) =>
      cb(data);
    ipcRenderer.on('http:stream-error', handler);
    return () => ipcRenderer.removeListener('http:stream-error', handler);
  },

  simpleRequest: (payload: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => ipcRenderer.invoke('http:simple-request', payload),
});
