import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ResolvedTheme } from '@/components/renderer/svgUtils';
import type { LightboxPayload } from '@/components/renderer/LightboxModal';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';

interface ChatViewProps {
  theme: ResolvedTheme;
  onInspect: (payload: LightboxPayload) => void;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
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
    streamingMessageId,
    sendMessage,
    stopStreaming,
    regenerateMessage,
    editAndResend,
    deleteMessage,
  } = useAppStore();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoFollowRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConv ? messagesByConv[activeConv.id] || [] : [];
  const isStreaming = Boolean(
    streamingMessageId && messages.some((m) => m.id === streamingMessageId)
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

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distFromBottom < 90;
    autoFollowRef.current = nearBottom;
    setShowScrollBottom(!nearBottom && el.scrollHeight > el.clientHeight + 120);
  };

  const dispatchSend = async (text: string) => {
    setErrorBanner(null);
    autoFollowRef.current = true;
    try {
      await sendMessage(text);
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
      {errorBanner && (
        <div className="mx-4 mt-2 px-3.5 py-2 rounded-xl border border-amber-500/35 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between gap-2">
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

      {/* Scrollbar-free Message Stream */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 pt-3 pb-6 scroll-smooth"
      >
        <div className="mx-auto w-full" style={{ maxWidth: 'var(--chat-max-width)' }}>
          {messages.length === 0 ? (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center py-10 space-y-6">
              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-fg">
                  有什么可以帮你的？
                </h1>
                <p className="text-sm text-muted max-w-md mx-auto">
                  支持多步数学推导、化学式、矢量图解与交互原理实验。
                </p>
              </div>

              {!hasConfiguredProvider && (
                <button
                  type="button"
                  onClick={() => onOpenSettings('providers')}
                  className="px-4 py-2.5 rounded-2xl bg-accent text-accentfg text-sm font-medium shadow-md active:scale-95 transition"
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
                    className="p-3.5 rounded-2xl border border-borderc bg-surface/55 hover:bg-elevated hover:border-fg/25 transition text-xs sm:text-[13px] text-fg/90 leading-relaxed"
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
                    }
                  })
                }
                onEditResend={(id, newText) =>
                  void editAndResend(id, newText).catch((e) => {
                    if (e instanceof Error && e.message === 'NO_PROVIDER_CONFIGURED') {
                      onOpenSettings('providers');
                    }
                  })
                }
                onDelete={(id) => void deleteMessage(id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Scroll-to-bottom circular button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-[114px] left-1/2 -translate-x-1/2 z-20 w-9 h-9 rounded-full border border-borderc bg-elevated/90 backdrop-blur-md text-fg shadow-lg flex items-center justify-center hover:bg-surface active:scale-95 transition"
          aria-label="滚动到底部"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      <ChatInput
        onSend={(t) => void dispatchSend(t)}
        onStop={() => stopStreaming()}
        isStreaming={isStreaming}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
};
