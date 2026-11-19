import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Mic, Plus, Square } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ReasoningEffort } from '@/types/chat';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { usePresence } from '@/components/ui/MotionPrimitives';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
}

const REASONING_OPTIONS: Array<{ value: ReasoningEffort; label: string; desc: string }> = [
  { value: 'off', label: '关闭', desc: '直接输出，不额外开启思考链' },
  { value: 'low', label: '低', desc: '轻量思考，响应更快' },
  { value: 'medium', label: '中', desc: '均衡思考深度与速度' },
  { value: 'high', label: '高', desc: '深度推理，适合复杂推导' },
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  isStreaming,
  onOpenSettings,
}) => {
  const {
    appearance,
    conversations,
    activeConversationId,
    providers,
    activeProviderId,
    activeModelId,
    generation,
    promptPresets,
    promptSettings,
    updateConversationConfig,
    setActiveProviderModel,
    updateGeneration,
  } = useAppStore();

  const [text, setText] = useState('');
  const [activeMenu, setActiveMenu] = useState<'plus' | 'model' | 'reasoning' | null>(null);
  const [renderedMenu, setRenderedMenu] = useState<'plus' | 'model' | 'reasoning' | null>(null);
  const [reservedHint, setReservedHint] = useState<string | null>(null);
  const [renderedHint, setRenderedHint] = useState<string | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const menuPresence = usePresence(activeMenu !== null, 170);
  const hintPresence = usePresence(Boolean(reservedHint), 180);

  useEffect(() => {
    if (!activeMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMenu]);

  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const currentProvider = providers.find(
    (p) => p.id === (activeConv?.providerId || activeProviderId)
  );
  const currentModelId =
    activeConv?.modelId || activeModelId || currentProvider?.defaultModel || '';
  const currentReasoning: ReasoningEffort =
    activeConv?.reasoningEffort ?? generation.reasoningEffort ?? 'medium';

  const renderEnabled =
    activeConv?.enableRenderPrompt !== undefined
      ? activeConv.enableRenderPrompt
      : promptSettings.renderEnhancementEnabled;
  const activePresetId = activeConv?.systemPromptPresetId || promptSettings.defaultPresetId;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const showReservedNotice = (msg: string) => {
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    setRenderedHint(msg);
    setReservedHint(msg);
    hintTimerRef.current = setTimeout(() => setReservedHint(null), 2600);
  };

  const toggleMenu = (target: 'plus' | 'model' | 'reasoning') => {
    setRenderedMenu(target);
    setActiveMenu((m) => (m === target ? null : target));
  };

  const handleSubmit = () => {
    if (isStreaming) {
      onStop();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    onSend(trimmed);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && appearance.sendOnEnter) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const reasoningLabel =
    REASONING_OPTIONS.find((o) => o.value === currentReasoning)?.label ?? '中';

  const popoverPanelWidth =
    renderedMenu === 'model'
      ? 'left-0 w-72 sm:w-80'
      : renderedMenu === 'reasoning'
        ? 'left-12 sm:left-24 w-64'
        : 'left-0 w-72';

  let modelRowIdx = 0;

  return (
    <div className="relative z-20 px-3 sm:px-6 pt-1 pb-2 safe-bottom shrink-0">
      <div className="mx-auto relative" style={{ maxWidth: 'var(--chat-max-width)' }}>
        {hintPresence.mounted && renderedHint && (
          <div
            className={`absolute -top-11 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-elevated border border-borderc text-xs text-fg shadow-lg whitespace-nowrap transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              hintPresence.visible
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 translate-y-1.5 scale-95 pointer-events-none'
            }`}
          >
            {renderedHint}
          </div>
        )}

        {activeMenu && (
          <div className="fixed inset-0 z-20" onClick={() => setActiveMenu(null)} />
        )}

        {/* Animated Popover Menu (Plus / Model Selector / Reasoning Effort) */}
        {menuPresence.mounted && renderedMenu && (
          <div
            className={`absolute ${popoverPanelWidth} bottom-[106px] z-30 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl text-xs origin-bottom-left transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              menuPresence.visible
                ? 'opacity-100 translate-y-0 scale-100'
                : 'opacity-0 translate-y-2.5 scale-[0.96] pointer-events-none'
            }`}
          >
            {renderedMenu === 'plus' && (
              <div className="p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">提示词与渲染协议</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      onOpenSettings('prompts');
                    }}
                    className="text-muted hover:text-fg transition"
                  >
                    编辑预设
                  </button>
                </div>

                {activeConv && (
                  <>
                    <div className="cb-list-item flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface border border-borderc" style={{ '--stagger-i': 0 } as React.CSSProperties}>
                      <span className="text-fg">学术公式与 SVG 渲染增强</span>
                      <ToggleSwitch
                        checked={renderEnabled}
                        onChange={(checked) =>
                          void updateConversationConfig(activeConv.id, {
                            enableRenderPrompt: checked,
                          })
                        }
                        ariaLabel="渲染增强"
                      />
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {promptPresets.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            void updateConversationConfig(activeConv.id, {
                              systemPromptPresetId: p.id,
                            })
                          }
                          style={{ '--stagger-i': idx + 1 } as React.CSSProperties}
                          className={`cb-list-item px-2.5 py-1 rounded-lg active:scale-[0.97] transition ${
                            activePresetId === p.id
                              ? 'bg-accent text-accentfg font-medium'
                              : 'bg-surface text-muted hover:text-fg'
                          }`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div className="pt-2 border-t border-borderc space-y-1">
                  <div className="text-[11px] text-muted px-1">预留扩展接口</div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      showReservedNotice('识图 (Vision) 与图像生成接口已在底层预留');
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-fg/5 active:scale-[0.985] text-muted hover:text-fg transition"
                  >
                    <span>图片识图 / 图像生成</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/5">预留</span>
                  </button>
                </div>
              </div>
            )}

            {renderedMenu === 'model' && (
              <div className="p-3 max-h-[60vh] overflow-y-auto no-scrollbar space-y-2.5">
                <div className="flex items-center justify-between px-1">
                  <span className="font-semibold text-fg">切换模型</span>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      onOpenSettings('providers');
                    }}
                    className="text-muted hover:text-fg transition"
                  >
                    管理供应商
                  </button>
                </div>

                {providers.length === 0 ? (
                  <div className="cb-list-item p-3 rounded-xl bg-surface text-center space-y-2.5">
                    <p className="text-muted">尚未添加任何大模型供应商</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMenu(null);
                        onOpenSettings('providers');
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-accent text-accentfg font-medium active:scale-95 transition"
                    >
                      添加供应商
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
                          <div className="px-1.5 text-[11px] text-muted flex items-center justify-between">
                            <span className="truncate">{p.name}</span>
                            <span className="shrink-0 ml-2 font-mono">
                              {PROTOCOL_TEMPLATES[p.protocol].shortLabel}
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {modelList.map((m) => {
                              const idx = modelRowIdx++;
                              const selected =
                                currentProvider?.id === p.id && currentModelId === m.id;
                              return (
                                <button
                                  key={`${p.id}_${m.id}`}
                                  type="button"
                                  onClick={() => {
                                    void setActiveProviderModel(p.id, m.id);
                                    setActiveMenu(null);
                                  }}
                                  style={{ '--stagger-i': idx } as React.CSSProperties}
                                  className={`cb-list-item w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between active:scale-[0.985] transition ${
                                    selected
                                      ? 'bg-accent text-accentfg font-medium'
                                      : 'text-fg hover:bg-fg/5'
                                  }`}
                                >
                                  <span className="truncate font-mono">{m.name || m.id}</span>
                                  {selected && <span className="text-[10px] ml-2 shrink-0">当前</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {renderedMenu === 'reasoning' && (
              <div className="p-2 space-y-1">
                <div className="px-2 py-1 text-[11px] text-muted font-medium">推理强度</div>
                {REASONING_OPTIONS.map((opt, idx) => {
                  const selected = currentReasoning === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        if (activeConv) {
                          void updateConversationConfig(activeConv.id, {
                            reasoningEffort: opt.value,
                          });
                        }
                        void updateGeneration({ reasoningEffort: opt.value });
                        setActiveMenu(null);
                      }}
                      style={{ '--stagger-i': idx } as React.CSSProperties}
                      className={`cb-list-item w-full text-left px-2.5 py-2 rounded-xl active:scale-[0.985] transition ${
                        selected
                          ? 'bg-accent text-accentfg font-medium'
                          : 'text-fg hover:bg-fg/5'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span>{opt.label}</span>
                        {selected && <span className="text-[10px]">当前</span>}
                      </div>
                      <div
                        className={`text-[11px] mt-0.5 ${
                          selected ? 'opacity-80' : 'text-muted'
                        }`}
                      >
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ChatGPT x Claude Code Scrollbar-free Composer */}
        <div className="rounded-[24px] border border-borderc focus-within:border-fg/25 bg-surface/95 backdrop-blur-xl px-3.5 pt-3 pb-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.32)] transition-colors">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="向 ChatBeauty 提问"
            className="w-full bg-transparent text-[15px] text-fg placeholder:text-muted/80 px-1 resize-none focus:outline-none max-h-[160px] leading-relaxed no-scrollbar"
          />

          <div className="flex items-center justify-between gap-2 mt-2 pt-1">
            {/* Left controls: +, Monospace Model Pill, Reasoning Pill */}
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => toggleMenu('plus')}
                className={`w-8 h-8 rounded-full flex items-center justify-center hover:text-fg hover:bg-fg/10 active:scale-95 shrink-0 transition ${
                  activeMenu === 'plus' ? 'bg-fg/10 text-fg' : 'text-muted'
                }`}
                aria-label="更多能力与提示词"
                aria-expanded={activeMenu === 'plus'}
              >
                <Plus
                  className={`w-[18px] h-[18px] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'plus' ? 'rotate-45 text-fg' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => toggleMenu('model')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-xs font-mono text-fg max-w-[140px] sm:max-w-[210px] transition ${
                  activeMenu === 'model' ? 'border-fg/30 bg-elevated' : 'border-borderc'
                }`}
                title="切换模型"
                aria-expanded={activeMenu === 'model'}
              >
                <span className="truncate">{currentModelId || '选择模型'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'model' ? 'rotate-180 text-fg' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => toggleMenu('reasoning')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-xs text-muted hover:text-fg shrink-0 transition ${
                  activeMenu === 'reasoning' ? 'border-fg/30 bg-elevated text-fg' : 'border-borderc'
                }`}
                title="设置推理强度"
                aria-expanded={activeMenu === 'reasoning'}
              >
                <span>推理</span>
                <span className="font-mono text-fg/90">{reasoningLabel}</span>
                <ChevronDown
                  className={`w-3 h-3 opacity-75 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'reasoning' ? 'rotate-180 opacity-100' : ''
                  }`}
                />
              </button>
            </div>

            {/* Right controls: Shortcut hint + Reserved Mic + Accent Send/Stop */}
            <div className="flex items-center gap-1.5 shrink-0">
              {appearance.sendOnEnter && (
                <span className="hidden md:inline text-[11px] font-mono text-muted/60 pr-1 select-none">
                  Enter 发送
                </span>
              )}
              <button
                type="button"
                onClick={() => showReservedNotice('语音输入 / TTS 合成接口已在底层预留')}
                className="w-8 h-8 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-fg/10 transition"
                title="语音接口（已预留）"
              >
                <Mic className="w-[17px] h-[17px]" />
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!isStreaming && !text.trim()}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
                  isStreaming || text.trim()
                    ? 'bg-accent text-accentfg active:scale-95'
                    : 'bg-fg/10 text-muted cursor-not-allowed'
                }`}
                aria-label={isStreaming ? '停止生成' : '发送'}
              >
                {isStreaming ? (
                  <Square className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <ArrowUp className="w-[18px] h-[18px] stroke-[2.3]" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
