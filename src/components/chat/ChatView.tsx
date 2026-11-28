import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDown, BatteryCharging } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getModelDisplayName } from '@/services/llm/adapters/shared';
import { getRuntimeEnvironment, openAndroidBatterySettings } from '@/services/transport/streamHttp';
import { useAndroidBatteryStatus } from '@/hooks/useAndroidBatteryStatus';
import type { ContentPart, Message, ModelDefinition } from '@/types/chat';
import type { ResolvedTheme } from '@/components/renderer/svgUtils';
import type { LightboxPayload } from '@/components/renderer/LightboxModal';
import type { SettingsTabKey } from '@/components/settings/SettingsModal';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { usePresence } from '@/components/ui/MotionPrimitives';

interface ChatViewProps {
  theme: ResolvedTheme;
  onInspect: (payload: LightboxPayload) => void;
  onOpenSettings: (tab?: SettingsTabKey) => void;
}

const EMPTY_MESSAGES: Message[] = [];

const STARTER_PROMPTS = [
  '请分步推导傅里叶变换的直觉意义，并用 SVG 绘制时域与频域对照图',
  '用两个半加器和一个或门设计一位全加器，写出布尔代数推导并画电路图',
  '推导吉布斯自由能 ΔG = ΔH - TΔS 判断反应自发性的条件，并举化学反应例子',
  '用 html-preview 做一个可调参数的简谐振动合成交互演示',
];

