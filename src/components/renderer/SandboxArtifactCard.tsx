import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Code2, Copy, Maximize2, Play, RotateCcw } from 'lucide-react';
import type { ResolvedTheme } from './svgUtils';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';
import type { LightboxPayload } from './LightboxModal';
import { getChartPalette } from './chartPalette';

interface SandboxArtifactCardProps {
  code: string;
  theme: ResolvedTheme;
  accentColor: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
  frameless?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

function buildInjectedDocument(
  rawHtml: string,
  frameId: string,
  theme: ResolvedTheme,
  accent: string,
  enableResize = true
): string {
  const isLight = theme === 'light';
  const palette = getChartPalette(theme);
  const inlineHeightReset = enableResize ? 'html, body { min-height: 0 !important; }' : '';
  const themeStyle = `<style>
    :root {
      --bg: ${theme === 'oled' ? '#000000' : theme === 'dark' ? '#171615' : '#faf9f5'};
      --surface: ${theme === 'oled' ? '#141312' : theme === 'dark' ? '#21201e' : '#f2f0e9'};
      --fg: ${isLight ? '#1f1e1c' : theme === 'oled' ? '#f2f0eb' : '#eceae4'};
      --muted: ${isLight ? '#6f6a62' : theme === 'oled' ? '#9b968e' : '#9c968c'};
      --accent: ${accent};
      --border: ${isLight ? 'rgba(31,30,28,0.12)' : 'rgba(236,234,228,0.12)'};
      --chart-1: ${palette[0]};
      --chart-2: ${palette[1]};
      --chart-3: ${palette[2]};
      --chart-4: ${palette[3]};
      --chart-5: ${palette[4]};
      --chart-6: ${palette[5] ?? palette[0]};
      --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei UI', sans-serif;
      --font-mono: ui-monospace, 'JetBrains Mono', 'Cascadia Code', Consolas, monospace;
      color-scheme: ${isLight ? 'light' : 'dark'};
    }
    html, body { color: var(--fg); background: transparent; font-family: var(--font-sans); }
    ${inlineHeightReset}
    input[type='range'] {
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      border-radius: 9999px;
      background: ${isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)'};
      outline: none;
      cursor: pointer;
    }
    input[type='range']::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: var(--accent);
      border: 2px solid var(--bg);
      cursor: pointer;
      transition: transform 0.1s ease;
    }
    input[type='range']::-webkit-slider-thumb:hover {
      transform: scale(1.15);
    }
    input[type='range']::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 9999px;
      background: var(--accent);
      border: 2px solid var(--bg);
      cursor: pointer;
    }
  </style>`;

  const resizeScript = enableResize
    ? `<script>
    (function() {
      var lastSent = 0;
      function sendHeight() {
        var h = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        var clamped = Math.min(Math.max(Math.round(h), 160), 760);
        if (Math.abs(clamped - lastSent) < 2) return;
        lastSent = clamped;
        window.parent.postMessage({ type: 'cb-sandbox-height', id: ${JSON.stringify(frameId)}, height: clamped }, '*');
      }
      window.addEventListener('load', sendHeight);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(sendHeight).observe(document.body || document.documentElement);
      }
      setTimeout(sendHeight, 120);
      setTimeout(sendHeight, 450);
    })();
  </script>`
    : '';

  const lower = rawHtml.toLowerCase();
  const headCloseIdx = lower.lastIndexOf('</head>');
  const bodyCloseIdx = lower.lastIndexOf('</body>');
  if (headCloseIdx !== -1 && bodyCloseIdx !== -1 && bodyCloseIdx > headCloseIdx) {
    return (
      rawHtml.slice(0, headCloseIdx) +
      themeStyle +
      rawHtml.slice(headCloseIdx, bodyCloseIdx) +
      resizeScript +
      rawHtml.slice(bodyCloseIdx)
    );
  }
  return `<!doctype html><html><head><meta charset="utf-8"/>${themeStyle}</head><body>${rawHtml}${resizeScript}</body></html>`;
}

export const SandboxArtifactCard: React.FC<SandboxArtifactCardProps> = memo(({
  code,
  theme,
  accentColor,
  isStreaming,
  defaultPreview = true,
  frameless = false,
  onInspect,
}) => {
  const frameId = useId();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [mode, setMode] = useState<'preview' | 'code'>(defaultPreview ? 'preview' : 'code');
  const [height, setHeight] = useState(240);
  const [reloadNonce, setReloadNonce] = useState(0);
  const { copied, copy } = useCopyFeedback();

  const srcDoc = useMemo(
    () => (mode === 'preview' && !isStreaming ? buildInjectedDocument(code, frameId, theme, accentColor, true) : ''),
    [code, frameId, theme, accentColor, mode, isStreaming]
  );

  useEffect(() => {
    if (mode !== 'preview' || isStreaming) return;
    const onMessage = (evt: MessageEvent) => {
      if (!iframeRef.current?.contentWindow || evt.source !== iframeRef.current.contentWindow) {
        return;
      }
      const data = evt.data as { type?: string; id?: string; height?: number } | null;
      if (
        data?.type === 'cb-sandbox-height' &&
        data.id === frameId &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height)
      ) {
        setHeight(Math.min(Math.max(Math.round(data.height), 160), 760));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId, mode, isStreaming]);

  const handleCopy = async () => {
    await copy(code);
  };

  const hideChrome = frameless && mode === 'preview';

  return (
    <div
      className={
        hideChrome
          ? 'my-4 rounded-xl overflow-hidden group/media relative'
          : 'my-4 rounded-2xl border border-borderc bg-surface/40 overflow-hidden'
      }
    >
      <div
        className={
          hideChrome
            ? 'absolute top-2 right-2 z-20 flex items-center gap-1 rounded-xl border border-borderc bg-elevated/90 backdrop-blur-md px-1.5 py-1 opacity-85 pointer-events-auto sm:opacity-0 sm:pointer-events-none sm:group-hover/media:opacity-100 sm:group-hover/media:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto transition-opacity duration-200 shadow-sm'
            : 'flex items-center justify-between px-3.5 py-2 border-b border-borderc bg-surface/60'
        }
      >
        {!hideChrome && (
          <span className="text-[11px] font-mono font-medium tracking-wide text-muted uppercase">
            交互沙盒预览
          </span>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode((m) => (m === 'preview' ? 'code' : 'preview'))}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted hover:text-fg hover:bg-white/10 transition"
          >
            {mode === 'preview' ? (
              <>
                <Code2 className="w-3.5 h-3.5" />
                <span>源码</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                <span>运行</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title="重置运行状态"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title="复制代码"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-fg" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() =>
              onInspect({
                kind: 'iframe',
                title: '交互式实验全屏视图',
                htmlDoc: buildInjectedDocument(code, `${frameId}_lb`, theme, accentColor, false),
                rawSource: code,
              })
            }
            className="p-1.5 rounded-lg text-muted hover:text-fg hover:bg-white/10 transition"
            title="全屏交互"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {mode === 'code' ? (
        <pre className="p-4 text-xs font-mono overflow-x-auto text-muted m-0">
          <code>{code}</code>
        </pre>
      ) : isStreaming ? (
        <div className="p-6 text-center text-xs text-muted">正在编写交互式实验代码…</div>
      ) : (
        <iframe
          ref={iframeRef}
          key={`${reloadNonce}_${theme}`}
          title="Interactive Sandbox"
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          style={{ height: `${height}px` }}
          className="w-full border-0 bg-transparent block"
        />
      )}
    </div>
  );
});
