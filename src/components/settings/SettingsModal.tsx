import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  Brain,
  Database,
  Info,
  Palette,
  Server,
  SlidersHorizontal,
  Sparkles,
  Type,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { BUILTIN_MODEL_PROFILE_RULES } from '@/services/llm/modelProfiles';
import { THEME_OPTIONS } from '@/types/settings';
import { usePresence } from '@/components/ui/MotionPrimitives';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { ProvidersTab } from './ProvidersTab';
import { PromptsTab } from './PromptsTab';
import { MemoryTab } from './MemoryTab';
import { AppearanceTab } from './AppearanceTab';
import { DataSyncTab } from './DataSyncTab';
import { AboutTab } from './AboutTab';
import { SettingsNavRow, SettingsSection } from './SettingsPrimitives';

export type SettingsTabKey =
  | 'providers'
  | 'generation'
  | 'memory'
  | 'prompts'
  | 'general'
  | 'appearance'
  | 'typography'
  | 'data'
  | 'about';

type ResolvedSectionKey =
  | 'providers'
  | 'generation'
  | 'memory'
  | 'prompts'
  | 'general'
  | 'typography'
  | 'data'
  | 'about';

function normalizeSection(tab: SettingsTabKey): ResolvedSectionKey {
  return tab === 'appearance' ? 'general' : tab;
}

function detectMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 767px)').matches;
  }
  return window.innerWidth <= 767;
}

interface NavItemDef {
  key: ResolvedSectionKey;
  label: string;
  description: string;
  icon: React.ReactNode;
}

interface NavGroupDef {
  title: string;
  items: NavItemDef[];
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    title: '模型与对话',
    items: [
      {
        key: 'providers',
        label: '模型供应商',
        description: '接口线路、API Key 与模型列表',
        icon: <Server className="w-4 h-4" />,
      },
      {
        key: 'generation',
        label: '采样与上下文',
        description: '采样参数、上下文压缩与思考强度规则',
        icon: <SlidersHorizontal className="w-4 h-4" />,
      },
      {
        key: 'memory',
        label: '记忆库',
        description: '单文件长期记忆、按需检索与隐私规则',
        icon: <Brain className="w-4 h-4" />,
      },
      {
        key: 'prompts',
        label: '个性化与提示词',
        description: '渲染增强协议、角色系统提示词预设',
        icon: <Sparkles className="w-4 h-4" />,
      },
    ],
  },
  {
    title: '通用与外观',
    items: [
      {
        key: 'general',
        label: '通用与外观',
        description: '主题、强调色、发送与显示开关',
        icon: <Palette className="w-4 h-4" />,
      },
      {
        key: 'typography',
        label: '排版与进阶样式',
        description: '字号缩放、KaTeX 比例、自定义 CSS',
        icon: <Type className="w-4 h-4" />,
      },
    ],
  },
  {
    title: '数据与关于',
    items: [
      {
        key: 'data',
        label: '数据与同步',
        description: '本地导入导出与 WebDAV 跨端同步',
        icon: <Database className="w-4 h-4" />,
      },
      {
        key: 'about',
        label: '关于与示例',
        description: '渲染能力演示与版本信息',
        icon: <Info className="w-4 h-4" />,
      },
    ],
  },
];

const SECTION_ORDER: ResolvedSectionKey[] = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key));
const ITEM_BY_KEY: Record<ResolvedSectionKey, NavItemDef> = NAV_GROUPS.flatMap((g) => g.items).reduce(
  (acc, item) => {
    acc[item.key] = item;
    return acc;
  },
  {} as Record<ResolvedSectionKey, NavItemDef>
);

