import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MarkdownBlock } from './MarkdownBlock';
import type { AppearanceSettings } from '@/types/settings';
import type { ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';

interface ReasoningCardProps {
  text: string;
  durationMs?: number;
  isStreaming?: boolean;
  theme: ResolvedTheme;
  appearance: AppearanceSettings;
  onInspect: (payload: LightboxPayload) => void;
}

export const ReasoningCard: React.FC<ReasoningCardProps> = ({
  text,
  durationMs,
  isStreaming,
  theme,
  appearance,
  onInspect,
}) => {
  const [open, setOpen] = useState(Boolean(isStreaming));

  if (!text.trim() && !isStreaming) return null;

  const durationText =
    durationMs && durationMs > 0 ? ` ${(durationMs / 1000).toFixed(1)} 秒` : '';

  return (
    <div className="mb-3 rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-muted hover:text-fg hover:bg-white/[0.03] transition"
      >
        <span className={`font-medium ${isStreaming ? 'animate-pulse text-fg' : ''}`}>
          {isStreaming ? '正在思考' : `已思考${durationText}`}
        </span>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-3.5 pb-3 pt-1 border-t border-borderc/50 text-[13px] text-muted leading-relaxed">
          <MarkdownBlock
            content={text}
            theme={theme}
            appearance={appearance}
            isStreaming={isStreaming}
            onInspect={onInspect}
          />
        </div>
      )}
    </div>
  );
};
