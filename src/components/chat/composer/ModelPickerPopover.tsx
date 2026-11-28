import React from 'react';
import { ChevronRight } from 'lucide-react';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { getModelDisplayName, hasCustomModelDisplayName } from '@/services/llm/adapters/shared';
import { resolveModelReasoningProfile } from '@/services/llm/modelProfiles';
import { Collapsible } from '@/components/ui/MotionPrimitives';
import type { ProviderConfig } from '@/types/chat';
import type { ModelProfileSyncSettings } from '@/types/settings';

interface ModelPickerPopoverProps {
  providers: ProviderConfig[];
  currentProvider: ProviderConfig | undefined;
  currentModelId: string;
  collapsedProviders: Record<string, boolean>;
  setCollapsedProviders: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  modelProfileSync: ModelProfileSyncSettings;
  onSelectModel: (providerId: string, modelId: string) => void;
  onManageProviders: () => void;
}

export const ModelPickerPopover: React.FC<ModelPickerPopoverProps> = ({
  providers,
  currentProvider,
  currentModelId,
  collapsedProviders,
  setCollapsedProviders,
  modelProfileSync,
  onSelectModel,
  onManageProviders,
}) => {
  const isProviderCollapsed = (p: ProviderConfig) =>
    collapsedProviders[p.id] ?? (providers.length > 2 && p.id !== currentProvider?.id);
  const allCollapsed =
    providers.length > 1 && providers.every((p) => isProviderCollapsed(p));
  const toggleAllProviders = () => {
    const nextVal = !allCollapsed;
    const next: Record<string, boolean> = {};
    for (const p of providers) {
      next[p.id] = nextVal;
    }
    setCollapsedProviders(next);
  };

  let modelRowIdx = 0;

  return (
    <div className="p-3 max-h-[60vh] overflow-y-auto no-scrollbar space-y-2.5">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-semibold text-fg">切换模型</span>
        <div className="flex items-center gap-2.5">
          {providers.length > 1 && (
            <button
              type="button"
              onClick={toggleAllProviders}
              className="text-muted hover:text-fg transition"
            >
              {allCollapsed ? '全部展开' : '全部折叠'}
            </button>
          )}
          <button
            type="button"
            onClick={onManageProviders}
            className="text-muted hover:text-fg transition"
          >
            管理供应商
          </button>
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="cb-list-item p-3 rounded-xl bg-surface text-center space-y-2.5">
          <p className="text-muted">尚未添加任何大模型供应商</p>
          <button
            type="button"
            onClick={onManageProviders}
            className="px-3.5 py-1.5 rounded-xl bg-accent text-accentfg font-medium active:scale-95 transition"
          >
            添加供应商
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const modelList =
              p.models.length > 0
                ? p.models
                : p.defaultModel
                  ? [{ id: p.defaultModel, name: p.defaultModel, capabilities: { chat: true } }]
                  : [];
            const collapsed = isProviderCollapsed(p);
            const isCurrentProvider = currentProvider?.id === p.id;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-borderc/60 bg-surface/35 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedProviders((prev) => ({ ...prev, [p.id]: !collapsed }))
                  }
                  aria-expanded={!collapsed}
                  className="w-full px-2.5 py-2 flex items-center justify-between gap-2 text-[11.5px] text-muted hover:text-fg hover:bg-fg/[0.04] transition"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight
                      className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        !collapsed ? 'rotate-90 text-fg' : ''
                      }`}
                    />
                    <span className="truncate font-medium text-fg/90">{p.name}</span>
                    {isCurrentProvider && (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-accent shrink-0"
                        title="当前使用"
                      />
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted font-mono shrink-0">
                      {modelList.length}
                    </span>
                  </span>
                  <span className="shrink-0 ml-2 font-mono text-[10px]">
                    {PROTOCOL_TEMPLATES[p.protocol].shortLabel}
                  </span>
                </button>
                <Collapsible open={!collapsed}>
                  <div className="px-1.5 pb-1.5 pt-1 border-t border-borderc/40 space-y-0.5">
                    {modelList.map((m) => {
                      const idx = modelRowIdx++;
                      const selected = isCurrentProvider && currentModelId === m.id;
                      const { profile: mProf } = resolveModelReasoningProfile({
                        modelId: m.id,
                        protocol: p.protocol,
                        modelDef: m,
                        customRules: modelProfileSync.customRules,
                        remoteRules: modelProfileSync.remoteRules,
                      });
                      const hasAlias = hasCustomModelDisplayName(m);
                      const labelText = getModelDisplayName(m, m.id);
                      return (
                        <button
                          key={`${p.id}_${m.id}`}
                          type="button"
                          onClick={() => onSelectModel(p.id, m.id)}
                          style={{ '--stagger-i': idx } as React.CSSProperties}
                          className={`cb-list-item w-full text-left px-2.5 py-1.5 rounded-xl flex items-center justify-between gap-2 active:scale-[0.985] transition ${
                            selected
                              ? 'bg-accent text-accentfg font-medium'
                              : 'text-fg hover:bg-fg/5'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className={`truncate ${
                                hasAlias ? 'font-sans font-medium' : 'font-mono'
                              }`}
                            >
                              {labelText}
                            </div>
                            {hasAlias && (
                              <div
                                className={`text-[10px] font-mono truncate ${
                                  selected ? 'opacity-80' : 'text-muted/85'
                                }`}
                              >
                                {m.id}
                              </div>
                            )}
                          </div>
                          <span
                            className={`text-[10px] shrink-0 ${
                              selected ? 'opacity-90' : 'text-muted'
                            }`}
                          >
                            {mProf.strategy === 'none'
                              ? '标准'
                              : mProf.strategy === 'fixed'
                                ? '内置思考'
                                : `${mProf.levels.length} 档思考`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Collapsible>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
