import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, Image as ImageIcon, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { exportSvgToPng, triggerDownload, type ResolvedTheme } from './svgUtils';
import { usePresence } from '@/components/ui/MotionPrimitives';

export type LightboxPayload =
  | { kind: 'svg'; title?: string; svgHtml: string; rawSource: string }
  | { kind: 'math'; latex: string; katexHtml: string }
  | { kind: 'iframe'; title?: string; htmlDoc: string; rawSource: string }
  | { kind: 'image'; title?: string; src: string };

interface LightboxModalProps {
  payload: LightboxPayload | null;
  theme: ResolvedTheme;
  onClose: () => void;
}

export const LightboxModal: React.FC<LightboxModalProps> = ({ payload, theme, onClose }) => {
  const [renderedPayload, setRenderedPayload] = useState<LightboxPayload | null>(payload);
  const lightboxPresence = usePresence(Boolean(payload), 200);
  const [displayScale, setDisplayScale] = useState(1);
  const [copied, setCopied] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<{ x: number; y: number; scale: number }>({
    x: 0,
    y: 0,
    scale: 1,
  });
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const tapTrackRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  const applyTransform = (
    next: { x: number; y: number; scale: number },
    smooth = false
  ) => {
    const clampedScale = Math.max(0.4, Math.min(6, next.scale));
    const committed = { x: next.x, y: next.y, scale: clampedScale };
    transformRef.current = committed;
    const el = contentRef.current;
    if (el) {
      el.style.transition = smooth ? 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
      el.style.transform = `translate3d(${committed.x}px, ${committed.y}px, 0) scale(${committed.scale})`;
    }
    const nextPct = Math.round(clampedScale * 100);
    setDisplayScale((prev) => (Math.round(prev * 100) === nextPct ? prev : clampedScale));
  };

  const zoomAroundPoint = (
    targetScale: number,
    clientX: number,
    clientY: number,
    smooth = false
  ) => {
    const curr = transformRef.current;
    const clampedScale = Math.max(0.4, Math.min(6, targetScale));
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || curr.scale <= 0) {
      applyTransform({ x: curr.x, y: curr.y, scale: clampedScale }, smooth);
      return;
    }
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const px = clientX - cx;
    const py = clientY - cy;
    const ratio = clampedScale / curr.scale;
    applyTransform(
      {
        x: px - (px - curr.x) * ratio,
        y: py - (py - curr.y) * ratio,
        scale: clampedScale,
      },
      smooth
    );
  };

  useEffect(() => {
    if (payload) {
      setRenderedPayload(payload);
      const initialScale = payload.kind === 'math' ? 1.45 : 1;
      activePointers.current.clear();
      lastPinchRef.current = null;
      tapTrackRef.current = null;
      transformRef.current = { x: 0, y: 0, scale: initialScale };
      setDisplayScale(initialScale);
      setCopied(false);
      requestAnimationFrame(() => {
        applyTransform({ x: 0, y: 0, scale: initialScale }, false);
      });
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

  const defaultScale = activePayload.kind === 'math' ? 1.45 : 1;

  const copySource = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAroundPoint(transformRef.current.scale * factor, e.clientX, e.clientY, false);
  };

  const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic events where pointer capture isn't registered
    }
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      lastPinchRef.current = null;
      tapTrackRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
    } else if (activePointers.current.size === 2) {
      tapTrackRef.current = null;
      const pts = Array.from(activePointers.current.values());
      lastPinchRef.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
    }
  };

  const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (activePayload.kind === 'iframe') return;
    const prev = activePointers.current.get(e.pointerId);
    if (!prev) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (
        tapTrackRef.current &&
        tapTrackRef.current.pointerId === e.pointerId &&
        Math.hypot(e.clientX - tapTrackRef.current.startX, e.clientY - tapTrackRef.current.startY) > 10
      ) {
        tapTrackRef.current.moved = true;
      }
      const curr = transformRef.current;
      applyTransform({ x: curr.x + dx, y: curr.y + dy, scale: curr.scale }, false);
    } else if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const prevPinch = lastPinchRef.current;
      if (prevPinch && prevPinch.dist > 4) {
        const curr = transformRef.current;
        const panDx = midX - prevPinch.midX;
        const panDy = midY - prevPinch.midY;
        transformRef.current = { ...curr, x: curr.x + panDx, y: curr.y + panDy };
        zoomAroundPoint(curr.scale * (dist / prevPinch.dist), midX, midY, false);
      }
      lastPinchRef.current = { dist, midX, midY };
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, allowTap: boolean) => {
    activePointers.current.delete(e.pointerId);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore synthetic event cleanup
    }

    if (activePointers.current.size < 2) {
      lastPinchRef.current = null;
    }

    if (
      allowTap &&
      activePointers.current.size === 0 &&
      tapTrackRef.current &&
      tapTrackRef.current.pointerId === e.pointerId &&
      !tapTrackRef.current.moved
    ) {
      const now = Date.now();
      const prevTap = lastTapRef.current;
      if (
        now - prevTap.time < 280 &&
        Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 28
      ) {
        lastTapRef.current = { time: 0, x: 0, y: 0 };
        if (Math.abs(transformRef.current.scale - defaultScale) < 0.2) {
          zoomAroundPoint(defaultScale * 2.2, e.clientX, e.clientY, true);
        } else {
          applyTransform({ x: 0, y: 0, scale: defaultScale }, true);
        }
      } else {
        lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
      }
    }

    if (tapTrackRef.current?.pointerId === e.pointerId) {
      tapTrackRef.current = null;
    }
  };

  const stepZoom = (delta: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : 0;
    const cy = rect ? rect.top + rect.height / 2 : 0;
    zoomAroundPoint(transformRef.current.scale + delta, cx, cy, true);
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
              : activePayload.kind === 'image'
                ? activePayload.title || '图片预览'
                : activePayload.title || (activePayload.kind === 'iframe' ? '交互式实验预览' : '矢量图形查看器')}
          </div>
        <div className="flex items-center gap-1.5">
          {activePayload.kind !== 'iframe' && (
            <>
              <button
                type="button"
                onClick={() => stepZoom(-0.25)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="缩小"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-xs text-zinc-400 w-11 text-center tabular-nums">
                {Math.round(displayScale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => stepZoom(0.25)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="放大"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => applyTransform({ x: 0, y: 0, scale: defaultScale }, true)}
                className="p-2 rounded-lg hover:bg-white/10 transition"
                title="重置视角"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </>
          )}

          {activePayload.kind !== 'image' && (
            <button
              type="button"
              onClick={() =>
                void copySource(
                  activePayload.kind === 'math' ? activePayload.latex : activePayload.rawSource
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs transition"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-fg" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{activePayload.kind === 'math' ? '复制 LaTeX' : '复制源码'}</span>
            </button>
          )}

          {activePayload.kind === 'image' && (
            <button
              type="button"
              onClick={() =>
                triggerDownload(
                  `chatbeauty-image-${Date.now()}.png`,
                  activePayload.src
                )
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载图片</span>
            </button>
          )}

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
          ref={viewportRef}
          className="flex-1 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none p-6"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishPointer(e, true)}
          onPointerCancel={(e) => finishPointer(e, false)}
        >
          <div
            ref={contentRef}
            style={{
              transform: `translate3d(${transformRef.current.x}px, ${transformRef.current.y}px, 0) scale(${transformRef.current.scale})`,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
            className="max-w-[92vw] pointer-events-none"
          >
            {activePayload.kind === 'svg' ? (
              <div
                className="w-[min(860px,88vw)] text-zinc-100 p-4 rounded-2xl border border-white/10 bg-zinc-950/80"
                dangerouslySetInnerHTML={{ __html: activePayload.svgHtml }}
              />
            ) : activePayload.kind === 'image' ? (
              <img
                src={activePayload.src}
                alt={activePayload.title || 'image'}
                className="max-w-[88vw] max-h-[78vh] object-contain rounded-xl select-none"
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
