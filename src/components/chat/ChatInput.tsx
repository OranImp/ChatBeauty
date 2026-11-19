import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, ImagePlus, Mic, Plus, Sparkles, Square } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  onOpenSettings: (tab?: 'providers' | 'prompts' | 'appearance' | 'data') => void;
}

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
    promptPresets,
    promptSettings,
    updateConversationConfig,
  } = useAppStore();

  const [text, setText] = useState('');
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [reservedHint, setReservedHint] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const renderEnabled =
    activeConv?.enableRenderPrompt !== undefined
      ? activeConv.enableRenderPrompt
      : promptSettings.renderEnhancementEnabled;
  const activePresetId = activeConv?.systemPromptPresetId || promptSettings.defaultPresetId;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  const showReservedNotice = (msg: string) => {
    setReservedHint(msg);
    setTimeout(() => setReservedHint(null), 2600);
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

  return (
    <div className="relative z-20 px-3 sm:px-6 pt-1 pb-2 safe-bottom shrink-0">
      <div className="mx-auto relative" style={{ maxWidth: 'var(--chat-max-width)' }}>
        {reservedHint && (
          <div className="absolute -top-11 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-elevated border border-borderc text-xs text-fg shadow-lg whitespace-nowrap">
            {reservedHint}
          </div>
        )}

        {/* Plus Menu Popover */}
        {plusMenuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPlusMenuOpen(false)} />
            <div className="absolute left-0 bottom-16 z-30 w-72 rounded-2xl border border-borderc bg-elevated/95 backdrop-blur-xl shadow-2xl p-3 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-fg flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>渲染与学习提示词</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    onOpenSettings('prompts');
                  }}
                  className="text-accent hover:underline"
                >
                  自定义编辑
                </button>
              </div>

              {activeConv && (
                <>
                  <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface border border-borderc">
                    <span className="text-fg">公式/SVG/图表渲染增强</span>
                    <button
                      type="button"
                      onClick={() =>
                        void updateConversationConfig(activeConv.id, {
                          enableRenderPrompt: !renderEnabled,
                        })
                      }
                      className={`px-2 py-0.5 rounded-full text-[11px] font-medium transition ${
                        renderEnabled ? 'bg-accent text-black' : 'bg-white/10 text-muted'
                      }`}
                    >
                      {renderEnabled ? '已开启' : '已关闭'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {promptPresets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          void updateConversationConfig(activeConv.id, {
                            systemPromptPresetId: p.id,
                          })
                        }
                        className={`px-2 py-1 rounded-lg transition ${
                          activePresetId === p.id
                            ? 'bg-accent/20 text-accent border border-accent/40'
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
                <div className="text-[11px] text-muted px-1">预留多模态接口（后续版本接入）</div>
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false);
                    showReservedNotice('识图 (Vision) 与图像生成接口已在底层预留');
                  }}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-white/5 text-muted"
                >
                  <span className="flex items-center gap-2">
                    <ImagePlus className="w-4 h-4" />
                    <span>图片识图 / 生成图像</span>
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5">预留</span>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Screenshot-inspired floating frosted pill composer */}
        <div className="flex items-end gap-2 rounded-[28px] border border-borderc bg-surface/90 backdrop-blur-xl px-2.5 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
          <button
            type="button"
            onClick={() => setPlusMenuOpen((v) => !v)}
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-white/10 shrink-0 transition"
            aria-label="更多能力与提示词"
          >
            <Plus className="w-5 h-5" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="提问任何知识，支持公式推导与 SVG 图解…"
            className="flex-1 bg-transparent text-[15px] text-fg placeholder:text-muted/80 py-1.5 px-1 resize-none focus:outline-none max-h-[168px] leading-relaxed"
          />

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => showReservedNotice('语音输入 / TTS 合成接口已在底层预留')}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted hover:text-fg hover:bg-white/10 transition"
              title="语音接口（已预留）"
            >
              <Mic className="w-[18px] h-[18px]" />
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isStreaming && !text.trim()}
              style={
                isStreaming || text.trim()
                  ? { backgroundColor: appearance.accentColor, color: '#050811' }
                  : undefined
              }
              className={`w-9 h-9 rounded-full flex items-center justify-center transition ${
                isStreaming || text.trim()
                  ? 'shadow-md active:scale-95'
                  : 'bg-white/10 text-muted cursor-not-allowed'
              }`}
              aria-label={isStreaming ? '停止生成' : '发送'}
            >
              {isStreaming ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <ArrowUp className="w-5 h-5 stroke-[2.3]" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
