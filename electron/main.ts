import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron';
import path from 'node:path';

interface StreamStartPayload {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface SimpleRequestPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const activeStreams = new Map<string, AbortController>();
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  nativeTheme.themeSource = 'dark';

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 390,
    minHeight: 580,
    backgroundColor: '#171615',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devBase =
      !app.isPackaged && process.env.VITE_DEV_SERVER_URL
        ? process.env.VITE_DEV_SERVER_URL
        : !app.isPackaged && process.argv.includes('--dev')
          ? 'http://localhost:5173'
          : null;
    if (devBase && url.startsWith(devBase)) return;
    if (url.startsWith('file://') && /\/dist\/index\.html([?#]|$)/i.test(url)) return;

    event.preventDefault();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged && process.argv.includes('--dev')) {
    void mainWindow.loadURL('http://localhost:5173');
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('http:stream-start', async (event, payload: StreamStartPayload) => {
  const { requestId, url, method, headers, body } = payload;
  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  try {
    const response = await fetch(url, {
      method: method || 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    const respHeaders: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      respHeaders[k] = v;
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      activeStreams.delete(requestId);
      throw new Error(`HTTP ${response.status}: ${errText || response.statusText}`);
    }

    if (!response.body) {
      activeStreams.delete(requestId);
      throw new Error('响应流为空');
    }

    const sender = event.sender;
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    // Pump stream in background after returning headers
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            const tail = decoder.decode();
            if (tail && !sender.isDestroyed()) {
              sender.send('http:stream-chunk', { requestId, chunk: tail });
            }
            if (!sender.isDestroyed()) {
              sender.send('http:stream-end', { requestId });
            }
            break;
          }
          if (value) {
            const chunk = decoder.decode(value, { stream: true });
            if (chunk && !sender.isDestroyed()) {
              sender.send('http:stream-chunk', { requestId, chunk });
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        if (!sender.isDestroyed()) {
          sender.send('http:stream-error', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        activeStreams.delete(requestId);
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }
    })();

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    };
  } catch (err) {
    activeStreams.delete(requestId);
    throw err;
  }
});

ipcMain.handle('http:stream-abort', (_event, requestId: string) => {
  const ctrl = activeStreams.get(requestId);
  if (ctrl) {
    ctrl.abort();
    activeStreams.delete(requestId);
  }
});

ipcMain.handle('http:simple-request', async (_event, payload: SimpleRequestPayload) => {
  const response = await fetch(payload.url, {
    method: payload.method || 'GET',
    headers: payload.headers,
    body: payload.body,
  });
  const body = await response.text();
  const respHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: respHeaders,
    body,
  };
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
