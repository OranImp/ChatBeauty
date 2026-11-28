import React from 'react';
import { Loader2, Minimize2 } from 'lucide-react';
import type { ContextUsageStats } from '@/services/llm/contextManager';
import type { ContextSettings } from '@/types/settings';

interface ContextMenuPopoverProps {
  contextStats: ContextUsageStats;
  contextSettings: ContextSettings;
  relevantMemoriesCount: number;
  compactFeedback: { ok: boolean; text: string } | null;
  isCompacting: boolean;
  canCompact: boolean;
  onCompactNow: () => void;
  onOpenGenerationSettings: () => void;
}

export const ContextMenuPopover: React.FC<ContextMenuPopoverProps> = ({
  contextStats,
  contextSettings,
  relevantMemoriesCount,
  compactFeedback,
  isCompacting,
  canCompact,
  onCompactNow,
  onOpenGenerationSettings,
}) => {
  return (
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
          <span>按需记忆注入（{relevantMemoriesCount} 条）</span>
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
          disabled={!canCompact}
          onClick={onCompactNow}
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
          onClick={onOpenGenerationSettings}
          className="px-2.5 py-1.5 rounded-xl bg-accent/15 text-accent font-medium hover:bg-accent/25 transition"
        >
          压缩设置
        </button>
      </div>
    </div>
  );
};
