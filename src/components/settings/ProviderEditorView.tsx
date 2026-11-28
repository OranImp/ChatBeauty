import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Wifi,
} from 'lucide-react';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import {
  getModelDisplayName,
  hasCustomModelDisplayName,
  toModelDefinition,
  trimBaseUrl,
} from '@/services/llm/adapters/shared';
import type { EndpointBenchmarkResult } from '@/services/llm/endpointBenchmark';
import {
  listAllReasoningProfiles,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import { useFlashNotice } from '@/hooks/useFlashNotice';
import { Collapsible } from '@/components/ui/MotionPrimitives';
import type { CustomModelParams, ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ModelProfileSyncSettings } from '@/types/settings';
import { ProtocolSelector } from './ProtocolSelector';
import {
  LatencyBadge,
  ProviderHeadersAccordion,
  getProviderUrlKey,
  mergeFetchedModelsPreservingAliases,
  parseOptionalNumber,
  pruneParams,
  useProviderHeadersEditor,
} from './providerShared';

interface ProviderEditorViewProps {
  initialProvider: ProviderConfig;
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModelId: string | null;
  modelProfileSync: ModelProfileSyncSettings;
  benchmarkByUrl: Record<string, EndpointBenchmarkResult>;
  benchmarkingUrls: Record<string, boolean>;
  viewAnim: string;
  onBack: () => void;
  onDeleteProvider: (id: string) => Promise<void>;
  onBenchmarkEndpoint: (p: ProviderConfig, urlOverride?: string) => Promise<EndpointBenchmarkResult>;
  saveProvider: (p: ProviderConfig) => Promise<void>;
  setActiveProviderModel: (providerId: string, modelId: string) => Promise<void>;
  fetchProviderModels: (p: ProviderConfig) => Promise<ModelDefinition[]>;
  testProviderConnection: (p: ProviderConfig, modelId: string) => Promise<string>;
}

export const ProviderEditorView: React.FC<ProviderEditorViewProps> = ({
  initialProvider,
  providers,
  activeProviderId,
  activeModelId,
  modelProfileSync,
  benchmarkByUrl,
  benchmarkingUrls,
  viewAnim,
  onBack,
  onDeleteProvider,
  onBenchmarkEndpoint,
  saveProvider,
  setActiveProviderModel,
  fetchProviderModels,
  testProviderConnection,
}) => {
  const [draft, setDraft] = useState<ProviderConfig>(() => structuredClone(initialProvider));
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [newBackupUrl, setNewBackupUrl] = useState('');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelExtraJson, setModelExtraJson] = useState<Record<string, string>>({});
  const [modelExtraErr, setModelExtraErr] = useState<Record<string, string | null>>({});
  const {
    notice: statusMsg,
    setNotice: setStatusMsg,
    showNotice: showStatusMsg,
  } = useFlashNotice<{ ok: boolean; text: string }>(2200);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);

  const headersEditor = useProviderHeadersEditor(
    draft,
    false,
    initialProvider.extraHeaders || {}
  );

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const activeEditDraftIdRef = useRef(draft.id);
  activeEditDraftIdRef.current = draft.id;

  const allProfiles = useMemo(() => listAllReasoningProfiles(), []);

  const getLiveBenchmarkCandidate = (d: ProviderConfig): ProviderConfig => ({
    ...d,
    extraHeaders: headersEditor.getLiveExtraHeadersOrFallback(d),
  });

  const handleSave = async () => {
    if (headersEditor.headersErr) {
      setStatusMsg({ ok: false, text: headersEditor.headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = headersEditor.resolveLiveExtraHeaders(draft);
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
      name: m.name.trim() || m.id,
      params: pruneParams(m.params),
    }));
    const cleanDefault = draft.defaultModel.trim() || cleanModels[0]?.id || '';
    const primaryBaseUrl = draft.baseUrl.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl;
    const backupList = Array.from(
      new Set(
        (draft.backupBaseUrls || [])
          .map((u) => trimBaseUrl(u))
          .filter((u) => Boolean(u) && u !== trimBaseUrl(primaryBaseUrl))
      )
    );
    const updated: ProviderConfig = {
      ...draft,
      name: draft.name.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultName,
      baseUrl: primaryBaseUrl,
      backupBaseUrls: backupList,
      defaultModel: cleanDefault,
      models: cleanModels,
      extraHeaders: parsedHeaders,
    };
    await saveProvider(updated);
    setDraft(structuredClone(updated));
    headersEditor.syncHeadersForDraft(updated, parsedHeaders);
    showStatusMsg({ ok: true, text: '接口与模型参数配置已保存' }, 2200);
  };

  const handleFetchModels = async () => {
    if (headersEditor.headersErr) {
      setStatusMsg({ ok: false, text: headersEditor.headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = headersEditor.resolveLiveExtraHeaders(draft);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '自定义 Headers JSON 格式无效',
      });
      return;
    }
    const targetId = draft.id;
    const candidate: ProviderConfig = { ...draft, extraHeaders: parsedHeaders };
    setFetchingModels(true);
    setStatusMsg(null);
    try {
      const fetched = await fetchProviderModels(candidate);
      if (activeEditDraftIdRef.current !== targetId) return;
      if (fetched.length === 0) {
        setStatusMsg({ ok: false, text: '接口未返回模型列表，可手动添加模型 ID' });
      } else {
        const latestDraft = draftRef.current;
        if (!latestDraft || latestDraft.id !== targetId) return;
        const merged = mergeFetchedModelsPreservingAliases(fetched, latestDraft.models);
        const nextDefault =
          latestDraft.defaultModel && merged.some((m) => m.id === latestDraft.defaultModel)
            ? latestDraft.defaultModel
            : merged[0].id;
        const latestHeaders = headersEditor.getLiveExtraHeadersOrFallback(latestDraft);
        const nextDraft: ProviderConfig = {
          ...latestDraft,
          extraHeaders: latestHeaders,
          models: merged,
          defaultModel: nextDefault,
        };
        setDraft(nextDraft);
        await saveProvider(nextDraft);
        if (activeEditDraftIdRef.current !== targetId) return;
        setStatusMsg({ ok: true, text: `已拉取并保存 ${merged.length} 个可用模型` });
      }
    } catch (err) {
      if (activeEditDraftIdRef.current !== targetId) return;
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '拉取模型列表失败',
      });
    } finally {
      if (activeEditDraftIdRef.current === targetId) {
        setFetchingModels(false);
      }
    }
  };

  const handleTest = async () => {
    if (headersEditor.headersErr) {
      setStatusMsg({ ok: false, text: headersEditor.headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = headersEditor.resolveLiveExtraHeaders(draft);
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

  const patchModelName = (modelId: string, nextName: string) => {
    setDraft((prev) => ({
      ...prev,
      models: prev.models.map((m) => (m.id === modelId ? { ...m, name: nextName } : m)),
    }));
  };

  const patchModelParams = (modelId: string, patch: Partial<CustomModelParams>) => {
    setDraft((prev) => ({
      ...prev,
      models: prev.models.map((m) => {
        if (m.id !== modelId) return m;
        const nextParams = pruneParams({ ...(m.params || {}), ...patch });
        return { ...m, params: nextParams };
      }),
    }));
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

  const addBackupEndpoint = () => {
    const cleaned = trimBaseUrl(newBackupUrl);
    if (!cleaned) return;
    if (cleaned === trimBaseUrl(draft.baseUrl)) {
      setStatusMsg({ ok: false, text: '该地址已作为主 Base URL 使用' });
      return;
    }
    const existing = draft.backupBaseUrls || [];
    if (!existing.some((u) => trimBaseUrl(u) === cleaned)) {
      setDraft({ ...draft, backupBaseUrls: [...existing, cleaned] });
    }
    setNewBackupUrl('');
  };

  const promoteBackupUrl = (targetUrl: string) => {
    const currentPrimary = trimBaseUrl(draft.baseUrl);
    const nextBackups = Array.from(
      new Set([
        ...(currentPrimary && currentPrimary !== targetUrl ? [currentPrimary] : []),
        ...(draft.backupBaseUrls || []).filter((u) => trimBaseUrl(u) !== targetUrl),
      ])
    );
    setDraft({
      ...draft,
      baseUrl: targetUrl,
      backupBaseUrls: nextBackups,
    });
    setStatusMsg({ ok: true, text: `已将 ${targetUrl} 设为主端点（保存后生效）` });
  };

  const primaryUrlKey = getProviderUrlKey(draft);
  const primaryBench = benchmarkByUrl[primaryUrlKey];
  const primaryBenching = Boolean(benchmarkingUrls[primaryUrlKey]);
  const filteredModels = modelSearch.trim()
    ? draft.models.filter((m) => {
        const q = modelSearch.trim().toLowerCase();
        return m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
      })
    : draft.models;

  return (
    <div
      key={`providers-edit-${draft.id}`}
      className={`${viewAnim} space-y-4 text-[13.5px] min-w-0 max-w-full`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-muted hover:text-fg transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回供应商列表</span>
        </button>

        <button
          type="button"
          onClick={() => {
            void onDeleteProvider(draft.id);
            onBack();
          }}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-muted hover:text-rose-400 hover:bg-white/5 transition"
        >
          <Trash2 className="w-4 h-4" />
          <span>删除接口</span>
        </button>
      </div>

      <div className="rounded-2xl border border-borderc bg-surface/45 p-3 sm:p-4 space-y-4 min-w-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
          <label className="space-y-1 min-w-0">
            <span className="text-muted text-xs">配置名称</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
            />
          </label>

          <ProtocolSelector
            label="调用协议"
            value={draft.protocol}
            onChange={(proto) => {
              const prevDefault = PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl;
              const shouldSwapBase =
                !draft.baseUrl.trim() || trimBaseUrl(draft.baseUrl) === trimBaseUrl(prevDefault);
              setDraft({
                ...draft,
                protocol: proto,
                baseUrl: shouldSwapBase ? PROTOCOL_TEMPLATES[proto].defaultBaseUrl : draft.baseUrl,
              });
            }}
          />
        </div>

        <div className="space-y-1.5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted">Base URL（支持任意兼容中转站地址）</span>
            <div className="flex items-center gap-2">
              {primaryBench && (
                <LatencyBadge
                  result={primaryBench}
                  fallbackErrorText={`${primaryBench.latencyMs} ms 异常`}
                  pill
                />
              )}
              <button
                type="button"
                disabled={primaryBenching}
                onClick={() => void onBenchmarkEndpoint(getLiveBenchmarkCandidate(draft))}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
              >
                {primaryBenching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Gauge className="w-3.5 h-3.5" />
                )}
                <span>测速</span>
              </button>
            </div>
          </div>
          <input
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
            placeholder={PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl}
            className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
          />
        </div>

        {/* Backup Endpoints */}
        <div className="rounded-xl border border-borderc bg-bg/50 p-3 space-y-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted text-xs font-medium">
              备用端点（中转站多线路测速与一键切换）
            </span>
            <span className="text-[11px] text-muted">{(draft.backupBaseUrls || []).length} 个备用</span>
          </div>

          {(draft.backupBaseUrls || []).length > 0 && (
            <div className="space-y-1.5 min-w-0">
              {(draft.backupBaseUrls || []).map((url) => {
                const key = getProviderUrlKey(draft, url);
                const bench = benchmarkByUrl[key];
                const isBusy = Boolean(benchmarkingUrls[key]);
                return (
                  <div
                    key={url}
                    className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border border-borderc bg-surface/50 min-w-0"
                  >
                    <span className="font-mono text-xs text-fg break-all sm:truncate flex-1 min-w-0">
                      {url}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      {bench && (
                        <LatencyBadge
                          result={bench}
                          fallbackErrorText="不可用"
                          compact
                          pill={false}
                        />
                      )}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void onBenchmarkEndpoint(getLiveBenchmarkCandidate(draft), url)
                        }
                        className="px-2 py-1 rounded-lg border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition disabled:opacity-50"
                      >
                        {isBusy ? '测速中' : '测速'}
                      </button>
                      <button
                        type="button"
                        onClick={() => promoteBackupUrl(url)}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
                        title="与当前主 Base URL 互换"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>设为主端点</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            backupBaseUrls: (draft.backupBaseUrls || []).filter((x) => x !== url),
                          })
                        }
                        className="p-1 text-muted hover:text-rose-400"
                        title="删除备用端点"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <input
              value={newBackupUrl}
              onChange={(e) => setNewBackupUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addBackupEndpoint();
                }
              }}
              placeholder="添加备用 Base URL，例如 https://backup.example.com/v1"
              className="w-full sm:flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-fg font-mono text-xs focus:outline-none focus:border-fg/40"
            />
            <button
              type="button"
              onClick={addBackupEndpoint}
              className="px-3 py-1.5 rounded-xl bg-elevated border border-borderc text-fg text-xs hover:border-fg/35 shrink-0 self-start sm:self-auto"
            >
              添加备用
            </button>
          </div>
        </div>

        <label className="block space-y-1 min-w-0">
          <span className="text-muted">API Key</span>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-... / AIza... / sk-ant-..."
              className="w-full min-w-0 pl-3 pr-10 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
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

        <div className="space-y-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
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
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span>在线拉取模型</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
            <div className="flex gap-2 min-w-0">
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
                className="flex-1 min-w-0 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
              />
              <button
                type="button"
                onClick={addManualModel}
                className="px-3 py-1.5 rounded-xl bg-elevated border border-borderc text-fg hover:border-fg/35 shrink-0"
              >
                添加
              </button>
            </div>

            <div className="relative flex items-center min-w-0">
              <Search className="w-4 h-4 text-muted absolute left-3 pointer-events-none" />
              <input
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
                placeholder="搜索模型 ID 或名称..."
                className="w-full min-w-0 pl-9 pr-14 py-1.5 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
              />
              {modelSearch.trim() && (
                <span className="absolute right-2.5 text-[11px] text-muted tabular-nums">
                  {filteredModels.length}/{draft.models.length}
                </span>
              )}
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
            {filteredModels.length === 0 ? (
              <div className="px-3 py-4 text-center text-muted text-xs border border-dashed border-borderc rounded-xl">
                未找到匹配「{modelSearch}」的模型
              </div>
            ) : (
              filteredModels.map((m) => {
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
                const autoProf = isExpanded
                  ? resolveModelReasoningProfile({
                      modelId: m.id,
                      protocol: draft.protocol,
                      customRules: modelProfileSync.customRules,
                      remoteRules: modelProfileSync.remoteRules,
                    }).profile
                  : null;
                const hasAlias = hasCustomModelDisplayName(m);
                const hasCustomParams = Boolean(m.params && Object.keys(m.params).length > 0);
                const hasCustom = hasCustomParams || hasAlias;
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
                          if (activeProviderId === draft.id) {
                            const savedProv = providers.find((p) => p.id === draft.id);
                            if (savedProv?.models.some((x) => x.id === m.id)) {
                              void setActiveProviderModel(draft.id, m.id);
                            }
                          }
                        }}
                        className="flex-1 text-left flex items-center justify-between min-w-0 gap-2"
                      >
                        <div className="min-w-0">
                          <div
                            className={`truncate text-fg ${
                              hasAlias ? 'font-sans font-medium' : 'font-mono'
                            }`}
                          >
                            {getModelDisplayName(m, m.id)}
                          </div>
                          {hasAlias && (
                            <div className="truncate font-mono text-[10px] text-muted/85">
                              ID: {m.id}
                            </div>
                          )}
                        </div>
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/5 text-muted truncate max-w-[130px]">
                            {resolvedProf.familyName.split('（')[0]}
                          </span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                              当前
                            </span>
                          )}
                          {isDefault && <span className="text-[10px] text-accent">默认</span>}
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
                          setModelExtraJson((prev) => {
                            if (!(m.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[m.id];
                            return next;
                          });
                          setModelExtraErr((prev) => {
                            if (!(m.id in prev)) return prev;
                            const next = { ...prev };
                            delete next[m.id];
                            return next;
                          });
                          if (expandedModelId === m.id) {
                            setExpandedModelId(null);
                          }
                        }}
                        className="p-1 text-muted hover:text-rose-400 shrink-0"
                        title="删除模型"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    <Collapsible open={isExpanded}>
                      <div className="px-3 pb-3 pt-2.5 border-t border-borderc bg-bg/50 space-y-3 text-[11px]">
                        <div className="rounded-lg border border-borderc/70 bg-surface/60 px-2.5 py-2 space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-muted">模型 ID（API 请求用）</span>
                            <span className="font-mono text-fg select-all break-all">{m.id}</span>
                          </div>
                          <label className="block space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-muted">自定义显示名称</span>
                              {m.name.trim() !== m.id && (
                                <button
                                  type="button"
                                  onClick={() => patchModelName(m.id, m.id)}
                                  className="text-muted hover:text-fg transition"
                                >
                                  恢复为 ID
                                </button>
                              )}
                            </div>
                            <input
                              type="text"
                              value={m.name}
                              onChange={(e) => patchModelName(m.id, e.target.value)}
                              placeholder={m.id}
                              aria-label={`自定义显示名称 ${m.id}`}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-surface border border-borderc text-fg focus:outline-none focus:border-fg/40"
                            />
                          </label>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-fg">模型专属参数（留空则沿用全局）</span>
                          {hasCustomParams && (
                            <button
                              type="button"
                              onClick={() => {
                                setModelExtraJson((prev) => ({ ...prev, [m.id]: '{}' }));
                                setModelExtraErr((prev) => ({ ...prev, [m.id]: null }));
                                setDraft((prev) => ({
                                  ...prev,
                                  models: prev.models.map((item) =>
                                    item.id === m.id ? { ...item, params: undefined } : item
                                  ),
                                }));
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
                            <option value="">
                              自动识别（{(autoProf || resolvedProf).familyName}）
                            </option>
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
                              <span className="text-rose-600 dark:text-rose-400">
                                {modelExtraErr[m.id]}
                              </span>
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
              })
            )}
          </div>
        </div>

        <ProviderHeadersAccordion
          title="高级：自定义请求头 (JSON，随协议 / URL / API Key 实时更新)"
          subtitle="自动生成协议默认头；修改或新增键值对将在保存时一并生效。"
          open={headersEditor.headersOpen}
          onToggle={() => headersEditor.setHeadersOpen((v) => !v)}
          headersText={headersEditor.headersText}
          headersErr={headersEditor.headersErr}
          onChange={headersEditor.handleHeadersJsonChange}
          onReset={headersEditor.resetAutoHeaders}
          variant="edit"
        />

        {statusMsg && (
          <div
            className={`px-3 py-2 rounded-xl border break-words ${
              statusMsg.ok
                ? 'border-borderc bg-surface text-fg'
                : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
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
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Wifi className="w-4 h-4" />
            )}
            <span>测试连接</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg font-semibold hover:opacity-90 transition"
          >
            <Check className="w-4 h-4" />
            <span>保存配置</span>
          </button>
        </div>
      </div>
    </div>
  );
};
