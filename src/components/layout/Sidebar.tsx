import React, { useMemo, useState } from 'react';
import {
  Check,
  MessageSquare,
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
    createConversation,
    selectConversation,
    renameConversation,
    togglePinConversation,
    deleteConversation,
  } = useAppStore();

  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    const pinned = list.filter((c) => c.pinned);
    const normal = list.filter((c) => !c.pinned);
    return [...pinned, ...normal];
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

  const innerContent = (
    <div className="flex flex-col h-full bg-surface/95 md:bg-surface/65 border-r border-borderc select-none">
      {/* Brand + Actions */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2 safe-top">
        <div className="flex items-center gap-2">
          <img src="./icon.svg" alt="ChatBeaty" className="w-6 h-6 rounded-lg" />
          <span className="font-semibold tracking-tight text-sm text-fg">ChatBeaty</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              void createConversation('新对话');
              onCloseMobile();
            }}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-white/10 transition"
            title="新建对话"
          >
            <SquarePen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCollapseDesktop}
            className="hidden md:flex p-2 rounded-xl text-muted hover:text-fg hover:bg-white/10 transition"
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            className="md:hidden p-2 rounded-xl text-muted hover:text-fg hover:bg-white/10 transition"
            title="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索历史对话…"
            className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-bg/70 border border-borderc text-xs text-fg placeholder:text-muted focus:outline-none focus:border-accent/60"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted">暂无匹配的对话</div>
        ) : (
          filtered.map((conv) => {
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
                    ? 'bg-elevated text-fg border border-borderc'
                    : 'text-muted hover:text-fg hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {conv.pinned ? (
                  <Pin className="w-3.5 h-3.5 text-accent shrink-0" />
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-70" />
                )}

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
                      className="w-full bg-bg border border-accent/60 rounded px-1.5 py-0.5 text-xs text-fg focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void commitRename(conv.id)}
                      className="p-1 text-emerald-400"
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
                        conv.pinned ? 'text-accent' : 'text-muted'
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
          })
        )}
      </div>

      {/* Footer Settings */}
      <div className="p-3 border-t border-borderc/70 safe-bottom">
        <button
          type="button"
          onClick={() => {
            onOpenSettings('providers');
            onCloseMobile();
          }}
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-bg/60 hover:bg-elevated border border-borderc text-xs transition"
        >
          <span className="flex items-center gap-2 text-fg font-medium">
            <Settings className="w-3.5 h-3.5 text-muted" />
            <span>设置与模型接口</span>
          </span>
          <span className="text-[11px] text-muted">{providers.length} 个接口</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside
        className="hidden md:block shrink-0 transition-all duration-200 overflow-hidden"
        style={{ width: desktopOpen ? 272 : 0 }}
      >
        <div className="w-[272px] h-full">{innerContent}</div>
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onCloseMobile}
          />
          <div className="relative z-10 w-[82vw] max-w-[310px] h-full shadow-2xl">
            {innerContent}
          </div>
        </div>
      )}
    </>
  );
};
