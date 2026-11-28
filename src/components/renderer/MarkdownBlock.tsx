import React, { Suspense, createContext, lazy, memo, useContext, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { AppearanceSettings } from '@/types/settings';
import type { ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';
import { SvgDiagramCard } from './SvgDiagramCard';
import { SandboxArtifactCard } from './SandboxArtifactCard';
import { CodeBlock } from './CodeBlock';
import { CalloutBlock, extractCalloutFromChildren } from './CalloutBlock';
import { Check, Copy } from 'lucide-react';
import { useCopyFeedback } from '@/hooks/useCopyFeedback';

const MermaidBlock = lazy(() =>
  import('./MermaidBlock').then((m) => ({ default: m.MermaidBlock }))
);
const EChartsBlock = lazy(() =>
  import('./EChartsBlock').then((m) => ({ default: m.EChartsBlock }))
);

interface MarkdownRenderContextValue {
  theme: ResolvedTheme;
  codeTheme: AppearanceSettings['codeTheme'];
  showLineNumbers: boolean;
  autoPreviewArtifacts: boolean;
  hideMediaFrames: boolean;
  accentColor: string;
  isStreaming: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

const NOOP_INSPECT = () => undefined;

const MarkdownRenderContext = createContext<MarkdownRenderContextValue>({
  theme: 'dark',
  codeTheme: 'auto',
  showLineNumbers: false,
  autoPreviewArtifacts: true,
  hideMediaFrames: false,
  accentColor: '#d97757',
  isStreaming: false,
  onInspect: NOOP_INSPECT,
});

type ReactMarkdownProps = React.ComponentProps<typeof ReactMarkdown>;
const REMARK_PLUGINS: NonNullable<ReactMarkdownProps['remarkPlugins']> = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: NonNullable<ReactMarkdownProps['rehypePlugins']> = [
  [
    rehypeKatex,
    {
      strict: false,
      trust: (ctx: { command?: string; url?: string }) =>
        ctx.command === '\\href' &&
        typeof ctx.url === 'string' &&
        /^https?:\/\//i.test(ctx.url.trim()),
    },
  ],
];

interface MarkdownBlockProps {
  content: string;
  theme: ResolvedTheme;
  appearance: AppearanceSettings;
  isStreaming?: boolean;
  onInspect: (payload: LightboxPayload) => void;
}

function parseCaptionFromMeta(meta: string | undefined): string | undefined {
  if (!meta) return undefined;
  const quoted = /caption\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(meta);
  if (quoted) return (quoted[1] ?? quoted[2] ?? '').trim();
  return undefined;
}

function extractTextContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractTextContent).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractTextContent(node.props.children);
  }
  return '';
}

const TableWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { copied, copy } = useCopyFeedback();
  const tableRef = React.useRef<HTMLTableElement | null>(null);

  const handleCopyTsv = async () => {
    if (!tableRef.current) return;
    const rows = Array.from(tableRef.current.querySelectorAll('tr'));
    const tsv = rows
      .map((tr) =>
        Array.from(tr.querySelectorAll('th,td'))
          .map((cell) => (cell.textContent || '').trim())
          .join('\t')
      )
      .join('\n');
    await copy(tsv);
  };

  return (
    <div className="my-4 rounded-xl border border-borderc bg-surface/35 overflow-hidden">
      <div className="flex justify-end px-2.5 py-1 border-b border-borderc bg-surface/50">
        <button
          type="button"
          onClick={() => void handleCopyTsv()}
          className="flex items-center gap-1 text-[11px] text-muted hover:text-fg px-2 py-0.5 rounded transition"
        >
          {copied ? <Check className="w-3 h-3 text-fg" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? '已复制表格' : '复制表格'}</span>
        </button>
      </div>
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full text-sm border-collapse">
          {children}
        </table>
      </div>
    </div>
  );
};

