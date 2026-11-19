import React, { useState } from 'react';
import {
  Download,
  MoreVertical,
  PanelLeft,
  Settings,
  SquarePen,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { exportConversationMarkdown } from '@/db/backup';
import { triggerDownload } from '@/components/renderer/svgUtils';

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  sidebarOpen,
  onToggleSidebar,
  onOpenSettings,
}) => {
  const {
    conversations,
    messagesByConv,
    activeConversationId,
    providers,
    activeProviderId,
    activeModelId,
    createConversation,
  } = useAppStore();

  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const currentProvider = providers.find(
    (p) => p.id === (activeConv?.providerId || activeProviderId)
  );
  const headerModelId =
    activeConv?.modelId || activeModelId || currentProvider?.defaultModel || '';

  const handleExportMd = () => {
    if (!activeConv) return;
    const msgs = messagesByConv[activeConv.id] || [];
    const md = exportConversationMarkdown(activeConv, msgs);
    triggerDownload(
      `${activeConv.title.replace(/[\\/:*?"<>|]/g, '_')}.md`,
      new Blob([md], { type: 'text/markdown;charset=utf-8' })
    );
    setMoreMenuOpen(false);
  };

  return (
    <header className="relative z-30 shrink-0 safe-top">
      {/* Mobile floating capsule bar (ChatGPT-aligned) */}
      <div className="flex md:hidden items-center justify-between px-3.5 py-2 gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="w-10 h-10 rounded-full border border-borderc bg-surface/80 backdrop-blur-xl flex items-center justify-center text-fg shadow-sm active:scale-95 transition"
          aria-label="打开菜单"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
          >
            <line x1="5" y1="9" x2="19" y2="9" />
            <line x1="5" y1="15" x2="14" y2="15" />
          </svg>
        </button>

        {/* Right Dual Pill: New Chat + More */}
        <div className="flex items-center rounded-full border border-borderc bg-surface/80 backdrop-blur-xl shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => void createConversation('新对话')}
            className="w-10 h-10 flex items-center justify-center text-fg active:bg-white/10 transition"
            aria-label="新建对话"
          >
            <SquarePen className="w-[18px] h-[18px]" />
          </button>
          <div className="w-px h-4 bg-borderc" />
          <button
            type="button"
            onClick={() => setMoreMenuOpen((v) => !v)}
            className="w-10 h-10 flex items-center justify-center text-fg active:bg-white/10 transition"
            aria-label="更多操作"
          >
            <MoreVertical className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* Desktop clean header bar */}
      <div className="hidden md:flex items-center justify-between px-4 h-[50px] border-b border-borderc bg-bg/85 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
              title="展开侧边栏"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          <span className="text-sm font-medium text-fg truncate max-w-[42vw]">
            {activeConv?.title || 'ChatBeauty'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {headerModelId && (
            <button
              type="button"
              onClick={() => onOpenSettings('providers')}
              className="hidden lg:flex items-center px-2.5 py-1 rounded-lg border border-borderc bg-surface/60 hover:bg-elevated text-[11px] font-mono text-muted hover:text-fg max-w-[200px] truncate transition"
              title="管理模型与接口"
            >
              <span className="truncate">{headerModelId}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void createConversation('新对话')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs text-muted hover:text-fg hover:bg-surface transition"
            title="新建对话 (Ctrl+N)"
          >
            <SquarePen className="w-4 h-4" />
            <span>新对话</span>
          </button>
          {activeConv && (
            <button
              type="button"
              onClick={handleExportMd}
              className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
              title="导出当前对话为 Markdown"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenSettings('providers')}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
            title="设置 (Ctrl+,)"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile More Menu */}
      {moreMenuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
          <div className="absolute right-3.5 top-14 z-40 w-44 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl p-1.5 text-sm">
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('providers');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10"
            >
              模型与接口
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('prompts');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10"
            >
              提示词与渲染
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('appearance');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10"
            >
              外观与排版
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('data');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10"
            >
              数据与同步
            </button>
            {activeConv && (
              <button
                type="button"
                onClick={handleExportMd}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 border-t border-borderc mt-1 pt-2"
              >
                导出 Markdown
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
};
