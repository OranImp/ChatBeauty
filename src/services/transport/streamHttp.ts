import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface StreamHttpOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  onOpen?: (status: number) => void;
  onChunk: (chunk: string) => void;
}

export interface SimpleHttpOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SimpleHttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export interface ElectronBridge {
  platform: string;
  streamFetch: (payload: {
    requestId: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; statusText: string; headers: Record<string, string> }>;
  abortStream: (requestId: string) => Promise<void>;
  onStreamChunk: (cb: (data: { requestId: string; chunk: string }) => void) => () => void;
  onStreamEnd: (cb: (data: { requestId: string }) => void) => () => void;
  onStreamError: (cb: (data: { requestId: string; error: string }) => void) => () => void;
  simpleRequest: (payload: {
    requestId?: string;
    timeoutMs?: number;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<SimpleHttpResponse>;
  abortSimpleRequest?: (requestId: string) => Promise<void>;
  setBackgroundSettings?: (settings: {
    closeToTray: boolean;
    backgroundGeneration: boolean;
  }) => Promise<void>;
  setStreamingState?: (count: number) => Promise<void>;
  onClipboardImagePaste?: (
    cb: (data: { dataUrl: string; mimeType: string; name: string }) => void
  ) => () => void;
  readMemoryFile?: () => Promise<{ ok: boolean; content: string | null; filePath?: string }>;
  writeMemoryFile?: (
    content: string
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  quitApp?: () => Promise<void>;
}

declare global {
  interface Window {
    electronBridge?: ElectronBridge;
  }
}

interface NativeStreamPlugin {
  startStream(options: {
    requestId: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ status: number }>;
  abortStream(options: { requestId: string }): Promise<void>;
  simpleRequest(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<SimpleHttpResponse>;
  saveAndShareFile(options: {
    filename: string;
    base64: string;
    mimeType?: string;
  }): Promise<void>;
  getBatteryOptimizationStatus(): Promise<{
    ignoring: boolean;
    manufacturer?: string;
    sdkInt?: number;
  }>;
  openBatteryOptimizationSettings(): Promise<void>;
  setBackgroundGenerationState(options: { active: boolean; count: number }): Promise<void>;
  addListener(
    eventName: 'streamChunk',
    listenerFunc: (data: { requestId: string; chunk: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'streamEnd',
    listenerFunc: (data: { requestId: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'streamError',
    listenerFunc: (data: { requestId: string; error: string; status?: number }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeStream = registerPlugin<NativeStreamPlugin>('NativeStream');

function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getRuntimeEnvironment(): 'electron' | 'capacitor' | 'web' {
  if (typeof window !== 'undefined' && window.electronBridge) {
    return 'electron';
  }
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    return 'capacitor';
  }
  return 'web';
}

interface StreamRouterEntry {
  onChunk: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

const electronStreamRoutes = new Map<string, StreamRouterEntry>();
let boundElectronBridge: ElectronBridge | null = null;
let electronUnsubs: Array<() => void> = [];

function ensureElectronStreamDispatcher(bridge: ElectronBridge): void {
  if (boundElectronBridge === bridge) return;
  for (const unsub of electronUnsubs) {
    try {
      unsub();
    } catch {
      // Ignore cleanup errors on stale bridge
    }
  }
  electronUnsubs = [
    bridge.onStreamChunk((data) => {
      electronStreamRoutes.get(data.requestId)?.onChunk(data.chunk);
    }),
    bridge.onStreamEnd((data) => {
      electronStreamRoutes.get(data.requestId)?.onEnd();
    }),
    bridge.onStreamError((data) => {
      electronStreamRoutes.get(data.requestId)?.onError(data.error || '请求失败');
    }),
  ];
  boundElectronBridge = bridge;
}

const capacitorStreamRoutes = new Map<string, StreamRouterEntry>();
let capacitorInitPromise: Promise<void> | null = null;

function ensureCapacitorStreamDispatcher(): Promise<void> {
  if (!capacitorInitPromise) {
    capacitorInitPromise = Promise.all([
      NativeStream.addListener('streamChunk', (data) => {
        capacitorStreamRoutes.get(data.requestId)?.onChunk(data.chunk);
      }),
      NativeStream.addListener('streamEnd', (data) => {
        capacitorStreamRoutes.get(data.requestId)?.onEnd();
      }),
      NativeStream.addListener('streamError', (data) => {
        capacitorStreamRoutes
          .get(data.requestId)
          ?.onError(data.error || `HTTP ${data.status ?? 'Error'}`);
      }),
    ])
      .then(() => undefined)
      .catch((err) => {
        capacitorInitPromise = null;
        throw err;
      });
  }
  return capacitorInitPromise;
}

export async function streamRequest(options: StreamHttpOptions): Promise<void> {
  const { url, method = 'POST', headers = {}, body, signal, onOpen, onChunk } = options;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const env = getRuntimeEnvironment();

  if (env === 'electron' && window.electronBridge) {
    const bridge = window.electronBridge;
    const requestId = createRequestId();
    ensureElectronStreamDispatcher(bridge);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        electronStreamRoutes.delete(requestId);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        void bridge.abortStream(requestId);
        reject(new DOMException('Aborted', 'AbortError'));
      };

      electronStreamRoutes.set(requestId, {
        onChunk: (chunk) => {
          if (settled) return;
          try {
            onChunk(chunk);
          } catch (err) {
            settled = true;
            cleanup();
            void bridge.abortStream(requestId);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onEnd: () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        },
        onError: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(error));
        },
      });

      signal?.addEventListener('abort', onAbort, { once: true });

      bridge
        .streamFetch({ requestId, url, method, headers, body })
        .then((res) => {
          if (settled) return;
          try {
            onOpen?.(res.status);
          } catch (openErr) {
            settled = true;
            cleanup();
            void bridge.abortStream(requestId);
            reject(openErr instanceof Error ? openErr : new Error(String(openErr)));
          }
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
    });
    return;
  }

  if (env === 'capacitor') {
    const requestId = createRequestId();
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        capacitorStreamRoutes.delete(requestId);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        void NativeStream.abortStream({ requestId });
        reject(new DOMException('Aborted', 'AbortError'));
      };

      capacitorStreamRoutes.set(requestId, {
        onChunk: (chunk) => {
          if (settled) return;
          try {
            onChunk(chunk);
          } catch (err) {
            settled = true;
            cleanup();
            void NativeStream.abortStream({ requestId });
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        },
        onEnd: () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        },
        onError: (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(error));
        },
      });

      signal?.addEventListener('abort', onAbort, { once: true });

      ensureCapacitorStreamDispatcher()
        .then(() => {
          if (settled || signal?.aborted) {
            if (!settled) onAbort();
            return;
          }
          return NativeStream.startStream({ requestId, url, method, headers, body }).then((res) => {
            if (settled) return;
            try {
              onOpen?.(res.status);
            } catch (openErr) {
              settled = true;
              cleanup();
              void NativeStream.abortStream({ requestId });
              reject(openErr instanceof Error ? openErr : new Error(String(openErr)));
            }
          });
        })
        .catch((err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
    });
    return;
  }

  // Web browser fallback
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal,
  });
  onOpen?.(response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
  }

  if (!response.body) {
    throw new Error('响应流为空');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let streamDone = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) onChunk(tail);
        streamDone = true;
        break;
      }
      if (value) {
        const text = decoder.decode(value, { stream: true });
        if (text) onChunk(text);
      }
    }
  } finally {
    if (!streamDone) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  onAbortCleanup?: () => void
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    onAbortCleanup?.();
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      onAbortCleanup?.();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export async function simpleRequest(options: SimpleHttpOptions): Promise<SimpleHttpResponse> {
  const { url, method = 'GET', headers = {}, body, timeoutMs, signal } = options;

  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const env = getRuntimeEnvironment();
  if (env === 'electron' && window.electronBridge) {
    const bridge = window.electronBridge;
    const requestId = createRequestId();
    return raceWithAbort(
      bridge.simpleRequest({ requestId, timeoutMs, url, method, headers, body }),
      signal,
      () => {
        void bridge.abortSimpleRequest?.(requestId);
      }
    );
  }
  if (env === 'capacitor') {
    return raceWithAbort(NativeStream.simpleRequest({ url, method, headers, body }), signal);
  }

  const res = await fetch(url, { method, headers, body, signal });
  const text = await res.text();
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  return {
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    body: text,
  };
}

export async function saveNativeFile(options: {
  filename: string;
  base64: string;
  mimeType?: string;
}): Promise<void> {
  if (getRuntimeEnvironment() !== 'capacitor') return;
  await NativeStream.saveAndShareFile(options);
}

export async function syncDesktopBackgroundSettings(settings: {
  closeToTray: boolean;
  backgroundGeneration: boolean;
}): Promise<void> {
  if (typeof window === 'undefined' || !window.electronBridge?.setBackgroundSettings) return;
  await window.electronBridge.setBackgroundSettings(settings).catch(() => undefined);
}

export async function syncBackgroundStreamingState(
  count: number,
  enabled: boolean
): Promise<void> {
  const env = getRuntimeEnvironment();
  const effectiveCount = enabled ? Math.max(0, count) : 0;
  if (env === 'electron' && window.electronBridge?.setStreamingState) {
    await window.electronBridge.setStreamingState(effectiveCount).catch(() => undefined);
    return;
  }
  if (env === 'capacitor') {
    await NativeStream.setBackgroundGenerationState({
      active: effectiveCount > 0,
      count: effectiveCount,
    }).catch(() => undefined);
  }
}

export async function getAndroidBatteryStatus(): Promise<{
  ignoring: boolean;
  manufacturer?: string;
  supported: boolean;
}> {
  if (getRuntimeEnvironment() !== 'capacitor') {
    return { ignoring: true, supported: false };
  }
  try {
    const res = await NativeStream.getBatteryOptimizationStatus();
    return {
      ignoring: Boolean(res.ignoring),
      manufacturer: res.manufacturer,
      supported: true,
    };
  } catch {
    return { ignoring: true, supported: false };
  }
}

export async function openAndroidBatterySettings(): Promise<boolean> {
  if (getRuntimeEnvironment() !== 'capacitor') return false;
  try {
    await NativeStream.openBatteryOptimizationSettings();
    return true;
  } catch {
    return false;
  }
}

export function subscribeDesktopClipboardImagePaste(
  cb: (data: { dataUrl: string; mimeType: string; name: string }) => void
): () => void {
  if (typeof window === 'undefined' || !window.electronBridge?.onClipboardImagePaste) {
    return () => undefined;
  }
  return window.electronBridge.onClipboardImagePaste(cb);
}

export async function readNativeMemoryFile(): Promise<string | null> {
  if (typeof window === 'undefined' || !window.electronBridge?.readMemoryFile) {
    return null;
  }
  try {
    const res = await window.electronBridge.readMemoryFile();
    return res?.ok && typeof res.content === 'string' ? res.content : null;
  } catch {
    return null;
  }
}

export async function writeNativeMemoryFile(content: string): Promise<void> {
  if (typeof window === 'undefined' || !window.electronBridge?.writeMemoryFile) {
    return;
  }
  await window.electronBridge.writeMemoryFile(content).catch(() => undefined);
}
