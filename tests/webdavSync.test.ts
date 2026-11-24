import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebDavSyncSettings } from '@/types/settings';

const mockSimpleRequest = vi.fn();
const mockExportFullBackup = vi.fn();
const mockImportFullBackup = vi.fn();

vi.mock('@/services/transport/streamHttp', () => ({
  simpleRequest: (...args: unknown[]) => mockSimpleRequest(...args),
}));

vi.mock('@/db/backup', () => ({
  exportFullBackup: (...args: unknown[]) => mockExportFullBackup(...args),
  importFullBackup: (...args: unknown[]) => mockImportFullBackup(...args),
}));

import { ensureRemoteDirectories, WebDavSyncService } from '@/services/sync/webdavSync';

const baseSettings: WebDavSyncSettings = {
  enabled: true,
  endpoint: 'https://dav.example.com/dav/',
  username: 'alice',
  password: 'secret',
  remotePath: 'ChatBeauty/backup.json',
  autoSync: false,
};

describe('WebDAV Auto-Directory & Sync', () => {
  beforeEach(() => {
    mockSimpleRequest.mockReset();
    mockExportFullBackup.mockReset();
    mockImportFullBackup.mockReset();
    mockExportFullBackup.mockResolvedValue({ version: 1, conversations: [] });
  });

  it('probes missing folder via PROPFIND (404) and creates /ChatBeauty/ via MKCOL (201)', async () => {
    mockSimpleRequest
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' });

    const created = await ensureRemoteDirectories(baseSettings);
    expect(created).toBe(true);
    expect(mockSimpleRequest).toHaveBeenCalledTimes(2);
    expect(mockSimpleRequest.mock.calls[0][0]).toMatchObject({
      url: 'https://dav.example.com/dav/ChatBeauty/',
      method: 'PROPFIND',
    });
    expect(mockSimpleRequest.mock.calls[1][0]).toMatchObject({
      url: 'https://dav.example.com/dav/ChatBeauty/',
      method: 'MKCOL',
    });
  });

  it('creates nested directories sequentially for Sync/ChatBeauty/backup.json', async () => {
    mockSimpleRequest
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' });

    const created = await ensureRemoteDirectories({
      ...baseSettings,
      remotePath: '/Sync/ChatBeauty/backup.json',
    });

    expect(created).toBe(true);
    expect(mockSimpleRequest.mock.calls.map((c) => `${c[0].method}:${c[0].url}`)).toEqual([
      'PROPFIND:https://dav.example.com/dav/Sync/',
      'MKCOL:https://dav.example.com/dav/Sync/',
      'PROPFIND:https://dav.example.com/dav/Sync/ChatBeauty/',
      'MKCOL:https://dav.example.com/dav/Sync/ChatBeauty/',
    ]);
  });

  it('retries MKCOL without trailing slash when server returns 301 or 400', async () => {
    mockSimpleRequest
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 301, statusText: 'Moved', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 400, statusText: 'Bad Request', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' });

    await expect(ensureRemoteDirectories(baseSettings)).resolves.toBe(true);
    expect(mockSimpleRequest.mock.calls[2][0]).toMatchObject({
      url: 'https://dav.example.com/dav/ChatBeauty',
      method: 'MKCOL',
    });

    await expect(ensureRemoteDirectories(baseSettings)).resolves.toBe(true);
    expect(mockSimpleRequest.mock.calls[5][0]).toMatchObject({
      url: 'https://dav.example.com/dav/ChatBeauty',
      method: 'MKCOL',
    });
  });

  it('treats MKCOL 405 (collection already exists) cleanly without throwing', async () => {
    mockSimpleRequest
      .mockResolvedValueOnce({ status: 404, statusText: 'Not Found', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 405, statusText: 'Method Not Allowed', headers: {}, body: '' });

    const created = await ensureRemoteDirectories(baseSettings);
    expect(created).toBe(false);
  });

  it('pushSnapshot recovers from initial PUT 404/409 by forcing MKCOL and retrying PUT', async () => {
    mockSimpleRequest
      // Initial PROPFIND returns 207 (server misleadingly reports parent OK)
      .mockResolvedValueOnce({ status: 207, statusText: 'Multi-Status', headers: {}, body: '' })
      // Initial PUT fails with 409 Conflict (missing collection)
      .mockResolvedValueOnce({ status: 409, statusText: 'Conflict', headers: {}, body: '' })
      // Forced MKCOL creates ChatBeauty
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' })
      // Retried PUT succeeds
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' });

    const service = new WebDavSyncService();
    const res = await service.pushSnapshot(baseSettings);

    expect(res.ok).toBe(true);
    expect(mockSimpleRequest.mock.calls.map((c) => `${c[0].method}:${c[0].url}`)).toEqual([
      'PROPFIND:https://dav.example.com/dav/ChatBeauty/',
      'PUT:https://dav.example.com/dav/ChatBeauty/backup.json',
      'MKCOL:https://dav.example.com/dav/ChatBeauty/',
      'PUT:https://dav.example.com/dav/ChatBeauty/backup.json',
    ]);
  });

  it('normalizes traversal segments (..) / URL-encodes segments and rejects non-2xx in testConnection', async () => {
    mockSimpleRequest
      .mockResolvedValueOnce({ status: 401, statusText: 'Unauthorized', headers: {}, body: '' });

    const service = new WebDavSyncService();
    const failRes = await service.testConnection({
      ...baseSettings,
      remotePath: '/../我的 备份/./snap shot.json',
    });
    expect(failRes.ok).toBe(false);

    mockSimpleRequest
      .mockResolvedValueOnce({ status: 207, statusText: 'Multi-Status', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 207, statusText: 'Multi-Status', headers: {}, body: '' })
      .mockResolvedValueOnce({ status: 201, statusText: 'Created', headers: {}, body: '' });

    const pushRes = await service.pushSnapshot({
      ...baseSettings,
      remotePath: '/../我的 备份/./snap shot.json',
    });
    expect(pushRes.ok).toBe(true);
    expect(mockSimpleRequest.mock.calls.map((c) => `${c[0].method}:${c[0].url}`)).toEqual([
      'PROPFIND:https://dav.example.com/dav/',
      'PROPFIND:https://dav.example.com/dav/%E6%88%91%E7%9A%84%20%E5%A4%87%E4%BB%BD/',
      'PUT:https://dav.example.com/dav/%E6%88%91%E7%9A%84%20%E5%A4%87%E4%BB%BD/snap%20shot.json',
    ]);
  });
});
