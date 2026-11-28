import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CloudDownload, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  BUILTIN_MODEL_PROFILE_RULES,
  parseModelProfileRulesJson,
} from '@/services/llm/modelProfiles';
import {
  SettingsCollapsibleRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

export const GenerationTab: React.FC = () => {
  const {
    generation,
    contextSettings,
    modelProfileSync,
    updateGeneration,
    updateContextSettings,
    updateModelProfileSync,
    syncRemoteModelProfiles,
    saveCustomModelProfileRules,
  } = useAppStore(
    useShallow((s) => ({
      generation: s.generation,
      contextSettings: s.contextSettings,
      modelProfileSync: s.modelProfileSync,
      updateGeneration: s.updateGeneration,
      updateContextSettings: s.updateContextSettings,
      updateModelProfileSync: s.updateModelProfileSync,
      syncRemoteModelProfiles: s.syncRemoteModelProfiles,
      saveCustomModelProfileRules: s.saveCustomModelProfileRules,
    }))
  );

  const [globalExtraOpen, setGlobalExtraOpen] = useState(false);
  const [customRulesOpen, setCustomRulesOpen] = useState(false);
  const [globalExtraText, setGlobalExtraText] = useState(() =>
    generation.extraBody && Object.keys(generation.extraBody).length > 0
      ? JSON.stringify(generation.extraBody, null, 2)
      : '{}'
  );
  const [globalExtraErr, setGlobalExtraErr] = useState<string | null>(null);
  const [remoteUrlInput, setRemoteUrlInput] = useState(modelProfileSync.remoteUrl);
  const [customRulesText, setCustomRulesText] = useState(() =>
    modelProfileSync.customRules.length > 0
      ? JSON.stringify(modelProfileSync.customRules, null, 2)
      : ''
  );
  const [syncingRules, setSyncingRules] = useState(false);
  const [rulesFeedback, setRulesFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setRemoteUrlInput(modelProfileSync.remoteUrl);
  }, [modelProfileSync.remoteUrl]);

  const handleGlobalExtraChange = (raw: string) => {
    setGlobalExtraText(raw);
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}') {
      setGlobalExtraErr(null);
      void updateGeneration({ extraBody: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setGlobalExtraErr('必须为 JSON 对象');
        return;
      }
      setGlobalExtraErr(null);
      void updateGeneration({ extraBody: parsed as Record<string, unknown> });
    } catch {
      setGlobalExtraErr('JSON 语法无效');
    }
  };

  const handleSyncRemoteRules = async () => {
    setSyncingRules(true);
    setRulesFeedback(null);
    try {
      await updateModelProfileSync({ remoteUrl: remoteUrlInput.trim() });
      const res = await syncRemoteModelProfiles(remoteUrlInput.trim());
      setRulesFeedback({ ok: true, text: `已同步 ${res.count} 条在线规则，已实时生效` });
    } catch (err) {
      setRulesFeedback({
        ok: false,
        text: err instanceof Error ? err.message : '同步失败',
      });
    } finally {
      setSyncingRules(false);
    }
  };

  const handleSaveCustomRules = async () => {
    const trimmed = customRulesText.trim();
    if (!trimmed) {
      await saveCustomModelProfileRules([]);
      setRulesFeedback({ ok: true, text: '已清空自定义规则' });
      return;
    }
    try {
      const rules = parseModelProfileRulesJson(trimmed);
      await saveCustomModelProfileRules(rules);
      setRulesFeedback({ ok: true, text: `已应用 ${rules.length} 条自定义规则，实时生效` });
    } catch (err) {
      setRulesFeedback({
        ok: false,
        text: err instanceof Error ? err.message : '规则 JSON 格式错误',
      });
    }
  };

  const enabled = {
    temperature: generation.enabledParams?.temperature ?? true,
    topP: generation.enabledParams?.topP ?? true,
    maxTokens: generation.enabledParams?.maxTokens ?? true,
    presencePenalty: generation.enabledParams?.presencePenalty ?? false,
    frequencyPenalty: generation.enabledParams?.frequencyPenalty ?? false,
  };

  const hasGlobalExtra = Boolean(globalExtraText.trim() && globalExtraText.trim() !== '{}');
  const thresholdPercent = Math.round(contextSettings.autoCompactThreshold * 100);
  const contextPresets: Array<{ label: string; value: number }> = [
    { label: '自动识别', value: 0 },
    { label: '200K', value: 200000 },
    { label: '500K', value: 500000 },
    { label: '1M', value: 1000000 },
  ];

  return (
    <div key="providers-generation" className="space-y-5 text-[13.5px] min-w-0 max-w-full">
      <SettingsSection
        title="上下文统计与自动压缩"
        description="主页面发送按钮旁圆环实时展示占用比例；达到阈值后发送新消息前将自动摘要较早记录，界面仍保留完整历史"
        action={
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-fg/10 text-muted">
            {contextSettings.autoCompactEnabled ? `阈值 ${thresholdPercent}%` : '自动压缩关'}
          </span>
        }
      >
        <SettingsToggleRow
          title="启用自动上下文压缩"
          description="当占用率达到触发阈值时自动合并较早对话为紧凑摘要，避免超长报错与注意力稀释"
          checked={contextSettings.autoCompactEnabled}
          onChange={(checked) => void updateContextSettings({ autoCompactEnabled: checked })}
          ariaLabel="启用自动上下文压缩"
        />

        <div className="px-3.5 sm:px-4 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          <div className="space-y-1.5 min-w-0">
            <div className="flex justify-between text-xs text-muted">
              <span>自动压缩触发阈值</span>
              <span className="font-mono tabular-nums text-fg">{thresholdPercent}%</span>
            </div>
            <SmoothSlider
              min={50}
              max={95}
              decimals={0}
              value={thresholdPercent}
              onChange={(val) =>
                void updateContextSettings({
                  autoCompactThreshold: Math.min(0.95, Math.max(0.5, val / 100)),
                })
              }
              ariaLabel="自动压缩触发阈值"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex justify-between text-xs text-muted">
              <span>压缩后保留最近消息数</span>
              <span className="font-mono tabular-nums text-fg">
                {contextSettings.keepRecentMessages} 条
              </span>
            </div>
            <SmoothSlider
              min={2}
              max={24}
              decimals={0}
              value={contextSettings.keepRecentMessages}
              onChange={(val) => void updateContextSettings({ keepRecentMessages: val })}
              ariaLabel="压缩后保留最近消息数"
            />
          </div>
        </div>

        <div className="px-3.5 sm:px-4 py-3.5 space-y-2.5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>上下文窗口上限（用于占用率统计与自动压缩）</span>
            <span className="font-mono text-[11px] text-fg/80">
              {contextSettings.customMaxContextTokens > 0
                ? `${contextSettings.customMaxContextTokens.toLocaleString()} tokens`
                : `按模型自动（回退 ${
                    contextSettings.defaultContextWindow >= 1_000_000
                      ? `${Number((contextSettings.defaultContextWindow / 1_000_000).toFixed(2))}M`
                      : `${Math.round(contextSettings.defaultContextWindow / 1000)}K`
                  }）`}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {contextPresets.map((preset) => {
              const active = contextSettings.customMaxContextTokens === preset.value;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() =>
                    void updateContextSettings({ customMaxContextTokens: preset.value })
                  }
                  className={`px-2.5 py-1 rounded-lg border text-xs transition ${
                    active
                      ? 'border-accent bg-accent/15 text-fg font-medium'
                      : 'border-borderc bg-bg text-muted hover:text-fg hover:bg-surface'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}

            <input
              type="number"
              min={0}
              step={1024}
              value={contextSettings.customMaxContextTokens || ''}
              onChange={(e) => {
                const val = Math.max(0, Math.round(Number(e.target.value) || 0));
                void updateContextSettings({ customMaxContextTokens: val });
              }}
              placeholder="自定义 (0=自动)"
              aria-label="自定义上下文窗口上限"
              className="w-44 sm:w-48 max-w-full px-2.5 py-1 rounded-lg bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="全局采样参数"
        description="默认作用于所有未单独覆写的模型会话"
      >
        <div className="px-3.5 sm:px-4 py-3.5 grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-2">
                <span>Temperature</span>
                <ToggleSwitch
                  checked={enabled.temperature}
                  onChange={(checked) =>
                    void updateGeneration({
                      enabledParams: { ...enabled, temperature: checked },
                    })
                  }
                  ariaLabel="启用 Temperature"
                />
              </span>
              <span className="font-mono tabular-nums text-fg">
                {enabled.temperature ? generation.temperature.toFixed(2) : '未发送'}
              </span>
            </div>
            <SmoothSlider
              min={0}
              max={2}
              decimals={2}
              value={generation.temperature}
              onChange={(val) => void updateGeneration({ temperature: val })}
              ariaLabel="Temperature"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-2">
                <span>Top-P</span>
                <ToggleSwitch
                  checked={enabled.topP}
                  onChange={(checked) =>
                    void updateGeneration({
                      enabledParams: { ...enabled, topP: checked },
                    })
                  }
                  ariaLabel="启用 Top-P"
                />
              </span>
              <span className="font-mono tabular-nums text-fg">
                {enabled.topP ? generation.topP.toFixed(2) : '未发送'}
              </span>
            </div>
            <SmoothSlider
              min={0.1}
              max={1}
              decimals={2}
              value={generation.topP}
              onChange={(val) => void updateGeneration({ topP: val })}
              ariaLabel="Top-P"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-2">
                <span>Presence Penalty</span>
                <ToggleSwitch
                  checked={enabled.presencePenalty}
                  onChange={(checked) =>
                    void updateGeneration({
                      enabledParams: { ...enabled, presencePenalty: checked },
                    })
                  }
                  ariaLabel="启用 Presence Penalty"
                />
              </span>
              <span className="font-mono tabular-nums text-fg">
                {enabled.presencePenalty
                  ? (generation.presencePenalty ?? 0).toFixed(2)
                  : '未发送'}
              </span>
            </div>
            <SmoothSlider
              min={-2}
              max={2}
              decimals={2}
              value={generation.presencePenalty ?? 0}
              onChange={(val) => void updateGeneration({ presencePenalty: val })}
              ariaLabel="Presence Penalty"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center justify-between text-xs text-muted">
              <span className="flex items-center gap-2">
                <span>Frequency Penalty</span>
                <ToggleSwitch
                  checked={enabled.frequencyPenalty}
                  onChange={(checked) =>
                    void updateGeneration({
                      enabledParams: { ...enabled, frequencyPenalty: checked },
                    })
                  }
                  ariaLabel="启用 Frequency Penalty"
                />
              </span>
              <span className="font-mono tabular-nums text-fg">
                {enabled.frequencyPenalty
                  ? (generation.frequencyPenalty ?? 0).toFixed(2)
                  : '未发送'}
              </span>
            </div>
            <SmoothSlider
              min={-2}
              max={2}
              decimals={2}
              value={generation.frequencyPenalty ?? 0}
              onChange={(val) => void updateGeneration({ frequencyPenalty: val })}
              ariaLabel="Frequency Penalty"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex justify-between text-xs text-muted">
              <span>Max Output Tokens</span>
              <span className="font-mono tabular-nums text-fg">{generation.maxTokens}</span>
            </div>
            <SmoothSlider
              min={512}
              max={32768}
              decimals={0}
              value={generation.maxTokens}
              onChange={(val) => void updateGeneration({ maxTokens: val })}
              ariaLabel="Max Output Tokens"
            />
          </div>

          <div className="space-y-1.5 min-w-0">
            <div className="flex justify-between text-xs text-muted">
              <span>上下文携带消息数</span>
              <span className="font-mono tabular-nums text-fg">
                {generation.maxContextMessages} 条
              </span>
            </div>
            <SmoothSlider
              min={4}
              max={64}
              decimals={0}
              value={generation.maxContextMessages}
              onChange={(val) => void updateGeneration({ maxContextMessages: val })}
              ariaLabel="上下文携带消息数"
            />
          </div>
        </div>

        <SettingsCollapsibleRow
          title="全局默认自定义请求体 JSON (extraBody)"
          description="可选追加到每个请求体中的 JSON 字段"
          value={hasGlobalExtra ? '已配置' : '默认 {}'}
          open={globalExtraOpen}
          onToggle={() => setGlobalExtraOpen((v) => !v)}
        >
          <div className="space-y-1.5 min-w-0">
            <textarea
              rows={3}
              value={globalExtraText}
              onChange={(e) => handleGlobalExtraChange(e.target.value)}
              placeholder='{"user": "chatbeauty-study"}'
              className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
            {globalExtraErr && (
              <div className="text-xs text-rose-600 dark:text-rose-400 break-words">
                {globalExtraErr}
              </div>
            )}
          </div>
        </SettingsCollapsibleRow>
      </SettingsSection>

      <SettingsSection
        title="已知模型思考强度规则库"
        description="按「模型专属指定 → 自定义规则 → 在线规则 → 内置规则」顺序匹配思考档位"
        action={
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-fg/10 text-muted">
            内置 {BUILTIN_MODEL_PROFILE_RULES.length} · 在线 {modelProfileSync.remoteRules.length} ·
            自定义 {modelProfileSync.customRules.length}
          </span>
        }
      >
        <div className="px-3.5 sm:px-4 py-3 space-y-2.5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>在线规则库 URL（支持正则与中转站前缀如 openai/gpt-5.2）</span>
            {modelProfileSync.lastStatus && (
              <span className="text-[11px] font-mono break-all text-fg/80">
                {modelProfileSync.lastStatus}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <input
              value={remoteUrlInput}
              onChange={(e) => setRemoteUrlInput(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../model-profiles.json"
              className="w-full sm:flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
            <button
              type="button"
              disabled={syncingRules}
              onClick={() => void handleSyncRemoteRules()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated border border-borderc hover:border-fg/35 text-xs text-fg shrink-0 self-start sm:self-auto active:scale-95 transition disabled:opacity-50"
            >
              {syncingRules ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudDownload className="w-3.5 h-3.5" />
              )}
              <span>同步在线规则</span>
            </button>
          </div>
          {rulesFeedback && (
            <div
              className={`px-3 py-2 rounded-xl border text-xs ${
                rulesFeedback.ok
                  ? 'border-borderc bg-surface text-fg'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              }`}
            >
              {rulesFeedback.text}
            </div>
          )}
        </div>

        <SettingsCollapsibleRow
          title="自定义匹配规则 (JSON 数组)"
          description="优先于内置与在线规则生效"
          value={`${modelProfileSync.customRules.length} 条`}
          open={customRulesOpen}
          onToggle={() => setCustomRulesOpen((v) => !v)}
        >
          <div className="space-y-2.5 min-w-0">
            <textarea
              rows={4}
              value={customRulesText}
              onChange={(e) => setCustomRulesText(e.target.value)}
              placeholder='[{"pattern": "^my-relay-model", "profileId": "openai-gpt5-xhigh"}]'
              className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCustomRulesText('');
                  void saveCustomModelProfileRules([]).then(() =>
                    setRulesFeedback({ ok: true, text: '已清空自定义规则' })
                  );
                }}
                className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition"
              >
                清空规则
              </button>
              <button
                type="button"
                onClick={() => void handleSaveCustomRules()}
                className="px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold active:scale-95 transition"
              >
                应用自定义规则
              </button>
            </div>
          </div>
        </SettingsCollapsibleRow>
      </SettingsSection>
    </div>
  );
};
