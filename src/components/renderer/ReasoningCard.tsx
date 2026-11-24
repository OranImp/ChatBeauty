import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MarkdownBlock } from './MarkdownBlock';
import { preprocessLatex } from './latexPreprocessor';
import { splitMarkdownBlocks } from './blockSplitter';
import { Collapsible } from '@/components/ui/MotionPrimitives';
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

  const blocks = useMemo(
    () => splitMarkdownBlocks(preprocessLatex(text, Boolean(isStreaming))),
    [text, isStreaming]
  );

  if (!text.trim() && !isStreaming) return null;

  const durationText =
    durationMs && durationMs > 0 ? `${(durationMs / 1000).toFixed(1)}s` : '';

  return (
    <div className="mb-3 rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-muted hover:text-fg hover:bg-fg/[0.03] transition"
      >
        <span className="flex items-center gap-2 font-medium">
          <span className={isStreaming ? 'animate-pulse text-fg' : ''}>
            {isStreaming ? '正在思考' : '思考过程'}
          </span>
          {!isStreaming && durationText && (
            <span className="font-mono text-[11px] text-muted/80 tabular-nums">{durationText}</span>
          )}
        </span>
        <ChevronRight
          className={`w-4 h-4 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? 'rotate-90 text-fg' : ''
          }`}
        />
      </button>

      <Collapsible open={open}>
        <div className="px-3.5 pb-3 pt-2 border-t border-borderc text-[13px] text-muted leading-relaxed">
          <div className="border-l-2 border-accent/55 pl-3">
            {blocks.map((block, idx) => (
              <MarkdownBlock
                key={idx}
                content={block}
                theme={theme}
                appearance={appearance}
                isStreaming={Boolean(isStreaming) && idx === blocks.length - 1}
                onInspect={onInspect}
              />
            ))}
          </div>
        </div>
      </Collapsible>
    </div>
  );
};
