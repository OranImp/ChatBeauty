import React, { useEffect, useId, useMemo, useState } from 'react';
import { Check, Code2, Copy, Maximize2, Play, RotateCcw } from 'lucide-react';
import type { ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';

interface SandboxArtifactCardProps {
  code: string;
  theme: ResolvedTheme;
  accentColor: string;
  isStreaming?: boolean;
  defaultPreview?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

function buildInjectedDocument(
  rawHtml: string,
  frameId: string,
  theme: ResolvedTheme,
  accent: string
): string {
  const isLight = theme === 'light';
  const themeStyle = `<style>
    :root {
      --bg: ${theme === 'oled' ? '#000000' : theme === 'dark' ? '#141416' : '#ffffff'};
      --surface: ${isLight ? '#f4f4f5' : '#18181b'};
      --fg: ${isLight ? '#18181b' : '#f4f4f5'};
      --muted: ${isLight ? '#71717a' : '#a1a1aa'};
      --accent: ${accent};
      --border: ${isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)'};
      color-scheme: ${isLight ? 'light' : 'dark'};
    }
    html, body { color: var(--fg); background: transparent; }
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

  const resizeScript = `<script>
    (function() {
      function sendHeight() {
        var h = Math.max(
          document.documentElement ? document.documentElement.scrollHeight : 0,
          document.body ? document.body.scrollHeight : 0
        );
        window.parent.postMessage({ type: 'cb-sandbox-height', id: ${JSON.stringify(frameId)}, height: Math.min(Math.max(h, 160), 760) }, '*');
      }
      window.addEventListener('load', sendHeight);
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(sendHeight).observe(document.documentElement);
      }
      setTimeout(sendHeight, 120);
      setTimeout(sendHeight, 450);
    })();
  </script>`;

  if (/<\/head>/i.test(rawHtml) && /<\/body>/i.test(rawHtml)) {
    return rawHtml
      .replace(/<\/head>/i, `${themeStyle}</head>`)
      .replace(/<\/body>/i, `${resizeScript}</body>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"/>${themeStyle}</head><body>${rawHtml}${resizeScript}</body></html>`;
}

export const SandboxArtifactCard: React.FC<SandboxArtifactCardProps> = ({
  code,
  theme,
  accentColor,
  isStreaming,
  defaultPreview = true,
  onInspect,
}) => {
  const frameId = useId();
  const [mode, setMode] = useState<'preview' | 'code'>(defaultPreview ? 'preview' : 'code');
  const [height, setHeight] = useState(240);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  const srcDoc = useMemo(
    () => buildInjectedDocument(code, frameId, theme, accentColor),
    [code, frameId, theme, accentColor]
  );

  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      const data = evt.data as { type?: string; id?: string; height?: number } | null;
      if (data?.type === 'cb-sandbox-height' && data.id === frameId && typeof data.height === 'number') {
        setHeight(data.height);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frameId]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 rounded-2xl border border-borderc bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-borderc bg-surface/60">
        <span className="text-[11px] font-medium tracking-wide text-muted uppercase">
          交互沙盒预览
        </span>
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
                htmlDoc: srcDoc,
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
      ) : isStreaming && !/<\/(html|body|script)>/i.test(code) ? (
        <div className="p-6 text-center text-xs text-muted">正在编写交互式实验代码…</div>
      ) : (
        <iframe
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
};
