import React, { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, Image as ImageIcon } from 'lucide-react';
import { triggerDownload, type ResolvedTheme } from './svgUtils';

interface EChartsBlockProps {
  code: string;
  theme: ResolvedTheme;
  isStreaming?: boolean;
}

export const EChartsBlock: React.FC<EChartsBlockProps> = ({ code, theme, isStreaming }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<{ getDataURL: (opts: Record<string, unknown>) => string; resize: () => void; dispose: () => void } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (showCode) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    const init = async () => {
      if (!containerRef.current) return;
      let option: Record<string, unknown>;
      try {
        option = JSON.parse(code) as Record<string, unknown>;
      } catch {
        if (!isStreaming) setError('ECharts 配置 JSON 尚不完整或格式有误');
        return;
      }

      try {
        const echarts = await import('echarts');
        if (disposed || !containerRef.current) return;

        chartRef.current?.dispose();
        const chart = echarts.init(
          containerRef.current,
          theme === 'light' ? undefined : 'dark',
          { renderer: 'canvas' }
        );
        chartRef.current = chart;

        const fg = theme === 'light' ? '#18181b' : '#e4e4e7';
        const palette =
          theme === 'light'
            ? ['#18181b', '#71717a', '#8c7a5b', '#4d7c63', '#b86843']
            : ['#e4e4e7', '#a1a1aa', '#d4c5a9', '#9ec5ab', '#d99b78'];
        const mergedOption: Record<string, unknown> = {
          backgroundColor: 'transparent',
          color: palette,
          textStyle: { color: fg },
          ...option,
        };
        chart.setOption(mergedOption);
        setError(null);

        observer = new ResizeObserver(() => {
          chart.resize();
        });
        observer.observe(containerRef.current);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : 'ECharts 渲染失败');
        }
      }
    };

    const timer = setTimeout(() => {
      void init();
    }, isStreaming ? 250 : 20);

    return () => {
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [code, theme, showCode, isStreaming]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleExportPng = () => {
    if (!chartRef.current) return;
    const bg = theme === 'oled' ? '#000000' : theme === 'dark' ? '#141416' : '#ffffff';
    const dataUrl = chartRef.current.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: bg,
    });
    triggerDownload(`chatbeauty-chart-${Date.now()}.png`, dataUrl);
  };

  return (
    <div className="my-4 rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-borderc bg-surface/60">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          ECharts 数据/函数图
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowCode((v) => !v)}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title={showCode ? '查看图表' : '查看 JSON'}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title="复制 JSON 配置"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-fg" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          {!showCode && !error && (
            <button
              type="button"
              onClick={handleExportPng}
              className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
              title="导出 PNG"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {showCode ? (
        <pre className="p-4 text-xs font-mono overflow-x-auto text-muted m-0">
          <code>{code}</code>
        </pre>
      ) : error ? (
        <div className="p-4 text-xs text-muted">
          {isStreaming ? '正在生成图表数据…' : error}
        </div>
      ) : (
        <div ref={containerRef} className="w-full h-[290px] sm:h-[330px] p-2" />
      )}
    </div>
  );
};