const MarkdownPre: Components['pre'] = ({ node, children }) => {
  const {
    theme,
    codeTheme,
    showLineNumbers,
    autoPreviewArtifacts,
    hideMediaFrames,
    accentColor,
    isStreaming,
    onInspect,
  } = useContext(MarkdownRenderContext);

  const codeHast = node?.children?.[0];
  const isElem = codeHast && codeHast.type === 'element';
  const rawClass = isElem ? codeHast.properties?.className : undefined;
  const classNames = Array.isArray(rawClass)
    ? rawClass.map(String)
    : typeof rawClass === 'string'
      ? [rawClass]
      : [];
  const langClass = classNames.find((c) => c.startsWith('language-'));
  const lang = (langClass ? langClass.replace('language-', '') : '').toLowerCase();
  const metaVal = isElem
    ? ((codeHast.data as { meta?: unknown } | undefined)?.meta ??
      codeHast.properties?.metastring)
    : undefined;
  const meta = typeof metaVal === 'string' ? metaVal : undefined;
  const rawCode = extractTextContent(children).replace(/\n$/, '');

  if (lang === 'svg' || (lang === 'xml' && rawCode.trim().startsWith('<svg'))) {
    return (
      <SvgDiagramCard
        code={rawCode}
        caption={parseCaptionFromMeta(meta)}
        theme={theme}
        isStreaming={isStreaming}
        frameless={hideMediaFrames}
        onInspect={onInspect}
      />
    );
  }

  if (lang === 'mermaid') {
    return (
      <Suspense
        fallback={
          <div className="my-4 p-5 text-xs text-muted rounded-2xl border border-borderc bg-surface/35 text-center">
            加载 Mermaid 图表引擎…
          </div>
        }
      >
        <MermaidBlock
          code={rawCode}
          theme={theme}
          isStreaming={isStreaming}
          frameless={hideMediaFrames}
          onInspect={onInspect}
        />
      </Suspense>
    );
  }

  if (lang === 'echarts' || lang === 'chart') {
    return (
      <Suspense
        fallback={
          <div className="my-4 p-5 text-xs text-muted rounded-2xl border border-borderc bg-surface/35 text-center">
            加载 ECharts 图表引擎…
          </div>
        }
      >
        <EChartsBlock
          code={rawCode}
          theme={theme}
          isStreaming={isStreaming}
          frameless={hideMediaFrames}
        />
      </Suspense>
    );
  }

  if (
    lang === 'html-preview' ||
    lang === 'interactive' ||
    lang === 'artifact' ||
    (lang === 'html' && autoPreviewArtifacts && /<canvas|<script/i.test(rawCode))
  ) {
    return (
      <SandboxArtifactCard
        code={rawCode}
        theme={theme}
        accentColor={accentColor}
        isStreaming={isStreaming}
        defaultPreview
        frameless={hideMediaFrames}
        onInspect={onInspect}
      />
    );
  }

  return (
    <CodeBlock
      language={lang}
      code={rawCode}
      theme={theme}
      codeThemePref={codeTheme}
      showLineNumbers={showLineNumbers}
      accentColor={accentColor}
      isStreaming={isStreaming}
      onInspect={onInspect}
    />
  );
};

