import React, { useEffect, useState } from 'react';
import {
  Download,
  MoreVertical,
  PanelLeft,
  Settings,
  SquarePen,
} from 'lucide-react';
import { resolveValidProviderAndModel, useAppStore } from '@/store/useAppStore';
import { getModelDisplayName, hasCustomModelDisplayName } from '@/services/llm/adapters/shared';
import { exportConversationMarkdown } from '@/db/backup';
import { triggerDownload } from '@/components/renderer/svgUtils';
import type { SettingsTabKey } from '@/components/settings/SettingsModal';
import { usePresence } from '@/components/ui/MotionPrimitives';

interface TopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: (tab?: SettingsTabKey) => void;
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
  const morePresence = usePresence(moreMenuOpen, 170);

  useEffect(() => {
    const onOverlayOpen = (e: Event) => {
      const detail = (e as CustomEvent<string | { source?: string }>).detail;
      const source = typeof detail === 'string' ? detail : detail?.source;
      if (source !== 'topbar-more') {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('cb:overlay-open', onOverlayOpen);
    return () => window.removeEventListener('cb:overlay-open', onOverlayOpen);
  }, []);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreMenuOpen]);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const { provider: headerProvider, modelId: headerModelId } = resolveValidProviderAndModel(
    activeConv,
    providers,
    activeProviderId,
    activeModelId
  );
  const headerModelDef = headerProvider?.models.find((m) => m.id === headerModelId);
  const headerModelLabel = getModelDisplayName(headerModelDef, headerModelId);
  const headerModelHasAlias = hasCustomModelDisplayName(headerModelDef);

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
            <SquarePen className="w-5 h-5" />
          </button>
          <div className="w-px h-4 bg-borderc" />
          <button
            type="button"
            onClick={() => {
              const next = !moreMenuOpen;
              setMoreMenuOpen(next);
              if (next) {
                window.dispatchEvent(
                  new CustomEvent('cb:overlay-open', { detail: { source: 'topbar-more' } })
                );
              }
            }}
            className="w-10 h-10 flex items-center justify-center text-fg active:bg-white/10 transition"
            aria-label="更多操作"
          >
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Desktop clean header bar */}
      <div className="hidden md:flex items-center justify-between gap-3 px-4 h-[52px] border-b border-borderc bg-bg/85 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={onToggleSidebar}
              className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition shrink-0"
              title="展开侧边栏"
            >
              <PanelLeft className="w-[18px] h-[18px]" />
            </button>
          )}
          <span className="text-[15px] font-medium text-fg truncate">
            {activeConv?.title || 'ChatBeauty'}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {headerModelId && (
            <button
              type="button"
              onClick={() => onOpenSettings('providers')}
              className={`flex items-center px-2.5 py-1 rounded-lg border border-borderc bg-surface/60 hover:bg-elevated text-xs text-muted hover:text-fg max-w-[140px] lg:max-w-[210px] truncate transition ${
                headerModelHasAlias ? 'font-sans' : 'font-mono'
              }`}
              title={`管理模型与接口 (${headerModelId})`}
            >
              <span className="truncate">{headerModelLabel}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void createConversation('新对话')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[13px] text-muted hover:text-fg hover:bg-surface transition"
            title="新建对话 (Ctrl+N)"
          >
            <SquarePen className="w-[18px] h-[18px]" />
            <span>新对话</span>
          </button>
          {activeConv && (
            <button
              type="button"
              onClick={handleExportMd}
              className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
              title="导出当前对话为 Markdown"
            >
              <Download className="w-[18px] h-[18px]" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenSettings()}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
            title="设置 (Ctrl+,)"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* Mobile More Menu */}
      {morePresence.mounted && (
        <>
          <div
            className={`fixed inset-0 z-30 ${
              morePresence.state === 'open' ? '' : 'pointer-events-none'
            }`}
            onClick={() => setMoreMenuOpen(false)}
          />
          <div
            className={`absolute right-3.5 top-full mt-1 z-40 w-44 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl p-1.5 text-sm origin-top-right ${
              morePresence.state === 'open'
                ? 'cb-popover-top-in'
                : 'cb-popover-top-out pointer-events-none'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('providers');
              }}
              style={{ '--stagger-i': 0 } as React.CSSProperties}
              className="cb-list-item w-full text-left px-3 py-2 rounded-xl hover:bg-fg/10 active:scale-[0.98] transition"
            >
              模型与接口
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('prompts');
              }}
              style={{ '--stagger-i': 1 } as React.CSSProperties}
              className="cb-list-item w-full text-left px-3 py-2 rounded-xl hover:bg-fg/10 active:scale-[0.98] transition"
            >
              提示词与渲染
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('general');
              }}
              style={{ '--stagger-i': 2 } as React.CSSProperties}
              className="cb-list-item w-full text-left px-3 py-2 rounded-xl hover:bg-fg/10 active:scale-[0.98] transition"
            >
              外观与排版
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('data');
              }}
              style={{ '--stagger-i': 3 } as React.CSSProperties}
              className="cb-list-item w-full text-left px-3 py-2 rounded-xl hover:bg-fg/10 active:scale-[0.98] transition"
            >
              数据与同步
            </button>
            {activeConv && (
              <button
                type="button"
                onClick={handleExportMd}
                style={{ '--stagger-i': 4 } as React.CSSProperties}
                className="cb-list-item w-full text-left px-3 py-2 rounded-xl hover:bg-fg/10 active:scale-[0.98] border-t border-borderc mt-1 pt-2 transition"
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
