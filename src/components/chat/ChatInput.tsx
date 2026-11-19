import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Mic,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { CustomModelParams } from '@/types/chat';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import { usePresence } from '@/components/ui/MotionPrimitives';
import {
  coerceReasoningEffort,
  resolveModelReasoningProfile,
  type ProfileMatchSource,
} from '@/services/llm/modelProfiles';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
}

type ComposerMenu = 'plus' | 'model' | 'reasoning' | 'params';

const SOURCE_LABELS: Record<ProfileMatchSource, string> = {
  'model-override': '模型自定义',
  'custom-rule': '自定义规则',
  'remote-rule': '在线规则',
  builtin: '自动匹配',
  fallback: '默认识别',
};

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
    modelProfileSync,
    updateConversationConfig,
    setActiveProviderModel,
    updateGeneration,
  } = useAppStore();

  const [text, setText] = useState('');
  const [activeMenu, setActiveMenu] = useState<ComposerMenu | null>(null);
  const [renderedMenu, setRenderedMenu] = useState<ComposerMenu | null>(null);
  const [reservedHint, setReservedHint] = useState<string | null>(null);
  const [renderedHint, setRenderedHint] = useState<string | null>(null);
  const [extraJsonText, setExtraJsonText] = useState('{}');
  const [extraJsonError, setExtraJsonError] = useState<string | null>(null);
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
  const currentModelDef = currentProvider?.models.find((m) => m.id === currentModelId);

  const { profile: reasoningProfile, source: profileSource } = resolveModelReasoningProfile({
    modelId: currentModelId,
    protocol: currentProvider?.protocol,
    modelDef: currentModelDef,
    customRules: modelProfileSync.customRules,
    remoteRules: modelProfileSync.remoteRules,
  });

  const effectiveReasoning = coerceReasoningEffort(
    activeConv?.reasoningEffort ?? generation.reasoningEffort,
    reasoningProfile
  );
  const activeLevel = reasoningProfile.levels.find((l) => l.value === effectiveReasoning);

  const renderEnabled =
    activeConv?.enableRenderPrompt !== undefined
      ? activeConv.enableRenderPrompt
      : promptSettings.renderEnhancementEnabled;
  const activePresetId = activeConv?.systemPromptPresetId || promptSettings.defaultPresetId;

  useEffect(() => {
    if (activeMenu === 'params') {
      const src = activeConv ? activeConv.customParams?.extraBody : generation.extraBody;
      setExtraJsonText(src && Object.keys(src).length > 0 ? JSON.stringify(src, null, 2) : '{}');
      setExtraJsonError(null);
    }
  }, [activeMenu, activeConv?.id]);

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

  const toggleMenu = (target: ComposerMenu) => {
    setRenderedMenu(target);
    setActiveMenu((m) => (m === target ? null : target));
  };

  const patchConvParams = (patch: Partial<CustomModelParams>) => {
    if (!activeConv) {
      void updateGeneration({
        ...(patch.temperature !== undefined ? { temperature: patch.temperature } : {}),
        ...(patch.topP !== undefined ? { topP: patch.topP } : {}),
        ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens } : {}),
        ...(patch.extraBody !== undefined ? { extraBody: patch.extraBody } : {}),
      });
      return;
    }
    const next: CustomModelParams = { ...(activeConv.customParams || {}), ...patch };
    void updateConversationConfig(activeConv.id, { customParams: next });
  };

  const handleExtraBodyChange = (raw: string) => {
    setExtraJsonText(raw);
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}') {
      setExtraJsonError(null);
      if (activeConv) {
        const next: CustomModelParams = { ...(activeConv.customParams || {}) };
        delete next.extraBody;
        void updateConversationConfig(activeConv.id, {
          customParams: Object.keys(next).length > 0 ? next : undefined,
        });
      } else {
        void updateGeneration({ extraBody: undefined });
      }
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setExtraJsonError('必须为 JSON 对象，例如 {"stop": ["END"]}');
        return;
      }
      setExtraJsonError(null);
      patchConvParams({ extraBody: parsed as Record<string, unknown> });
    } catch {
      setExtraJsonError('JSON 格式有误，修正后自动生效');
    }
  };

  const handleResetConvParams = () => {
    setExtraJsonText('{}');
    setExtraJsonError(null);
    if (activeConv) {
      void updateConversationConfig(activeConv.id, { customParams: undefined });
    } else {
      void updateGeneration({
        temperature: DEFAULT_GENERATION_SETTINGS.temperature,
        topP: DEFAULT_GENERATION_SETTINGS.topP,
        maxTokens: DEFAULT_GENERATION_SETTINGS.maxTokens,
        extraBody: undefined,
      });
    }
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

  const hasCustomParams = Boolean(
    (activeConv?.customParams && Object.keys(activeConv.customParams).length > 0) ||
      (currentModelDef?.params && Object.keys(currentModelDef.params).length > 0)
  );

  const effectiveTemp =
    activeConv?.customParams?.temperature ??
    currentModelDef?.params?.temperature ??
    generation.temperature;
  const effectiveTopP =
    activeConv?.customParams?.topP ?? currentModelDef?.params?.topP ?? generation.topP;
  const effectiveMaxTokens =
    activeConv?.customParams?.maxTokens ??
    currentModelDef?.params?.maxTokens ??
    generation.maxTokens;
  const effectiveBudget =
    activeConv?.customParams?.thinkingBudget ??
    currentModelDef?.params?.thinkingBudget ??
    activeLevel?.budgetTokens ??
    8192;
  const showBudgetSlider =
    (reasoningProfile.strategy === 'gemini-budget' ||
      reasoningProfile.strategy === 'anthropic-budget') &&
    effectiveReasoning !== 'off';

  const samplingAutoOmitted =
    (reasoningProfile.strategy !== 'none' &&
      effectiveReasoning !== 'off' &&
      reasoningProfile.supportsSamplingWhenThinking === false) ||
    (effectiveReasoning === 'off' && reasoningProfile.supportsSamplingWhenOff === false);

  const popoverPanelWidth =
    renderedMenu === 'model' || renderedMenu === 'params'
      ? 'left-0 w-72 sm:w-80 max-w-[calc(100vw-24px)]'
      : renderedMenu === 'reasoning'
        ? 'left-0 sm:left-24 w-72 max-w-[calc(100vw-24px)]'
        : 'left-0 w-72 max-w-[calc(100vw-24px)]';

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

        {/* Animated Popover Menu (Plus / Model / Reasoning / Custom Params) */}
        {menuPresence.mounted && renderedMenu && (
          <div
            className={`absolute ${popoverPanelWidth} bottom-full mb-2 z-30 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl text-xs origin-bottom-left transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
                    <div
                      className="cb-list-item flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface border border-borderc"
                      style={{ '--stagger-i': 0 } as React.CSSProperties}
                    >
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
                              const { profile: mProf } = resolveModelReasoningProfile({
                                modelId: m.id,
                                protocol: p.protocol,
                                modelDef: m,
                                customRules: modelProfileSync.customRules,
                                remoteRules: modelProfileSync.remoteRules,
                              });
                              return (
                                <button
                                  key={`${p.id}_${m.id}`}
                                  type="button"
                                  onClick={() => {
                                    void setActiveProviderModel(p.id, m.id);
                                    setActiveMenu(null);
                                  }}
                                  style={{ '--stagger-i': idx } as React.CSSProperties}
                                  className={`cb-list-item w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 active:scale-[0.985] transition ${
                                    selected
                                      ? 'bg-accent text-accentfg font-medium'
                                      : 'text-fg hover:bg-fg/5'
                                  }`}
                                >
                                  <span className="truncate font-mono">{m.name || m.id}</span>
                                  <span
                                    className={`text-[10px] shrink-0 ${
                                      selected ? 'opacity-90' : 'text-muted'
                                    }`}
                                  >
                                    {mProf.strategy === 'none'
                                      ? '标准'
                                      : mProf.strategy === 'fixed'
                                        ? '内置思考'
                                        : `${mProf.levels.length} 档思考`}
                                  </span>
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
              <div className="p-2.5 space-y-1.5">
                <div className="px-1.5 py-1 flex items-center justify-between gap-2 border-b border-borderc pb-2">
                  <span className="font-semibold text-fg truncate">
                    {reasoningProfile.familyName}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted shrink-0">
                    {SOURCE_LABELS[profileSource]}
                  </span>
                </div>

                {reasoningProfile.strategy === 'none' ? (
                  <div className="cb-list-item p-2.5 space-y-2.5 text-muted leading-relaxed">
                    <p>当前模型未配备可调思考强度。若这是支持思考的新模型或中转站自定义名称，可在供应商配置中指定思考系列或同步规则库。</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMenu(null);
                        onOpenSettings('providers');
                      }}
                      className="w-full px-3 py-1.5 rounded-xl bg-surface hover:bg-fg/10 border border-borderc text-fg font-medium active:scale-95 transition"
                    >
                      前往设置思考系列 / 更新规则库
                    </button>
                  </div>
                ) : reasoningProfile.strategy === 'fixed' ? (
                  <div className="cb-list-item p-2.5 space-y-2.5 text-muted leading-relaxed">
                    <p>{reasoningProfile.levels[0]?.desc || '模型内置固定思维链推理。'}</p>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveMenu(null);
                        onOpenSettings('providers');
                      }}
                      className="w-full px-3 py-1.5 rounded-xl bg-surface hover:bg-fg/10 border border-borderc text-fg font-medium active:scale-95 transition"
                    >
                      自定义模型系列映射
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {reasoningProfile.levels.map((opt, idx) => {
                      const selected = effectiveReasoning === opt.value;
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
                              selected ? 'opacity-85' : 'text-muted'
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

            {renderedMenu === 'params' && (
              <div className="p-3 max-h-[65vh] overflow-y-auto no-scrollbar space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-fg">当前会话参数覆盖</span>
                  <button
                    type="button"
                    onClick={handleResetConvParams}
                    className="flex items-center gap-1 text-muted hover:text-fg transition"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>恢复默认</span>
                  </button>
                </div>

                <div
                  className="cb-list-item space-y-2.5"
                  style={{ '--stagger-i': 0 } as React.CSSProperties}
                >
                  <label className="block space-y-1">
                    <div className="flex justify-between text-muted">
                      <span>Temperature</span>
                      <span className="font-mono tabular-nums text-fg">
                        {effectiveTemp.toFixed(2)}
                      </span>
                    </div>
                    <SmoothSlider
                      min={0}
                      max={2}
                      decimals={2}
                      value={effectiveTemp}
                      onChange={(val) => patchConvParams({ temperature: val })}
                      ariaLabel="会话 Temperature"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-muted">
                      <span>Top-P</span>
                      <span className="font-mono tabular-nums text-fg">
                        {effectiveTopP.toFixed(2)}
                      </span>
                    </div>
                    <SmoothSlider
                      min={0.05}
                      max={1}
                      decimals={2}
                      value={effectiveTopP}
                      onChange={(val) => patchConvParams({ topP: val })}
                      ariaLabel="会话 Top-P"
                    />
                  </label>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-muted">
                      <span>Max Output Tokens</span>
                      <span className="font-mono tabular-nums text-fg">{effectiveMaxTokens}</span>
                    </div>
                    <SmoothSlider
                      min={256}
                      max={32768}
                      decimals={0}
                      value={effectiveMaxTokens}
                      onChange={(val) => patchConvParams({ maxTokens: val })}
                      ariaLabel="会话 Max Tokens"
                    />
                  </label>

                  {showBudgetSlider && (
                    <label className="block space-y-1">
                      <div className="flex justify-between text-muted">
                        <span>思考预算 Tokens</span>
                        <span className="font-mono tabular-nums text-fg">{effectiveBudget}</span>
                      </div>
                      <SmoothSlider
                        min={1024}
                        max={32768}
                        decimals={0}
                        value={Math.max(1024, effectiveBudget)}
                        onChange={(val) => patchConvParams({ thinkingBudget: val })}
                        ariaLabel="会话思考预算 Tokens"
                      />
                    </label>
                  )}

                  {samplingAutoOmitted && (
                    <p className="text-[11px] text-muted leading-snug">
                      当前模型/思考模式会自动省略 Temperature 与 Top-P 以防请求报错。
                    </p>
                  )}
                </div>

                <div
                  className="cb-list-item space-y-1 pt-2 border-t border-borderc"
                  style={{ '--stagger-i': 1 } as React.CSSProperties}
                >
                  <div className="flex items-center justify-between text-muted">
                    <span>自定义请求体 JSON (extraBody)</span>
                    {extraJsonError && <span className="text-[10px] text-rose-400">格式错误</span>}
                  </div>
                  <textarea
                    rows={3}
                    value={extraJsonText}
                    onChange={(e) => handleExtraBodyChange(e.target.value)}
                    placeholder='{"seed": 42}'
                    className="w-full px-2.5 py-1.5 rounded-xl bg-surface border border-borderc font-mono text-[11px] text-fg focus:outline-none focus:border-fg/40"
                  />
                  {extraJsonError && (
                    <div className="text-[10px] text-rose-400">{extraJsonError}</div>
                  )}
                </div>
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
            {/* Left controls: +, Monospace Model Pill, Dynamic Reasoning Pill, Custom Params Pill */}
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
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-xs font-mono text-fg min-w-0 max-w-[120px] sm:max-w-[175px] lg:max-w-[210px] transition ${
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
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-xs shrink-0 transition ${
                  activeMenu === 'reasoning'
                    ? 'border-fg/30 bg-elevated text-fg'
                    : 'border-borderc text-muted hover:text-fg'
                }`}
                title={`设置推理强度 (${reasoningProfile.familyName})`}
                aria-expanded={activeMenu === 'reasoning'}
              >
                {reasoningProfile.strategy === 'none' ? (
                  <span>无思考</span>
                ) : reasoningProfile.strategy === 'fixed' ? (
                  <span>内置推理</span>
                ) : (
                  <>
                    <span>推理</span>
                    <span className="font-mono text-fg/90">
                      {activeLevel?.label ?? effectiveReasoning}
                    </span>
                  </>
                )}
                <ChevronDown
                  className={`w-3 h-3 opacity-75 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'reasoning' ? 'rotate-180 opacity-100' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => toggleMenu('params')}
                className={`relative w-7 h-7 rounded-full border flex items-center justify-center active:scale-95 shrink-0 transition ${
                  activeMenu === 'params'
                    ? 'border-fg/30 bg-elevated text-fg'
                    : 'border-borderc bg-bg/55 hover:bg-elevated text-muted hover:text-fg'
                }`}
                title="自定义模型参数"
                aria-label="自定义模型参数"
                aria-expanded={activeMenu === 'params'}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {hasCustomParams && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-accent ring-2 ring-surface" />
                )}
              </button>
            </div>

            {/* Right controls: Shortcut hint + Reserved Mic + Accent Send/Stop */}
            <div className="flex items-center gap-1.5 shrink-0">
              {appearance.sendOnEnter && (
                <span className="hidden lg:inline text-[11px] font-mono text-muted/60 pr-1 select-none">
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
