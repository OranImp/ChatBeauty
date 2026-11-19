import React, { useMemo, useState } from 'react';
import {
  Check,
  PanelLeftClose,
  Pencil,
  Pin,
  Search,
  Settings,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { Conversation } from '@/types/chat';

interface SidebarProps {
  desktopOpen: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onCollapseDesktop: () => void;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
  searchInputRef?: React.RefObject<HTMLInputElement>;
}

export const Sidebar: React.FC<SidebarProps> = ({
  desktopOpen,
  mobileOpen,
  onCloseMobile,
  onCollapseDesktop,
  onOpenSettings,
  searchInputRef,
}) => {
  const {
    conversations,
    activeConversationId,
    providers,
    activeProviderId,
    activeModelId,
    createConversation,
    selectConversation,
    renameConversation,
    togglePinConversation,
    deleteConversation,
  } = useAppStore();

  const currentProvider = providers.find((p) => p.id === activeProviderId);
  const resolvedModelId = activeModelId || currentProvider?.defaultModel || '';

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const { pinnedList, recentList } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    return {
      pinnedList: list.filter((c) => c.pinned),
      recentList: list.filter((c) => !c.pinned),
    };
  }, [conversations, query]);

  const startRename = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(title);
  };

  const commitRename = async (id: string) => {
    await renameConversation(id, editingTitle);
    setEditingId(null);
  };

  const renderRow = (conv: Conversation) => {
    const active = conv.id === activeConversationId;
    return (
      <div
        key={conv.id}
        onClick={() => {
          if (editingId === conv.id) return;
          void selectConversation(conv.id);
          onCloseMobile();
        }}
        className={`group flex items-center gap-2 px-2.5 py-2 rounded-xl cursor-pointer transition ${
          active
            ? 'bg-elevated text-fg'
            : 'text-muted hover:text-fg hover:bg-fg/[0.04]'
        }`}
      >
        {active && <span className="w-[2.5px] h-4 rounded-full bg-accent shrink-0" />}
        {editingId === conv.id ? (
          <div
            className="flex-1 flex items-center gap-1 min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename(conv.id);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="w-full bg-bg border border-fg/35 rounded px-1.5 py-0.5 text-xs text-fg focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void commitRename(conv.id)}
              className="p-1 text-fg"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <span className="flex-1 text-[13px] truncate">{conv.title}</span>
        )}

        {editingId !== conv.id && (
          <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void togglePinConversation(conv.id);
              }}
              className={`p-1 rounded-md hover:bg-white/10 ${
                conv.pinned ? 'text-fg' : 'text-muted'
              }`}
              title={conv.pinned ? '取消置顶' : '置顶'}
            >
              <Pin className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => startRename(conv.id, conv.title, e)}
              className="p-1 rounded-md text-muted hover:text-fg hover:bg-white/10"
              title="重命名"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void deleteConversation(conv.id);
              }}
              className="p-1 rounded-md text-muted hover:text-rose-400 hover:bg-white/10"
              title="删除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const innerContent = (
    <div className="flex flex-col h-full bg-surface/95 md:bg-surface/65 border-r border-borderc select-none">
      {/* Compact Header */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2 safe-top">
        <span className="font-semibold tracking-tight text-sm text-fg">ChatBeauty</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCollapseDesktop}
            className="hidden md:flex p-1.5 rounded-lg text-muted hover:text-fg hover:bg-fg/10 transition"
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-1.5 rounded-lg text-muted hover:text-fg hover:bg-fg/10 transition"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* New Chat Button (Claude Code Workspace Action) */}
      <div className="px-3 pb-2 space-y-2">
        <button
          type="button"
          onClick={() => {
            void createConversation('新对话');
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-borderc bg-bg/55 hover:bg-elevated text-xs text-fg font-medium transition"
        >
          <span className="flex items-center gap-2">
            <SquarePen className="w-3.5 h-3.5 text-muted" />
            <span>新建对话</span>
          </span>
          <span className="hidden md:inline font-mono text-[10px] text-muted/75">Ctrl+N</span>
        </button>

        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索对话"
            className="w-full pl-8 pr-14 py-1.5 rounded-xl bg-bg/65 border border-borderc text-xs text-fg placeholder:text-muted focus:outline-none focus:border-fg/35"
          />
          <span className="hidden md:inline pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted/65">
            Ctrl+K
          </span>
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-2 py-1 space-y-3">
        {pinnedList.length === 0 && recentList.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">暂无匹配的对话</div>
        ) : (
          <>
            {pinnedList.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-3 py-1 text-[11px] font-medium text-muted/80">置顶</div>
                {pinnedList.map(renderRow)}
              </div>
            )}
            {recentList.length > 0 && (
              <div className="space-y-0.5">
                {pinnedList.length > 0 && (
                  <div className="px-3 py-1 text-[11px] font-medium text-muted/80">最近</div>
                )}
                {recentList.map(renderRow)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer Status & Settings */}
      <div className="p-3 border-t border-borderc safe-bottom">
        <button
          type="button"
          onClick={() => {
            onOpenSettings('providers');
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-bg/60 hover:bg-elevated border border-borderc text-xs transition"
        >
          <span className="flex items-center gap-2 text-fg font-medium shrink-0">
            <Settings className="w-3.5 h-3.5 text-muted" />
            <span>设置</span>
          </span>
          <span className="text-[11px] font-mono text-muted truncate">
            {resolvedModelId || `${providers.length} 个供应商`}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside
        className="hidden md:block shrink-0 transition-all duration-200 overflow-hidden"
        style={{ width: desktopOpen ? 268 : 0 }}
      >
        <div className="w-[268px] h-full">{innerContent}</div>
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-[82vw] max-w-[300px] h-full shadow-2xl">
            {innerContent}
          </div>
        </div>
      )}
    </>
  );
};
