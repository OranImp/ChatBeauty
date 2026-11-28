import React from 'react';
import type { ProfileMatchSource } from '@/services/llm/modelProfiles';
import type { ReasoningEffort } from '@/types/chat';
import type { ModelReasoningProfile } from '@/types/settings';

const SOURCE_LABELS: Record<ProfileMatchSource, string> = {
  'model-override': '模型自定义',
  'custom-rule': '自定义规则',
  'remote-rule': '在线规则',
  builtin: '自动匹配',
  fallback: '默认识别',
};

interface ReasoningMenuPopoverProps {
  reasoningProfile: ModelReasoningProfile;
  profileSource: ProfileMatchSource;
  effectiveReasoning: ReasoningEffort;
  onSelectLevel: (effort: ReasoningEffort, budgetTokens?: number) => void;
  onOpenProvidersSettings: () => void;
}

export const ReasoningMenuPopover: React.FC<ReasoningMenuPopoverProps> = ({
  reasoningProfile,
  profileSource,
  effectiveReasoning,
  onSelectLevel,
  onOpenProvidersSettings,
}) => {
  return (
    <div className="p-2.5 space-y-1.5">
      <div className="px-1.5 py-1 flex items-center justify-between gap-2 border-b border-borderc pb-2">
        <span className="font-semibold text-fg truncate">
          {reasoningProfile.familyName}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted shrink-0">
          {SOURCE_LABELS[profileSource]}
        </span>
      </div>

      {reasoningProfile.strategy === 'none' ? (
        <div className="cb-list-item p-2.5 space-y-2.5 text-muted leading-relaxed">
          <p>
            当前模型未配备可调思考强度。若这是支持思考的新模型或中转站自定义名称，可在供应商配置中指定思考系列或同步规则库。
          </p>
          <button
            type="button"
            onClick={onOpenProvidersSettings}
            className="w-full px-3 py-1.5 rounded-xl bg-surface hover:bg-fg/10 border border-borderc text-fg font-medium active:scale-95 transition"
          >
            前往设置思考系列 / 更新规则库
          </button>
        </div>
      ) : reasoningProfile.strategy === 'fixed' ? (
        <div className="cb-list-item p-2.5 space-y-2.5 text-muted leading-relaxed">
          <p>{reasoningProfile.levels[0]?.desc || '模型内置固定思维链推理。'}</p>
          <button
            type="button"
            onClick={onOpenProvidersSettings}
            className="w-full px-3 py-1.5 rounded-xl bg-surface hover:bg-fg/10 border border-borderc text-fg font-medium active:scale-95 transition"
          >
            自定义模型系列映射
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {reasoningProfile.levels.map((opt, idx) => {
            const selected = effectiveReasoning === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelectLevel(opt.value, opt.budgetTokens)}
                style={{ '--stagger-i': idx } as React.CSSProperties}
                className={`cb-list-item w-full text-left px-2.5 py-2 rounded-xl active:scale-[0.985] transition ${
                  selected ? 'bg-accent text-accentfg font-medium' : 'text-fg hover:bg-fg/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{opt.label}</span>
                  {selected && <span className="text-[10px]">当前</span>}
                </div>
                <div className={`text-[11px] mt-0.5 ${selected ? 'opacity-85' : 'text-muted'}`}>
                  {opt.desc}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
