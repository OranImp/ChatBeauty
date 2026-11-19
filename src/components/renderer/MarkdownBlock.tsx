import React, { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { AppearanceSettings } from '@/types/settings';
import type { ResolvedTheme } from './svgUtils';
import type { LightboxPayload } from './LightboxModal';
import { SvgDiagramCard } from './SvgDiagramCard';
import { MermaidBlock } from './MermaidBlock';
import { EChartsBlock } from './EChartsBlock';
import { SandboxArtifactCard } from './SandboxArtifactCard';
import { CodeBlock } from './CodeBlock';
import { CalloutBlock, extractCalloutFromChildren } from './CalloutBlock';
import { Check, Copy } from 'lucide-react';

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
  const [copied, setCopied] = React.useState(false);
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
    await navigator.clipboard.writeText(tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="my-4 rounded-xl border border-borderc bg-surface/35 overflow-hidden">
      <div className="flex justify-end px-2.5 py-1 border-b border-borderc/50 bg-surface/50">
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

export const MarkdownBlock: React.FC<MarkdownBlockProps> = memo(
  ({ content, theme, appearance, isStreaming, onInspect }) => {
    const handleContainerClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const katexEl = target.closest('.katex');
      if (!katexEl) return;
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

    const components = useMemo<Components>(
      () => ({
        pre: ({ node, children }) => {
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
                onInspect={onInspect}
              />
            );
          }

          if (lang === 'mermaid') {
            return (
              <MermaidBlock
                code={rawCode}
                theme={theme}
                isStreaming={isStreaming}
                onInspect={onInspect}
              />
            );
          }

          if (lang === 'echarts' || lang === 'chart') {
            return <EChartsBlock code={rawCode} theme={theme} isStreaming={isStreaming} />;
          }

          if (
            lang === 'html-preview' ||
            lang === 'interactive' ||
            lang === 'artifact' ||
            (lang === 'html' && appearance.autoPreviewArtifacts && /<canvas|<script/i.test(rawCode))
          ) {
            return (
              <SandboxArtifactCard
                code={rawCode}
                theme={theme}
                accentColor={appearance.accentColor}
                isStreaming={isStreaming}
                defaultPreview
                onInspect={onInspect}
              />
            );
          }

          return (
            <CodeBlock
              language={lang}
              code={rawCode}
              theme={theme}
              codeThemePref={appearance.codeTheme}
              showLineNumbers={appearance.showLineNumbers}
              accentColor={appearance.accentColor}
              isStreaming={isStreaming}
              onInspect={onInspect}
            />
          );
        },
        code: ({
          className,
          children,
          ...rest
        }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => {
          // Block codes are handled by `pre`; only inline code lands directly without `pre`
          return (
            <code
              className={`px-1.5 py-0.5 rounded-md bg-white/[0.08] border border-borderc/60 font-mono text-[0.875em] text-fg ${
                className || ''
              }`}
              {...rest}
            >
              {children}
            </code>
          );
        },
        blockquote: ({ children }: { children?: React.ReactNode }) => {
          const { kind, cleanedChildren } = extractCalloutFromChildren(children);
          if (kind) {
            return <CalloutBlock kind={kind}>{cleanedChildren}</CalloutBlock>;
          }
          return (
            <blockquote className="my-3.5 pl-4 border-l-2 border-accent/60 text-muted italic">
              {children}
            </blockquote>
          );
        },
        table: ({ children }: { children?: React.ReactNode }) => (
          <TableWrapper>{children}</TableWrapper>
        ),
        thead: ({ children }: { children?: React.ReactNode }) => (
          <thead className="bg-white/[0.04] text-left border-b border-borderc">{children}</thead>
        ),
        th: ({ children }: { children?: React.ReactNode }) => (
          <th className="px-3.5 py-2.5 font-semibold text-xs tracking-wide text-fg whitespace-nowrap">
            {children}
          </th>
        ),
        td: ({ children }: { children?: React.ReactNode }) => (
          <td className="px-3.5 py-2 border-t border-borderc/50 text-fg/90">{children}</td>
        ),
        a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-4 decoration-accent/50 hover:decoration-accent"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-5 border-borderc" />,
      }),
      [theme, appearance, isStreaming, onInspect]
    );

    return (
      <div className="cb-markdown" onClick={handleContainerClick}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[[rehypeKatex, { strict: false, trust: true }]]}
          components={components}
        >
          {content}
        </ReactMarkdown>
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
    prev.appearance.accentColor === next.appearance.accentColor
);
