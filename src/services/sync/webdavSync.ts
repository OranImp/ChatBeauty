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

function buildTargetUrl(settings: WebDavSyncSettings): string {
  const base = settings.endpoint.trim().replace(/\/+$/, '');
  const rel = settings.remotePath.trim().replace(/^\/+/, '') || 'ChatBeauty/backup.json';
  return `${base}/${rel}`;
}

function buildParentDirUrl(settings: WebDavSyncSettings): string {
  const full = buildTargetUrl(settings);
  const idx = full.lastIndexOf('/');
  return idx > 8 ? full.slice(0, idx) : full;
}

function authHeaders(settings: WebDavSyncSettings): Record<string, string> {
  const token = btoa(unescape(encodeURIComponent(`${settings.username}:${settings.password}`)));
  return {
    Authorization: `Basic ${token}`,
  };
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
      if (res.status >= 200 && res.status < 400) {
        return { ok: true, message: `连接成功 (HTTP ${res.status})`, timestamp: Date.now() };
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
      // Ensure remote folder exists (ignore 405 Method Not Allowed / already exists)
      const dirUrl = buildParentDirUrl(settings);
      await simpleRequest({
        url: dirUrl,
        method: 'MKCOL',
        headers: authHeaders(settings),
      }).catch(() => undefined);

      const snapshot = await exportFullBackup();
      const res = await simpleRequest({
        url: buildTargetUrl(settings),
        method: 'PUT',
        headers: {
          ...authHeaders(settings),
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(snapshot),
      });

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
