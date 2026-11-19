import React, { useEffect, useState } from 'react';
import {
  Check,
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

  const [selectedId, setSelectedId] = useState<string | null>(
    activeProviderId || providers[0]?.id || null
  );
  const [draft, setDraft] = useState<ProviderConfig | null>(null);
  const [headersText, setHeadersText] = useState('{}');
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const target = providers.find((p) => p.id === selectedId) || providers[0] || null;
    if (target) {
      setSelectedId(target.id);
      setDraft(structuredClone(target));
      setHeadersText(JSON.stringify(target.extraHeaders || {}, null, 2));
    } else {
      setDraft(null);
    }
  }, [selectedId, providers]);

  const createNewProvider = async (protocol: ProtocolType) => {
    const tpl = PROTOCOL_TEMPLATES[protocol];
    const created: ProviderConfig = {
      id: `prov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: tpl.defaultName,
      protocol,
      baseUrl: tpl.defaultBaseUrl,
      apiKey: '',
      defaultModel: tpl.placeholderModel,
      models: tpl.suggestedModels,
      extraHeaders: {},
      enabled: true,
      createdAt: Date.now(),
    };
    await saveProvider(created);
    setSelectedId(created.id);
    setStatusMsg({ ok: true, text: `已创建 ${tpl.shortLabel} 接口模板，请填写 API Key 后保存` });
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
    setTimeout(() => setStatusMsg(null), 2200);
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
        const merged = [...models];
        const nextDefault = draft.defaultModel || merged[0].id;
        const nextDraft = { ...draft, models: merged, defaultModel: nextDefault };
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
    setTesting(true);
    setStatusMsg(null);
    try {
      const modelToUse =
        draft.defaultModel || draft.models[0]?.id || PROTOCOL_TEMPLATES[draft.protocol].placeholderModel;
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
    if (draft.models.some((m) => m.id === id)) {
      setNewModelId('');
      return;
    }
    const added = toModelDefinition(id);
    setDraft({
      ...draft,
      defaultModel: draft.defaultModel || id,
      models: [...draft.models, added],
    });
    setNewModelId('');
  };

  return (
    <div className="space-y-6">
      {/* Quick Add Protocol Bar */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-muted">添加大模型供应商 / 协议接口</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(Object.keys(PROTOCOL_TEMPLATES) as ProtocolType[]).map((proto) => {
            const tpl = PROTOCOL_TEMPLATES[proto];
            return (
              <button
                key={proto}
                type="button"
                onClick={() => void createNewProvider(proto)}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-borderc bg-surface hover:bg-elevated hover:border-accent/50 text-xs font-medium text-fg transition"
              >
                <Plus className="w-3.5 h-3.5 text-accent" />
                <span>{tpl.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Configured Providers Selector */}
      {providers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {providers.map((p) => {
            const active = p.id === draft?.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs border transition flex items-center gap-1.5 ${
                  active
                    ? 'border-accent bg-accent/15 text-accent font-medium'
                    : 'border-borderc bg-surface text-muted hover:text-fg'
                }`}
              >
                <span>{p.name}</span>
                <span className="text-[10px] opacity-70">
                  {PROTOCOL_TEMPLATES[p.protocol].shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected Provider Editor */}
      {draft ? (
        <div className="rounded-2xl border border-borderc bg-surface/50 p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted">
              {PROTOCOL_TEMPLATES[draft.protocol].description}
            </div>
            <button
              type="button"
              onClick={() => void deleteProvider(draft.id)}
              className="p-1.5 rounded-lg text-muted hover:text-rose-400 hover:bg-white/5 shrink-0"
              title="删除此接口"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted">配置名称</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-accent"
              />
            </label>

            <label className="space-y-1 text-xs">
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
                className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-accent"
              >
                {(Object.keys(PROTOCOL_TEMPLATES) as ProtocolType[]).map((proto) => (
                  <option key={proto} value={proto}>
                    {PROTOCOL_TEMPLATES[proto].label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1 text-xs">
            <span className="text-muted">Base URL（支持任意兼容中转站地址）</span>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder={PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl}
              className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono text-xs focus:outline-none focus:border-accent"
            />
          </label>

          <label className="block space-y-1 text-xs">
            <span className="text-muted">API Key</span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-... / AIza... / sk-ant-..."
                className="w-full pl-3 pr-10 py-2 rounded-xl bg-bg border border-borderc text-fg font-mono text-xs focus:outline-none focus:border-accent"
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

          {/* Models Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                模型列表与能力标记（已预留识图/生图/语音接口）
              </span>
              <button
                type="button"
                disabled={fetchingModels}
                onClick={() => void handleFetchModels()}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-elevated border border-borderc text-xs text-fg hover:border-accent/50 transition disabled:opacity-50"
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
                className="flex-1 px-3 py-1.5 rounded-xl bg-bg border border-borderc text-xs text-fg font-mono focus:outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={addManualModel}
                className="px-3 py-1.5 rounded-xl bg-elevated border border-borderc text-xs text-fg hover:border-accent/50"
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
                    className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-bg/70 border border-borderc/60 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, defaultModel: m.id });
                        void setActiveProviderModel(draft.id, m.id);
                      }}
                      className="flex-1 text-left flex items-center gap-2 min-w-0"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isActive || isDefault ? 'bg-accent' : 'bg-white/15'
                        }`}
                      />
                      <span className="truncate font-mono text-fg">{m.id}</span>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {m.capabilities.reasoning && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                          推理
                        </span>
                      )}
                      {m.capabilities.vision && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted">
                          识图(预留)
                        </span>
                      )}
                      {m.capabilities.imageGen && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted">
                          生图(预留)
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            models: draft.models.filter((x) => x.id !== m.id),
                          })
                        }
                        className="p-1 text-muted hover:text-rose-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <details className="text-xs">
            <summary className="cursor-pointer text-muted hover:text-fg">
              高级：自定义请求头 (JSON)
            </summary>
            <textarea
              rows={2}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-accent"
            />
          </details>

          {statusMsg && (
            <div
              className={`px-3 py-2 rounded-xl text-xs border ${
                statusMsg.ok
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
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
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition disabled:opacity-50"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wifi className="w-3.5 h-3.5" />}
              <span>测试连接</span>
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-black text-xs font-semibold hover:opacity-90 transition"
            >
              <Check className="w-3.5 h-3.5" />
              <span>保存配置</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-borderc p-6 text-center text-xs text-muted">
          点击上方协议按钮即可添加 OpenAI Chat / Responses、Gemini 或 Anthropic 接口
        </div>
      )}

      {/* Generation Parameters */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-3.5">
        <div className="text-xs font-semibold text-fg">推理与生成参数</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>Temperature</span>
              <span className="tabular-nums text-fg">{generation.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={generation.temperature}
              onChange={(e) => void updateGeneration({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>Top-P</span>
              <span className="tabular-nums text-fg">{generation.topP.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={generation.topP}
              onChange={(e) => void updateGeneration({ topP: parseFloat(e.target.value) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>Max Output Tokens</span>
              <span className="tabular-nums text-fg">{generation.maxTokens}</span>
            </div>
            <input
              type="range"
              min="512"
              max="32768"
              step="512"
              value={generation.maxTokens}
              onChange={(e) => void updateGeneration({ maxTokens: parseInt(e.target.value, 10) })}
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>上下文携带消息数</span>
              <span className="tabular-nums text-fg">{generation.maxContextMessages} 条</span>
            </div>
            <input
              type="range"
              min="4"
              max="64"
              step="2"
              value={generation.maxContextMessages}
              onChange={(e) =>
                void updateGeneration({ maxContextMessages: parseInt(e.target.value, 10) })
              }
              className="w-full accent-sky-400"
            />
          </label>

          <label className="space-y-1">
            <span className="text-muted">Responses API 推理强度</span>
            <select
              value={generation.reasoningEffort}
              onChange={(e) =>
                void updateGeneration({
                  reasoningEffort: e.target.value as 'low' | 'medium' | 'high',
                })
              }
              className="w-full px-3 py-1.5 rounded-xl bg-bg border border-borderc text-fg"
            >
              <option value="low">Low (快速)</option>
              <option value="medium">Medium (均衡)</option>
              <option value="high">High (深度)</option>
            </select>
          </label>

          <label className="space-y-1">
            <div className="flex justify-between text-muted">
              <span>Claude / Gemini 思考预算 (Tokens)</span>
              <span className="tabular-nums text-fg">{generation.reasoningBudgetTokens}</span>
            </div>
            <input
              type="range"
              min="0"
              max="16384"
              step="1024"
              value={generation.reasoningBudgetTokens}
              onChange={(e) =>
                void updateGeneration({ reasoningBudgetTokens: parseInt(e.target.value, 10) })
              }
              className="w-full accent-sky-400"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
