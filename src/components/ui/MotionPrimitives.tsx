import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface PresenceState {
  mounted: boolean;
  visible: boolean;
  state: 'open' | 'closed';
  phase: 'enter' | 'entered' | 'exit' | 'unmounted';
}

/**
 * Coordinates synchronous DOM mount + deterministic enter/exit phases so
 * @keyframes animations trigger reliably on frame 0 without rAF coalescing races.
 */
export function usePresence(open: boolean, exitMs = 200): PresenceState {
  const [mounted, setMounted] = useState<boolean>(open);
  const [entered, setEntered] = useState<boolean>(open);

  if (open && !mounted) {
    setMounted(true);
  }
  const isMounted = open || mounted;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const delay = prefersReducedMotion() ? 0 : exitMs;

    if (open) {
      setMounted(true);
      if (delay <= 0) {
        setEntered(true);
      } else {
        timer = setTimeout(() => {
          setEntered(true);
        }, delay);
      }
    } else {
      setEntered(false);
      timer = setTimeout(() => {
        setMounted(false);
      }, delay);
    }

    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [open, exitMs]);

  const phase: PresenceState['phase'] = !isMounted
    ? 'unmounted'
    : !open
      ? 'exit'
      : entered
        ? 'entered'
        : 'enter';

  return {
    mounted: isMounted,
    visible: open,
    state: open ? 'open' : 'closed',
    phase,
  };
}

interface CollapsibleProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  keepMounted?: boolean;
  durationMs?: number;
}

/**
 * Smooth height & opacity accordion powered by scrollHeight measurement +
 * forced layout reflow, with optional lazy unmounting when collapsed.
 */
export const Collapsible: React.FC<CollapsibleProps> = ({
  open,
  children,
  className,
  keepMounted = false,
  durationMs = 240,
}) => {
  const [mounted, setMounted] = useState<boolean>(open || keepMounted);

  if ((open || keepMounted) && !mounted) {
    setMounted(true);
  }
  const isMounted = open || keepMounted || mounted;

  const outerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const initialStyleRef = useRef<React.CSSProperties>({
    height: open ? 'auto' : '0px',
    opacity: open ? 1 : 0,
  });
  const isFirstRenderRef = useRef<boolean>(true);
  const prevOpenRef = useRef<boolean>(open);

  useIsomorphicLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      prevOpenRef.current = open;
      return;
    }

    if (prevOpenRef.current === open) return;
    prevOpenRef.current = open;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    if (prefersReducedMotion()) {
      outer.style.transition = '';
      outer.style.height = open ? 'auto' : '0px';
      outer.style.opacity = open ? '1' : '0';
      if (!open && !keepMounted) {
        setMounted(false);
      }
      return;
    }

    const closeDuration = Math.max(180, durationMs - 20);
    const activeDuration = open ? durationMs : closeDuration;

    const finish = () => {
      if (settled) return;
      settled = true;
      outer.removeEventListener('transitionend', onTransitionEnd);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      outer.style.transition = '';
      if (open) {
        outer.style.height = 'auto';
        outer.style.opacity = '1';
      } else {
        outer.style.height = '0px';
        outer.style.opacity = '0';
        if (!keepMounted) {
          setMounted(false);
        }
      }
    };

    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === outer && e.propertyName === 'height') {
        finish();
      }
    };

    if (open) {
      const targetH = contentRef.current?.scrollHeight ?? 0;
      outer.style.transition = 'none';
      outer.style.height = '0px';
      outer.style.opacity = '0';
      void outer.offsetHeight;
      outer.addEventListener('transitionend', onTransitionEnd);
      outer.style.transition = `height ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${Math.max(160, durationMs - 30)}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      outer.style.height = `${targetH}px`;
      outer.style.opacity = '1';
    } else {
      const currentH = outer.getBoundingClientRect().height || contentRef.current?.scrollHeight || 0;
      outer.style.transition = 'none';
      outer.style.height = `${currentH}px`;
      outer.style.opacity = '1';
      void outer.offsetHeight;
      outer.addEventListener('transitionend', onTransitionEnd);
      outer.style.transition = `height ${closeDuration}ms cubic-bezier(0.22, 1, 0.36, 1), opacity 170ms ease-out`;
      outer.style.height = '0px';
      outer.style.opacity = '0';
    }

    timer = setTimeout(finish, activeDuration + 40);

    return () => {
      settled = true;
      outer.removeEventListener('transitionend', onTransitionEnd);
      if (timer !== null) clearTimeout(timer);
    };
  }, [open, keepMounted, durationMs]);

  return (
    <div
      ref={outerRef}
      style={initialStyleRef.current}
      className={`overflow-hidden ${open ? '' : 'pointer-events-none'} ${className || ''}`}
      aria-hidden={!open}
    >
      {isMounted && (
        <div ref={contentRef} className="min-w-0">
          {children}
        </div>
      )}
    </div>
  );
};
