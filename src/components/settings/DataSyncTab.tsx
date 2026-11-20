import React, { useRef, useState } from 'react';
import { Download, Loader2, Upload, Wifi } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  exportConversationHtml,
  exportConversationMarkdown,
  exportFullBackup,
  importFullBackup,
} from '@/db/backup';
import { triggerDownload } from '@/components/renderer/svgUtils';
import { webDavSync } from '@/services/sync/webdavSync';
import type { AppBackupV1 } from '@/types/settings';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';

export const DataSyncTab: React.FC = () => {
  const {
    conversations,
    messagesByConv,
    activeConversationId,
    webdav,
    updateWebDav,
    reloadFromDatabase,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  const handleExportFull = async () => {
    const data = await exportFullBackup();
    triggerDownload(
      `ChatBeauty-Backup-${new Date().toISOString().slice(0, 10)}.json`,
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })
    );
    setNotice({ ok: true, text: '已导出全部本地对话、接口与设置备份' });
  };

  const handleImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AppBackupV1;
      await importFullBackup(parsed, importMode);
      await reloadFromDatabase();
      setNotice({
        ok: true,
        text: `已成功导入备份（模式：${importMode === 'merge' ? '合并保留现有' : '全量覆盖'}）`,
      });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : '导入失败' });
    } finally {
      e.target.value = '';
    }
  };

  const handleExportCurrent = (format: 'md' | 'html') => {
    if (!activeConv) return;
    const msgs = messagesByConv[activeConv.id] || [];
    const safeTitle = activeConv.title.replace(/[\\/:*?"<>|]/g, '_');
    if (format === 'md') {
      const md = exportConversationMarkdown(activeConv, msgs);
      triggerDownload(`${safeTitle}.md`, new Blob([md], { type: 'text/markdown;charset=utf-8' }));
    } else {
      const html = exportConversationHtml(activeConv, msgs);
      triggerDownload(`${safeTitle}.html`, new Blob([html], { type: 'text/html;charset=utf-8' }));
    }
  };

  const runWebDavAction = async (action: 'test' | 'push' | 'pull') => {
    setSyncBusy(true);
    setNotice(null);
    try {
      const res =
        action === 'test'
          ? await webDavSync.testConnection(webdav)
          : action === 'push'
            ? await webDavSync.pushSnapshot(webdav)
            : await webDavSync.pullSnapshot(webdav, 'merge');
      if (action === 'pull' && res.ok) {
        await reloadFromDatabase();
      }
      await updateWebDav({ lastSyncedAt: res.timestamp, lastStatus: res.message });
      setNotice({ ok: res.ok, text: res.message });
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-[13.5px]">
      {notice && (
        <div
          className={`px-3 py-2 rounded-xl border ${
            notice.ok
              ? 'border-borderc bg-surface text-fg'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* Local Backup */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-3">
        <div className="font-semibold text-sm text-fg">本地数据管理与导出</div>
        <p className="text-muted">
          所有聊天记录、API 密钥与自定义提示词均默认保存在本机 IndexedDB，支持一键全量 JSON 导入/导出。
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleExportFull()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accentfg font-semibold"
          >
            <Download className="w-4 h-4" />
            <span>导出全量 JSON 备份</span>
          </button>

          <select
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
            className="px-2.5 py-2 rounded-xl bg-bg border border-borderc text-fg"
          >
            <option value="merge">导入模式：合并</option>
            <option value="replace">导入模式：覆盖</option>
          </select>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg"
          >
            <Upload className="w-4 h-4" />
            <span>导入备份文件</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handleImportFile(e)}
            className="hidden"
          />
        </div>

        {activeConv && (
          <div className="pt-3 border-t border-borderc flex flex-wrap items-center gap-2">
            <span className="text-muted">导出当前对话：</span>
            <button
              type="button"
              onClick={() => handleExportCurrent('md')}
              className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg"
            >
              Markdown (.md)
            </button>
            <button
              type="button"
              onClick={() => handleExportCurrent('html')}
              className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg"
            >
              独立网页 (.html)
            </button>
          </div>
        )}
      </div>

      {/* Reserved WebDAV Sync Interface */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-[15px] text-fg">WebDAV 跨端同步</div>
          <div className="flex items-center gap-2">
            <span className="text-muted">启用</span>
            <ToggleSwitch
              checked={webdav.enabled}
              onChange={(checked) => void updateWebDav({ enabled: checked })}
              ariaLabel="启用 WebDAV 同步"
            />
          </div>
        </div>

        <p className="text-muted">
          支持坚果云、Nextcloud、Alist 等标准 WebDAV 服务，可在 Windows 与 Android 客户端之间无缝同步会话与设置。
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-muted">WebDAV 服务器地址</span>
            <input
              value={webdav.endpoint}
              onChange={(e) => void updateWebDav({ endpoint: e.target.value })}
              placeholder="https://dav.jianguoyun.com/dav/"
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono"
            />
          </label>

          <label className="space-y-1">
            <span className="text-muted">账号</span>
            <input
              value={webdav.username}
              onChange={(e) => void updateWebDav({ username: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg"
            />
          </label>

          <label className="space-y-1">
            <span className="text-muted">应用专用密码</span>
            <input
              type="password"
              value={webdav.password}
              onChange={(e) => void updateWebDav({ password: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg"
            />
          </label>

          <label className="space-y-1 sm:col-span-2">
            <span className="text-muted">远端备份路径</span>
            <input
              value={webdav.remotePath}
              onChange={(e) => void updateWebDav({ remotePath: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void runWebDavAction('test')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg disabled:opacity-50"
          >
            {syncBusy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wifi className="w-4 h-4" />
            )}
            <span>测试 WebDAV 连接</span>
          </button>
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void runWebDavAction('push')}
            className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg disabled:opacity-50"
          >
            上传快照到云端
          </button>
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void runWebDavAction('pull')}
            className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg disabled:opacity-50"
          >
            从云端拉取合并
          </button>
        </div>

        {webdav.lastStatus && (
          <div className="text-xs text-muted">
            上次状态：{webdav.lastStatus}
            {webdav.lastSyncedAt ? ` (${new Date(webdav.lastSyncedAt).toLocaleString()})` : ''}
          </div>
        )}
      </div>
    </div>
  );
};
