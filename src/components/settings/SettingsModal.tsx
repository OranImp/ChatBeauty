import React, { useEffect } from 'react';
import { X } from 'lucide-react';
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
        className={`w-full sm:max-w-3xl h-[92dvh] sm:h-[82vh] rounded-t-3xl sm:rounded-3xl border border-borderc bg-bg flex flex-col overflow-hidden shadow-2xl transition-all duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          modalPresence.visible
            ? 'opacity-100 translate-y-0 sm:scale-100'
            : 'opacity-0 translate-y-8 sm:translate-y-3 sm:scale-[0.97]'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-borderc shrink-0">
          <div className="font-semibold text-base text-fg">ChatBeauty 设置</div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface active:scale-95 transition"
            aria-label="关闭设置"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-borderc bg-surface/35 overflow-x-auto no-scrollbar shrink-0">
          {TABS.map(({ key, label }) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onTabChange(key)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap active:scale-95 transition ${
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
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 safe-bottom">
          <div key={activeTab} className="cb-panel-enter">
            {activeTab === 'providers' && <ProvidersTab />}
            {activeTab === 'prompts' && <PromptsTab />}
            {activeTab === 'appearance' && <AppearanceTab />}
            {activeTab === 'data' && <DataSyncTab />}
          </div>
        </div>

        {/* Subtle License & Font Attribution Footer */}
        <div className="px-5 py-2 border-t border-borderc bg-surface/25 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted font-mono shrink-0">
          <span>ChatBeauty v0.3.0 · MIT License</span>
          <span className="truncate">Inter / Newsreader / JetBrains Mono (SIL OFL)</span>
        </div>
      </div>
    </div>
  );
};
