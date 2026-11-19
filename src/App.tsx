import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { useAppStore } from '@/store/useAppStore';
import type { ResolvedTheme } from '@/components/renderer/svgUtils';
import { LightboxModal, type LightboxPayload } from '@/components/renderer/LightboxModal';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { ChatView } from '@/components/chat/ChatView';
import { SettingsModal, type SettingsTabKey } from '@/components/settings/SettingsModal';

function resolveFontFamily(
  kind: 'system' | 'serif' | 'mono' | 'custom',
  customName: string
): string {
  if (kind === 'serif') {
    return `'Noto Serif SC', 'Songti SC', Georgia, Cambria, 'Times New Roman', serif`;
  }
  if (kind === 'mono') {
    return `ui-monospace, 'JetBrains Mono', 'Cascadia Code', Consolas, monospace`;
  }
  if (kind === 'custom' && customName.trim()) {
    return customName.trim();
  }
  return `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif`;
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
  const { ready, appearance, initApp, createConversation } = useAppStore();

  const [systemPrefersLight, setSystemPrefersLight] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false
  );

  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState<boolean>(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabKey>('providers');
  const [lightbox, setLightbox] = useState<LightboxPayload | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initApp();
  }, [initApp]);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersLight(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (appearance.theme === 'system') {
      return systemPrefersLight ? 'light' : 'oled';
    }
    return appearance.theme;
  }, [appearance.theme, systemPrefersLight]);

  // Apply CSS theme variables & custom CSS
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', resolvedTheme);
    root.classList.toggle('dark', resolvedTheme !== 'light');

    const rawAccent = (appearance.accentColor || '#ededed').trim();
    const effectiveAccent =
      resolvedTheme === 'light' && rawAccent.toLowerCase() === '#ededed'
        ? '#18181b'
        : rawAccent;
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

    root.style.setProperty('--chat-font-size', `${appearance.fontSize}px`);
    root.style.setProperty('--chat-line-height', String(appearance.lineHeight));
    root.style.setProperty('--math-scale', String(appearance.mathScale));
    root.style.setProperty('--chat-max-width', `${appearance.contentMaxWidth}px`);
    root.style.setProperty(
      '--chat-font-family',
      resolveFontFamily(appearance.fontFamily, appearance.customFontName)
    );

    let styleEl = document.getElementById('chatbeauty-custom-css') as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'chatbeauty-custom-css';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = appearance.customCss || '';

    // Native Android StatusBar sync
    if (Capacitor.isNativePlatform()) {
      const bgColor =
        resolvedTheme === 'oled' ? '#000000' : resolvedTheme === 'dark' ? '#171717' : '#ffffff';
      void StatusBar.setBackgroundColor({ color: bgColor }).catch(() => undefined);
      void StatusBar.setStyle({
        style: resolvedTheme === 'light' ? Style.Light : Style.Dark,
      }).catch(() => undefined);
    }
  }, [resolvedTheme, appearance]);

  // Android hardware back button handling
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (lightbox) {
        setLightbox(null);
      } else if (settingsOpen) {
        setSettingsOpen(false);
      } else if (mobileDrawerOpen) {
        setMobileDrawerOpen(false);
      } else if (!canGoBack) {
        void CapApp.minimizeApp();
      }
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [lightbox, settingsOpen, mobileDrawerOpen]);

  // Desktop keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void createConversation('新对话');
      } else if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDesktopSidebarOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 60);
      } else if (e.key === ',') {
        e.preventDefault();
        setSettingsTab('providers');
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createConversation]);

  const openSettings = (tab: SettingsTabKey = 'providers') => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

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
        onCloseMobile={() => setMobileDrawerOpen(false)}
        onCollapseDesktop={() => setDesktopSidebarOpen(false)}
        onOpenSettings={openSettings}
        searchInputRef={searchInputRef}
      />

      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <TopBar
          sidebarOpen={desktopSidebarOpen}
          onToggleSidebar={() => {
            if (window.innerWidth < 768) {
              setMobileDrawerOpen((v) => !v);
            } else {
              setDesktopSidebarOpen((v) => !v);
            }
          }}
          onOpenSettings={openSettings}
        />

        <ChatView
          theme={resolvedTheme}
          onInspect={(payload) => setLightbox(payload)}
          onOpenSettings={openSettings}
        />
      </main>

      <SettingsModal
        open={settingsOpen}
        activeTab={settingsTab}
        onTabChange={setSettingsTab}
        onClose={() => setSettingsOpen(false)}
      />

      <LightboxModal
        payload={lightbox}
        theme={resolvedTheme}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
};

export default App;
