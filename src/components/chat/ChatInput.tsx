import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Brain,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Mic,
  Minimize2,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
  X,
} from 'lucide-react';
import { resolveValidProviderAndModel, useAppStore } from '@/store/useAppStore';
import {
  AttachedImage,
  MAX_ATTACHED_IMAGES,
  prepareImageAttachment,
} from '@/services/media/imageUtils';
import { subscribeDesktopClipboardImagePaste } from '@/services/transport/streamHttp';
import type { ContentPart, Conversation, CustomModelParams, ProviderConfig } from '@/types/chat';
import type { LightboxPayload } from '@/components/renderer/LightboxModal';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import {
  getModelDisplayName,
  hasCustomModelDisplayName,
} from '@/services/llm/adapters/shared';
import {
  computeContextUsageStats,
  estimateTokens,
  selectActiveHistoryMessages,
} from '@/services/llm/contextManager';
import { formatMemoriesForPrompt, retrieveRelevantMemories } from '@/services/memory/memoryEngine';
import { composeSystemPrompt } from '@/services/prompts/presets';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import type { SettingsTabKey } from '@/components/settings/SettingsModal';
import { Collapsible, usePresence } from '@/components/ui/MotionPrimitives';
import {
  coerceReasoningEffort,
  resolveModelReasoningProfile,
  type ProfileMatchSource,
} from '@/services/llm/modelProfiles';

interface ChatInputProps {
  onSend: (text: string, images?: Array<Extract<ContentPart, { type: 'image' }>>) => void;
  onStop: () => void;
  isStreaming: boolean;
  onOpenSettings: (tab?: SettingsTabKey) => void;
  onInspect?: (payload: LightboxPayload) => void;
}

