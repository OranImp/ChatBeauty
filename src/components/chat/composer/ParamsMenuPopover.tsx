import React from 'react';
import { RotateCcw } from 'lucide-react';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import type { CustomModelParams } from '@/types/chat';

interface ParamsMenuPopoverProps {
  effectiveTemp: number;
  effectiveTopP: number;
  effectiveMaxTokens: number;
  effectiveBudget: number;
  showBudgetSlider: boolean;
  hasBudgetOverride: boolean;
  samplingAutoOmitted: boolean;
  onPatchParams: (patch: Partial<CustomModelParams>) => void;
  onClearThinkingBudgetOverride: () => void;
  onResetParams: () => void;
}

export const ParamsMenuPopover: React.FC<ParamsMenuPopoverProps> = ({
  effectiveTemp,
  effectiveTopP,
  effectiveMaxTokens,
  effectiveBudget,
  showBudgetSlider,
  hasBudgetOverride,
  samplingAutoOmitted,
  onPatchParams,
  onClearThinkingBudgetOverride,
  onResetParams,
}) => {
  return (
    <div className="p-3 max-h-[65vh] overflow-y-auto no-scrollbar space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-fg">当前会话参数覆盖</span>
        <button
          type="button"
          onClick={onResetParams}
          className="flex items-center gap-1 text-muted hover:text-fg transition"
        >
          <RotateCcw className="w-3 h-3" />
          <span>恢复默认</span>
        </button>
      </div>

      <div
        className="cb-list-item space-y-2.5"
        style={{ '--stagger-i': 0 } as React.CSSProperties}
      >
        <label className="block space-y-1">
          <div className="flex justify-between text-muted">
            <span>Temperature</span>
            <span className="font-mono tabular-nums text-fg">{effectiveTemp.toFixed(2)}</span>
          </div>
          <SmoothSlider
            min={0}
            max={2}
            decimals={2}
            value={effectiveTemp}
            onChange={(val) => onPatchParams({ temperature: val })}
            ariaLabel="会话 Temperature"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between text-muted">
            <span>Top-P</span>
            <span className="font-mono tabular-nums text-fg">{effectiveTopP.toFixed(2)}</span>
          </div>
          <SmoothSlider
            min={0.05}
            max={1}
            decimals={2}
            value={effectiveTopP}
            onChange={(val) => onPatchParams({ topP: val })}
            ariaLabel="会话 Top-P"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between text-muted">
            <span>Max Output Tokens</span>
            <span className="font-mono tabular-nums text-fg">{effectiveMaxTokens}</span>
          </div>
          <SmoothSlider
            min={256}
            max={32768}
            decimals={0}
            value={effectiveMaxTokens}
            onChange={(val) => onPatchParams({ maxTokens: val })}
            ariaLabel="会话 Max Tokens"
          />
        </label>

        {showBudgetSlider && (
          <label className="block space-y-1">
            <div className="flex justify-between items-center text-muted gap-2">
              <span className="flex items-center gap-1.5">
                <span>思考预算 Tokens</span>
                {hasBudgetOverride && (
                  <button
                    type="button"
                    onClick={onClearThinkingBudgetOverride}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted hover:text-fg transition"
                  >
                    跟随档位
                  </button>
                )}
              </span>
              <span className="font-mono tabular-nums text-fg">
                {!hasBudgetOverride && effectiveBudget < 0 ? '动态 (-1)' : effectiveBudget}
              </span>
            </div>
            <SmoothSlider
              min={1024}
              max={32768}
              decimals={0}
              value={effectiveBudget >= 1024 ? Math.min(32768, effectiveBudget) : 8192}
              onChange={(val) => onPatchParams({ thinkingBudget: val })}
              ariaLabel="会话思考预算 Tokens"
            />
          </label>
        )}

        {samplingAutoOmitted && (
          <p className="text-[11px] text-muted leading-snug">
            当前模型/思考模式会自动省略 Temperature 与 Top-P 以防请求报错。
          </p>
        )}
      </div>
    </div>
  );
};
