import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudDownload,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { parseHttpHeadersJson, toModelDefinition } from '@/services/llm/adapters/shared';
import type {
  CustomModelParams,
  ModelDefinition,
  ProtocolType,
  ProviderConfig,
} from '@/types/chat';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Collapsible } from '@/components/ui/MotionPrimitives';
import {
  BUILTIN_MODEL_PROFILE_RULES,
  listAllReasoningProfiles,
  parseModelProfileRulesJson,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import { ProviderWizard } from './ProviderWizard';

function pruneParams(params?: CustomModelParams): CustomModelParams | undefined {
  if (!params) return undefined;
  const out: CustomModelParams = {};
  if (params.temperature !== undefined && Number.isFinite(params.temperature)) {
    out.temperature = params.temperature;
  }
  if (params.topP !== undefined && Number.isFinite(params.topP)) {
    out.topP = params.topP;
  }
  if (params.maxTokens !== undefined && Number.isFinite(params.maxTokens)) {
    out.maxTokens = Math.round(params.maxTokens);
  }
  if (params.presencePenalty !== undefined && Number.isFinite(params.presencePenalty)) {
    out.presencePenalty = params.presencePenalty;
  }
  if (params.frequencyPenalty !== undefined && Number.isFinite(params.frequencyPenalty)) {
    out.frequencyPenalty = params.frequencyPenalty;
  }
  if (params.seed !== undefined && Number.isFinite(params.seed)) {
    out.seed = Math.round(params.seed);
  }
  if (params.thinkingBudget !== undefined && Number.isFinite(params.thinkingBudget)) {
    out.thinkingBudget = Math.round(params.thinkingBudget);
  }
  if (params.reasoningProfileId) {
    out.reasoningProfileId = params.reasoningProfileId;
  }
  if (params.stop && params.stop.length > 0) {
    out.stop = params.stop;
  }
  if (params.extraBody && Object.keys(params.extraBody).length > 0) {
    out.extraBody = params.extraBody;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

export const ProvidersTab: React.FC = () => {
  const {
    providers,
    activeProviderId,
    activeModelId,
    generation,
    modelProfileSync,
    saveProvider,
    deleteProvider,
    setActiveProviderModel,
    fetchProviderModels,
    testProviderConnection,
    updateGeneration,
    updateModelProfileSync,
    syncRemoteModelProfiles,
    saveCustomModelProfileRules,
  } = useAppStore();

  const [view, setView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [headersText, setHeadersText] = useState('{}');
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelExtraJson, setModelExtraJson] = useState<Record<string, string>>({});
  const [modelExtraErr, setModelExtraErr] = useState<Record<string, string | null>>({});
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);

  // List-view accordions & rule sync states
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
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

  const openEditor = (p: ProviderConfig) => {
    setDraft(structuredClone(p));
    setHeadersText(JSON.stringify(p.extraHeaders || {}, null, 2));
    setShowKey(false);
    setExpandedModelId(null);
    setModelExtraJson({});
    setModelExtraErr({});
    setStatusMsg(null);
    setView('edit');
  };

  const handleWizardComplete = async (created: ProviderConfig) => {
    await saveProvider(created);
    await setActiveProviderModel(
      created.id,
      created.defaultModel || created.models[0]?.id || ''
    );
    setView('list');
  };

  const handleSave = async () => {
    if (!draft) return;
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = parseHttpHeadersJson(headersText);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '自定义 Headers JSON 格式无效',
      });
      return;
    }
    const pendingModelErr = Object.values(modelExtraErr).find(Boolean);
    if (pendingModelErr) {
      setStatusMsg({ ok: false, text: `模型参数 JSON 有误：${pendingModelErr}` });
      return;
    }

    const cleanModels = draft.models.map((m) => ({
      ...m,
      params: pruneParams(m.params),
    }));
    const cleanDefault = draft.defaultModel.trim() || cleanModels[0]?.id || '';
    const updated: ProviderConfig = {
      ...draft,
      name: draft.name.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultName,
      baseUrl: draft.baseUrl.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl,
      defaultModel: cleanDefault,
      models: cleanModels,
      extraHeaders: parsedHeaders,
    };
    await saveProvider(updated);
    setDraft(structuredClone(updated));
    setStatusMsg({ ok: true, text: '接口与模型参数配置已保存' });
    setTimeout(() => setStatusMsg(null), 2200);
  };

  const handleFetchModels = async () => {
    if (!draft) return;
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = parseHttpHeadersJson(headersText);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '自定义 Headers JSON 格式无效',
      });
      return;
    }
    const candidate: ProviderConfig = { ...draft, extraHeaders: parsedHeaders };
    setFetchingModels(true);
    setStatusMsg(null);
    try {
      const fetched = await fetchProviderModels(candidate);
      if (fetched.length === 0) {
        setStatusMsg({ ok: false, text: '接口未返回模型列表，可手动添加模型 ID' });
      } else {
        const existingMap = new Map(candidate.models.map((m) => [m.id, m]));
        const merged = fetched.map((m) => {
          const prev = existingMap.get(m.id);
          return prev?.params ? { ...m, params: prev.params } : m;
        });
        const nextDefault = candidate.defaultModel || merged[0].id;
        const nextDraft = { ...candidate, models: merged, defaultModel: nextDefault };
        setDraft(nextDraft);
        await saveProvider(nextDraft);
        setStatusMsg({ ok: true, text: `已拉取并保存 ${merged.length} 个可用模型` });
      }
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '拉取模型列表失败',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (!draft) return;
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = parseHttpHeadersJson(headersText);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '自定义 Headers JSON 格式无效',
      });
      return;
    }
    const candidate: ProviderConfig = { ...draft, extraHeaders: parsedHeaders };
    setTesting(true);
    setStatusMsg(null);
    try {
      const modelToUse =
        candidate.defaultModel ||
        candidate.models[0]?.id ||
        PROTOCOL_TEMPLATES[candidate.protocol].placeholderModel;
      const reply = await testProviderConnection(candidate, modelToUse);
      setStatusMsg({ ok: true, text: `连接成功 (${modelToUse})：${reply.slice(0, 60)}` });
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '测试连接失败',
      });
    } finally {
      setTesting(false);
    }
  };

  const addManualModel = () => {
    if (!draft) return;
    const id = newModelId.trim();
    if (!id) return;
    if (!draft.models.some((m) => m.id === id)) {
      setDraft({
        ...draft,
        defaultModel: draft.defaultModel || id,
        models: [...draft.models, toModelDefinition(id)],
      });
    }
    setNewModelId('');
  };

  const toggleExpandModel = (m: ModelDefinition) => {
    if (expandedModelId === m.id) {
      setExpandedModelId(null);
      return;
    }
    setModelExtraJson((prev) => ({
      ...prev,
      [m.id]:
        prev[m.id] ??
        (m.params?.extraBody && Object.keys(m.params.extraBody).length > 0
          ? JSON.stringify(m.params.extraBody, null, 2)
          : '{}'),
    }));
    setExpandedModelId(m.id);
  };

  const patchModelParams = (modelId: string, patch: Partial<CustomModelParams>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((m) => {
          if (m.id !== modelId) return m;
          const nextParams = pruneParams({ ...(m.params || {}), ...patch });
          return { ...m, params: nextParams };
        }),
      };
    });
  };

  const handleModelExtraJsonChange = (modelId: string, raw: string) => {
    setModelExtraJson((prev) => ({ ...prev, [modelId]: raw }));
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '{}') {
      setModelExtraErr((prev) => ({ ...prev, [modelId]: null }));
      patchModelParams(modelId, { extraBody: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setModelExtraErr((prev) => ({ ...prev, [modelId]: '需为 JSON 对象' }));
        return;
      }
      setModelExtraErr((prev) => ({ ...prev, [modelId]: null }));
      patchModelParams(modelId, { extraBody: parsed as Record<string, unknown> });
    } catch {
      setModelExtraErr((prev) => ({ ...prev, [modelId]: 'JSON 语法无效' }));
    }
  };

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

  if (view === 'wizard') {
    return (
      <div className="cb-panel-enter">
        <ProviderWizard
          onCancel={() => setView('list')}
          onComplete={handleWizardComplete}
        />
      </div>
    );
  }

  if (view === 'edit' && draft) {
    const allProfiles = listAllReasoningProfiles();
    return (
      <div className="cb-panel-enter space-y-4 text-xs">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setView('list')}
            className="flex items-center gap-1.5 text-muted hover:text-fg transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回供应商列表</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void deleteProvider(draft.id);
              setView('list');
            }}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-muted hover:text-rose-400 hover:bg-white/5 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>删除接口</span>
          </button>
        </div>

        <div className="rounded-2xl border border-borderc bg-surface/45 p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-muted">配置名称</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
              />
            </label>

            <label className="space-y-1">
              <span className="text-muted">调用协议</span>
              <select
                value={draft.protocol}
                onChange={(e) => {
                  const proto = e.target.value as ProtocolType;
                  setDraft({
                    ...draft,
                    protocol: proto,
                    baseUrl: PROTOCOL_TEMPLATES[proto].defaultBaseUrl,
                  });
                }}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
              >
                {(Object.keys(PROTOCOL_TEMPLATES) as ProtocolType[]).map((proto) => (
                  <option key={proto} value={proto}>
                    {PROTOCOL_TEMPLATES[proto].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-muted">Base URL（支持任意兼容中转站地址）</span>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder={PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-muted">API Key</span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-... / AIza... / sk-ant-..."
                className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted">
                模型列表（点击名称设为默认，点击右侧图标配置专属参数与思考系列）
              </span>
              <button
                type="button"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated border border-borderc text-fg hover:border-fg/35 shrink-0 transition disabled:opacity-50"
              >
                {fetchingModels ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>在线拉取模型</span>
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addManualModel();
                  }
                }}
                placeholder={`手动添加模型 ID，如 ${PROTOCOL_TEMPLATES[draft.protocol].placeholderModel}`}
                className="flex-1 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
              />
              <button
                type="button"
                onClick={addManualModel}
                className="px-3 py-1.5 rounded-xl bg-elevated border border-borderc text-fg hover:border-fg/35"
              >
                添加
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {draft.models.map((m) => {
                const isDefault = draft.defaultModel === m.id;
                const isActive = activeProviderId === draft.id && activeModelId === m.id;
                const isExpanded = expandedModelId === m.id;
                const { profile: resolvedProf } = resolveModelReasoningProfile({
                  modelId: m.id,
                  protocol: draft.protocol,
                  modelDef: m,
                  customRules: modelProfileSync.customRules,
                  remoteRules: modelProfileSync.remoteRules,
                });
                const { profile: autoProf } = resolveModelReasoningProfile({
                  modelId: m.id,
                  protocol: draft.protocol,
                  customRules: modelProfileSync.customRules,
                  remoteRules: modelProfileSync.remoteRules,
                });
                const hasCustom = Boolean(m.params && Object.keys(m.params).length > 0);
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border transition ${
                      isActive || isDefault || isExpanded
                        ? 'bg-elevated/90 border-fg/25 text-fg'
                        : 'bg-bg/60 border-borderc text-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft({ ...draft, defaultModel: m.id });
                          const savedProv = providers.find((p) => p.id === draft.id);
                          if (savedProv?.models.some((x) => x.id === m.id)) {
                            void setActiveProviderModel(draft.id, m.id);
                          }
                        }}
                        className="flex-1 text-left flex items-center justify-between min-w-0 gap-2"
                      >
                        <span className="truncate font-mono text-fg">{m.id}</span>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/5 text-muted truncate max-w-[130px]">
                            {resolvedProf.familyName.split('（')[0]}
                          </span>
                          {(isActive || isDefault) && (
                            <span className="text-[10px] text-accent">默认</span>
                          )}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleExpandModel(m)}
                        className={`relative p-1 rounded-md hover:bg-fg/10 shrink-0 transition ${
                          isExpanded ? 'text-fg bg-fg/10' : 'text-muted hover:text-fg'
                        }`}
                        title="自定义该模型参数与思考强度系列"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        {hasCustom && (
                          <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const remaining = draft.models.filter((x) => x.id !== m.id);
                          setDraft({
                            ...draft,
                            models: remaining,
                            defaultModel:
                              draft.defaultModel === m.id
                                ? remaining[0]?.id ?? ''
                                : draft.defaultModel,
                          });
                        }}
                        className="p-1 text-muted hover:text-rose-400 shrink-0"
                        title="删除模型"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <Collapsible open={isExpanded}>
                      <div className="px-3 pb-3 pt-2.5 border-t border-borderc bg-bg/50 space-y-3 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-fg">模型专属参数（留空则沿用全局）</span>
                          {hasCustom && (
                            <button
                              type="button"
                              onClick={() => {
                                setModelExtraJson((prev) => ({ ...prev, [m.id]: '{}' }));
                                setModelExtraErr((prev) => ({ ...prev, [m.id]: null }));
                                setDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        models: prev.models.map((item) =>
                                          item.id === m.id ? { ...item, params: undefined } : item
                                        ),
                                      }
                                    : prev
                                );
                              }}
                              className="text-muted hover:text-fg transition"
                            >
                              清空覆盖
                            </button>
                          )}
                        </div>

                        <label className="block space-y-1">
                          <span className="text-muted">思考强度系列映射</span>
                          <select
                            value={m.params?.reasoningProfileId || ''}
                            onChange={(e) =>
                              patchModelParams(m.id, {
                                reasoningProfileId: e.target.value || undefined,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-borderc text-fg focus:outline-none focus:border-fg/40"
                          >
                            <option value="">自动识别（{autoProf.familyName}）</option>
                            {allProfiles.map((prof) => (
                              <option key={prof.id} value={prof.id}>
                                {prof.familyName}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          <label className="space-y-1">
                            <span className="text-muted">Temperature</span>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="2"
                              value={m.params?.temperature ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  temperature: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="全局默认"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-muted">Top-P</span>
                            <input
                              type="number"
                              step="0.05"
                              min="0"
                              max="1"
                              value={m.params?.topP ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  topP: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="全局默认"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-muted">Max Tokens</span>
                            <input
                              type="number"
                              step="256"
                              min="128"
                              max="128000"
                              value={m.params?.maxTokens ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  maxTokens: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="全局默认"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-muted">Presence Penalty</span>
                            <input
                              type="number"
                              step="0.1"
                              min="-2"
                              max="2"
                              value={m.params?.presencePenalty ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  presencePenalty: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="不发送"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-muted">Frequency Penalty</span>
                            <input
                              type="number"
                              step="0.1"
                              min="-2"
                              max="2"
                              value={m.params?.frequencyPenalty ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  frequencyPenalty: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="不发送"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-muted">Thinking Budget</span>
                            <input
                              type="number"
                              step="512"
                              min="0"
                              max="65536"
                              value={m.params?.thinkingBudget ?? ''}
                              onChange={(e) =>
                                patchModelParams(m.id, {
                                  thinkingBudget: parseOptionalNumber(e.target.value),
                                })
                              }
                              placeholder="按档位自动"
                              className="w-full px-2 py-1 rounded-lg bg-surface border border-borderc font-mono text-fg"
                            />
                          </label>
                        </div>

                        <label className="block space-y-1">
                          <div className="flex items-center justify-between text-muted">
                            <span>模型级自定义请求体 JSON (extraBody)</span>
                            {modelExtraErr[m.id] && (
                              <span className="text-rose-400">{modelExtraErr[m.id]}</span>
                            )}
                          </div>
                          <textarea
                            rows={2}
                            value={modelExtraJson[m.id] ?? '{}'}
                            onChange={(e) => handleModelExtraJsonChange(m.id, e.target.value)}
                            placeholder='{"seed": 42, "enable_thinking": true}'
                            className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-borderc font-mono text-fg focus:outline-none focus:border-fg/40"
                          />
                        </label>
                      </div>
                    </Collapsible>
                  </div>
                );
              })}
            </div>
          </div>

          <details>
            <summary className="cursor-pointer text-muted hover:text-fg">
              高级：自定义请求头 (JSON)
            </summary>
            <textarea
              rows={2}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-fg focus:outline-none focus:border-fg/40"
            />
          </details>

          {statusMsg && (
            <div
              className={`px-3 py-2 rounded-xl border ${
                statusMsg.ok
                  ? 'border-borderc bg-surface text-fg'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTest()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-borderc bg-bg hover:bg-elevated text-fg transition disabled:opacity-50"
            >
              {testing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Wifi className="w-3.5 h-3.5" />
              )}
              <span>测试连接</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg font-semibold hover:opacity-90 transition"
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存配置</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cb-panel-enter space-y-4 text-xs">
      {/* Header + Single Add Provider CTA */}
      <div className="flex items-center justify-between gap-3 pb-1">
        <div>
          <div className="text-sm font-semibold text-fg">模型供应商</div>
          <div className="text-muted mt-0.5">
            管理 OpenAI Chat / Responses、Gemini 与 Anthropic 接口；模型、思考强度与参数可在输入框直接实时调节。
          </div>
        </div>
        <button
          type="button"
          onClick={() => setView('wizard')}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-accentfg font-semibold shrink-0 hover:opacity-90 active:scale-95 transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>添加供应商</span>
        </button>
      </div>

      {/* Configured Providers List */}
      {providers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-borderc p-8 text-center space-y-3">
          <div className="text-muted">尚未添加任何大模型接口</div>
          <button
            type="button"
            onClick={() => setView('wizard')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg font-semibold active:scale-95 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>立即配置</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const isActive = p.id === activeProviderId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => openEditor(p)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border border-borderc bg-surface/45 hover:bg-surface active:scale-[0.99] transition text-left"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13px] text-fg truncate">{p.name}</span>
                    {isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-fg shrink-0">
                        当前使用
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    {PROTOCOL_TEMPLATES[p.protocol].shortLabel} · {p.models.length} 个模型 · 默认{' '}
                    {p.defaultModel || '未指定'}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-muted shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {/* Collapsible Global Sampling Parameters */}
      <div className="rounded-2xl border border-borderc bg-surface/35 overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left font-semibold text-fg hover:bg-fg/[0.03] transition"
        >
          <span>高级采样参数与全局自定义请求体</span>
          <ChevronRight
            className={`w-4 h-4 text-muted transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              advancedOpen ? 'rotate-90 text-fg' : ''
            }`}
          />
        </button>
        <Collapsible open={advancedOpen}>
          <div className="px-4 pb-4 pt-3 border-t border-borderc space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-muted">
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

              <div className="space-y-1">
                <div className="flex items-center justify-between text-muted">
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

              <div className="space-y-1">
                <div className="flex items-center justify-between text-muted">
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

              <div className="space-y-1">
                <div className="flex items-center justify-between text-muted">
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

              <div className="space-y-1">
                <div className="flex justify-between text-muted">
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

              <div className="space-y-1">
                <div className="flex justify-between text-muted">
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

            <div className="space-y-1 pt-2 border-t border-borderc">
              <div className="flex items-center justify-between text-muted">
                <span>全局默认自定义请求体 JSON (extraBody)</span>
                {globalExtraErr && <span className="text-rose-400">{globalExtraErr}</span>}
              </div>
              <textarea
                rows={2}
                value={globalExtraText}
                onChange={(e) => handleGlobalExtraChange(e.target.value)}
                placeholder='{"user": "chatbeauty-study"}'
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-fg focus:outline-none focus:border-fg/40"
              />
            </div>
          </div>
        </Collapsible>
      </div>

      {/* Collapsible Live Model Reasoning Profile Rules */}
      <div className="rounded-2xl border border-borderc bg-surface/35 overflow-hidden">
        <button
          type="button"
          onClick={() => setRulesOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left font-semibold text-fg hover:bg-fg/[0.03] transition"
        >
          <span className="flex items-center gap-2">
            <span>已知模型思考强度规则库（可实时更新）</span>
            <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded-full bg-fg/10 text-muted">
              内置 {BUILTIN_MODEL_PROFILE_RULES.length} · 在线 {modelProfileSync.remoteRules.length} ·
              自定义 {modelProfileSync.customRules.length}
            </span>
          </span>
          <ChevronRight
            className={`w-4 h-4 text-muted transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              rulesOpen ? 'rotate-90 text-fg' : ''
            }`}
          />
        </button>
        <Collapsible open={rulesOpen}>
          <div className="px-4 pb-4 pt-3 border-t border-borderc space-y-3">
            <div className="text-muted leading-relaxed">
              切换模型时将按「模型专属指定 → 自定义规则 → 在线同步规则 → 内置规则」顺序实时分配该系列支持的思考强度档位（支持正则匹配与中转站前缀如{' '}
              <code>openai/gpt-5.2</code>）。
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-muted">
                <span>在线规则库 URL</span>
                {modelProfileSync.lastStatus && (
                  <span className="text-[11px] font-mono">{modelProfileSync.lastStatus}</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={remoteUrlInput}
                  onChange={(e) => setRemoteUrlInput(e.target.value)}
                  placeholder="https://raw.githubusercontent.com/.../model-profiles.json"
                  className="flex-1 px-3 py-1.5 rounded-xl bg-bg border border-borderc font-mono text-fg focus:outline-none focus:border-fg/40"
                />
                <button
                  type="button"
                  disabled={syncingRules}
                  onClick={() => void handleSyncRemoteRules()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-elevated border border-borderc hover:border-fg/35 text-fg shrink-0 active:scale-95 transition disabled:opacity-50"
                >
                  {syncingRules ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CloudDownload className="w-3.5 h-3.5" />
                  )}
                  <span>同步在线规则</span>
                </button>
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-borderc">
              <div className="flex items-center justify-between text-muted">
                <span>自定义匹配规则 (JSON 数组，优先于内置/在线规则生效)</span>
              </div>
              <textarea
                rows={4}
                value={customRulesText}
                onChange={(e) => setCustomRulesText(e.target.value)}
                placeholder='[{"pattern": "^my-relay-model", "profileId": "openai-gpt5-xhigh"}]'
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-[11px] text-fg focus:outline-none focus:border-fg/40"
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
                  className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-muted hover:text-fg transition"
                >
                  清空规则
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveCustomRules()}
                  className="px-3.5 py-1.5 rounded-xl bg-accent text-accentfg font-semibold active:scale-95 transition"
                >
                  应用自定义规则
                </button>
              </div>
            </div>

            {rulesFeedback && (
              <div
                className={`px-3 py-2 rounded-xl border ${
                  rulesFeedback.ok
                    ? 'border-borderc bg-surface text-fg'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
                }`}
              >
                {rulesFeedback.text}
              </div>
            )}
          </div>
        </Collapsible>
      </div>
    </div>
  );
};
