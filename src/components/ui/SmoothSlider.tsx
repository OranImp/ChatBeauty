import React, { useState } from 'react';

interface SmoothSliderProps {
  value: number;
  min: number;
  max: number;
  decimals?: number;
  onChange: (next: number) => void;
  ariaLabel?: string;
}

/**
 * Continuous, step-free slider with smooth visual tracking even when
 * quantized values (decimals = 0) are emitted to state.
 */
export const SmoothSlider: React.FC<SmoothSliderProps> = ({
  value,
  min,
  max,
  decimals = 2,
  onChange,
  ariaLabel,
}) => {
  const [draggingVal, setDraggingVal] = useState<number | null>(null);
  const displayVal = draggingVal ?? value;
  const span = max - min || 1;
  const pct = Math.max(0, Math.min(100, ((displayVal - min) / span) * 100));

  const formatOutput = (raw: number): number => {
    if (decimals <= 0) return Math.round(raw);
    const factor = 10 ** decimals;
    return Math.round(raw * factor) / factor;
  };

  return (
    <div className="relative h-6 flex items-center select-none group">
      {/* Visual continuous track */}
      <div className="w-full h-[4px] rounded-full bg-fg/15 overflow-hidden pointer-events-none">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: 'var(--accent)',
          }}
        />
      </div>

      {/* Visual smooth thumb */}
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full pointer-events-none shadow-sm transition-transform duration-100 group-hover:scale-110 group-active:scale-125"
        style={{
          left: `${pct}%`,
          backgroundColor: 'var(--accent)',
          border: '2px solid var(--bg)',
        }}
      />

      {/* Native continuous range input (step="any") */}
      <input
        type="range"
        min={min}
        max={max}
        step="any"
        value={displayVal}
        aria-label={ariaLabel}
        onPointerDown={() => setDraggingVal(value)}
        onPointerUp={() => setDraggingVal(null)}
        onPointerCancel={() => setDraggingVal(null)}
        onBlur={() => setDraggingVal(null)}
        onChange={(e) => {
          const raw = parseFloat(e.target.value);
          if (!Number.isFinite(raw)) return;
          setDraggingVal(raw);
          onChange(formatOutput(raw));
        }}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 m-0"
      />
    </div>
  );
};
