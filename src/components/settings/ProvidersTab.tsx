import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronRight,
  CloudDownload,
  Copy,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wifi,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import {
  buildPreviewHeadersJson,
  extractExtraHeadersFromPreviewJson,
  getModelDisplayName,
  hasCustomModelDisplayName,
  toModelDefinition,
  trimBaseUrl,
} from '@/services/llm/adapters/shared';
import {
  benchmarkProviderEndpoint,
  type EndpointBenchmarkResult,
} from '@/services/llm/endpointBenchmark';
import { triggerDownload } from '@/components/renderer/svgUtils';
import type {
  CustomModelParams,
  ModelDefinition,
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
import { ProtocolSelector } from './ProtocolSelector';
import {
  SettingsCollapsibleRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

interface ProvidersTabProps {
  section?: 'providers' | 'generation';
}

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

export const ProvidersTab: React.FC<ProvidersTabProps> = ({ section = 'providers' }) => {
  const {
    providers,
    activeProviderId,
    activeModelId,
    generation,
    contextSettings,
    modelProfileSync,
    saveProvider,
    deleteProvider,
    setActiveProviderModel,
    fetchProviderModels,
    testProviderConnection,
    updateGeneration,
    updateContextSettings,
    updateModelProfileSync,
    syncRemoteModelProfiles,
    saveCustomModelProfileRules,
  } = useAppStore();

  const [view, setView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [prevView, setPrevView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [viewAnim, setViewAnim] = useState<
    'cb-panel-enter' | 'cb-step-forward' | 'cb-step-backward'
  >('cb-panel-enter');
  if (view !== prevView) {
    setPrevView(view);
    setViewAnim(view === 'list' ? 'cb-step-backward' : 'cb-step-forward');
  }
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [customExtraHeaders, setCustomExtraHeaders] = useState<Record<string, string>>({});
  const [headersText, setHeadersText] = useState('{}');
  const [headersErr, setHeadersErr] = useState<string | null>(null);
  const [headersOpen, setHeadersOpen] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [modelSearch, setModelSearch] = useState('');
  const [newBackupUrl, setNewBackupUrl] = useState('');
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [modelExtraJson, setModelExtraJson] = useState<Record<string, string>>({});
  const [modelExtraErr, setModelExtraErr] = useState<Record<string, string | null>>({});
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [listNotice, setListNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [benchmarkByUrl, setBenchmarkByUrl] = useState<Record<string, EndpointBenchmarkResult>>({});
  const [benchmarkingUrls, setBenchmarkingUrls] = useState<Record<string, boolean>>({});
  const [benchmarkingAll, setBenchmarkingAll] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // Sub-accordions inside generation & rule sync view
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
  const customExtraHeadersRef = useRef(customExtraHeaders);
  customExtraHeadersRef.current = customExtraHeaders;
  const headersErrRef = useRef(headersErr);
  headersErrRef.current = headersErr;
  const activeEditDraftIdRef = useRef<string | null>(null);
  activeEditDraftIdRef.current = view === 'edit' && draft ? draft.id : null;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(() => {
    setRemoteUrlInput(modelProfileSync.remoteUrl);
  }, [modelProfileSync.remoteUrl]);

  useEffect(() => {
    if (view !== 'edit' || !draft || headersErrRef.current) return;
    setHeadersText(buildPreviewHeadersJson(draft, customExtraHeadersRef.current));
  }, [view, draft?.protocol, draft?.baseUrl, draft?.apiKey, draft?.presetId]);

  const handleHeadersJsonChange = (nextText: string) => {
    setHeadersText(nextText);
    if (!draft) return;
    try {
      const nextExtra = extractExtraHeadersFromPreviewJson(nextText, draft);
      customExtraHeadersRef.current = nextExtra;
      headersErrRef.current = null;
      setCustomExtraHeaders(nextExtra);
      setHeadersErr(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '自定义 Headers JSON 格式无效';
      headersErrRef.current = msg;
      setHeadersErr(msg);
    }
  };

  const resetAutoHeaders = () => {
    if (!draft) return;
    customExtraHeadersRef.current = {};
    headersErrRef.current = null;
    setCustomExtraHeaders({});
    setHeadersErr(null);
    setHeadersText(buildPreviewHeadersJson(draft, {}));
  };

  const openEditor = (p: ProviderConfig) => {
    const initialExtra = p.extraHeaders || {};
    setDraft(structuredClone(p));
    setCustomExtraHeaders(initialExtra);
    setHeadersErr(null);
    setHeadersOpen(false);
    setHeadersText(buildPreviewHeadersJson(p, initialExtra));
    setShowKey(false);
    setModelSearch('');
    setNewBackupUrl('');
    setExpandedModelId(null);
    setModelExtraJson({});
    setModelExtraErr({});
    setStatusMsg(null);
    setView('edit');
  };

  const getUrlKey = (p: ProviderConfig, urlOverride?: string) =>
    `${p.id}::${trimBaseUrl(urlOverride || p.baseUrl || PROTOCOL_TEMPLATES[p.protocol].defaultBaseUrl)}`;

  const getLiveBenchmarkCandidate = (d: ProviderConfig): ProviderConfig => {
    try {
      const parsed = extractExtraHeadersFromPreviewJson(headersText, d);
      return { ...d, extraHeaders: parsed };
    } catch {
      return { ...d, extraHeaders: customExtraHeadersRef.current };
    }
  };

  const handleBenchmarkEndpoint = async (p: ProviderConfig, urlOverride?: string) => {
    const key = getUrlKey(p, urlOverride);
    setBenchmarkingUrls((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await benchmarkProviderEndpoint(p, urlOverride);
      setBenchmarkByUrl((prev) => ({ ...prev, [key]: result }));
      return result;
    } finally {
      setBenchmarkingUrls((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleBenchmarkAll = async () => {
    if (providers.length === 0 || benchmarkingAll) return;
    setBenchmarkingAll(true);
    setListNotice(null);
    try {
      const results = await Promise.all(
        providers.map((p) => handleBenchmarkEndpoint(p))
      );
      const okCount = results.filter((r) => r.ok).length;
      setListNotice({
        ok: okCount > 0,
        text: `测速完成：${okCount} / ${results.length} 个主端点可连通`,
      });
    } finally {
      setBenchmarkingAll(false);
    }
  };

  const handleDuplicateProvider = async (p: ProviderConfig) => {
    const copy: ProviderConfig = {
      ...structuredClone(p),
      id: `prov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${p.name} (副本)`,
      createdAt: Date.now(),
    };
    await saveProvider(copy);
    setListNotice({ ok: true, text: `已复制配置「${copy.name}」` });
  };

  const handleExportProviders = () => {
    const json = JSON.stringify(providers, null, 2);
    triggerDownload(
      `chatbeauty-providers-${new Date().toISOString().slice(0, 10)}.json`,
      new Blob([json], { type: 'application/json' })
    );
    setListNotice({ ok: true, text: `已导出 ${providers.length} 个供应商配置` });
  };

  const handleImportProviders = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const existingIds = new Set(providers.map((p) => p.id));
      let imported = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Partial<ProviderConfig> | null;
        if (!item || typeof item !== 'object') continue;
        if (
          typeof item.name !== 'string' ||
          !item.name.trim() ||
          typeof item.baseUrl !== 'string' ||
          !item.baseUrl.trim() ||
          !(
            item.protocol === 'openai-chat' ||
            item.protocol === 'openai-responses' ||
            item.protocol === 'gemini' ||
            item.protocol === 'anthropic'
          )
        ) {
          continue;
        }
        const tpl = PROTOCOL_TEMPLATES[item.protocol];
        const nextId =
          typeof item.id === 'string' && item.id.trim() && !existingIds.has(item.id.trim())
            ? item.id.trim()
            : `prov_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
        existingIds.add(nextId);

        const seenModelIds = new Set<string>();
        const normalizedModels: ModelDefinition[] = [];
        if (Array.isArray(item.models)) {
          for (const rawM of item.models) {
            if (!rawM || typeof rawM !== 'object') continue;
            const rec = rawM as Partial<ModelDefinition>;
            const id = typeof rec.id === 'string' ? rec.id.trim() : '';
            if (!id || seenModelIds.has(id)) continue;
            seenModelIds.add(id);
            const fallback = toModelDefinition(id);
            normalizedModels.push({
              ...fallback,
              ...(typeof rec.name === 'string' && rec.name.trim()
                ? { name: rec.name.trim() }
                : {}),
              ...(typeof rec.contextLength === 'number' &&
              Number.isFinite(rec.contextLength) &&
              rec.contextLength > 0
                ? { contextLength: Math.round(rec.contextLength) }
                : {}),
              ...(rec.capabilities && typeof rec.capabilities === 'object'
                ? {
                    capabilities: {
                      ...fallback.capabilities,
                      ...(typeof rec.capabilities.vision === 'boolean'
                        ? { vision: rec.capabilities.vision }
                        : {}),
                      ...(typeof rec.capabilities.reasoning === 'boolean'
                        ? { reasoning: rec.capabilities.reasoning }
                        : {}),
                      ...(typeof rec.capabilities.imageGen === 'boolean'
                        ? { imageGen: rec.capabilities.imageGen }
                        : {}),
                      ...(typeof rec.capabilities.speechIn === 'boolean'
                        ? { speechIn: rec.capabilities.speechIn }
                        : {}),
                      ...(typeof rec.capabilities.speechOut === 'boolean'
                        ? { speechOut: rec.capabilities.speechOut }
                        : {}),
                    },
                  }
                : {}),
              ...(rec.params && typeof rec.params === 'object'
                ? { params: pruneParams(rec.params) }
                : {}),
            });
          }
        }
        const models = normalizedModels.length > 0 ? normalizedModels : [...tpl.suggestedModels];
        const primaryUrl = trimBaseUrl(item.baseUrl);
        if (!/^https?:\/\/\S+/i.test(primaryUrl)) {
          continue;
        }
        const backupBaseUrls = Array.isArray(item.backupBaseUrls)
          ? Array.from(
              new Set(
                item.backupBaseUrls
                  .filter((u): u is string => typeof u === 'string')
                  .map((u) => trimBaseUrl(u))
                  .filter((u) => Boolean(u) && /^https?:\/\/\S+/i.test(u) && u !== primaryUrl)
              )
            )
          : [];
        const rawHeaders =
          item.extraHeaders && typeof item.extraHeaders === 'object' && !Array.isArray(item.extraHeaders)
            ? Object.fromEntries(
                Object.entries(item.extraHeaders).filter(
                  ([k, v]) => k.trim().length > 0 && typeof v === 'string'
                )
              )
            : {};

        const candidateDefault =
          typeof item.defaultModel === 'string' && item.defaultModel.trim()
            ? item.defaultModel.trim()
            : '';
        const normalized: ProviderConfig = {
          id: nextId,
          name: item.name.trim(),
          protocol: item.protocol,
          baseUrl: primaryUrl,
          backupBaseUrls,
          apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
          defaultModel: candidateDefault || models[0]?.id || tpl.placeholderModel,
          models,
          extraHeaders: rawHeaders,
          presetId: typeof item.presetId === 'string' ? item.presetId : undefined,
          enabled: item.enabled !== false,
          createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        };
        await saveProvider(normalized);
        imported++;
      }

      if (imported === 0) {
        setListNotice({ ok: false, text: '未识别到有效的供应商配置条目' });
      } else {
        setListNotice({ ok: true, text: `已成功导入 ${imported} 个供应商配置` });
      }
    } catch (err) {
      setListNotice({
        ok: false,
        text: err instanceof Error ? `导入失败：${err.message}` : '导入 JSON 格式无效',
      });
    }
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
    if (headersErr) {
      setStatusMsg({ ok: false, text: headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = extractExtraHeadersFromPreviewJson(headersText, draft);
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
    setCustomExtraHeaders(parsedHeaders);
    setHeadersErr(null);
    setHeadersText(buildPreviewHeadersJson(updated, parsedHeaders));
    setStatusMsg({ ok: true, text: '接口与模型参数配置已保存' });
    setTimeout(() => setStatusMsg(null), 2200);
  };

  const handleFetchModels = async () => {
    if (!draft) return;
    if (headersErr) {
      setStatusMsg({ ok: false, text: headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = extractExtraHeadersFromPreviewJson(headersText, draft);
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
        const existingMap = new Map(latestDraft.models.map((m) => [m.id, m]));
        const merged = fetched.map((m) => {
          const prev = existingMap.get(m.id);
          const hasPrevAlias = Boolean(prev?.name?.trim() && prev.name.trim() !== prev.id);
          return {
            ...m,
            ...(hasPrevAlias ? { name: prev!.name.trim() } : {}),
            ...(prev?.params ? { params: prev.params } : {}),
          };
        });
        const nextDefault =
          latestDraft.defaultModel && merged.some((m) => m.id === latestDraft.defaultModel)
            ? latestDraft.defaultModel
            : merged[0].id;
        let latestHeaders = parsedHeaders;
        try {
          latestHeaders = extractExtraHeadersFromPreviewJson(headersText, latestDraft);
        } catch {
          // Keep headers captured before fetch
        }
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
      if (activeEditDraftIdRef.current === targetId || activeEditDraftIdRef.current === null) {
        setFetchingModels(false);
      }
    }
  };

  const handleTest = async () => {
    if (!draft) return;
    if (headersErr) {
      setStatusMsg({ ok: false, text: headersErr });
      return;
    }
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = extractExtraHeadersFromPreviewJson(headersText, draft);
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

  const patchModelName = (modelId: string, nextName: string) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        models: prev.models.map((m) => (m.id === modelId ? { ...m, name: nextName } : m)),
      };
    });
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

  if (section === 'generation') {
    const hasGlobalExtra = Boolean(globalExtraText.trim() && globalExtraText.trim() !== '{}');
    const thresholdPercent = Math.round(contextSettings.autoCompactThreshold * 100);
    const contextPresets: Array<{ label: string; value: number }> = [
      { label: '自动识别', value: 0 },
      { label: '200K', value: 200000 },
      { label: '500K', value: 500000 },
      { label: '1M', value: 1000000 },
    ];
    return (
      <div
        key="providers-generation"
        className="space-y-5 text-[13.5px] min-w-0 max-w-full"
      >
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
  }

  if (view === 'wizard') {
    return (
      <div key="providers-wizard" className={viewAnim}>
        <ProviderWizard
          onCancel={() => setView('list')}
          onComplete={handleWizardComplete}
        />
      </div>
    );
  }

  if (view === 'edit' && draft) {
    const allProfiles = listAllReasoningProfiles();
    const primaryUrlKey = getUrlKey(draft);
    const primaryBench = benchmarkByUrl[primaryUrlKey];
    const primaryBenching = Boolean(benchmarkingUrls[primaryUrlKey]);
    const filteredModels = modelSearch.trim()
      ? draft.models.filter((m) => {
          const q = modelSearch.trim().toLowerCase();
          return m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q);
        })
      : draft.models;

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

    return (
      <div key={`providers-edit-${draft.id}`} className={`${viewAnim} space-y-4 text-[13.5px] min-w-0 max-w-full`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                      primaryBench.ok
                        ? primaryBench.latencyMs < 800
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    }`}
                  >
                    {primaryBench.ok
                      ? `${primaryBench.latencyMs} ms`
                      : primaryBench.error || `${primaryBench.latencyMs} ms 异常`}
                  </span>
                )}
                <button
                  type="button"
                  disabled={primaryBenching}
                  onClick={() => void handleBenchmarkEndpoint(getLiveBenchmarkCandidate(draft))}
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
              <span className="text-muted text-xs font-medium">备用端点（中转站多线路测速与一键切换）</span>
              <span className="text-[11px] text-muted">{(draft.backupBaseUrls || []).length} 个备用</span>
            </div>

            {(draft.backupBaseUrls || []).length > 0 && (
              <div className="space-y-1.5 min-w-0">
                {(draft.backupBaseUrls || []).map((url) => {
                  const key = getUrlKey(draft, url);
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
                          <span
                            className={`text-[11px] font-mono px-1.5 py-0.5 rounded border ${
                              bench.ok
                                ? bench.latencyMs < 800
                                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                                  : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                            }`}
                          >
                            {bench.ok ? `${bench.latencyMs} ms` : bench.error || '不可用'}
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            void handleBenchmarkEndpoint(getLiveBenchmarkCandidate(draft), url)
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
                const { profile: autoProf } = resolveModelReasoningProfile({
                  modelId: m.id,
                  protocol: draft.protocol,
                  customRules: modelProfileSync.customRules,
                  remoteRules: modelProfileSync.remoteRules,
                });
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
              }))}
            </div>
          </div>

          <div className="rounded-xl border border-borderc bg-bg/50 overflow-hidden min-w-0">
            <button
              type="button"
              onClick={() => setHeadersOpen((v) => !v)}
              aria-expanded={headersOpen}
              className="w-full min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 text-left text-muted hover:text-fg hover:bg-fg/[0.03] transition"
            >
              <span className="truncate">高级：自定义请求头 (JSON，随协议 / URL / API Key 实时更新)</span>
              <ChevronRight
                className={`w-4 h-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  headersOpen ? 'rotate-90 text-fg' : ''
                }`}
              />
            </button>
            <Collapsible open={headersOpen}>
              <div className="px-3 pb-3 pt-2 border-t border-borderc space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                  <span>自动生成协议默认头；修改或新增键值对将在保存时一并生效。</span>
                  <button
                    type="button"
                    onClick={resetAutoHeaders}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-borderc bg-bg hover:bg-elevated text-fg transition shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>恢复自动头</span>
                  </button>
                </div>
                <textarea
                  rows={5}
                  value={headersText}
                  onChange={(e) => handleHeadersJsonChange(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
                />
                {headersErr && (
                  <div className="text-[11px] text-rose-600 dark:text-rose-400 break-words">
                    {headersErr}
                  </div>
                )}
              </div>
            </Collapsible>
          </div>

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
  }

  return (
    <div key="providers-list" className={`${viewAnim} space-y-5 text-[13.5px] min-w-0 max-w-full`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5 min-w-0">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">模型供应商与线路</div>
          <div className="text-muted text-xs mt-0.5">
            支持品牌预设、备用 URL 测速切换与 JSON 批量导入导出。
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
          {providers.length > 0 && (
            <button
              type="button"
              disabled={benchmarkingAll}
              onClick={() => void handleBenchmarkAll()}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-borderc bg-surface hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
            >
              {benchmarkingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Gauge className="w-3.5 h-3.5" />
              )}
              <span>全部测速</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-borderc bg-surface hover:bg-elevated text-xs text-fg transition"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>导入 JSON</span>
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => void handleImportProviders(e)}
          />
          {providers.length > 0 && (
            <button
              type="button"
              onClick={handleExportProviders}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-borderc bg-surface hover:bg-elevated text-xs text-fg transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 JSON</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('wizard')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold shrink-0 hover:opacity-90 active:scale-95 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>添加供应商</span>
          </button>
        </div>
      </div>

      {listNotice && (
        <div
          className={`cb-panel-enter px-3 py-2 rounded-xl border text-xs break-words ${
            listNotice.ok
              ? 'border-borderc bg-surface text-fg'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {listNotice.text}
        </div>
      )}

      <SettingsSection
        title={providers.length > 0 ? `已配置供应商 (${providers.length})` : '已配置供应商'}
      >
        {providers.length === 0 ? (
          <div className="p-6 sm:p-8 text-center space-y-3">
            <div className="text-muted text-xs">尚未添加任何大模型接口</div>
            <button
              type="button"
              onClick={() => setView('wizard')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg text-xs font-semibold active:scale-95 transition"
            >
              <Plus className="w-4 h-4" />
              <span>立即配置</span>
            </button>
          </div>
        ) : (
          providers.map((p) => {
            const isActive = p.id === activeProviderId;
            const benchKey = getUrlKey(p);
            const bench = benchmarkByUrl[benchKey];
            const isBenching = Boolean(benchmarkingUrls[benchKey]);
            let hostLabel = p.baseUrl;
            try {
              hostLabel = new URL(p.baseUrl).host;
            } catch {
              // Keep raw string when URL is partial
            }
            const backupCount = p.backupBaseUrls?.length ?? 0;
            const defaultModelDef = p.models.find((m) => m.id === p.defaultModel);
            const defaultModelLabel = p.defaultModel
              ? getModelDisplayName(defaultModelDef, p.defaultModel)
              : '未指定';
            return (
              <div
                key={p.id}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:px-4 min-w-0 transition ${
                  isActive ? 'bg-elevated/65' : 'hover:bg-fg/[0.02]'
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-semibold text-[14px] text-fg truncate max-w-full">
                      {p.name}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        当前启用
                      </span>
                    )}
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-fg/10 text-muted shrink-0">
                      {PROTOCOL_TEMPLATES[p.protocol].shortLabel}
                    </span>
                    {bench && (
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded-full border shrink-0 ${
                          bench.ok
                            ? bench.latencyMs < 800
                              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {bench.ok ? `${bench.latencyMs} ms` : bench.error || '连接异常'}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate font-mono">
                    {hostLabel} · {p.models.length} 个模型
                    {backupCount > 0 ? ` · ${backupCount} 个备用端点` : ''} · 默认{' '}
                    {defaultModelLabel}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() =>
                        void setActiveProviderModel(p.id, p.defaultModel || p.models[0]?.id || '')
                      }
                      className="px-2.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBenching}
                    onClick={() => void handleBenchmarkEndpoint(p)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
                    title="测速主端点"
                  >
                    {isBenching ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Gauge className="w-3.5 h-3.5" />
                    )}
                    <span>测速</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDuplicateProvider(p)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition"
                    title="复制配置"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>复制</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(p)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
                  >
                    <span>编辑</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>
    </div>
  );
};
