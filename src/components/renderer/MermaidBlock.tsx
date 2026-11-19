import React, { useEffect, useId, useState } from 'react';
import { Check, Code2, Copy, Image as ImageIcon, Maximize2 } from 'lucide-react';
import { exportSvgToPng, type ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';

interface MermaidBlockProps {
  code: string;
  theme: ResolvedTheme;
  isStreaming?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

export const MermaidBlock: React.FC<MermaidBlockProps> = ({
  code,
  theme,
  isStreaming,
  onInspect,
}) => {
  const reactId = useId().replace(/:/g, '');
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      if (!code.trim()) return;
      try {
        const mermaidMod = await import('mermaid');
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
                  primaryColor: '#f1f5f9',
                  primaryBorderColor: '#64748b',
                  lineColor: '#334155',
                }
              : {
                  background: 'transparent',
                  primaryColor: '#161b26',
                  primaryTextColor: '#f4f4f5',
                  primaryBorderColor: '#38bdf8',
                  lineColor: '#94a3b8',
                  secondaryColor: '#1e293b',
                  tertiaryColor: '#0f172a',
                },
        });

        const { svg: rendered } = await mermaid.render(`cb_mmd_${reactId}_${Date.now()}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid 语法渲染失败');
        }
      }
    };

    const timer = setTimeout(() => {
      void renderDiagram();
    }, isStreaming ? 260 : 20);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, theme, isStreaming, reactId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-borderc/60 bg-surface/60">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          Mermaid 图表
        </span>
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
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          {svg && (
            <>
              <button
                type="button"
                onClick={() =>
                  void exportSvgToPng(svg, `chatbeauty-mermaid-${Date.now()}.png`, theme)
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
          <div className="text-xs text-amber-400 mb-2">Mermaid 解析提示：{error}</div>
          <pre className="text-xs font-mono overflow-x-auto text-muted bg-black/20 p-3 rounded-xl m-0">
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-muted">加载图表中…</div>
      )}
    </div>
  );
};