interface SettingsModalProps {
  open: boolean;
  activeTab: SettingsTabKey;
  initialMobileRoot?: boolean;
  mobileBackRef?: React.MutableRefObject<(() => boolean) | null>;
  onTabChange: (tab: SettingsTabKey) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  activeTab,
  initialMobileRoot = false,
  mobileBackRef,
  onTabChange,
  onClose,
}) => {
  const modalPresence = usePresence(open, 200);
  const {
    providers,
    contextSettings,
    memorySettings,
    memoryEntries,
    modelProfileSync,
    promptPresets,
    promptSettings,
    appearance,
    webdav,
    openDemoShowcase,
  } = useAppStore(
    useShallow((s) => ({
      providers: s.providers,
      contextSettings: s.contextSettings,
      memorySettings: s.memorySettings,
      memoryEntries: s.memoryEntries,
      modelProfileSync: s.modelProfileSync,
      promptPresets: s.promptPresets,
      promptSettings: s.promptSettings,
      appearance: s.appearance,
      webdav: s.webdav,
      openDemoShowcase: s.openDemoShowcase,
    }))
  );

  const resolvedSection = normalizeSection(activeTab);
  const [isMobile, setIsMobile] = useState<boolean>(detectMobileViewport);
  const [mobileScreen, setMobileScreen] = useState<'root' | 'detail'>(
    initialMobileRoot ? 'root' : 'detail'
  );
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevSection, setPrevSection] = useState<ResolvedSectionKey>(resolvedSection);
  const [panelAnim, setPanelAnim] = useState<
    'cb-panel-enter' | 'cb-step-forward' | 'cb-step-backward'
  >('cb-panel-enter');

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setMobileScreen(initialMobileRoot ? 'root' : 'detail');
      setPanelAnim('cb-panel-enter');
      setPrevSection(resolvedSection);
    }
  } else if (resolvedSection !== prevSection) {
    const prevIdx = SECTION_ORDER.indexOf(prevSection);
    const nextIdx = SECTION_ORDER.indexOf(resolvedSection);
    setPrevSection(resolvedSection);
    setPanelAnim(nextIdx > prevIdx ? 'cb-step-forward' : 'cb-step-backward');
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewport = () => setIsMobile(detectMobileViewport());
    syncViewport();

    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(max-width: 767px)');
      mq.addEventListener('change', syncViewport);
      return () => mq.removeEventListener('change', syncViewport);
    }
    window.addEventListener('resize', syncViewport);
    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  useEffect(() => {
    if (!mobileBackRef) return;
    mobileBackRef.current = () => {
      if (open && isMobile && mobileScreen === 'detail') {
        setMobileScreen('root');
        return true;
      }
      return false;
    };
    return () => {
      mobileBackRef.current = null;
    };
  }, [mobileBackRef, open, isMobile, mobileScreen]);

  useEscapeKey(open, () => {
    if (isMobile && mobileScreen === 'detail') {
      setMobileScreen('root');
    } else {
      onClose();
    }
  });

  if (!modalPresence.mounted) return null;

  const totalRulesCount =
    BUILTIN_MODEL_PROFILE_RULES.length +
    modelProfileSync.remoteRules.length +
    modelProfileSync.customRules.length;
  const defaultPreset = promptPresets.find((p) => p.id === promptSettings.defaultPresetId);
  const activeThemeLabel =
    THEME_OPTIONS.find((t) => t.id === appearance.theme)?.name || '暖炭黑';
  const thresholdPercent = Math.round(contextSettings.autoCompactThreshold * 100);

  const summaryByKey: Record<ResolvedSectionKey, string> = {
    providers: `${providers.length} 个供应商`,
    generation: `${contextSettings.autoCompactEnabled ? `压缩 ${thresholdPercent}%` : '压缩关'} · ${totalRulesCount}规则`,
    memory: `${memoryEntries.length} 条记忆 · ${memorySettings.enabled ? '已启用' : '已暂停'}`,
    prompts: defaultPreset?.name || '默认预设',
    general: activeThemeLabel,
    typography: `${appearance.fontSize.toFixed(0)}px · ${Math.round((appearance.uiScale ?? 1.06) * 100)}%`,
    data: webdav.enabled ? 'WebDAV 已开启' : '仅本地存储',
    about: 'v0.5.3',
  };

  const activeMeta = ITEM_BY_KEY[resolvedSection];

  const handleSelectDesktopSection = (key: ResolvedSectionKey) => {
    onTabChange(key);
  };

  const handleOpenMobileDetail = (key: ResolvedSectionKey) => {
    setMobileScreen('detail');
    setPanelAnim('cb-step-forward');
    setPrevSection(key);
    onTabChange(key);
  };

  const handleBackToMobileRoot = () => {
    setMobileScreen('root');
    setPanelAnim('cb-step-backward');
  };

  const renderSectionContent = () => {
    if (resolvedSection === 'providers') return <ProvidersTab section="providers" />;
    if (resolvedSection === 'generation') return <ProvidersTab section="generation" />;
    if (resolvedSection === 'memory') return <MemoryTab />;
    if (resolvedSection === 'prompts') return <PromptsTab />;
    if (resolvedSection === 'general') return <AppearanceTab section="general" />;
    if (resolvedSection === 'typography') return <AppearanceTab section="typography" />;
    if (resolvedSection === 'data') return <DataSyncTab />;
    return (
      <AboutTab
        onOpenDemo={() => {
          void openDemoShowcase().then(() => onClose());
        }}
      />
    );
  };

  return (
    <div
      className={`fixed inset-0 z-50 bg-bg flex flex-col overflow-hidden ${
        modalPresence.state === 'open' ? 'cb-fullscreen-in' : 'cb-fullscreen-out pointer-events-none'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      {isMobile ? (
        /* Mobile: Full-Screen Two-Level Push Navigation */
        mobileScreen === 'root' ? (
          <div
            key="mobile-settings-root"
            className={`${panelAnim} flex flex-col flex-1 min-h-0 min-w-0 safe-top`}
          >
            <div className="flex items-center justify-between px-4 py-3.5 border-b border-borderc shrink-0">
              <div className="font-semibold text-[16px] text-fg">设置</div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition shrink-0"
                aria-label="关闭设置"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-3.5 space-y-5 safe-bottom">
              {NAV_GROUPS.map((group) => (
                <SettingsSection key={group.title} title={group.title}>
                  {group.items.map((item) => (
                    <SettingsNavRow
                      key={item.key}
                      icon={item.icon}
                      title={item.label}
                      value={summaryByKey[item.key]}
                      onClick={() => handleOpenMobileDetail(item.key)}
                    />
                  ))}
                </SettingsSection>
              ))}
              <div className="pt-1 pb-2 text-center text-[11px] font-mono text-muted/80">
                ChatBeauty v0.5.3 · MIT License
              </div>
            </div>
          </div>
        ) : (
          <div
            key={`mobile-settings-detail-${resolvedSection}`}
            className={`${panelAnim} flex flex-col flex-1 min-h-0 min-w-0 safe-top`}
          >
            <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-borderc shrink-0">
              <button
                type="button"
                onClick={handleBackToMobileRoot}
                className="flex items-center gap-1 px-2 py-1.5 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition shrink-0"
                aria-label="返回设置"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-[13.5px] font-medium">设置</span>
              </button>
              <div className="font-semibold text-[15px] text-fg truncate text-center flex-1">
                {activeMeta.label}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition shrink-0"
                aria-label="关闭设置"
              >
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-3.5 safe-bottom">
              {renderSectionContent()}
            </div>
          </div>
        )
      ) : (
        /* Desktop: Full-Screen ChatGPT-style Two-Column Settings Workspace */
        <div className="flex flex-1 min-h-0 min-w-0">
          <aside className="w-[252px] lg:w-[272px] shrink-0 border-r border-borderc bg-surface/40 flex flex-col min-h-0 safe-top safe-bottom">
            <div className="h-[58px] px-3.5 flex items-center justify-between gap-2 border-b border-borderc shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-muted hover:text-fg hover:bg-elevated active:scale-95 transition"
                aria-label="返回对话"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="text-[13.5px] font-medium text-fg">返回对话</span>
              </button>
              <span className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded bg-fg/[0.06] border border-borderc/60 text-[10.5px] font-mono text-muted">
                Esc
              </span>
            </div>

            <nav
              aria-label="设置分类导航"
              className="flex-1 overflow-y-auto no-scrollbar px-3 py-3.5 space-y-4"
            >
              {NAV_GROUPS.map((group) => (
                <div key={group.title} className="space-y-1">
                  <div className="px-2.5 pb-0.5 text-[11px] font-semibold text-muted/85 tracking-wide">
                    {group.title}
                  </div>
                  {group.items.map((item) => {
                    const active = resolvedSection === item.key;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleSelectDesktopSection(item.key)}
                        aria-current={active ? 'page' : undefined}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-[13.5px] font-medium active:scale-[0.985] transition ${
                          active
                            ? 'bg-elevated text-fg shadow-sm'
                            : 'text-muted hover:text-fg hover:bg-fg/[0.04]'
                        }`}
                      >
                        <span className={active ? 'text-accent shrink-0' : 'text-muted shrink-0'}>
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>

            <div className="px-4 py-3 border-t border-borderc text-[11px] font-mono text-muted/80 shrink-0">
              ChatBeauty v0.5.3 · MIT
            </div>
          </aside>

          <div className="flex-1 min-w-0 flex flex-col bg-bg safe-top">
            <div className="h-[58px] px-6 lg:px-10 border-b border-borderc shrink-0 flex items-center">
              <div className="w-full max-w-[760px] mx-auto flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-muted shrink-0">{activeMeta.icon}</span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-[16px] text-fg truncate">
                      {activeMeta.label}
                    </h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition shrink-0"
                  aria-label="关闭设置"
                >
                  <X className="w-[18px] h-[18px]" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-6 lg:px-10 py-6 safe-bottom">
              <div className="w-full max-w-[760px] mx-auto min-w-0">
                <div key={resolvedSection} className={`${panelAnim} min-w-0 max-w-full`}>
                  {renderSectionContent()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