export const ChatView: React.FC<ChatViewProps> = ({ theme, onInspect, onOpenSettings }) => {
  const activeConversationId = useAppStore((s) => s.activeConversationId);
  const activeConv = useAppStore((s) =>
    s.activeConversationId
      ? s.conversations.find((c) => c.id === s.activeConversationId)
      : undefined
  );
  const messages = useAppStore((s) =>
    s.activeConversationId ? s.messagesByConv[s.activeConversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  );
  const isStreaming = useAppStore((s) =>
    Boolean(
      s.activeConversationId &&
        (s.abortControllers[s.activeConversationId] || s.streamingByConv[s.activeConversationId])
    )
  );
  const isCompacting = useAppStore((s) =>
    Boolean(s.activeConversationId && s.compactingByConv[s.activeConversationId])
  );
  const {
    providers,
    appearance,
    memoryNotice,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    editAndResend,
    deleteMessage,
    updateAppearance,
    clearMemoryNotice,
  } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      appearance: s.appearance,
      memoryNotice: s.memoryNotice,
      sendMessage: s.sendMessage,
      stopStreaming: s.stopStreaming,
      regenerateMessage: s.regenerateMessage,
      editAndResend: s.editAndResend,
      deleteMessage: s.deleteMessage,
      updateAppearance: s.updateAppearance,
      clearMemoryNotice: s.clearMemoryNotice,
    }))
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoFollowRef = useRef(true);
  const isProgrammaticScrollRef = useRef(false);
  const smoothScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollBtnPresence = usePresence(showScrollBottom, 180);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const shouldCheckBattery =
    getRuntimeEnvironment() === 'capacitor' &&
    (appearance.backgroundGeneration ?? true) &&
    !appearance.androidBatteryPromptDismissed;
  const batteryStatus = useAndroidBatteryStatus(shouldCheckBattery);
  const showBatteryPrompt = shouldCheckBattery && batteryStatus.supported && !batteryStatus.ignoring;

  useEffect(() => {
    return () => {
      if (smoothScrollTimerRef.current) clearTimeout(smoothScrollTimerRef.current);
    };
  }, []);

  const hasConfiguredProvider = useMemo(
    () => providers.some((p) => p.apiKey.trim().length > 0),
    [providers]
  );

  const modelLookup = useMemo(() => {
    const byProviderAndModel = new Map<string, ModelDefinition>();
    const byModel = new Map<string, ModelDefinition>();
    for (const p of providers) {
      for (const m of p.models) {
        byProviderAndModel.set(`${p.id}\0${m.id}`, m);
        if (!byModel.has(m.id)) {
          byModel.set(m.id, m);
        }
      }
    }
    return { byProviderAndModel, byModel };
  }, [providers]);

  const scrollRafRef = useRef<number | null>(null);
  const scheduleAutoScroll = useCallback(() => {
    if (!autoFollowRef.current) return;
    if (scrollRafRef.current !== null) return;
    const run = () => {
      scrollRafRef.current = null;
      if (!autoFollowRef.current) return;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    if (typeof requestAnimationFrame === 'function') {
      scrollRafRef.current = requestAnimationFrame(run);
    } else {
      run();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    if (smoothScrollTimerRef.current) {
      clearTimeout(smoothScrollTimerRef.current);
      smoothScrollTimerRef.current = null;
    }
    if (behavior === 'smooth') {
      isProgrammaticScrollRef.current = true;
      smoothScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
        smoothScrollTimerRef.current = null;
      }, 450);
    } else {
      isProgrammaticScrollRef.current = false;
    }
    el.scrollTo({ top: el.scrollHeight, behavior });
    autoFollowRef.current = true;
    setShowScrollBottom(false);
  };

  useEffect(() => {
    autoFollowRef.current = true;
    isProgrammaticScrollRef.current = false;
    setShowScrollBottom(false);
    scheduleAutoScroll();
  }, [activeConversationId, scheduleAutoScroll]);

  useEffect(() => {
    scheduleAutoScroll();
  }, [messages.length, scheduleAutoScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    const contentEl = contentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      scheduleAutoScroll();
    });
    observer.observe(el);
    if (contentEl) {
      observer.observe(contentEl);
    }
    return () => observer.disconnect();
  }, [activeConversationId, scheduleAutoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 90;
    if (isProgrammaticScrollRef.current) {
      if (nearBottom) {
        isProgrammaticScrollRef.current = false;
        if (smoothScrollTimerRef.current) {
          clearTimeout(smoothScrollTimerRef.current);
          smoothScrollTimerRef.current = null;
        }
        setShowScrollBottom(false);
      }
      return;
    }
    autoFollowRef.current = nearBottom;
    setShowScrollBottom(!nearBottom && el.scrollHeight > el.clientHeight + 120);
  };

  const dispatchSend = useCallback(
    async (text: string, images?: Array<Extract<ContentPart, { type: 'image' }>>) => {
      setErrorBanner(null);
      autoFollowRef.current = true;
      try {
        await sendMessage(text, images);
      } catch (err) {
        if (err instanceof Error && err.message === 'NO_PROVIDER_CONFIGURED') {
          setErrorBanner('尚未配置可用的模型 API Key，请先在设置中添加模型供应商。');
          onOpenSettings('providers');
        } else {
          setErrorBanner(err instanceof Error ? err.message : '发送失败');
        }
      }
    },
    [sendMessage, onOpenSettings]
  );

  const handleRegenerate = useCallback(
    (id: string) => {
      void regenerateMessage(id).catch((e) => {
        if (e instanceof Error && e.message === 'NO_PROVIDER_CONFIGURED') {
          onOpenSettings('providers');
        } else if (e instanceof Error) {
          setErrorBanner(e.message);
        }
      });
    },
    [regenerateMessage, onOpenSettings]
  );

  const handleEditResend = useCallback(
    (id: string, newText: string) => {
      void editAndResend(id, newText).catch((e) => {
        if (e instanceof Error && e.message === 'NO_PROVIDER_CONFIGURED') {
          onOpenSettings('providers');
        } else if (e instanceof Error) {
          setErrorBanner(e.message);
        }
      });
    },
    [editAndResend, onOpenSettings]
  );

  const handleDeleteMessage = useCallback(
    (id: string) => {
      void deleteMessage(id);
    },
    [deleteMessage]
  );

  const handleComposerSend = useCallback(
    (t: string, imgs?: Array<Extract<ContentPart, { type: 'image' }>>) => {
      void dispatchSend(t, imgs);
    },
    [dispatchSend]
  );

  const handleComposerStop = useCallback(() => {
    stopStreaming();
  }, [stopStreaming]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {showBatteryPrompt && (
        <div className="cb-panel-enter mx-4 mt-2 px-3.5 py-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs text-fg flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BatteryCharging
              className={`w-4 h-4 shrink-0 ${
                theme === 'light' ? 'text-amber-600' : 'text-amber-400'
              }`}
            />
            <span>
              手机端后台生成建议：请将 ChatBeauty 设为「后台无限制 / 忽略电池优化」，防止切换应用或息屏时中断回答
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void openAndroidBatterySettings()}
              className="px-2.5 py-1 rounded-lg bg-accent text-accentfg font-semibold"
            >
              去设置
            </button>
            <button
              type="button"
              onClick={() => {
                void updateAppearance({ androidBatteryPromptDismissed: true });
              }}
              className="px-2 py-1 rounded-lg border border-borderc text-muted hover:text-fg"
            >
              不再提示
            </button>
          </div>
        </div>
      )}

      {memoryNotice && (
        <div className="cb-panel-enter mx-4 mt-2 px-3.5 py-2 rounded-xl border border-accent/35 bg-accent/10 text-xs text-fg flex items-center justify-between gap-2">
          <span>{memoryNotice}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                clearMemoryNotice();
                onOpenSettings('memory');
              }}
              className="text-accent font-medium underline"
            >
              管理记忆
            </button>
            <button
              type="button"
              onClick={clearMemoryNotice}
              className="text-muted hover:text-fg"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {isCompacting && (
        <div className="cb-panel-enter mx-4 mt-2 px-3.5 py-2 rounded-xl border border-borderc bg-surface/90 text-xs text-muted flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
          <span>正在自动摘要并压缩较早对话上下文，界面历史将完整保留…</span>
        </div>
      )}

      {errorBanner && (
        <div
          className={`cb-panel-enter mx-4 mt-2 px-3.5 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs flex items-center justify-between gap-2 ${
            theme === 'light' ? 'text-amber-800' : 'text-amber-200'
          }`}
        >
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className={`underline shrink-0 ${
              theme === 'light' ? 'text-amber-800' : 'text-amber-200'
            }`}
          >
            关闭
          </button>
        </div>
      )}

      {/* Message viewport wrapper so scroll button tracks composer height automatically */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* Scrollbar-free Message Stream */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto overscroll-y-contain touch-pan-y no-scrollbar px-4 sm:px-6 pt-3 pb-6"
        >
          <div
            ref={contentRef}
            key={activeConversationId || 'empty'}
            className="cb-panel-enter mx-auto w-full"
            style={{ maxWidth: 'var(--chat-max-width)' }}
          >
            {messages.length === 0 ? (
              <div className="min-h-[60vh] flex flex-col items-center justify-center text-center py-10 space-y-6">
                <div className="space-y-2.5">
                  <h1
                    className="cb-fade-up font-editorial text-3xl sm:text-[34px] font-medium tracking-tight text-fg"
                    style={{ '--stagger-i': 0 } as React.CSSProperties}
                  >
                    有什么可以帮你的？
                  </h1>
                  <p
                    className="cb-fade-up text-sm text-muted max-w-md mx-auto"
                    style={{ '--stagger-i': 1 } as React.CSSProperties}
                  >
                    支持多步数学推导、化学式、矢量图解与交互原理实验。
                  </p>
                </div>

                {!hasConfiguredProvider && (
                  <button
                    type="button"
                    onClick={() => onOpenSettings('providers')}
                    style={{ '--stagger-i': 2 } as React.CSSProperties}
                    className="cb-fade-up px-4 py-2.5 rounded-2xl bg-accent text-accentfg text-sm font-medium shadow-md hover:opacity-95 active:scale-95 transition"
                  >
                    添加模型供应商
                  </button>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl text-left">
                  {STARTER_PROMPTS.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => void dispatchSend(prompt)}
                      style={{ '--stagger-i': idx + 2 } as React.CSSProperties}
                      className="cb-fade-up p-3.5 rounded-2xl border border-borderc bg-surface/55 hover:bg-elevated hover:border-fg/25 hover:-translate-y-0.5 active:scale-[0.99] transition-all duration-200 text-xs sm:text-[13px] text-fg/90 leading-relaxed"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => {
                const msgModelDef = msg.modelId
                  ? (msg.providerId
                      ? modelLookup.byProviderAndModel.get(`${msg.providerId}\0${msg.modelId}`)
                      : undefined) ?? modelLookup.byModel.get(msg.modelId)
                  : undefined;
                const modelDisplayName = msg.modelId
                  ? getModelDisplayName(msgModelDef, msg.modelId)
                  : undefined;
                return (
                <React.Fragment key={msg.id}>
                  <MessageItem
                    message={msg}
                    modelDisplayName={modelDisplayName}
                    theme={theme}
                    appearance={appearance}
                    isConversationStreaming={isStreaming}
                    onInspect={onInspect}
                    onRegenerate={handleRegenerate}
                    onEditResend={handleEditResend}
                    onDelete={handleDeleteMessage}
                  />
                  {activeConv?.compactedUntilMessageId === msg.id && (
                    <div className="my-4 flex items-center gap-3 text-[11px] text-muted/85 select-none">
                      <div className="flex-1 h-px bg-borderc/70" />
                      <span className="px-2.5 py-1 rounded-full bg-surface/80 border border-borderc/70 font-mono text-center">
                        以上 {activeConv.compactedCount ?? '较早'} 条消息已自动压缩为上下文摘要（界面保留完整历史）
                      </span>
                      <div className="flex-1 h-px bg-borderc/70" />
                    </div>
                  )}
                </React.Fragment>
                );
              })
            )}
          </div>
        </div>

        {/* Animated Scroll-to-bottom circular button */}
        {scrollBtnPresence.mounted && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
            <button
              type="button"
              onClick={() => scrollToBottom('smooth')}
              className={`w-9 h-9 rounded-full border border-borderc bg-elevated/90 backdrop-blur-md text-fg shadow-lg flex items-center justify-center hover:bg-surface active:scale-95 transition-colors ${
                scrollBtnPresence.state === 'open'
                  ? 'cb-float-in'
                  : 'cb-float-out pointer-events-none'
              }`}
              aria-label="滚动到底部"
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleComposerSend}
        onStop={handleComposerStop}
        isStreaming={isStreaming}
        onOpenSettings={onOpenSettings}
        onInspect={onInspect}
      />
    </div>
  );
};
