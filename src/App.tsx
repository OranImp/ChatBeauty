import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { useAppStore } from '@/store/useAppStore';
import type { ResolvedTheme } from '@/components/renderer/svgUtils';
import type { LightboxPayload } from '@/components/renderer/LightboxModal';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ChatView } from '@/components/chat/ChatView';
import type { SettingsTabKey } from '@/components/settings/SettingsModal';
import { syncDesktopBackgroundSettings } from '@/services/transport/streamHttp';

const SettingsModal = lazy(() =>
  import('@/components/settings/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const LightboxModal = lazy(() =>
  import('@/components/renderer/LightboxModal').then((m) => ({ default: m.LightboxModal }))
);

let serifFontLoaded = false;
function loadSerifFontOnce(): void {
  if (serifFontLoaded) return;
  serifFontLoaded = true;
  void Promise.all([
    import('@fontsource/newsreader/latin-400.css'),
    import('@fontsource/newsreader/latin-500.css'),
    import('@fontsource/newsreader/latin-600.css'),
    import('@fontsource/newsreader/latin-400-italic.css'),
  ]).catch(() => {
    serifFontLoaded = false;
  });
}

function resolveFontFamily(
  kind: 'system' | 'serif' | 'mono' | 'custom',
  customName: string
): string {
  if (kind === 'serif') {
    return `'Newsreader', 'LXGW WenKai', 'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', Georgia, serif`;
  }
  if (kind === 'mono') {
    return `'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace`;
  }
  if (kind === 'custom' && customName.trim()) {
    return customName.trim();
  }
  return `'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'HarmonyOS Sans SC', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif`;
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (full.length !== 6) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return { r, g, b };
}

function getContrastFg(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return '#0a0a0a';
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.58 ? '#0a0a0a' : '#ffffff';
}

export const App: React.FC = () => {
  const { ready, appearance, initApp, createConversation } = useAppStore(
    useShallow((s) => ({
      ready: s.ready,
      appearance: s.appearance,
      initApp: s.initApp,
      createConversation: s.createConversation,
    }))
  );

  const [systemPrefersLight, setSystemPrefersLight] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false
  );

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>('providers');
  const [settingsMobileRoot, setSettingsMobileRoot] = useState<boolean>(true);
  const [lightbox, setLightbox] = useState<LightboxPayload | null>(null);
  const [hasOpenedLightbox, setHasOpenedLightbox] = useState<boolean>(false);

  if (settingsOpen && !hasOpenedSettings) {
    setHasOpenedSettings(true);
  }
  if (lightbox && !hasOpenedLightbox) {
    setHasOpenedLightbox(true);
  }
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);
  const settingsBackRef = useRef<(() => boolean) | null>(null);
  const lastAppHeightRef = useRef<number>(-1);
  const overlayStateRef = useRef({ lightbox: null as LightboxPayload | null, settingsOpen: false, mobileDrawerOpen: false });
  overlayStateRef.current = { lightbox, settingsOpen, mobileDrawerOpen };

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    const syncViewportHeight = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv ? vv.height : window.innerHeight);
      if (lastAppHeightRef.current !== height) {
        lastAppHeightRef.current = height;
        document.documentElement.style.setProperty('--app-height', `${height}px`);
      }
      if (window.scrollY !== 0 || window.scrollX !== 0 || (vv && vv.offsetTop !== 0)) {
        window.scrollTo(0, 0);
      }
    };

    syncViewportHeight();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewportHeight);
    vv?.addEventListener('scroll', syncViewportHeight);
    window.addEventListener('resize', syncViewportHeight);
    return () => {
      vv?.removeEventListener('resize', syncViewportHeight);
      vv?.removeEventListener('scroll', syncViewportHeight);
      window.removeEventListener('resize', syncViewportHeight);
    };
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersLight(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (appearance.theme === 'system') {
      return systemPrefersLight ? 'light' : 'dark';
    }
    return appearance.theme;
  }, [appearance.theme, systemPrefersLight]);

  // 1. Theme & native Android StatusBar sync
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    root.classList.toggle('dark', resolvedTheme !== 'light');

    if (Capacitor.isNativePlatform()) {
      const bgColor =
        resolvedTheme === 'oled' ? '#000000' : resolvedTheme === 'dark' ? '#171615' : '#faf9f5';
      void StatusBar.setBackgroundColor({ color: bgColor }).catch(() => undefined);
      void StatusBar.setStyle({
        style: resolvedTheme === 'light' ? Style.Light : Style.Dark,
      }).catch(() => undefined);
    }
  }, [resolvedTheme]);

  // 2. Accent color CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const rawAccent = (appearance.accentColor || '#d97757').trim();
    const candidateAccent =
      resolvedTheme === 'light' && rawAccent.toLowerCase() === '#ededed'
        ? '#1f1e1c'
        : rawAccent;
    const effectiveAccent = parseHexRgb(candidateAccent) ? candidateAccent : '#d97757';
    const accentFg = getContrastFg(effectiveAccent);
    const accentRgb = parseHexRgb(effectiveAccent);
    const accentFgRgb = parseHexRgb(accentFg);
    root.style.setProperty('--accent', effectiveAccent);
    root.style.setProperty('--accent-fg', accentFg);
    if (accentRgb) {
      root.style.setProperty('--accent-rgb', `${accentRgb.r} ${accentRgb.g} ${accentRgb.b}`);
    }
    if (accentFgRgb) {
      root.style.setProperty(
        '--accent-fg-rgb',
        `${accentFgRgb.r} ${accentFgRgb.g} ${accentFgRgb.b}`
      );
    }
  }, [resolvedTheme, appearance.accentColor]);

  // 3. Typography & layout CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const uiScale = Math.min(1.35, Math.max(0.85, appearance.uiScale ?? 1.06));
    root.style.fontSize = `${(16 * uiScale).toFixed(2)}px`;
    root.style.setProperty('--chat-font-size', `${appearance.fontSize}px`);
    root.style.setProperty('--chat-line-height', String(appearance.lineHeight));
    root.style.setProperty('--math-scale', String(appearance.mathScale));
    root.style.setProperty('--chat-max-width', `${appearance.contentMaxWidth}px`);
    root.style.setProperty(
      '--chat-font-family',
      resolveFontFamily(appearance.fontFamily, appearance.customFontName)
    );
    if (appearance.fontFamily === 'serif') {
      loadSerifFontOnce();
    }
  }, [
    appearance.uiScale,
    appearance.fontSize,
    appearance.lineHeight,
    appearance.mathScale,
    appearance.contentMaxWidth,
    appearance.fontFamily,
    appearance.customFontName,
  ]);

  // 4. Custom user CSS injection
  useEffect(() => {
    let styleEl = document.getElementById('chatbeauty-custom-css') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'chatbeauty-custom-css';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = appearance.customCss || '';
  }, [appearance.customCss]);

  useEffect(() => {
    void syncDesktopBackgroundSettings({
      closeToTray: appearance.closeToTray ?? true,
      backgroundGeneration: appearance.backgroundGeneration ?? true,
    });
  }, [appearance.closeToTray, appearance.backgroundGeneration]);

  // Android hardware back button handling (registered once)
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('backButton', ({ canGoBack }) => {
      const current = overlayStateRef.current;
      if (current.lightbox) {
        setLightbox(null);
      } else if (current.settingsOpen) {
        if (settingsBackRef.current?.()) return;
        setSettingsOpen(false);
      } else if (current.mobileDrawerOpen) {
        setMobileDrawerOpen(false);
      } else if (!canGoBack) {
        void CapApp.minimizeApp();
      }
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, []);

  // Desktop keyboard shortcuts (registered once)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const current = overlayStateRef.current;
      if (!mod || current.lightbox) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        if (current.settingsOpen) return;
        e.preventDefault();
        void createConversation('新对话');
      } else if (key === 'k') {
        if (current.settingsOpen) return;
        e.preventDefault();
        if (window.innerWidth < 768) {
          setMobileDrawerOpen(true);
          setTimeout(() => mobileSearchInputRef.current?.focus(), 60);
        } else {
          setDesktopSidebarOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 60);
        }
      } else if (e.key === ',') {
        e.preventDefault();
        setSettingsMobileRoot(true);
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createConversation]);

  const openSettings = useCallback((tab?: SettingsTabKey) => {
    if (tab) {
      setSettingsTab(tab);
      setSettingsMobileRoot(false);
    } else {
      setSettingsMobileRoot(true);
    }
    setSettingsOpen(true);
  }, []);

  const handleCloseMobile = useCallback(() => setMobileDrawerOpen(false), []);
  const handleCollapseDesktop = useCallback(() => setDesktopSidebarOpen(false), []);
  const handleToggleSidebar = useCallback(() => {
    if (window.innerWidth < 768) {
      setMobileDrawerOpen((v) => !v);
    } else {
      setDesktopSidebarOpen((v) => !v);
    }
  }, []);
  const handleCloseSettings = useCallback(() => setSettingsOpen(false), []);
  const handleCloseLightbox = useCallback(() => setLightbox(null), []);

  if (!ready) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-bg text-muted text-sm">
        正在初始化 ChatBeauty…
      </div>
    );
  }

  return (
    <div className="h-full w-full flex bg-bg text-fg overflow-hidden">
      <Sidebar
        desktopOpen={desktopSidebarOpen}
        mobileOpen={mobileDrawerOpen}
        onCloseMobile={handleCloseMobile}
        onCollapseDesktop={handleCollapseDesktop}
        onOpenSettings={openSettings}
        searchInputRef={searchInputRef}
        mobileSearchInputRef={mobileSearchInputRef}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <TopBar
          sidebarOpen={desktopSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          onOpenSettings={openSettings}
        />

        <ChatView
          theme={resolvedTheme}
          onInspect={setLightbox}
          onOpenSettings={openSettings}
        />
      </main>

      {hasOpenedSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            open={settingsOpen}
            activeTab={settingsTab}
            initialMobileRoot={settingsMobileRoot}
            mobileBackRef={settingsBackRef}
            onTabChange={setSettingsTab}
            onClose={handleCloseSettings}
          />
        </Suspense>
      )}

      {hasOpenedLightbox && (
        <Suspense fallback={null}>
          <LightboxModal
            payload={lightbox}
            theme={resolvedTheme}
            onClose={handleCloseLightbox}
          />
        </Suspense>
      )}
    </div>
  );
};

export default App;
