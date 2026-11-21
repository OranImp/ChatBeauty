import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, BatteryCharging } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { App as CapApp } from '@capacitor/app';
import {
  getAndroidBatteryStatus,
  getRuntimeEnvironment,
  openAndroidBatterySettings,
} from '@/services/transport/streamHttp';
import type { ContentPart } from '@/types/chat';
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

const STARTER_PROMPTS = [
  '请分步推导傅里叶变换的直觉意义，并用 SVG 绘制时域与频域对照图',
  '用两个半加器和一个或门设计一位全加器，写出布尔代数推导并画电路图',
  '推导吉布斯自由能 ΔG = ΔH - TΔS 判断反应自发性的条件，并举化学反应例子',
  '用 html-preview 做一个可调参数的简谐振动合成交互演示',
];

export const ChatView: React.FC<ChatViewProps> = ({ theme, onInspect, onOpenSettings }) => {
  const {
    conversations,
    messagesByConv,
    activeConversationId,
    providers,
    appearance,
    abortControllers,
    streamingByConv,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    editAndResend,
    deleteMessage,
    updateAppearance,
  } = useAppStore();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoFollowRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollBtnPresence = usePresence(showScrollBottom, 180);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);

  useEffect(() => {
    const env = getRuntimeEnvironment();
    const shouldCheck =
      env === 'capacitor' &&
      (appearance.backgroundGeneration ?? true) &&
      !appearance.androidBatteryPromptDismissed;

    if (!shouldCheck) {
      setShowBatteryPrompt(false);
      return;
    }

    let cancelled = false;
    const checkBattery = async () => {
      const status = await getAndroidBatteryStatus();
      if (!cancelled) {
        setShowBatteryPrompt(Boolean(status.supported && !status.ignoring));
      }
    };

    void checkBattery();
    let handlePromise: Promise<{ remove: () => Promise<void> }> | null = null;
    try {
      handlePromise = CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void checkBattery();
      });
    } catch {
      // Ignore outside Capacitor native shell
    }

    return () => {
      cancelled = true;
      if (handlePromise) {
        void handlePromise.then((h) => h.remove()).catch(() => undefined);
      }
    };
  }, [appearance.backgroundGeneration, appearance.androidBatteryPromptDismissed]);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConv ? messagesByConv[activeConv.id] || [] : [];
  const isStreaming = Boolean(
    activeConv && (abortControllers[activeConv.id] || streamingByConv[activeConv.id])
  );
  const hasConfiguredProvider = providers.some((p) => p.apiKey.trim().length > 0);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    autoFollowRef.current = true;
    setShowScrollBottom(false);
  };

  useEffect(() => {
    if (autoFollowRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [messages, activeConversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (autoFollowRef.current) {
        el.scrollTop = el.scrollHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 90;
    autoFollowRef.current = nearBottom;
    setShowScrollBottom(!nearBottom && el.scrollHeight > el.clientHeight + 120);
  };

  const dispatchSend = async (
    text: string,
    images?: Array<Extract<ContentPart, { type: 'image' }>>
  ) => {
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
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {showBatteryPrompt && (
        <div className="cb-panel-enter mx-4 mt-2 px-3.5 py-2.5 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs text-fg flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BatteryCharging className="w-4 h-4 text-amber-400 shrink-0" />
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
                setShowBatteryPrompt(false);
                void updateAppearance({ androidBatteryPromptDismissed: true });
              }}
              className="px-2 py-1 rounded-lg border border-borderc text-muted hover:text-fg"
            >
              不再提示
            </button>
          </div>
        </div>
      )}

      {errorBanner && (
        <div className="cb-panel-enter mx-4 mt-2 px-3.5 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between gap-2">
          <span>{errorBanner}</span>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-amber-200 underline shrink-0"
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
              messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  theme={theme}
                  appearance={appearance}
                  onInspect={onInspect}
                  onRegenerate={(id) =>
                    void regenerateMessage(id).catch((e) => {
                      if (e instanceof Error && e.message === 'NO_PROVIDER_CONFIGURED') {
                        onOpenSettings('providers');
                      } else if (e instanceof Error) {
                        setErrorBanner(e.message);
                      }
                    })
                  }
                  onEditResend={(id, newText) =>
                    void editAndResend(id, newText).catch((e) => {
                      if (e instanceof Error && e.message === 'NO_PROVIDER_CONFIGURED') {
                        onOpenSettings('providers');
                      } else if (e instanceof Error) {
                        setErrorBanner(e.message);
                      }
                    })
                  }
                  onDelete={(id) => void deleteMessage(id)}
                />
              ))
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
        onSend={(t, imgs) => void dispatchSend(t, imgs)}
        onStop={() => stopStreaming()}
        isStreaming={isStreaming}
        onOpenSettings={onOpenSettings}
        onInspect={onInspect}
      />
    </div>
  );
};
