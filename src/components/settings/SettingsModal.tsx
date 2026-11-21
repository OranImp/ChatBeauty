import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
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
import { usePresence } from '@/components/ui/MotionPrimitives';
import { ProvidersTab } from './ProvidersTab';
import { PromptsTab } from './PromptsTab';
import { AppearanceTab, THEME_OPTIONS } from './AppearanceTab';
import { DataSyncTab } from './DataSyncTab';
import { AboutTab } from './AboutTab';
import { SettingsNavRow, SettingsSection } from './SettingsPrimitives';

export type SettingsTabKey =
  | 'providers'
  | 'generation'
  | 'prompts'
  | 'general'
  | 'appearance'
  | 'typography'
  | 'data'
  | 'about';

type ResolvedSectionKey =
  | 'providers'
  | 'generation'
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
        label: '采样与推理规则',
        description: '全局采样参数、思考强度规则库',
        icon: <SlidersHorizontal className="w-4 h-4" />,
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
  onTabChange: (tab: SettingsTabKey) => void;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  activeTab,
  initialMobileRoot = false,
  onTabChange,
  onClose,
}) => {
  const modalPresence = usePresence(open, 200);
  const {
    providers,
    activeProviderId,
    activeModelId,
    generation,
    modelProfileSync,
    promptPresets,
    promptSettings,
    appearance,
    webdav,
    openDemoShowcase,
  } = useAppStore();

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

    let mq: MediaQueryList | null = null;
    if (typeof window.matchMedia === 'function') {
      mq = window.matchMedia('(max-width: 767px)');
      mq.addEventListener('change', syncViewport);
    }
    window.addEventListener('resize', syncViewport);
    return () => {
      mq?.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!modalPresence.mounted) return null;

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const currentModelId = activeModelId || activeProvider?.defaultModel || '';
  const totalRulesCount =
    BUILTIN_MODEL_PROFILE_RULES.length +
    modelProfileSync.remoteRules.length +
    modelProfileSync.customRules.length;
  const defaultPreset = promptPresets.find((p) => p.id === promptSettings.defaultPresetId);
  const activeThemeLabel =
    THEME_OPTIONS.find((t) => t.id === appearance.theme)?.name || '暖炭黑';

  const summaryByKey: Record<ResolvedSectionKey, string> = {
    providers: currentModelId || `${providers.length} 个供应商`,
    generation: `Temp ${generation.temperature.toFixed(2)} · ${totalRulesCount} 条规则`,
    prompts: defaultPreset?.name || '默认预设',
    general: activeThemeLabel,
    typography: `${appearance.fontSize.toFixed(0)}px · ${Math.round((appearance.uiScale ?? 1.06) * 100)}%`,
    data: webdav.enabled ? 'WebDAV 已开启' : '仅本地存储',
    about: 'v0.4.2',
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
      className={`fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/75 backdrop-blur-sm md:p-4 ${
        modalPresence.state === 'open' ? 'cb-backdrop-in' : 'cb-backdrop-out pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full max-w-full md:max-w-4xl h-[92dvh] md:h-[82vh] md:max-h-[760px] rounded-t-3xl md:rounded-3xl border border-borderc bg-bg flex flex-col overflow-hidden shadow-2xl ${
          modalPresence.state === 'open' ? 'cb-modal-in' : 'cb-modal-out pointer-events-none'
        }`}
      >
        {isMobile ? (
          /* Mobile: ChatGPT-style Two-Level Push Navigation */
          mobileScreen === 'root' ? (
            <div key="mobile-settings-root" className={`${panelAnim} flex flex-col flex-1 min-h-0`}>
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
                  ChatBeauty v0.4.2 · MIT License
                </div>
              </div>
            </div>
          ) : (
            <div
              key={`mobile-settings-detail-${resolvedSection}`}
              className={`${panelAnim} flex flex-col flex-1 min-h-0`}
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
          /* Desktop: ChatGPT-style Two-Column Master-Detail Settings Hub */
          <div className="flex flex-1 min-h-0 min-w-0">
            <aside className="w-[228px] shrink-0 border-r border-borderc bg-surface/35 flex flex-col min-h-0">
              <div className="h-[56px] px-4 flex items-center border-b border-borderc shrink-0">
                <span className="font-semibold text-[16px] text-fg">设置</span>
              </div>

              <nav
                aria-label="设置分类导航"
                className="flex-1 overflow-y-auto no-scrollbar px-2.5 py-3 space-y-4"
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
                          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-[13px] font-medium active:scale-[0.985] transition ${
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

              <div className="px-4 py-2.5 border-t border-borderc text-[11px] font-mono text-muted/80 shrink-0">
                ChatBeauty v0.4.2 · MIT
              </div>
            </aside>

            <div className="flex-1 min-w-0 flex flex-col bg-bg">
              <div className="h-[56px] px-6 flex items-center justify-between gap-3 border-b border-borderc shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-muted shrink-0">{activeMeta.icon}</span>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-[15.5px] text-fg truncate">
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

              <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-6 py-5">
                <div key={resolvedSection} className={`${panelAnim} min-w-0 max-w-full`}>
                  {renderSectionContent()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