type ComposerMenu = 'plus' | 'model' | 'reasoning' | 'params' | 'context';

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    if (tokens === 1_048_576 || Math.abs(millions - Math.round(millions)) < 0.02) {
      return `${Math.round(millions)}M`;
    }
    return `${Number(millions.toFixed(2))}M`;
  }
  if (tokens >= 100_000) return `${Math.round(tokens / 1000)}K`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

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
  onInspect,
}) => {
  const {
    appearance,
    conversations,
    messagesByConv,
    activeConversationId,
    providers,
    activeProviderId,
    activeModelId,
    generation,
    contextSettings,
    memorySettings,
    memoryEntries,
    compactingByConv,
    promptPresets,
    promptSettings,
    modelProfileSync,
    updateConversationConfig,
    setActiveProviderModel,
    updateGeneration,
    compactConversation,
  } = useAppStore();

  const [text, setText] = useState('');
  const [debouncedDraftText, setDebouncedDraftText] = useState('');
  const [draftBudgetOverridden, setDraftBudgetOverridden] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [activeMenu, setActiveMenu] = useState<ComposerMenu | null>(null);
  const [renderedMenu, setRenderedMenu] = useState<ComposerMenu | null>(null);
  const [reservedHint, setReservedHint] = useState<string | null>(null);
  const [renderedHint, setRenderedHint] = useState<string | null>(null);
  const [compactFeedback, setCompactFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMenuRef = useRef<ComposerMenu | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const menuPresence = usePresence(activeMenu !== null, 170);
  const hintPresence = usePresence(Boolean(reservedHint), 180);

  if (activeMenu && renderedMenu !== activeMenu) {
    setRenderedMenu(activeMenu);
  }
  if (reservedHint && renderedHint !== reservedHint) {
    setRenderedHint(reservedHint);
  }

  const closeAllMenus = () => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }
    pendingMenuRef.current = null;
    setActiveMenu(null);
  };

  useEffect(() => {
    if (!activeMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllMenus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeMenu]);

  useEffect(() => {
    const onExternalOverlay = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string }>).detail;
      if (detail?.source !== 'composer') {
        closeAllMenus();
      }
    };
    window.addEventListener('cb:overlay-open', onExternalOverlay);
    return () => {
      window.removeEventListener('cb:overlay-open', onExternalOverlay);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      if (switchTimerRef.current) clearTimeout(switchTimerRef.current);
    };
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const { provider: currentProvider, modelId: currentModelId } =
    resolveValidProviderAndModel(activeConv, providers, activeProviderId, activeModelId);
  const currentModelDef = currentProvider?.models.find((m) => m.id === currentModelId);

  useEffect(() => {
    if (!text.trim()) {
      setDebouncedDraftText('');
      return;
    }
    const timer = setTimeout(() => setDebouncedDraftText(text), 160);
    return () => clearTimeout(timer);
  }, [text]);

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
    setCompactFeedback(null);
    if (activeMenu === target && !pendingMenuRef.current) {
      closeAllMenus();
      return;
    }

    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
      switchTimerRef.current = null;
    }

    if (activeMenu === null) {
      pendingMenuRef.current = null;
      setRenderedMenu(target);
      setActiveMenu(target);
      window.dispatchEvent(new CustomEvent('cb:overlay-open', { detail: { source: 'composer' } }));
      return;
    }

    // Sequential switch: collapse current popover first, then expand the newly selected one
    pendingMenuRef.current = target;
    setActiveMenu(null);
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    switchTimerRef.current = setTimeout(() => {
      switchTimerRef.current = null;
      const next = pendingMenuRef.current;
      pendingMenuRef.current = null;
      if (!next) return;
      setRenderedMenu(next);
      setActiveMenu(next);
      window.dispatchEvent(new CustomEvent('cb:overlay-open', { detail: { source: 'composer' } }));
    }, reduced ? 0 : 145);
  };

  const patchConvParams = (patch: Partial<CustomModelParams>) => {
    if (!activeConv) {
      if (patch.thinkingBudget !== undefined) {
        setDraftBudgetOverridden(true);
      }
      void updateGeneration({
        ...(patch.temperature !== undefined ? { temperature: patch.temperature } : {}),
        ...(patch.topP !== undefined ? { topP: patch.topP } : {}),
        ...(patch.maxTokens !== undefined ? { maxTokens: patch.maxTokens } : {}),
        ...(patch.thinkingBudget !== undefined
          ? { reasoningBudgetTokens: patch.thinkingBudget }
          : {}),
        ...(patch.extraBody !== undefined ? { extraBody: patch.extraBody } : {}),
      });
      return;
    }
    const next: CustomModelParams = { ...(activeConv.customParams || {}), ...patch };
    void updateConversationConfig(activeConv.id, { customParams: next });
  };

  const clearThinkingBudgetOverride = () => {
    if (activeConv) {
      if (activeConv.customParams?.thinkingBudget !== undefined) {
        const nextCustom: CustomModelParams = { ...activeConv.customParams };
        delete nextCustom.thinkingBudget;
        void updateConversationConfig(activeConv.id, {
          customParams: Object.keys(nextCustom).length > 0 ? nextCustom : undefined,
        });
      }
      return;
    }
    setDraftBudgetOverridden(false);
    void updateGeneration({
      reasoningBudgetTokens:
        activeLevel?.budgetTokens ?? DEFAULT_GENERATION_SETTINGS.reasoningBudgetTokens,
    });
  };

  const handleResetConvParams = () => {
    setDraftBudgetOverridden(false);
    if (activeConv) {
      void updateConversationConfig(activeConv.id, { customParams: undefined });
    } else {
      void updateGeneration({
        temperature: DEFAULT_GENERATION_SETTINGS.temperature,
        topP: DEFAULT_GENERATION_SETTINGS.topP,
        maxTokens: DEFAULT_GENERATION_SETTINGS.maxTokens,
        reasoningBudgetTokens: DEFAULT_GENERATION_SETTINGS.reasoningBudgetTokens,
      });
    }
  };

  const addImageFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const imageFiles = incoming.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      setImageError('仅支持图片格式文件 (PNG / JPG / WebP / GIF)');
      return;
    }

    const availableSlots = MAX_ATTACHED_IMAGES - attachedImages.length;
    if (availableSlots <= 0) {
      setImageError(`单条消息最多附加 ${MAX_ATTACHED_IMAGES} 张图片`);
      return;
    }

    setImageError(
      imageFiles.length > availableSlots
        ? `已达到上限，最多附加 ${MAX_ATTACHED_IMAGES} 张图片`
        : null
    );

    const nextBatch: AttachedImage[] = [];
    for (const file of imageFiles.slice(0, availableSlots)) {
      try {
        nextBatch.push(await prepareImageAttachment(file));
      } catch (err) {
        setImageError(err instanceof Error ? err.message : '图片处理失败');
      }
    }

    if (nextBatch.length > 0) {
      setAttachedImages((prev) => [...prev, ...nextBatch].slice(0, MAX_ATTACHED_IMAGES));
    }
  };

  const addImageFilesRef = useRef(addImageFiles);
  addImageFilesRef.current = addImageFiles;

  useEffect(() => {
    return subscribeDesktopClipboardImagePaste((payload) => {
      if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) {
        return;
      }
      void (async () => {
        try {
          const response = await fetch(payload.dataUrl);
          const blob = await response.blob();
          const mimeType = payload.mimeType || blob.type || 'image/png';
          const file = new File([blob], payload.name || 'clipboard.png', { type: mimeType });
          await addImageFilesRef.current([file]);
        } catch {
          setImageError('粘贴剪贴板图片失败');
        }
      })();
    });
  }, []);

  const handleSubmit = () => {
    closeAllMenus();
    if (isStreaming) {
      onStop();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && attachedImages.length === 0) return;
    const imageParts: Array<Extract<ContentPart, { type: 'image' }>> = attachedImages.map(
      (img) => ({
        type: 'image',
        mimeType: img.mimeType,
        dataUrl: img.dataUrl,
        alt: img.name,
      })
    );
    setText('');
    setAttachedImages([]);
    setImageError(null);
    onSend(trimmed, imageParts.length > 0 ? imageParts : undefined);
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && appearance.sendOnEnter) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasCustomParams = Boolean(
    (activeConv?.customParams &&
      (activeConv.customParams.temperature !== undefined ||
        activeConv.customParams.topP !== undefined ||
        activeConv.customParams.maxTokens !== undefined ||
        activeConv.customParams.thinkingBudget !== undefined)) ||
      (currentModelDef?.params && Object.keys(currentModelDef.params).length > 0)
  );
  const currentModelDisplayName = getModelDisplayName(currentModelDef, currentModelId);
  const currentModelHasAlias = hasCustomModelDisplayName(currentModelDef);

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
  const explicitBudgetOverride = activeConv
    ? activeConv.customParams?.thinkingBudget ?? currentModelDef?.params?.thinkingBudget
    : draftBudgetOverridden
      ? generation.reasoningBudgetTokens
      : currentModelDef?.params?.thinkingBudget;
  const hasBudgetOverride = explicitBudgetOverride !== undefined;
  const effectiveBudget =
    explicitBudgetOverride ??
    activeLevel?.budgetTokens ??
    generation.reasoningBudgetTokens ??
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

  const convMessages = activeConv ? messagesByConv[activeConv.id] || [] : [];
  const activeWindowMessagesCount = useMemo(
    () => selectActiveHistoryMessages(convMessages, activeConv?.compactedUntilMessageId).length,
    [convMessages, activeConv?.compactedUntilMessageId]
  );
  const activePresetObj = promptPresets.find((p) => p.id === activePresetId);
  const systemPromptBase = useMemo(
    () =>
      composeSystemPrompt({
        presetContent: activePresetObj?.content,
        customSystemPrompt: activeConv?.customSystemPrompt,
        renderEnabled,
        renderPrompt: promptSettings.renderEnhancementPrompt,
      }),
    [
      activePresetObj?.content,
      activeConv?.customSystemPrompt,
      renderEnabled,
      promptSettings.renderEnhancementPrompt,
    ]
  );

  const relevantMemories = useMemo(
    () =>
      retrieveRelevantMemories(memoryEntries, debouncedDraftText, convMessages, memorySettings),
    [memoryEntries, debouncedDraftText, convMessages, memorySettings]
  );
  const retrievedMemoriesText = useMemo(
    () => formatMemoriesForPrompt(relevantMemories),
    [relevantMemories]
  );

  const baseContextStats = useMemo(
    () =>
      computeContextUsageStats({
        messages: convMessages,
        compactedUntilMessageId: activeConv?.compactedUntilMessageId,
        compactedAt: activeConv?.compactedAt,
        contextSummary: activeConv?.contextSummary,
        systemPromptBase,
        retrievedMemoriesText,
        draftText: '',
        draftImageCount: 0,
        modelId: currentModelId,
        modelDef: currentModelDef,
        contextSettings,
        maxContextMessages: generation.maxContextMessages,
      }),
    [
      convMessages,
      activeConv?.compactedUntilMessageId,
      activeConv?.compactedAt,
      activeConv?.contextSummary,
      systemPromptBase,
      retrievedMemoriesText,
      currentModelId,
      currentModelDef,
      contextSettings,
      generation.maxContextMessages,
    ]
  );

  const contextStats = useMemo(() => {
    const draftTokens = estimateTokens(text) + attachedImages.length * 1024;
    const usedTokens = baseContextStats.usedTokens + draftTokens;
    const ratio =
      baseContextStats.maxTokens > 0 ? Math.min(1, usedTokens / baseContextStats.maxTokens) : 0;
    const percent = Math.min(100, Math.round(ratio * 100));
    const willAutoCompact = Boolean(
      contextSettings.autoCompactEnabled &&
        ratio >= baseContextStats.threshold &&
        activeWindowMessagesCount > contextSettings.keepRecentMessages
    );
    return {
      ...baseContextStats,
      usedTokens,
      draftTokens,
      ratio,
      percent,
      willAutoCompact,
    };
  }, [
    baseContextStats,
    text,
    attachedImages.length,
    contextSettings.autoCompactEnabled,
    contextSettings.keepRecentMessages,
    activeWindowMessagesCount,
  ]);
  const isCompacting = Boolean(activeConv && compactingByConv[activeConv.id]);

  const popoverPanelWidth =
    renderedMenu === 'model' || renderedMenu === 'params'
      ? 'left-0 w-72 sm:w-80 max-w-[calc(100vw-24px)] origin-bottom-left'
      : renderedMenu === 'reasoning'
        ? 'left-0 sm:left-24 w-72 max-w-[calc(100vw-24px)] origin-bottom-left'
        : renderedMenu === 'context'
          ? 'right-0 w-72 sm:w-80 max-w-[calc(100vw-24px)] origin-bottom-right'
          : 'left-0 w-72 max-w-[calc(100vw-24px)] origin-bottom-left';

  let modelRowIdx = 0;

  return (
    <div className="relative z-20 px-2 sm:px-6 pt-1 pb-2 safe-bottom shrink-0">
      <div className="mx-auto relative" style={{ maxWidth: 'var(--chat-max-width)' }}>
        {hintPresence.mounted && renderedHint && (
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div
              className={`px-3 py-1.5 rounded-full bg-elevated border border-borderc text-xs text-fg shadow-lg whitespace-nowrap ${
                hintPresence.state === 'open' ? 'cb-float-in' : 'cb-float-out'
              }`}
            >
              {renderedHint}
            </div>
          </div>
        )}

        {activeMenu && (
          <div className="fixed inset-0 z-20" onClick={() => closeAllMenus()} />
        )}

        {/* Animated Popover Menu (Plus / Model / Reasoning / Custom Params / Context) */}
        {menuPresence.mounted && renderedMenu && (
          <div
            key={renderedMenu}
            className={`absolute ${popoverPanelWidth} bottom-full mb-2 z-40 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl text-xs ${
              menuPresence.state === 'open'
                ? 'cb-popover-in'
                : 'cb-popover-out pointer-events-none'
            }`}
          >
            <div>
            {renderedMenu === 'plus' && (
              <div className="p-3 space-y-3">
                <div className="space-y-1">
                  <div className="text-[11px] text-muted px-1">多模态与图片输入</div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu(null);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface/75 hover:bg-fg/10 border border-borderc/60 active:scale-[0.985] text-fg transition"
                  >
                    <span className="flex items-center gap-2">
                      <ImagePlus className="w-4 h-4 text-accent" />
                      <span>上传图片（识图）</span>
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted">
                      {attachedImages.length > 0
                        ? `已附 ${attachedImages.length}/${MAX_ATTACHED_IMAGES} 张`
                        : `最多 ${MAX_ATTACHED_IMAGES} 张`}
                    </span>
                  </button>
                </div>

                <div className="pt-2 border-t border-borderc space-y-2.5">
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
                </div>
              </div>
            )}

            {renderedMenu === 'model' && (() => {
              const isProviderCollapsed = (p: ProviderConfig) =>
                collapsedProviders[p.id] ?? (providers.length > 2 && p.id !== currentProvider?.id);
              const allCollapsed =
                providers.length > 1 && providers.every((p) => isProviderCollapsed(p));
              const toggleAllProviders = () => {
                const nextVal = !allCollapsed;
                const next: Record<string, boolean> = {};
                for (const p of providers) {
                  next[p.id] = nextVal;
                }
                setCollapsedProviders(next);
              };

              return (
              <div className="p-3 max-h-[60vh] overflow-y-auto no-scrollbar space-y-2.5">
                <div className="flex items-center justify-between gap-2 px-1">
                  <span className="font-semibold text-fg">切换模型</span>
                  <div className="flex items-center gap-2.5">
                    {providers.length > 1 && (
                      <button
                        type="button"
                        onClick={toggleAllProviders}
                        className="text-muted hover:text-fg transition"
                      >
                        {allCollapsed ? '全部展开' : '全部折叠'}
                      </button>
                    )}
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
                  <div className="space-y-2">
                    {providers.map((p) => {
                      const modelList =
                        p.models.length > 0
                          ? p.models
                          : p.defaultModel
                            ? [{ id: p.defaultModel, name: p.defaultModel, capabilities: { chat: true } }]
                            : [];
                      const collapsed = isProviderCollapsed(p);
                      const isCurrentProvider = currentProvider?.id === p.id;
                      return (
                        <div
                          key={p.id}
                          className="rounded-xl border border-borderc/60 bg-surface/35 overflow-hidden"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setCollapsedProviders((prev) => ({ ...prev, [p.id]: !collapsed }))
                            }
                            aria-expanded={!collapsed}
                            className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-[11.5px] text-muted hover:text-fg hover:bg-fg/[0.04] transition"
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              <ChevronRight
                                className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                                  !collapsed ? 'rotate-90 text-fg' : ''
                                }`}
                              />
                              <span className="truncate font-medium text-fg/90">{p.name}</span>
                              {isCurrentProvider && (
                                <span
                                  className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                                  title="当前使用"
                                />
                              )}
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted font-mono shrink-0">
                                {modelList.length}
                              </span>
                            </span>
                            <span className="shrink-0 ml-2 font-mono text-[10px]">
                              {PROTOCOL_TEMPLATES[p.protocol].shortLabel}
                            </span>
                          </button>
                          <Collapsible open={!collapsed}>
                            <div className="px-1.5 pb-1.5 pt-1 border-t border-borderc/40 space-y-0.5">
                              {modelList.map((m) => {
                                const idx = modelRowIdx++;
                                const selected = isCurrentProvider && currentModelId === m.id;
                                const { profile: mProf } = resolveModelReasoningProfile({
                                  modelId: m.id,
                                  protocol: p.protocol,
                                  modelDef: m,
                                  customRules: modelProfileSync.customRules,
                                  remoteRules: modelProfileSync.remoteRules,
                                });
                                const hasAlias = hasCustomModelDisplayName(m);
                                const labelText = getModelDisplayName(m, m.id);
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
                                    <div className="min-w-0 flex-1">
                                      <div
                                        className={`truncate ${
                                          hasAlias ? 'font-sans font-medium' : 'font-mono'
                                        }`}
                                      >
                                        {labelText}
                                      </div>
                                      {hasAlias && (
                                        <div
                                          className={`text-[10px] font-mono truncate ${
                                            selected ? 'opacity-80' : 'text-muted/85'
                                          }`}
                                        >
                                          {m.id}
                                        </div>
                                      )}
                                    </div>
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
                          </Collapsible>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })()}

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
                            setDraftBudgetOverridden(false);
                            if (activeConv) {
                              const patch: Partial<Conversation> = { reasoningEffort: opt.value };
                              if (activeConv.customParams?.thinkingBudget !== undefined) {
                                const nextCustom: CustomModelParams = {
                                  ...activeConv.customParams,
                                };
                                delete nextCustom.thinkingBudget;
                                patch.customParams =
                                  Object.keys(nextCustom).length > 0 ? nextCustom : undefined;
                              }
                              void updateConversationConfig(activeConv.id, patch);
                            }
                            void updateGeneration({
                              reasoningEffort: opt.value,
                              ...(opt.budgetTokens !== undefined
                                ? { reasoningBudgetTokens: opt.budgetTokens }
                                : {}),
                            });
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
                      <div className="flex justify-between items-center text-muted gap-2">
                        <span className="flex items-center gap-1.5">
                          <span>思考预算 Tokens</span>
                          {hasBudgetOverride && (
                            <button
                              type="button"
                              onClick={clearThinkingBudgetOverride}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted hover:text-fg transition"
                            >
                              跟随档位
                            </button>
                          )}
                        </span>
                        <span className="font-mono tabular-nums text-fg">
                          {!hasBudgetOverride && effectiveBudget < 0
                            ? '动态 (-1)'
                            : effectiveBudget}
                        </span>
                      </div>
                      <SmoothSlider
                        min={1024}
                        max={32768}
                        decimals={0}
                        value={
                          effectiveBudget >= 1024
                            ? Math.min(32768, effectiveBudget)
                            : 8192
                        }
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
              </div>
            )}

            {renderedMenu === 'context' && (
              <div className="p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">上下文占用统计</span>
                  <span
                    className={`font-mono text-[11px] px-2 py-0.5 rounded-full ${
                      contextStats.ratio >= contextStats.threshold
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400'
                        : contextStats.ratio >= 0.6
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-surface text-muted'
                    }`}
                  >
                    {contextStats.percent}%
                  </span>
                </div>

                <div className="space-y-1.5">
                  <div className="h-2 rounded-full bg-surface border border-borderc overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        contextStats.ratio >= contextStats.threshold
                          ? 'bg-rose-500'
                          : contextStats.ratio >= 0.6
                            ? 'bg-amber-400'
                            : 'bg-accent'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(2, contextStats.percent))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-muted">
                    <span>
                      {contextStats.usedTokens.toLocaleString()} /{' '}
                      {contextStats.maxTokens.toLocaleString()} tok
                    </span>
                    <span>
                      {contextSettings.autoCompactEnabled
                        ? `阈值 ${Math.round(contextStats.threshold * 100)}%`
                        : '自动压缩关'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-borderc text-[11.5px]">
                  <div className="flex items-center justify-between text-muted">
                    <span>系统提示词</span>
                    <span className="font-mono tabular-nums text-fg">
                      {contextStats.systemTokens.toLocaleString()} tok
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <span>按需记忆注入（{relevantMemories.length} 条）</span>
                    <span className="font-mono tabular-nums text-fg">
                      {contextStats.memoryTokens.toLocaleString()} tok
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <span>早期摘要（已压缩 {contextStats.compactedMessageCount} 条）</span>
                    <span className="font-mono tabular-nums text-fg">
                      {contextStats.summaryTokens.toLocaleString()} tok
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <span>活跃对话（{contextStats.activeMessageCount} 条）</span>
                    <span className="font-mono tabular-nums text-fg">
                      {contextStats.historyTokens.toLocaleString()} tok
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted">
                    <span>当前输入草稿</span>
                    <span className="font-mono tabular-nums text-fg">
                      {contextStats.draftTokens.toLocaleString()} tok
                    </span>
                  </div>
                </div>

                {compactFeedback && (
                  <div
                    className={`px-2.5 py-1.5 rounded-xl border text-[11px] ${
                      compactFeedback.ok
                        ? 'border-borderc bg-surface text-fg'
                        : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {compactFeedback.text}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={
                      !activeConv ||
                      isStreaming ||
                      isCompacting ||
                      activeWindowMessagesCount <= contextSettings.keepRecentMessages
                    }
                    onClick={() => {
                      if (!activeConv) return;
                      void compactConversation(activeConv.id).then((res) =>
                        setCompactFeedback({ ok: res.ok, text: res.message })
                      );
                    }}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-borderc bg-surface hover:bg-bg text-fg disabled:opacity-45 disabled:cursor-not-allowed transition"
                  >
                    {isCompacting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Minimize2 className="w-3.5 h-3.5" />
                    )}
                    <span>{isCompacting ? '压缩中…' : '立即压缩'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeAllMenus();
                      onOpenSettings('generation');
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-accent/15 text-accent font-medium hover:bg-accent/25 transition"
                  >
                    压缩设置
                  </button>
                </div>
              </div>
            )}
            </div>
          </div>
        )}

        {/* ChatGPT x Claude Code Scrollbar-free Composer */}
        <div
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) {
              e.preventDefault();
              setIsDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            setIsDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
              void addImageFiles(e.dataTransfer.files);
            }
          }}
          className={`relative z-30 rounded-[24px] border bg-surface/95 backdrop-blur-xl px-2.5 sm:px-3.5 pt-3 pb-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.32)] transition-colors ${
            isDragOver
              ? 'border-accent ring-2 ring-accent/25'
              : 'border-borderc focus-within:border-fg/25'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void addImageFiles(e.target.files);
              }
              e.target.value = '';
            }}
          />

          {imageError && (
            <div className="cb-panel-enter mb-2 px-3 py-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
              <span>{imageError}</span>
              <button
                type="button"
                onClick={() => setImageError(null)}
                className="p-0.5 text-rose-700 dark:text-rose-200 hover:text-fg"
                aria-label="关闭图片提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {attachedImages.length > 0 && (
            <div className="mb-2.5 space-y-1.5">
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((img, idx) => (
                  <div
                    key={img.id}
                    style={{ '--stagger-i': idx } as React.CSSProperties}
                    className="cb-list-item group relative w-16 h-16 rounded-xl border border-borderc bg-bg/70 overflow-hidden shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onInspect?.({
                          kind: 'image',
                          title: img.name,
                          src: img.dataUrl,
                        })
                      }
                      className="w-full h-full block focus:outline-none"
                      title={`预览 ${img.name}`}
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachedImages((prev) => prev.filter((item) => item.id !== img.id))
                      }
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-bg/85 text-fg border border-borderc flex items-center justify-center opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 transition hover:bg-rose-500 hover:text-white"
                      aria-label={`移除图片 ${img.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
              {currentModelDef?.capabilities?.vision === false && (
                <div className="text-[11px] text-amber-700 dark:text-amber-300/90 px-1">
                  提示：当前选中模型标记为不支持图片输入，发送前建议切换支持 Vision 的模型。
                </div>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (typeof window !== 'undefined') window.scrollTo(0, 0);
            }}
            onPaste={(e) => {
              const items = Array.from(e.clipboardData?.items || []);
              let imageFiles = items
                .filter((it) => it.type.startsWith('image/'))
                .map((it) => it.getAsFile())
                .filter((f): f is File => Boolean(f));
              if (imageFiles.length === 0 && e.clipboardData?.files?.length) {
                imageFiles = Array.from(e.clipboardData.files).filter((f) =>
                  f.type.startsWith('image/')
                );
              }
              if (imageFiles.length > 0) {
                e.preventDefault();
                void addImageFiles(imageFiles);
              }
            }}
            placeholder={
              attachedImages.length > 0 ? '添加图片说明或直接发送（支持粘贴/拖拽图片）' : '向 ChatBeauty 提问'
            }
            className="w-full bg-transparent text-[15px] text-fg placeholder:text-muted/80 px-1 resize-none focus:outline-none max-h-[160px] leading-relaxed no-scrollbar"
          />

          <div className="flex items-center justify-between gap-1 sm:gap-2 mt-2 pt-1 min-w-0">
            {/* Left controls: + (prompts & image upload), Model Pill, Dynamic Reasoning Pill, Custom Params Pill */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => toggleMenu('plus')}
                className={`relative w-[28px] h-[28px] sm:w-8 sm:h-8 rounded-full flex items-center justify-center hover:text-fg hover:bg-fg/10 active:scale-95 shrink-0 transition ${
                  activeMenu === 'plus' ? 'bg-fg/10 text-fg' : 'text-muted'
                }`}
                title="更多能力、提示词与上传图片"
                aria-label="更多能力、提示词与上传图片"
                aria-expanded={activeMenu === 'plus'}
              >
                <Plus
                  className={`w-[18px] h-[18px] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'plus' ? 'rotate-45 text-fg' : ''
                  }`}
                />
                {attachedImages.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accentfg text-[10px] font-semibold flex items-center justify-center">
                    {attachedImages.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => toggleMenu('model')}
                className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-[11px] sm:text-xs text-fg min-w-0 max-w-[78px] sm:max-w-[185px] lg:max-w-[220px] shrink-0 transition ${
                  activeMenu === 'model' ? 'border-fg/30 bg-elevated' : 'border-borderc'
                } ${currentModelHasAlias ? 'font-sans font-medium' : 'font-mono'}`}
                title={currentModelHasAlias ? `切换模型 (${currentModelId})` : '切换模型'}
                aria-expanded={activeMenu === 'model'}
              >
                <span className="truncate">{currentModelDisplayName || '选择模型'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                    activeMenu === 'model' ? 'rotate-180 text-fg' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={() => toggleMenu('reasoning')}
                className={`flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2.5 py-1 rounded-full border bg-bg/55 hover:bg-elevated active:scale-95 text-[11px] sm:text-xs shrink-0 transition ${
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
                    <Brain className="w-3 h-3 sm:hidden shrink-0" />
                    <span className="hidden sm:inline">推理</span>
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
                className={`relative w-[28px] h-[28px] sm:w-7 sm:h-7 rounded-full border flex items-center justify-center active:scale-95 shrink-0 transition ${
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

            {/* Right controls: Shortcut hint + Reserved Mic + Context Ring + Accent Send/Stop */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {appearance.sendOnEnter && (
                <span className="hidden lg:inline text-[11px] font-mono text-muted/60 pr-1 select-none">
                  Enter 发送
                </span>
              )}
              <button
                type="button"
                onClick={() => showReservedNotice('语音输入 / TTS 合成接口已在底层预留')}
                className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center text-muted hover:text-fg hover:bg-fg/10 transition"
                title="语音接口（已预留）"
              >
                <Mic className="w-[17px] h-[17px]" />
              </button>

              {(() => {
                const radius = 10;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference * (1 - Math.min(1, Math.max(0, contextStats.ratio)));
                const ringColor =
                  contextStats.ratio >= contextStats.threshold
                    ? 'text-rose-600 dark:text-rose-400'
                    : contextStats.ratio >= 0.6
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-fg/80';
                return (
                  <button
                    type="button"
                    onClick={() => toggleMenu('context')}
                    className={`relative w-[28px] h-[28px] sm:w-8 sm:h-8 rounded-full flex items-center justify-center active:scale-95 transition shrink-0 ${
                      activeMenu === 'context'
                        ? 'bg-elevated ring-1 ring-borderc'
                        : 'hover:bg-fg/10'
                    }`}
                    title={`上下文占用 ${contextStats.percent}% (${formatCompactTokens(contextStats.usedTokens)} / ${formatCompactTokens(contextStats.maxTokens)})`}
                    aria-label="上下文占用情况"
                    aria-expanded={activeMenu === 'context'}
                  >
                    {isCompacting ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin" />
                    ) : (
                      <svg
                        viewBox="0 0 28 28"
                        className={`w-[22px] h-[22px] sm:w-[24px] sm:h-[24px] -rotate-90 ${ringColor}`}
                        aria-hidden="true"
                      >
                        <circle
                          cx="14"
                          cy="14"
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          strokeOpacity="0.16"
                          strokeWidth="2.6"
                        />
                        <circle
                          cx="14"
                          cy="14"
                          r={radius}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.6"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={offset}
                        />
                      </svg>
                    )}
                  </button>
                );
              })()}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!isStreaming && !text.trim() && attachedImages.length === 0}
                className={`w-[32px] h-[32px] sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition ${
                  isStreaming || text.trim() || attachedImages.length > 0
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
