import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { toModelDefinition } from '@/services/llm/adapters/shared';
import type { ProtocolType, ProviderConfig } from '@/types/chat';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import { Collapsible } from '@/components/ui/MotionPrimitives';
import { ProviderWizard } from './ProviderWizard';

export const ProvidersTab: React.FC = () => {
  const {
    providers,
    activeProviderId,
    activeModelId,
    generation,
    saveProvider,
    deleteProvider,
    setActiveProviderModel,
    fetchProviderModels,
    testProviderConnection,
    updateGeneration,
  } = useAppStore();

  const [view, setView] = useState<'list' | 'wizard' | 'edit'>('list');
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [headersText, setHeadersText] = useState('{}');
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const openEditor = (p: ProviderConfig) => {
    setDraft(structuredClone(p));
    setHeadersText(JSON.stringify(p.extraHeaders || {}, null, 2));
    setShowKey(false);
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
    let parsedHeaders: Record<string, string> = {};
    if (headersText.trim()) {
      try {
        parsedHeaders = JSON.parse(headersText) as Record<string, string>;
      } catch {
        setStatusMsg({ ok: false, text: '自定义 Headers JSON 格式无效' });
        return;
      }
    }
    const cleanDefault = draft.defaultModel.trim() || draft.models[0]?.id || '';
    const updated: ProviderConfig = {
      ...draft,
      name: draft.name.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultName,
      baseUrl: draft.baseUrl.trim() || PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl,
      defaultModel: cleanDefault,
      extraHeaders: parsedHeaders,
    };
    await saveProvider(updated);
    setStatusMsg({ ok: true, text: '接口配置已保存' });
    setTimeout(() => setStatusMsg(null), 2000);
  };

  const handleFetchModels = async () => {
    if (!draft) return;
    setFetchingModels(true);
    setStatusMsg(null);
    try {
      const models = await fetchProviderModels(draft);
      if (models.length === 0) {
        setStatusMsg({ ok: false, text: '接口未返回模型列表，可手动添加模型 ID' });
      } else {
        const nextDefault = draft.defaultModel || models[0].id;
        const nextDraft = { ...draft, models, defaultModel: nextDefault };
        setDraft(nextDraft);
        await saveProvider(nextDraft);
        setStatusMsg({ ok: true, text: `已拉取并保存 ${models.length} 个可用模型` });
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
    setTesting(true);
    setStatusMsg(null);
    try {
      const modelToUse =
        draft.defaultModel ||
        draft.models[0]?.id ||
        PROTOCOL_TEMPLATES[draft.protocol].placeholderModel;
      const reply = await testProviderConnection(draft, modelToUse);
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
              <span className="text-muted">模型列表（可点选作为当前激活模型）</span>
              <button
                type="button"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated border border-borderc text-fg hover:border-fg/35 transition disabled:opacity-50"
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

            <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
              {draft.models.map((m) => {
                const isDefault = draft.defaultModel === m.id;
                const isActive = activeProviderId === draft.id && activeModelId === m.id;
                return (
                  <div
                    key={m.id}
                    className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border ${
                      isActive || isDefault
                        ? 'bg-elevated border-fg/25 text-fg'
                        : 'bg-bg/60 border-borderc text-muted'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, defaultModel: m.id });
                        void setActiveProviderModel(draft.id, m.id);
                      }}
                      className="flex-1 text-left flex items-center justify-between min-w-0"
                    >
                      <span className="truncate font-mono text-fg">{m.id}</span>
                      {(isActive || isDefault) && (
                        <span className="text-[10px] text-muted ml-2 shrink-0">默认</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          models: draft.models.filter((x) => x.id !== m.id),
                        })
                      }
                      className="p-1 text-muted hover:text-rose-400 shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
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
    <div className="cb-panel-enter space-y-6 text-xs">
      {/* Header + Single Add Provider CTA */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-fg">模型供应商</div>
          <div className="text-muted mt-0.5">
            管理 OpenAI Chat / Responses、Gemini 与 Anthropic 接口；模型与推理强度可在对话输入框直接切换。
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

      {/* Smooth Collapsible Sampling Parameters (Continuous SmoothSliders) */}
      <div className="rounded-2xl border border-borderc bg-surface/35 overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left font-semibold text-fg hover:bg-fg/[0.03] transition"
        >
          <span>高级采样参数（可选调节）</span>
          <ChevronRight
            className={`w-4 h-4 text-muted transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              advancedOpen ? 'rotate-90 text-fg' : ''
            }`}
          />
        </button>
        <Collapsible open={advancedOpen}>
          <div className="px-4 pb-4 pt-3 border-t border-borderc grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="space-y-1">
              <div className="flex justify-between text-muted">
                <span>Temperature</span>
                <span className="tabular-nums text-fg">{generation.temperature.toFixed(2)}</span>
              </div>
              <SmoothSlider
                min={0}
                max={2}
                decimals={2}
                value={generation.temperature}
                onChange={(val) => void updateGeneration({ temperature: val })}
                ariaLabel="Temperature"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-muted">
                <span>Top-P</span>
                <span className="tabular-nums text-fg">{generation.topP.toFixed(2)}</span>
              </div>
              <SmoothSlider
                min={0.1}
                max={1}
                decimals={2}
                value={generation.topP}
                onChange={(val) => void updateGeneration({ topP: val })}
                ariaLabel="Top-P"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-muted">
                <span>Max Output Tokens</span>
                <span className="tabular-nums text-fg">{generation.maxTokens}</span>
              </div>
              <SmoothSlider
                min={512}
                max={32768}
                decimals={0}
                value={generation.maxTokens}
                onChange={(val) => void updateGeneration({ maxTokens: val })}
                ariaLabel="Max Output Tokens"
              />
            </label>

            <label className="space-y-1">
              <div className="flex justify-between text-muted">
                <span>上下文携带消息数</span>
                <span className="tabular-nums text-fg">{generation.maxContextMessages} 条</span>
              </div>
              <SmoothSlider
                min={4}
                max={64}
                decimals={0}
                value={generation.maxContextMessages}
                onChange={(val) => void updateGeneration({ maxContextMessages: val })}
                ariaLabel="上下文携带消息数"
              />
            </label>
          </div>
        </Collapsible>
      </div>
    </div>
  );
};
