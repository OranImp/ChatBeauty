import React, { memo, useEffect, useRef, useState } from 'react';
import { Check, Copy, Play, WrapText } from 'lucide-react';
import type { ResolvedTheme } from './svgUtils';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';
import type { LightboxPayload } from './LightboxModal';
import { SandboxArtifactCard } from './SandboxArtifactCard';
import {
  getCachedHighlight,
  highlightCode,
  type SupportedShikiTheme,
} from './shikiHighlighter';

interface CodeBlockProps {
  language: string;
  code: string;
  theme: ResolvedTheme;
  codeThemePref: 'auto' | 'github-dark-default' | 'vitesse-black' | 'github-light';
  showLineNumbers: boolean;
  accentColor: string;
  isStreaming?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

export const CodeBlock: React.FC<CodeBlockProps> = memo(({
  language,
  code,
  theme,
  codeThemePref,
  showLineNumbers,
  accentColor,
  isStreaming,
  onInspect,
}) => {
  const lang = (language || 'text').toLowerCase();
  const isHtml = lang === 'html' || lang === 'htm';

  const resolvedShikiTheme: SupportedShikiTheme =
    codeThemePref === 'auto'
      ? theme === 'light'
        ? 'github-light'
        : 'github-dark-default'
      : codeThemePref;

  const initialCached = getCachedHighlight(code, lang, resolvedShikiTheme) ?? '';
  const [highlightedHtml, setHighlightedHtml] = useState<string>(initialCached);
  const { copied, copy } = useCopyFeedback();
  const [wrap, setWrap] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(false);
  const lastHighlightedKeyRef = useRef<string>(
    initialCached ? `${resolvedShikiTheme}\0${lang}\0${code}` : ''
  );

  useEffect(() => {
    const key = `${resolvedShikiTheme}\0${lang}\0${code}`;
    if (lastHighlightedKeyRef.current === key) {
      return;
    }

    const cached = getCachedHighlight(code, lang, resolvedShikiTheme);
    if (cached !== null) {
      lastHighlightedKeyRef.current = key;
      setHighlightedHtml(cached);
      return;
    }

    let cancelled = false;
    const runHighlight = async () => {
      try {
        const html = await highlightCode(code, lang, resolvedShikiTheme);
        if (!cancelled) {
          lastHighlightedKeyRef.current = key;
          setHighlightedHtml(html);
        }
      } catch {
        if (!cancelled) setHighlightedHtml('');
      }
    };

    const timer = setTimeout(() => {
      void runHighlight();
    }, isStreaming ? 120 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, lang, resolvedShikiTheme, isStreaming]);

  if (previewHtml && isHtml) {
    return (
      <div>
        <div className="flex justify-end mb-1">
          <button
            type="button"
            onClick={() => setPreviewHtml(false)}
            className="text-xs text-accent hover:underline"
          >
            返回代码视图
          </button>
        </div>
        <SandboxArtifactCard
          code={code}
          theme={theme}
          accentColor={accentColor}
          isStreaming={isStreaming}
          defaultPreview
          onInspect={onInspect}
        />
      </div>
    );
  }

  const handleCopy = () => copy(code);

  return (
    <div className="my-3.5 rounded-xl border border-borderc bg-surface/60 overflow-hidden text-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-borderc bg-surface/80 text-xs text-muted">
        <span className="font-mono text-[11px] uppercase tracking-wider">{lang}</span>
        <div className="flex items-center gap-1">
          {isHtml && (
            <button
              type="button"
              onClick={() => setPreviewHtml(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/10 text-accent transition"
              title="在隔离沙盒中运行 HTML"
            >
              <Play className="w-3 h-3" />
              <span>运行预览</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            className={`p-1.5 rounded-md hover:bg-white/10 transition ${wrap ? 'text-accent' : ''}`}
            title="自动换行"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/10 transition"
            title="复制代码"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-fg" />
                <span className="text-fg">已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">复制</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div
        className={`cb-code-container overflow-x-auto text-[13px] leading-relaxed ${
          wrap ? 'cb-code-wrap' : ''
        } ${showLineNumbers ? 'cb-code-lines' : ''}`}
      >
        {highlightedHtml ? (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        ) : (
          <pre className="p-3.5 m-0 font-mono text-fg">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
});
