import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerSaveBlocker,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs';
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
let tray: Tray | null = null;
let isQuitting = false;
let closeToTrayEnabled = true;
let backgroundGenEnabled = true;
let activeGenerationCount = 0;
let suspendBlockerId: number | null = null;
let trayTipShown = false;

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function updateSuspendBlocker(): void {
  const shouldPreventSuspend = backgroundGenEnabled && activeGenerationCount > 0;
  if (shouldPreventSuspend) {
    if (suspendBlockerId === null || !powerSaveBlocker.isStarted(suspendBlockerId)) {
      suspendBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } else if (suspendBlockerId !== null && powerSaveBlocker.isStarted(suspendBlockerId)) {
    powerSaveBlocker.stop(suspendBlockerId);
    suspendBlockerId = null;
  }
}

function updateTrayAppearance(): void {
  if (!tray) return;
  const tip =
    activeGenerationCount > 0
      ? `ChatBeauty — 正在后台生成（${activeGenerationCount} 个任务）`
      : 'ChatBeauty';
  tray.setToolTip(tip);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 ChatBeauty', click: showMainWindow },
      ...(activeGenerationCount > 0
        ? [{ label: `后台生成中 (${activeGenerationCount})`, enabled: false }]
        : []),
      { type: 'separator' },
      {
        label: '退出程序',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

function ensureTray(): Tray {
  if (tray) return tray;
  const icoPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const pngPath = path.join(__dirname, '..', 'build', 'icon.png');
  let icon = fs.existsSync(icoPath)
    ? nativeImage.createFromPath(icoPath)
    : nativeImage.createEmpty();
  if (icon.isEmpty() && fs.existsSync(pngPath)) {
    icon = nativeImage.createFromPath(pngPath);
  }
  if (!icon.isEmpty() && process.platform === 'win32') {
    icon = icon.resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  updateTrayAppearance();
  return tray;
}

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
      backgroundThrottling: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (closeToTrayEnabled || (backgroundGenEnabled && activeGenerationCount > 0)) {
      event.preventDefault();
      const t = ensureTray();
      mainWindow?.hide();
      if (!trayTipShown && process.platform === 'win32') {
        trayTipShown = true;
        try {
          t.displayBalloon({
            title: 'ChatBeauty 已转入任务栏后台',
            content:
              activeGenerationCount > 0
                ? '当前回复正在后台持续生成，完成后将提醒您。'
                : '可在设置 → 外观排版中调整关闭窗口行为。',
          });
        } catch {
          // Ignore notification balloon failures
        }
      }
    }
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

ipcMain.handle(
  'app:set-background-settings',
  (_event, payload: { closeToTray?: boolean; backgroundGeneration?: boolean }) => {
    if (typeof payload?.closeToTray === 'boolean') {
      closeToTrayEnabled = payload.closeToTray;
    }
    if (typeof payload?.backgroundGeneration === 'boolean') {
      backgroundGenEnabled = payload.backgroundGeneration;
    }
    updateSuspendBlocker();
    if (closeToTrayEnabled) {
      ensureTray();
    } else if (tray && mainWindow?.isVisible() && activeGenerationCount === 0) {
      tray.destroy();
      tray = null;
    }
  }
);

ipcMain.handle('app:set-streaming-state', (_event, count: number) => {
  const prevCount = activeGenerationCount;
  activeGenerationCount = Math.max(0, Number(count) || 0);
  updateSuspendBlocker();
  updateTrayAppearance();
  if (prevCount > 0 && activeGenerationCount === 0 && mainWindow && !mainWindow.isVisible()) {
    try {
      const note = new Notification({
        title: 'ChatBeauty',
        body: '后台回复已生成完成，点击查看结果。',
      });
      note.on('click', showMainWindow);
      note.show();
    } catch {
      // ignore OS notification errors
    }
  }
});

ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(() => {
    createWindow();
    if (closeToTrayEnabled) {
      ensureTray();
    }
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        showMainWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (suspendBlockerId !== null && powerSaveBlocker.isStarted(suspendBlockerId)) {
    powerSaveBlocker.stop(suspendBlockerId);
    suspendBlockerId = null;
  }
  tray?.destroy();
  tray = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !closeToTrayEnabled && isQuitting) {
    app.quit();
  }
});
