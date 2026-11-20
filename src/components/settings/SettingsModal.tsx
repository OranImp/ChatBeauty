import React, { useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { ProvidersTab } from './ProvidersTab';
import { PromptsTab } from './PromptsTab';
import { AppearanceTab } from './AppearanceTab';
import { DataSyncTab } from './DataSyncTab';
import { usePresence } from '@/components/ui/MotionPrimitives';

export type SettingsTabKey = 'providers' | 'prompts' | 'appearance' | 'data';

interface SettingsModalProps {
  open: boolean;
  activeTab: SettingsTabKey;
  onTabChange: (tab: SettingsTabKey) => void;
  onClose: () => void;
}

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: 'providers', label: '模型接口' },
  { key: 'prompts', label: '提示词与渲染' },
  { key: 'appearance', label: '外观排版' },
  { key: 'data', label: '数据与同步' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  activeTab,
  onTabChange,
  onClose,
}) => {
  const modalPresence = usePresence(open, 200);
  const openDemoShowcase = useAppStore((s) => s.openDemoShowcase);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!modalPresence.mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4 transition-opacity duration-200 ease-out ${
        modalPresence.visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full max-w-full sm:max-w-3xl h-[92dvh] sm:h-[82vh] rounded-t-3xl sm:rounded-3xl border border-borderc bg-bg flex flex-col overflow-hidden shadow-2xl transition-all duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          modalPresence.visible
            ? 'opacity-100 translate-y-0 sm:scale-100'
            : 'opacity-0 translate-y-8 sm:translate-y-3 sm:scale-[0.97]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 sm:py-4 border-b border-borderc shrink-0">
          <div className="font-semibold text-[16px] sm:text-[17px] text-fg truncate">ChatBeauty 设置</div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition shrink-0"
            aria-label="关闭设置"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 border-b border-borderc bg-surface/35 overflow-x-auto no-scrollbar shrink-0">
          {TABS.map(({ key, label }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTabChange(key)}
                className={`px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-[13px] font-medium whitespace-nowrap active:scale-95 transition shrink-0 ${
                  active
                    ? 'bg-accent text-accentfg shadow-sm'
                    : 'text-muted hover:text-fg hover:bg-fg/5'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 p-3.5 sm:p-6 safe-bottom">
          <div key={activeTab} className="cb-panel-enter min-w-0 max-w-full">
            {activeTab === 'providers' && <ProvidersTab />}
            {activeTab === 'prompts' && <PromptsTab />}
            {activeTab === 'appearance' && <AppearanceTab />}
            {activeTab === 'data' && <DataSyncTab />}
          </div>
        </div>

        {/* Subtle License & Font Attribution Footer */}
        <div className="px-3.5 sm:px-5 py-2 border-t border-borderc bg-surface/25 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted font-mono shrink-0">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span>ChatBeauty v0.4.1 · MIT License</span>
            <button
              type="button"
              onClick={() => void openDemoShowcase().then(() => onClose())}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-borderc bg-bg/60 hover:bg-elevated text-muted hover:text-fg transition font-sans"
              title="打开内置渲染能力演示会话（LaTeX、SVG、Mermaid、ECharts 与交互沙盒）"
            >
              <Sparkles className="w-3 h-3 text-accent" />
              <span>渲染效果示例</span>
            </button>
          </div>
          <span className="hidden sm:inline truncate">Inter / Newsreader / JetBrains Mono (SIL OFL)</span>
        </div>
      </div>
    </div>
  );
};
