import { exportFullBackup, importFullBackup } from '@/db/backup';
import { simpleRequest } from '@/services/transport/streamHttp';
import type { AppBackupV1, WebDavSyncSettings } from '@/types/settings';

export interface SyncResult {
  ok: boolean;
  message: string;
  timestamp: number;
}

export interface SyncProvider {
  testConnection(settings: WebDavSyncSettings): Promise<SyncResult>;
  pushSnapshot(settings: WebDavSyncSettings): Promise<SyncResult>;
  pullSnapshot(settings: WebDavSyncSettings, mode?: 'merge' | 'replace'): Promise<SyncResult>;
}

function getRelativePathSegments(settings: WebDavSyncSettings): string[] {
  const segments = settings.remotePath
    .split('/')
    .map((s) => s.trim())
    .filter((s) => Boolean(s) && s !== '.' && s !== '..');
  return segments.length > 0 ? segments : ['ChatBeauty', 'backup.json'];
}

function buildTargetUrl(settings: WebDavSyncSettings): string {
  const base = settings.endpoint.trim().replace(/\/+$/, '');
  const segments = getRelativePathSegments(settings).map((seg) => encodeURIComponent(seg));
  return `${base}/${segments.join('/')}`;
}

function authHeaders(settings: WebDavSyncSettings): Record<string, string> {
  const token = btoa(unescape(encodeURIComponent(`${settings.username}:${settings.password}`)));
  return {
    Authorization: `Basic ${token}`,
  };
}

/**
 * Ensures every directory segment leading to `remotePath` exists on the WebDAV server,
 * creating missing collections recursively via RFC 4918 `MKCOL`.
 */
export async function ensureRemoteDirectories(
  settings: WebDavSyncSettings,
  forceMkcol = false
): Promise<boolean> {
  const base = settings.endpoint.trim().replace(/\/+$/, '');
  if (!base) return false;

  const segments = getRelativePathSegments(settings);
  const dirSegments = segments.slice(0, -1);
  if (dirSegments.length === 0) return false;

  let createdAny = false;
  let currentUrl = base;
  const headers = authHeaders(settings);

  for (const seg of dirSegments) {
    currentUrl = `${currentUrl}/${encodeURIComponent(seg)}`;

    if (!forceMkcol) {
      const probe = await simpleRequest({
        url: `${currentUrl}/`,
        method: 'PROPFIND',
        headers: {
          ...headers,
          Depth: '0',
        },
      });
      if (probe.status === 401 || probe.status === 403) {
        throw new Error(`WebDAV 认证失败 (HTTP ${probe.status})，请检查用户名或应用专用密码`);
      }
      if (probe.status >= 200 && probe.status < 300) {
        continue;
      }
    }

    let mkRes = await simpleRequest({
      url: `${currentUrl}/`,
      method: 'MKCOL',
      headers,
    });

    if (
      mkRes.status === 301 ||
      mkRes.status === 302 ||
      mkRes.status === 307 ||
      mkRes.status === 308 ||
      mkRes.status === 400
    ) {
      mkRes = await simpleRequest({
        url: currentUrl,
        method: 'MKCOL',
        headers,
      });
    }

    if (mkRes.status === 401 || mkRes.status === 403) {
      throw new Error(`WebDAV 创建目录认证失败 (HTTP ${mkRes.status})`);
    }
    if (mkRes.status === 200 || mkRes.status === 201 || mkRes.status === 204) {
      createdAny = true;
      continue;
    }
    // 405 Method Not Allowed on MKCOL indicates the collection already exists per RFC 4918
    if (mkRes.status === 405) {
      continue;
    }

    throw new Error(`自动创建远端目录 ${currentUrl} 失败 (HTTP ${mkRes.status})`);
  }

  return createdAny;
}

/**
 * WebDAV sync foundation — uses native simpleRequest (Electron IPC / Android NativeStream)
 * to avoid browser CORS restrictions when communicating with Nextcloud / Alist / Nutstore.
 */
export class WebDavSyncService implements SyncProvider {
  async testConnection(settings: WebDavSyncSettings): Promise<SyncResult> {
    if (!settings.endpoint.trim()) {
      return { ok: false, message: '请先填写 WebDAV 服务器地址', timestamp: Date.now() };
    }
    try {
      const res = await simpleRequest({
        url: settings.endpoint.trim(),
        method: 'PROPFIND',
        headers: {
          ...authHeaders(settings),
          Depth: '0',
        },
      });
      if (res.status >= 200 && res.status < 300) {
        const created = await ensureRemoteDirectories(settings);
        return {
          ok: true,
          message: created ? '连接成功，已自动创建远端目录' : `连接成功 (HTTP ${res.status})`,
          timestamp: Date.now(),
        };
      }
      return { ok: false, message: `服务器返回异常状态 HTTP ${res.status}`, timestamp: Date.now() };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'WebDAV 连接失败',
        timestamp: Date.now(),
      };
    }
  }

  async pushSnapshot(settings: WebDavSyncSettings): Promise<SyncResult> {
    if (!settings.endpoint.trim()) {
      return { ok: false, message: '请先配置 WebDAV 地址', timestamp: Date.now() };
    }
    try {
      await ensureRemoteDirectories(settings);

      const snapshot = await exportFullBackup();
      const targetUrl = buildTargetUrl(settings);
      const putHeaders = {
        ...authHeaders(settings),
        'Content-Type': 'application/json; charset=utf-8',
      };
      const body = JSON.stringify(snapshot);

      let res = await simpleRequest({
        url: targetUrl,
        method: 'PUT',
        headers: putHeaders,
        body,
      });

      if (res.status === 404 || res.status === 409) {
        await ensureRemoteDirectories(settings, true);
        res = await simpleRequest({
          url: targetUrl,
          method: 'PUT',
          headers: putHeaders,
          body,
        });
      }

      if (res.status >= 200 && res.status < 300) {
        return { ok: true, message: '已上传备份到 WebDAV', timestamp: Date.now() };
      }
      return { ok: false, message: `上传失败 (HTTP ${res.status})`, timestamp: Date.now() };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '上传过程发生错误',
        timestamp: Date.now(),
      };
    }
  }

  async pullSnapshot(
    settings: WebDavSyncSettings,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<SyncResult> {
    if (!settings.endpoint.trim()) {
      return { ok: false, message: '请先配置 WebDAV 地址', timestamp: Date.now() };
    }
    try {
      const res = await simpleRequest({
        url: buildTargetUrl(settings),
        method: 'GET',
        headers: authHeaders(settings),
      });
      if (res.status === 404) {
        const ensured = await ensureRemoteDirectories(settings).catch(() => null);
        return {
          ok: false,
          message:
            ensured !== null
              ? '云端尚无备份文件（已自动创建/确认远端目录），请先点击「上传到云端」'
              : '云端尚无备份文件，请检查远端目录权限后点击「上传到云端」',
          timestamp: Date.now(),
        };
      }
      if (res.status < 200 || res.status >= 300) {
        return { ok: false, message: `拉取失败 (HTTP ${res.status})`, timestamp: Date.now() };
      }
      const parsed = JSON.parse(res.body) as AppBackupV1;
      await importFullBackup(parsed, mode);
      return { ok: true, message: '已从 WebDAV 拉取并同步本地数据', timestamp: Date.now() };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : '拉取或解析备份失败',
        timestamp: Date.now(),
      };
    }
  }
}

export const webDavSync = new WebDavSyncService();
