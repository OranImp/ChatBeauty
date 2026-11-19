import React, { useState } from 'react';
import {
  ChevronDown,
  Download,
  PanelLeft,
  Settings,
  Sparkles,
  SquarePen,
  MoreVertical,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
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
    promptPresets,
    promptSettings,
    createConversation,
    setActiveProviderModel,
    updateConversationConfig,
  } = useAppStore();

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const currentProvider = providers.find(
    (p) => p.id === (activeConv?.providerId || activeProviderId)
  );
  const currentModelId = activeConv?.modelId || activeModelId || currentProvider?.defaultModel;
  const activePresetId = activeConv?.systemPromptPresetId || promptSettings.defaultPresetId;
  const activePreset = promptPresets.find((p) => p.id === activePresetId);
  const renderEnabled =
    activeConv?.enableRenderPrompt !== undefined
      ? activeConv.enableRenderPrompt
      : promptSettings.renderEnhancementEnabled;

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
      {/* Mobile floating capsule bar (inspired by screenshot) */}
      <div className="flex md:hidden items-center justify-between px-3.5 py-2 gap-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="w-10 h-10 rounded-full border border-borderc bg-surface/80 backdrop-blur-xl flex items-center justify-center text-fg shadow-sm active:scale-95 transition"
          aria-label="打开菜单"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
            <line x1="5" y1="9" x2="19" y2="9" />
            <line x1="5" y1="15" x2="14" y2="15" />
          </svg>
        </button>

        {/* Compact Model Pill */}
        <button
          type="button"
          onClick={() => {
            setModelMenuOpen((v) => !v);
            setMoreMenuOpen(false);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-borderc bg-surface/75 backdrop-blur-xl text-xs text-fg max-w-[46vw] truncate shadow-sm"
        >
          <span className="truncate font-medium">
            {currentModelId || '配置模型接口'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
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
            onClick={() => {
              setMoreMenuOpen((v) => !v);
              setModelMenuOpen(false);
            }}
            className="w-10 h-10 flex items-center justify-center text-fg active:bg-white/10 transition"
            aria-label="更多操作"
          >
            <MoreVertical className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>

      {/* Desktop clean header bar */}
      <div className="hidden md:flex items-center justify-between px-4 h-[52px] border-b border-borderc/60 bg-bg/85 backdrop-blur-md">
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

          <button
            type="button"
            onClick={() => {
              setModelMenuOpen((v) => !v);
              setMoreMenuOpen(false);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-surface border border-transparent hover:border-borderc transition text-sm"
          >
            <span className="font-semibold text-fg truncate max-w-[220px]">
              {currentModelId || '尚未配置模型'}
            </span>
            {currentProvider && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-surface-elevated text-muted border border-borderc">
                {PROTOCOL_TEMPLATES[currentProvider.protocol].shortLabel}
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5 text-muted" />
          </button>

          <button
            type="button"
            onClick={() => onOpenSettings('prompts')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-muted hover:text-fg hover:bg-surface transition"
            title="点击修改提示词与渲染协议"
          >
            <Sparkles className={`w-3.5 h-3.5 ${renderEnabled ? 'text-accent' : 'text-muted'}`} />
            <span className="truncate max-w-[140px]">{activePreset?.name || '默认提示词'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
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

      {/* Model & Prompt Quick Switcher Popover */}
      {modelMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setModelMenuOpen(false)}
          />
          <div className="absolute left-3 right-3 md:left-4 md:right-auto md:w-80 top-14 z-40 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl p-3 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs font-semibold text-muted">选择模型接口</span>
              <button
                type="button"
                onClick={() => {
                  setModelMenuOpen(false);
                  onOpenSettings('providers');
                }}
                className="text-xs text-accent hover:underline"
              >
                管理供应商
              </button>
            </div>

            {providers.length === 0 ? (
              <div className="p-3 rounded-xl bg-surface text-xs text-muted text-center space-y-2">
                <p>还没有配置任何大模型接口</p>
                <button
                  type="button"
                  onClick={() => {
                    setModelMenuOpen(false);
                    onOpenSettings('providers');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-accent text-black font-medium"
                >
                  立即添加 OpenAI / Gemini / Claude
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {providers.map((p) => {
                  const modelList =
                    p.models.length > 0
                      ? p.models
                      : p.defaultModel
                        ? [{ id: p.defaultModel, name: p.defaultModel, capabilities: { chat: true } }]
                        : [];
                  return (
                    <div key={p.id} className="space-y-1">
                      <div className="px-1.5 text-[11px] font-medium text-muted flex items-center justify-between">
                        <span>{p.name}</span>
                        <span>{PROTOCOL_TEMPLATES[p.protocol].shortLabel}</span>
                      </div>
                      <div className="space-y-0.5">
                        {modelList.map((m) => {
                          const selected =
                            currentProvider?.id === p.id && currentModelId === m.id;
                          return (
                            <button
                              key={`${p.id}_${m.id}`}
                              type="button"
                              onClick={() => {
                                void setActiveProviderModel(p.id, m.id);
                                setModelMenuOpen(false);
                              }}
                              className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition ${
                                selected
                                  ? 'bg-accent/15 text-accent font-medium'
                                  : 'text-fg hover:bg-white/5'
                              }`}
                            >
                              <span className="truncate">{m.name || m.id}</span>
                              {m.capabilities.reasoning && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-muted ml-2 shrink-0">
                                  思考
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {activeConv && (
              <div className="mt-3 pt-3 border-t border-borderc">
                <div className="flex items-center justify-between mb-1.5 px-1">
                  <span className="text-xs font-semibold text-muted">本会话提示词</span>
                  <button
                    type="button"
                    onClick={() =>
                      void updateConversationConfig(activeConv.id, {
                        enableRenderPrompt: !renderEnabled,
                      })
                    }
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition ${
                      renderEnabled
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-borderc text-muted'
                    }`}
                  >
                    渲染增强 {renderEnabled ? '开' : '关'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {promptPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        void updateConversationConfig(activeConv.id, {
                          systemPromptPresetId: preset.id,
                        });
                      }}
                      className={`px-2 py-1 rounded-lg text-[11px] transition ${
                        activePresetId === preset.id
                          ? 'bg-accent text-black font-medium'
                          : 'bg-surface text-muted hover:text-fg'
                      }`}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Mobile More Menu */}
      {moreMenuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMoreMenuOpen(false)} />
          <div className="absolute right-3.5 top-14 z-40 w-48 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl p-1.5 text-sm">
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('providers');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center gap-2"
            >
              <Settings className="w-4 h-4 text-muted" />
              <span>模型与 API 设置</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('prompts');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-accent" />
              <span>提示词与渲染协议</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMoreMenuOpen(false);
                onOpenSettings('appearance');
              }}
              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center gap-2"
            >
              <span className="w-4 h-4 text-center text-muted">Aa</span>
              <span>外观与排版</span>
            </button>
            {activeConv && (
              <button
                type="button"
                onClick={handleExportMd}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 flex items-center gap-2"
              >
                <Download className="w-4 h-4 text-muted" />
                <span>导出 Markdown</span>
              </button>
            )}
          </div>
        </>
      )}
    </header>
  );
};
