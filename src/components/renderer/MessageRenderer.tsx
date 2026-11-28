import React, { memo, useMemo } from 'react';
import type { ContentPart } from '@/types/chat';
import type { AppearanceSettings } from '@/types/settings';
import type { ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';
import { preprocessLatex } from './latexPreprocessor';
import { splitMarkdownBlocks } from './blockSplitter';
import { MarkdownBlock } from './MarkdownBlock';
import { ReasoningCard } from './ReasoningCard';

interface MessageRendererProps {
  parts: ContentPart[];
  isStreaming?: boolean;
  theme: ResolvedTheme;
  appearance: AppearanceSettings;
  onInspect: (payload: LightboxPayload) => void;
}

export const MessageRenderer: React.FC<MessageRendererProps> = memo(({
  parts,
  isStreaming,
  theme,
  appearance,
  onInspect,
}) => {
  const { reasoningPart, textContent, imageParts } = useMemo(() => {
    let reasoning: Extract<ContentPart, { type: 'reasoning' }> | undefined;
    const texts: string[] = [];
    const imgs: Array<Extract<ContentPart, { type: 'image' }>> = [];
    for (const p of parts) {
      if (p.type === 'reasoning' && !reasoning) reasoning = p;
      else if (p.type === 'text') texts.push(p.text);
      else if (p.type === 'image') imgs.push(p);
    }
    return {
      reasoningPart: reasoning,
      textContent: texts.length === 1 ? texts[0] : texts.join('\n'),
      imageParts: imgs,
    };
  }, [parts]);

  const normalized = useMemo(
    () => preprocessLatex(textContent, Boolean(isStreaming)),
    [textContent, isStreaming]
  );

  const blocks = useMemo(() => splitMarkdownBlocks(normalized), [normalized]);

  return (
    <div className="space-y-1">
      {reasoningPart && (
        <ReasoningCard
          text={reasoningPart.text}
          durationMs={reasoningPart.durationMs}
          isStreaming={Boolean(isStreaming && !textContent)}
          theme={theme}
          appearance={appearance}
          onInspect={onInspect}
        />
      )}

      {imageParts.length > 0 && (
        <div className="flex flex-wrap gap-2.5 my-2">
          {imageParts.map((img, i) => {
            const src = img.dataUrl || img.url || '';
            if (!src) return null;
            return (
              <button
                key={i}
                type="button"
                onClick={() =>
                  onInspect({
                    kind: 'image',
                    title: img.alt || '图片预览',
                    src,
                  })
                }
                title="点击查看大图"
                className="group relative rounded-xl overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <img
                  src={src}
                  alt={img.alt || 'image'}
                  className={
                    appearance.hideMediaFrames
                      ? 'max-h-64 rounded-xl object-contain transition-transform duration-200 group-hover:scale-[1.01]'
                      : 'max-h-64 rounded-xl border border-borderc bg-surface/30 object-contain transition-transform duration-200 group-hover:scale-[1.01]'
                  }
                />
              </button>
            );
          })}
        </div>
      )}

      {blocks.map((block, idx) => {
        const isLast = idx === blocks.length - 1;
        return (
          <MarkdownBlock
            key={idx}
            content={block}
            theme={theme}
            appearance={appearance}
            isStreaming={Boolean(isStreaming && isLast)}
            onInspect={onInspect}
          />
        );
      })}
    </div>
  );
});
