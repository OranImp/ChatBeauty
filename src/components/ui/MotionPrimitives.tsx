import React, { useEffect, useState } from 'react';

/**
 * Coordinates mount + visible state so CSS entry/exit transitions animate
 * cleanly without skipping initial frames or getting stuck on rapid toggles.
 */
export function usePresence(
  open: boolean,
  exitMs = 200
): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState<boolean>(open);
  const [visible, setVisible] = useState<boolean>(false);

  useEffect(() => {
    let raf1: number | null = null;
    let raf2: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (open) {
      setMounted(true);
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          setVisible(true);
        });
      });
    } else {
      setVisible(false);
      timer = setTimeout(() => {
        setMounted(false);
      }, exitMs);
    }

    return () => {
      if (raf1 !== null) cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      if (timer !== null) clearTimeout(timer);
    };
  }, [open, exitMs]);

  return { mounted, visible };
}

interface CollapsibleProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Smooth height & opacity accordion powered by CSS grid row transitions.
 */
export const Collapsible: React.FC<CollapsibleProps> = ({ open, children, className }) => {
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0 pointer-events-none'
      } ${className || ''}`}
      aria-hidden={!open}
    >
      <div className="overflow-hidden min-h-0">{children}</div>
    </div>
  );
};
