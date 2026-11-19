import React, { useState } from 'react';
import { Check, Copy, Pencil, RotateCw, Trash2 } from 'lucide-react';
import type { Message } from '@/types/chat';
import type { AppearanceSettings } from '@/types/settings';
import type { ResolvedTheme } from '@/components/renderer/svgUtils';
import type { LightboxPayload } from '@/components/renderer/LightboxModal';
import { MessageRenderer } from '@/components/renderer/MessageRenderer';

interface MessageItemProps {
  message: Message;
  theme: ResolvedTheme;
  appearance: AppearanceSettings;
  onInspect: (payload: LightboxPayload) => void;
  onRegenerate: (id: string) => void;
  onEditResend: (id: string, newText: string) => void;
  onDelete: (id: string) => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  theme,
  appearance,
  onInspect,
  onRegenerate,
  onEditResend,
  onDelete,
}) => {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);

  const rawText = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  const [draft, setDraft] = useState(rawText);

  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(rawText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isUser) {
    return (
      <div className="cb-msg-enter group flex flex-col items-end my-4">
        {editing ? (
          <div className="cb-panel-enter w-full max-w-[88%] rounded-2xl border border-fg/30 bg-surface p-3 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full bg-transparent text-sm text-fg focus:outline-none resize-none no-scrollbar"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(rawText);
                }}
                className="px-3 py-1 rounded-lg text-xs text-muted hover:text-fg"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  onEditResend(message.id, draft);
                }}
                className="px-3 py-1 rounded-lg text-xs bg-accent text-accentfg font-medium"
              >
                保存并重新发送
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-[86%] sm:max-w-[78%] rounded-2xl rounded-tr-sm bg-elevated border border-borderc px-4 py-2.5 text-[15px] leading-relaxed text-fg whitespace-pre-wrap break-words">
            {rawText}
          </div>
        )}

        {!editing && (
          <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition text-muted">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-fg transition"
              title="复制"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-fg" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(rawText);
                setEditing(true);
              }}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-fg transition"
              title="编辑并重发"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-rose-400 transition"
              title="删除消息"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cb-msg-enter group my-5">
      {message.parts.length === 0 && isStreaming ? (
        <div className="py-2 text-sm text-muted animate-pulse">正在思考与生成</div>
      ) : (
        <MessageRenderer
          parts={message.parts}
          isStreaming={isStreaming}
          theme={theme}
          appearance={appearance}
          onInspect={onInspect}
        />
      )}

      {message.status === 'error' && (
        <div className="mt-3 p-3 rounded-xl border border-rose-500/35 bg-rose-500/10 text-xs text-rose-300 flex items-center justify-between gap-3">
          <span className="break-all">请求失败：{message.error || '未知网络或接口错误'}</span>
          <button
            type="button"
            onClick={() => onRegenerate(message.id)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 transition"
          >
            重试
          </button>
        </div>
      )}

      {message.status === 'aborted' && (
        <div className="mt-2 text-[11px] text-muted">已停止生成</div>
      )}

      {!isStreaming && (
        <div className="flex items-center justify-between mt-2.5 pt-1 text-muted">
          <div className="flex items-center gap-1 opacity-85 sm:opacity-0 sm:group-hover:opacity-100 transition">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-fg transition"
              title="复制 Markdown"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-fg" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => onRegenerate(message.id)}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-fg transition"
              title="重新生成"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="p-1.5 rounded-lg hover:bg-surface hover:text-rose-400 transition"
              title="删除消息"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {(message.modelId || message.usage?.totalTokens) && (
            <div className="text-[11px] font-mono text-muted/75 tabular-nums flex items-center gap-2">
              {message.modelId && <span>{message.modelId}</span>}
              {message.usage?.totalTokens && (
                <span>
                  {message.usage.inputTokens ?? '-'} → {message.usage.outputTokens ?? '-'} (
                  {message.usage.totalTokens})
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
