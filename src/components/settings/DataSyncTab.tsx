import React, { useRef, useState } from 'react';
import {
  Cloud,
  Download,
  FileText,
  FolderSync,
  HardDrive,
  KeyRound,
  Loader2,
  Upload,
  Wifi,
} from 'lucide-react';
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
import {
  SettingsCollapsibleRow,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

function formatWebDavHost(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '未配置';
  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed;
  }
}

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
  const [webdavConfigOpen, setWebdavConfigOpen] = useState(() =>
    Boolean(webdav.enabled && !webdav.endpoint.trim())
  );
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
    <div className="space-y-5 text-[13.5px] min-w-0 max-w-full">
      {notice && (
        <div
          className={`cb-panel-enter px-3 py-2 rounded-xl border break-words text-xs ${
            notice.ok
              ? 'border-borderc bg-surface text-fg'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <SettingsSection title="本地数据与备份">
        <SettingsRow
          icon={<HardDrive className="w-4 h-4" />}
          title="全量备份"
          description="导出全部聊天记录、供应商配置与设置到 JSON 文件"
          trailing={
            <button
              type="button"
              onClick={() => void handleExportFull()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 JSON</span>
            </button>
          }
        />

        <SettingsRow
          icon={<Upload className="w-4 h-4" />}
          title="导入本地备份"
          description="支持在保留现有对话基础上合并，或全量覆盖恢复"
          trailing={
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'merge' | 'replace')}
                aria-label="导入模式"
                className="px-2.5 py-1.5 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
              >
                <option value="merge">导入：合并</option>
                <option value="replace">导入：覆盖</option>
              </select>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>导入文件</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleImportFile(e)}
                className="hidden"
              />
            </div>
          }
        />

        {activeConv && (
          <SettingsRow
            icon={<FileText className="w-4 h-4" />}
            title="导出当前对话"
            description={activeConv.title}
            trailing={
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleExportCurrent('md')}
                  className="px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
                >
                  Markdown (.md)
                </button>
                <button
                  type="button"
                  onClick={() => handleExportCurrent('html')}
                  className="px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
                >
                  独立网页 (.html)
                </button>
              </div>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection title="WebDAV 跨端同步">
        <SettingsToggleRow
          icon={<Cloud className="w-4 h-4 text-accent" />}
          title="启用 WebDAV 跨端同步"
          description="支持坚果云、Nextcloud、Alist 在 Windows 与 Android 客户端之间同步"
          checked={webdav.enabled}
          onChange={(checked) => {
            void updateWebDav({ enabled: checked });
            if (checked && !webdav.endpoint.trim()) {
              setWebdavConfigOpen(true);
            }
          }}
          ariaLabel="启用 WebDAV 同步"
        />

        <SettingsCollapsibleRow
          icon={<KeyRound className="w-4 h-4" />}
          title="连接与凭据配置"
          description="设置 WebDAV 服务器地址、账号、应用专用密码与远端路径"
          value={formatWebDavHost(webdav.endpoint)}
          open={webdavConfigOpen}
          onToggle={() => setWebdavConfigOpen((v) => !v)}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
            <label className="space-y-1 sm:col-span-2 min-w-0">
              <span className="text-xs text-muted">WebDAV 服务器地址</span>
              <input
                value={webdav.endpoint}
                onChange={(e) => void updateWebDav({ endpoint: e.target.value })}
                placeholder="https://dav.jianguoyun.com/dav/"
                className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-xs text-fg font-mono focus:outline-none focus:border-fg/40"
              />
            </label>

            <label className="space-y-1 min-w-0">
              <span className="text-xs text-muted">账号</span>
              <input
                value={webdav.username}
                onChange={(e) => void updateWebDav({ username: e.target.value })}
                className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
              />
            </label>

            <label className="space-y-1 min-w-0">
              <span className="text-xs text-muted">应用专用密码</span>
              <input
                type="password"
                value={webdav.password}
                onChange={(e) => void updateWebDav({ password: e.target.value })}
                className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
              />
            </label>

            <label className="space-y-1 sm:col-span-2 min-w-0">
              <span className="text-xs text-muted">远端备份路径</span>
              <input
                value={webdav.remotePath}
                onChange={(e) => void updateWebDav({ remotePath: e.target.value })}
                className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-xs text-fg font-mono focus:outline-none focus:border-fg/40"
              />
            </label>
          </div>
        </SettingsCollapsibleRow>

        <SettingsRow
          icon={<FolderSync className="w-4 h-4" />}
          title="云端同步操作"
          description={
            webdav.lastStatus
              ? `上次：${webdav.lastStatus}${
                  webdav.lastSyncedAt ? ` (${new Date(webdav.lastSyncedAt).toLocaleString()})` : ''
                }`
              : '手动测试连接、上传快照或从云端拉取合并'
          }
          trailing={
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void runWebDavAction('test')}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
              >
                {syncBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
                <span>测试连接</span>
              </button>
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void runWebDavAction('push')}
                className="px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
              >
                上传快照
              </button>
              <button
                type="button"
                disabled={syncBusy}
                onClick={() => void runWebDavAction('pull')}
                className="px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
              >
                拉取合并
              </button>
            </div>
          }
        />
      </SettingsSection>
    </div>
  );
};
