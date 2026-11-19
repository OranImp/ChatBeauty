import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Image as ImageIcon, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { exportSvgToPng, triggerDownload, type ResolvedTheme } from './svgUtils';
import { usePresence } from '@/components/ui/MotionPrimitives';

export type LightboxPayload =
  | { kind: 'svg'; title?: string; svgHtml: string; rawSource: string }
  | { kind: 'math'; latex: string; katexHtml: string }
  | { kind: 'iframe'; title?: string; htmlDoc: string; rawSource: string };

interface LightboxModalProps {
  payload: LightboxPayload | null;
  theme: ResolvedTheme;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({ payload, theme, onClose }) => {
  const [renderedPayload, setRenderedPayload] = useState<LightboxPayload | null>(payload);
  const lightboxPresence = usePresence(Boolean(payload), 200);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const dragging = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  });
  const pinchDist = useRef<number | null>(null);

  useEffect(() => {
    if (payload) {
      setRenderedPayload(payload);
      setScale(payload.kind === 'math' ? 1.45 : 1);
      setOffset({ x: 0, y: 0 });
      setCopied(false);
    }
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, onClose]);

  const activePayload = payload ?? renderedPayload;
  if (!lightboxPresence.mounted || !activePayload) return null;

  const copySource = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.14 : -0.14;
    setScale((prev) => Math.max(0.4, Math.min(5, Number((prev + delta).toFixed(2)))));
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    dragging.current = { active: true, x: e.clientX - offset.x, y: e.clientY - offset.y };
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (!dragging.current.active) return;
    setOffset({
      x: e.clientX - dragging.current.x,
      y: e.clientY - dragging.current.y,
    });
  };

  const handlePointerUp = () => {
    dragging.current.active = false;
  };

  const handleTouchMove: React.TouchEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (pinchDist.current !== null) {
        const ratio = dist / pinchDist.current;
        setScale((prev) => Math.max(0.4, Math.min(5, Number((prev * ratio).toFixed(2)))));
      }
      pinchDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    pinchDist.current = null;
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-md text-zinc-100 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        lightboxPresence.visible
          ? 'opacity-100 scale-100'
          : 'opacity-0 scale-[0.97] pointer-events-none'
      }`}
      role="dialog"
      aria-modal="true"
    >
      {/* Top Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 safe-top">
        <div className="text-sm font-medium truncate max-w-[45%]">
          {activePayload.kind === 'math'
            ? '公式详情 & LaTeX 源码'
            : activePayload.title || (activePayload.kind === 'iframe' ? '交互式实验预览' : '矢量图形查看器')}
        </div>
        <div className="flex items-center gap-1.5">
          {activePayload.kind !== 'iframe' && (
            <>
              <button
                type="button"
                onClick={() => setScale((s) => Math.max(0.4, Number((s - 0.2).toFixed(2))))}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="缩小"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-400 w-11 text-center tabular-nums">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setScale((s) => Math.min(5, Number((s + 0.2).toFixed(2))))}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="放大"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setScale(activePayload.kind === 'math' ? 1.45 : 1);
                  setOffset({ x: 0, y: 0 });
                }}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="重置视角"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() =>
              void copySource(activePayload.kind === 'math' ? activePayload.latex : activePayload.rawSource)
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs transition"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-fg" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{activePayload.kind === 'math' ? '复制 LaTeX' : '复制源码'}</span>
          </button>

          {activePayload.kind === 'svg' && (
            <>
              <button
                type="button"
                onClick={() =>
                  triggerDownload(
                    `chatbeauty-diagram-${Date.now()}.svg`,
                    new Blob([activePayload.rawSource], { type: 'image/svg+xml;charset=utf-8' })
                  )
                }
                className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>SVG</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void exportSvgToPng(
                    activePayload.svgHtml,
                    `chatbeauty-diagram-${Date.now()}.png`,
                    theme
                  )
                }
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs transition"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>导出 PNG</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition ml-1"
            title="关闭"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      {activePayload.kind === 'iframe' ? (
        <div className="flex-1 p-3 sm:p-6">
          <iframe
            title={activePayload.title || 'Interactive Preview'}
            srcDoc={activePayload.htmlDoc}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            className="w-full h-full rounded-2xl border border-white/15 bg-transparent"
          />
        </div>
      ) : (
        <div
          className="flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none p-6"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: 'center center',
            }}
            className="transition-transform duration-75 max-w-[92vw]"
          >
            {activePayload.kind === 'svg' ? (
              <div
                className="w-[min(860px,88vw)] text-zinc-100 p-4 rounded-2xl border border-white/10 bg-zinc-950/80"
                dangerouslySetInnerHTML={{ __html: activePayload.svgHtml }}
              />
            ) : (
              <div
                className="p-6 rounded-2xl border border-white/10 bg-zinc-950/90 text-zinc-100 text-lg overflow-x-auto max-w-[88vw]"
                dangerouslySetInnerHTML={{ __html: activePayload.katexHtml }}
              />
            )}
          </div>
        </div>
      )}

      {activePayload.kind === 'math' && (
        <div className="px-4 py-3 border-t border-white/10 bg-zinc-950/80 shrink-0 safe-bottom">
          <div className="max-w-3xl mx-auto">
            <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">
              LaTeX 源码
            </div>
            <pre className="text-xs font-mono text-zinc-200 bg-black/50 p-2.5 rounded-lg overflow-x-auto border border-white/10">
              {activePayload.latex}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