const MarkdownCode: Components['code'] = ({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
  <code
    className={`px-1.5 py-0.5 rounded-md bg-white/[0.08] border border-borderc font-mono text-[0.875em] text-fg ${
      className || ''
    }`}
    {...rest}
  >
    {children}
  </code>
);

const MarkdownBlockquote: Components['blockquote'] = ({ children }) => {
  const { kind, cleanedChildren } = extractCalloutFromChildren(children);
  if (kind) {
    return <CalloutBlock kind={kind}>{cleanedChildren}</CalloutBlock>;
  }
  return (
    <blockquote className="my-3.5 pl-4 border-l-2 border-accent/60 text-muted italic">
      {children}
    </blockquote>
  );
};

const MarkdownTable: Components['table'] = ({ children }) => (
  <TableWrapper>{children}</TableWrapper>
);
const MarkdownThead: Components['thead'] = ({ children }) => (
  <thead className="bg-fg/[0.04] text-left border-b border-borderc">{children}</thead>
);
const MarkdownTh: Components['th'] = ({ children }) => (
  <th className="px-3.5 py-2.5 font-semibold text-xs tracking-wide text-fg whitespace-nowrap">
    {children}
  </th>
);
const MarkdownTd: Components['td'] = ({ children }) => (
  <td className="px-3.5 py-2 border-t border-borderc text-fg/90">{children}</td>
);
const MarkdownAnchor: Components['a'] = ({ href, children }) => {
  const safeHref = href && /^(https?:|mailto:|#)/i.test(href.trim()) ? href : undefined;
  return (
    <a
      href={safeHref}
      target={safeHref && !safeHref.startsWith('#') ? '_blank' : undefined}
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-4 decoration-accent/50 hover:decoration-accent"
    >
      {children}
    </a>
  );
};
const MarkdownHr: Components['hr'] = () => <hr className="my-5 border-borderc" />;

const MARKDOWN_COMPONENTS: Components = {
  pre: MarkdownPre,
  code: MarkdownCode,
  blockquote: MarkdownBlockquote,
  table: MarkdownTable,
  thead: MarkdownThead,
  th: MarkdownTh,
  td: MarkdownTd,
  a: MarkdownAnchor,
  hr: MarkdownHr,
};

export const MarkdownBlock: React.FC<MarkdownBlockProps> = memo(
  ({ content, theme, appearance, isStreaming, onInspect }) => {
    const handleContainerClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
      const sel = typeof window !== 'undefined' ? window.getSelection() : null;
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const katexEl = target.closest('.katex');
      if (!katexEl) return;

      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (anchor && katexEl.contains(anchor)) {
        const href = (anchor.getAttribute('href') || '').trim();
        e.preventDefault();
        if (/^(https?:|mailto:)/i.test(href)) {
          window.open(href, '_blank', 'noopener,noreferrer');
        }
        return;
      }

      const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]');
      const latex = annotation?.textContent?.trim();
      if (!latex) return;
      const displayWrapper = katexEl.closest('.katex-display');
      onInspect({
        kind: 'math',
        latex,
        katexHtml: (displayWrapper ?? katexEl).outerHTML,
      });
    };

    const contextValue = useMemo<MarkdownRenderContextValue>(
      () => ({
        theme,
        codeTheme: appearance.codeTheme,
        showLineNumbers: appearance.showLineNumbers,
        autoPreviewArtifacts: Boolean(appearance.autoPreviewArtifacts),
        hideMediaFrames: Boolean(appearance.hideMediaFrames),
        accentColor: appearance.accentColor,
        isStreaming: Boolean(isStreaming),
        onInspect,
      }),
      [
        theme,
        appearance.codeTheme,
        appearance.showLineNumbers,
        appearance.autoPreviewArtifacts,
        appearance.hideMediaFrames,
        appearance.accentColor,
        isStreaming,
        onInspect,
      ]
    );

    return (
      <div className="cb-markdown" onClick={handleContainerClick}>
        <MarkdownRenderContext.Provider value={contextValue}>
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={MARKDOWN_COMPONENTS}
          >
            {content}
          </ReactMarkdown>
        </MarkdownRenderContext.Provider>
      </div>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.theme === next.theme &&
    prev.isStreaming === next.isStreaming &&
    prev.appearance.codeTheme === next.appearance.codeTheme &&
    prev.appearance.showLineNumbers === next.appearance.showLineNumbers &&
    prev.appearance.autoPreviewArtifacts === next.appearance.autoPreviewArtifacts &&
    prev.appearance.hideMediaFrames === next.appearance.hideMediaFrames &&
    prev.appearance.accentColor === next.appearance.accentColor
);
