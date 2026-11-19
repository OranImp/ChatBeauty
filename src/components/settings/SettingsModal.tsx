import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { ProvidersTab } from './ProvidersTab';
import { PromptsTab } from './PromptsTab';
import { AppearanceTab } from './AppearanceTab';
import { DataSyncTab } from './DataSyncTab';

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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full sm:max-w-3xl h-[92dvh] sm:h-[82vh] rounded-t-3xl sm:rounded-3xl border border-borderc bg-bg flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-borderc shrink-0">
          <div className="font-semibold text-base text-fg">ChatBeauty 设置</div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-muted hover:text-fg hover:bg-surface transition"
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
                className={`px-3.5 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition ${
                  active
                    ? 'bg-accent text-accentfg'
                    : 'text-muted hover:text-fg hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 safe-bottom">
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'prompts' && <PromptsTab />}
          {activeTab === 'appearance' && <AppearanceTab />}
          {activeTab === 'data' && <DataSyncTab />}
        </div>
      </div>
    </div>
  );
};
