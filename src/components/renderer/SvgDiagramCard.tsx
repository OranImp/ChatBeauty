import React, { useMemo, useState } from 'react';
import { Check, Code2, Copy, Download, Maximize2, Image as ImageIcon } from 'lucide-react';
import {
  exportSvgToPng,
  sanitizeAndHarmonizeSvg,
  triggerDownload,
  type ResolvedTheme,
} from './svgUtils';
import type { LightboxPayload } from './LightboxModal';

interface SvgDiagramCardProps {
  code: string;
  caption?: string;
  theme: ResolvedTheme;
  isStreaming?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

export const SvgDiagramCard: React.FC<SvgDiagramCardProps> = ({
  code,
  caption,
  theme,
  isStreaming,
  onInspect,
}) => {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const hasCompleteSvg = /<\/svg\s*>/i.test(code);

  const processed = useMemo(() => {
    if (!hasCompleteSvg) return null;
    return sanitizeAndHarmonizeSvg(code, theme);
  }, [code, theme, hasCompleteSvg]);

  const finalCaption = caption || processed?.caption;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!hasCompleteSvg && isStreaming) {
    return (
      <div className="my-4 rounded-2xl border border-borderc bg-surface/50 p-6 flex flex-col items-center justify-center gap-2 text-muted">
        <div className="w-6 h-6 rounded-full border-2 border-accent/60 border-t-transparent animate-spin" />
        <div className="text-xs">正在绘制矢量示意图…</div>
      </div>
    );
  }

  return (
    <figure className="my-4 rounded-2xl border border-borderc bg-surface/35 overflow-hidden group relative">
      {/* Subtle hover-only floating corner actions */}
      <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-0.5 rounded-xl border border-borderc/80 bg-elevated/85 backdrop-blur-md px-1 py-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
          title={showCode ? '查看图形' : '查看源码'}
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
          title="复制 SVG 源码"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-fg" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
        {processed && (
          <>
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  `chatbeauty-svg-${Date.now()}.svg`,
                  new Blob([code], { type: 'image/svg+xml;charset=utf-8' })
                )
              }
              className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
              title="下载 SVG"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                void exportSvgToPng(
                  processed.html,
                  `chatbeauty-svg-${Date.now()}.png`,
                  theme
                )
              }
              className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
              title="导出高清 PNG"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                onInspect({
                  kind: 'svg',
                  title: finalCaption || '矢量示意图',
                  svgHtml: processed.html,
                  rawSource: code,
                })
              }
              className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
              title="全屏放大查看"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {showCode || !processed ? (
        <pre className="p-4 pt-11 text-xs font-mono overflow-x-auto text-muted bg-black/20 m-0">
          <code>{code}</code>
        </pre>
      ) : (
        <div
          className="px-4 py-5 flex justify-center items-center cursor-zoom-in text-fg"
          onClick={() =>
            onInspect({
              kind: 'svg',
              title: finalCaption || '矢量示意图',
              svgHtml: processed.html,
              rawSource: code,
            })
          }
        >
          <div
            className="w-full max-w-[660px]"
            dangerouslySetInnerHTML={{ __html: processed.html }}
          />
        </div>
      )}

      {finalCaption && (
        <figcaption className="px-4 pb-3.5 pt-0.5 text-center text-xs text-muted">
          {finalCaption}
        </figcaption>
      )}
    </figure>
  );
};
