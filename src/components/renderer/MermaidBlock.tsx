import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, Code2, Copy, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { exportSvgToPng, type ResolvedTheme } from './svgUtils';
import { copyTextSafe } from '@/services/media/clipboard';
import type { LightboxPayload } from './LightboxModal';

let mermaidRenderQueue: Promise<void> = Promise.resolve();

interface MermaidBlockProps {
  code: string;
  theme: ResolvedTheme;
  isStreaming?: boolean;
  frameless?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({
  code,
  theme,
  isStreaming,
  frameless = false,
  onInspect,
}) => {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = () => {
      if (!code.trim()) {
        setSvg('');
        setError(null);
        return;
      }
      mermaidRenderQueue = mermaidRenderQueue
        .catch(() => undefined)
        .then(async () => {
          if (cancelled) return;
          try {
            const mermaidMod = await import('mermaid');
            if (cancelled) return;
            const mermaid = mermaidMod.default;
            mermaid.initialize({
              startOnLoad: false,
              suppressErrorRendering: true,
              securityLevel: 'strict',
              theme: theme === 'light' ? 'default' : 'dark',
              themeVariables:
                theme === 'light'
                  ? {
                      background: 'transparent',
                      primaryColor: '#f2f0e9',
                      primaryTextColor: '#1f1e1c',
                      primaryBorderColor: '#c25d36',
                      secondaryColor: '#e7efe9',
                      secondaryTextColor: '#1f1e1c',
                      secondaryBorderColor: '#3d7f6a',
                      tertiaryColor: '#f6efe0',
                      tertiaryTextColor: '#1f1e1c',
                      tertiaryBorderColor: '#a87d24',
                      lineColor: '#6f6a62',
                      edgeLabelBackground: '#faf9f5',
                    }
                  : {
                      background: 'transparent',
                      primaryColor: '#21201e',
                      primaryTextColor: '#eceae4',
                      primaryBorderColor: '#d9825b',
                      secondaryColor: '#1d2623',
                      secondaryTextColor: '#eceae4',
                      secondaryBorderColor: '#6fb39c',
                      tertiaryColor: '#28251f',
                      tertiaryTextColor: '#eceae4',
                      tertiaryBorderColor: '#d9b566',
                      lineColor: '#9c968c',
                      edgeLabelBackground: '#171615',
                    },
            });

            const { svg: rendered } = await mermaid.render(
              `cb_mmd_${reactId}_${Date.now()}`,
              code
            );
            if (!cancelled) {
              setSvg(rendered);
              setError(null);
            }
          } catch (err) {
            if (!cancelled) {
              if (!isStreaming) {
                setSvg('');
              }
              setError(err instanceof Error ? err.message : 'Mermaid 语法渲染失败');
            }
          }
        });
    };

    const timer = setTimeout(() => {
      renderDiagram();
    }, isStreaming ? 260 : 20);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, theme, isStreaming, reactId]);

  const handleCopy = async () => {
    if (await copyTextSafe(code)) {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div
      className={
        frameless
          ? 'my-4 rounded-xl overflow-hidden group/media relative'
          : 'my-4 rounded-2xl border border-borderc bg-surface/40 overflow-hidden'
      }
    >
      <div
        className={
          frameless
            ? 'absolute top-2 right-2 z-20 flex items-center gap-1 rounded-xl border border-borderc bg-elevated/90 backdrop-blur-md px-1.5 py-1 opacity-85 pointer-events-auto sm:opacity-0 sm:pointer-events-none sm:group-hover/media:opacity-100 sm:group-hover/media:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-200 shadow-sm'
            : 'flex items-center justify-between px-3.5 py-2 border-b border-borderc bg-surface/60'
        }
      >
        {!frameless && (
          <span className="text-[11px] font-mono font-medium tracking-wide text-muted uppercase">
            Mermaid 图表
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title={showCode ? '查看图表' : '查看源码'}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title="复制 Mermaid 源码"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-fg" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          {svg && (
            <>
              <button
                type="button"
                onClick={() =>
                  void exportSvgToPng(svg, `chatbeauty-mermaid-${Date.now()}.png`, theme).catch(
                    () => undefined
                  )
                }
                className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
                title="导出 PNG"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  onInspect({
                    kind: 'svg',
                    title: 'Mermaid 图表',
                    svgHtml: svg,
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
      </div>

      {showCode ? (
        <pre className="p-4 text-xs font-mono overflow-x-auto text-muted m-0">
          <code>{code}</code>
        </pre>
      ) : svg ? (
        <div
          className="p-4 flex justify-center overflow-x-auto cursor-zoom-in [&_svg]:max-w-full [&_svg]:h-auto"
          onClick={() =>
            onInspect({
              kind: 'svg',
              title: 'Mermaid 图表',
              svgHtml: svg,
              rawSource: code,
            })
          }
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : isStreaming ? (
        <div className="p-6 text-center text-xs text-muted">正在生成 Mermaid 图表…</div>
      ) : error ? (
        <div className="p-4">
          <div
            className={`text-xs mb-2 ${
              theme === 'light' ? 'text-amber-700' : 'text-amber-400'
            }`}
          >
            Mermaid 解析提示：{error}
          </div>
          <pre
            className={`text-xs font-mono overflow-x-auto text-muted p-3 rounded-xl m-0 ${
              theme === 'light' ? 'bg-black/5' : 'bg-black/20'
            }`}
          >
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-muted">加载图表中…</div>
      )}
    </div>
  );
};
