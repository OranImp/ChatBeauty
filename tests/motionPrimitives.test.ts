// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Collapsible, usePresence, type PresenceState } from '@/components/ui/MotionPrimitives';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function PresenceHarness({
  open,
  exitMs = 200,
  onRender,
}: {
  open: boolean;
  exitMs?: number;
  onRender: (state: PresenceState) => void;
}) {
  const presence = usePresence(open, exitMs);
  onRender(presence);
  if (!presence.mounted) return null;
  return createElement('div', { 'data-state': presence.state, 'data-phase': presence.phase }, 'ok');
}

describe('MotionPrimitives', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('usePresence mounts synchronously on open without a null frame', () => {
    const snapshots: PresenceState[] = [];

    act(() => {
      root.render(createElement(PresenceHarness, { open: false, onRender: (s) => snapshots.push(s) }));
    });
    expect(container.querySelector('[data-state]')).toBeNull();
    expect(snapshots.at(-1)?.mounted).toBe(false);

    snapshots.length = 0;
    act(() => {
      root.render(createElement(PresenceHarness, { open: true, onRender: (s) => snapshots.push(s) }));
    });

    expect(snapshots[0].mounted).toBe(true);
    expect(snapshots[0].visible).toBe(true);
    expect(snapshots[0].state).toBe('open');
    expect(container.querySelector('[data-state="open"]')).not.toBeNull();
  });

  it('usePresence waits for exitMs before unmounting on close', () => {
    const snapshots: PresenceState[] = [];

    act(() => {
      root.render(
        createElement(PresenceHarness, { open: true, exitMs: 200, onRender: (s) => snapshots.push(s) })
      );
    });
    expect(container.querySelector('[data-state="open"]')).not.toBeNull();

    act(() => {
      root.render(
        createElement(PresenceHarness, { open: false, exitMs: 200, onRender: (s) => snapshots.push(s) })
      );
    });
    expect(snapshots.at(-1)?.state).toBe('closed');
    expect(snapshots.at(-1)?.visible).toBe(false);
    expect(snapshots.at(-1)?.mounted).toBe(true);
    expect(container.querySelector('[data-state="closed"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(190);
    });
    expect(container.querySelector('[data-state="closed"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(15);
    });
    expect(container.querySelector('[data-state]')).toBeNull();
  });

  it('usePresence cancels pending unmount timer on rapid true -> false -> true toggle', () => {
    const snapshots: PresenceState[] = [];

    act(() => {
      root.render(
        createElement(PresenceHarness, { open: true, exitMs: 200, onRender: (s) => snapshots.push(s) })
      );
    });
    act(() => {
      root.render(
        createElement(PresenceHarness, { open: false, exitMs: 200, onRender: (s) => snapshots.push(s) })
      );
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      root.render(
        createElement(PresenceHarness, { open: true, exitMs: 200, onRender: (s) => snapshots.push(s) })
      );
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(snapshots.at(-1)?.mounted).toBe(true);
    expect(snapshots.at(-1)?.state).toBe('open');
    expect(container.querySelector('[data-state="open"]')).not.toBeNull();
  });

  it('Collapsible mounts lazily on open, unmounts after close when keepMounted=false, and respects keepMounted=true', () => {
    act(() => {
      root.render(
        createElement(Collapsible, {
          open: false,
          durationMs: 220,
          children: createElement('span', { 'data-testid': 'panel-body' }, 'panel-content'),
        })
      );
    });
    expect(container.querySelector('[data-testid="panel-body"]')).toBeNull();

    act(() => {
      root.render(
        createElement(Collapsible, {
          open: true,
          durationMs: 220,
          children: createElement('span', { 'data-testid': 'panel-body' }, 'panel-content'),
        })
      );
    });
    expect(container.querySelector('[data-testid="panel-body"]')?.textContent).toBe('panel-content');

    act(() => {
      vi.advanceTimersByTime(280);
    });
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.height).toBe('auto');
    expect(outer.style.opacity).toBe('1');

    act(() => {
      root.render(
        createElement(Collapsible, {
          open: false,
          durationMs: 220,
          children: createElement('span', { 'data-testid': 'panel-body' }, 'panel-content'),
        })
      );
    });
    expect(container.querySelector('[data-testid="panel-body"]')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(container.querySelector('[data-testid="panel-body"]')).toBeNull();

    // keepMounted = true retains DOM subtree after closing
    act(() => {
      root.render(
        createElement(Collapsible, {
          open: true,
          keepMounted: true,
          durationMs: 200,
          children: createElement('span', { 'data-testid': 'kept-body' }, 'kept'),
        })
      );
    });
    act(() => {
      vi.advanceTimersByTime(260);
    });
    act(() => {
      root.render(
        createElement(Collapsible, {
          open: false,
          keepMounted: true,
          durationMs: 200,
          children: createElement('span', { 'data-testid': 'kept-body' }, 'kept'),
        })
      );
    });
    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(container.querySelector('[data-testid="kept-body"]')?.textContent).toBe('kept');

    // Initial open = true starts visible immediately
    act(() => {
      root.render(createElement('div'));
    });
    act(() => {
      root.render(
        createElement(Collapsible, {
          open: true,
          children: createElement('span', { 'data-testid': 'initial-open' }, 'ready'),
        })
      );
    });
    const initOuter = container.firstElementChild as HTMLElement;
    expect(initOuter.style.height).toBe('auto');
    expect(initOuter.style.opacity).toBe('1');
  });

  it('CSS contract uses backwards on enter animations (freeing hover/active transforms) and forwards on exit animations', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const reducedMarker = '@media (prefers-reduced-motion: reduce)';
    const markerIdx = css.indexOf(reducedMarker);
    expect(markerIdx).toBeGreaterThan(0);
    const mainCss = css.slice(0, markerIdx);
    const reducedSection = css.slice(markerIdx);

    const enterClasses = [
      'cb-fade-up',
      'cb-panel-enter',
      'cb-step-forward',
      'cb-step-backward',
      'cb-list-item',
      'cb-msg-enter',
      'cb-indicator-in',
      'cb-backdrop-in',
      'cb-backdrop-slow-in',
      'cb-modal-in',
      'cb-drawer-in',
      'cb-popover-in',
      'cb-popover-top-in',
      'cb-lightbox-in',
      'cb-float-in',
      'cb-fullscreen-in',
    ];

    const exitClasses = [
      'cb-backdrop-out',
      'cb-backdrop-slow-out',
      'cb-modal-out',
      'cb-drawer-out',
      'cb-popover-out',
      'cb-popover-top-out',
      'cb-lightbox-out',
      'cb-float-out',
      'cb-fullscreen-out',
    ];

    for (const cls of enterClasses) {
      const blocks = [...mainCss.matchAll(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      expect(blocks.length, `Missing CSS rule for .${cls}`).toBeGreaterThan(0);
      for (const body of blocks) {
        expect(body, `.${cls} must use backwards`).toContain('backwards');
        expect(body, `.${cls} must not use both or forwards`).not.toMatch(/\b(both|forwards)\b/);
      }
    }

    for (const cls of exitClasses) {
      const blocks = [...mainCss.matchAll(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]);
      expect(blocks.length, `Missing CSS rule for .${cls}`).toBeGreaterThan(0);
      for (const body of blocks) {
        expect(body, `.${cls} must use forwards`).toContain('forwards');
      }
    }

    for (const cls of [...enterClasses, ...exitClasses]) {
      expect(reducedSection, `Reduced motion missing .${cls}`).toContain(`.${cls}`);
    }
  });
});
