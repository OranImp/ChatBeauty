import React, { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { parseHttpHeadersJson, toModelDefinition } from '@/services/llm/adapters/shared';
import type { ProtocolType, ProviderConfig } from '@/types/chat';

interface ProviderWizardProps {
  onCancel: () => void;
  onComplete: (provider: ProviderConfig) => Promise<void>;
}

export const ProviderWizard: React.FC<ProviderWizardProps> = ({ onCancel, onComplete }) => {
  const { fetchProviderModels, testProviderConnection } = useAppStore();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [protocol, setProtocol] = useState<ProtocolType>('openai-chat');
  const [draft, setDraft] = useState<ProviderConfig>(() => {
    const tpl = PROTOCOL_TEMPLATES['openai-chat'];
    return {
      id: `prov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: tpl.defaultName,
      protocol: 'openai-chat',
      baseUrl: tpl.defaultBaseUrl,
      apiKey: '',
      defaultModel: tpl.placeholderModel,
      models: [...tpl.suggestedModels],
      extraHeaders: {},
      enabled: true,
      createdAt: Date.now(),
    };
  });
  const [headersText, setHeadersText] = useState('{}');
  const [showKey, setShowKey] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selectProtocol = (nextProto: ProtocolType) => {
    const tpl = PROTOCOL_TEMPLATES[nextProto];
    setProtocol(nextProto);
    setDraft((prev) => ({
      ...prev,
      protocol: nextProto,
      name: tpl.defaultName,
      baseUrl: tpl.defaultBaseUrl,
      defaultModel: tpl.placeholderModel,
      models: [...tpl.suggestedModels],
    }));
    setStatusMsg(null);
    setDirection('forward');
    setStep(2);
  };

  const buildCandidate = (): ProviderConfig | null => {
    let parsedHeaders: Record<string, string>;
    try {
      parsedHeaders = parseHttpHeadersJson(headersText);
    } catch (err) {
      setStatusMsg({
        ok: false,
        text: err instanceof Error ? err.message : '自定义 Headers JSON 格式无效',
      });
      return null;
    }
    const tpl = PROTOCOL_TEMPLATES[draft.protocol];
    return {
      ...draft,
      name: draft.name.trim() || tpl.defaultName,
      baseUrl: draft.baseUrl.trim() || tpl.defaultBaseUrl,
      apiKey: draft.apiKey.trim(),
      defaultModel: draft.defaultModel.trim() || draft.models[0]?.id || tpl.placeholderModel,
      extraHeaders: parsedHeaders,
    };
  };

  const handleTest = async () => {
    const candidate = buildCandidate();
    if (!candidate) return;
    if (!candidate.apiKey) {
      setStatusMsg({ ok: false, text: '请先填写 API Key' });
      return;
    }
    setTesting(true);
    setStatusMsg(null);
    try {
      const reply = await testProviderConnection(candidate, candidate.defaultModel);
      setStatusMsg({
        ok: true,
        text: `连接成功 (${candidate.defaultModel})：${reply.slice(0, 60)}`,
      });
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : '连接测试失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleNextToModels = () => {
    const candidate = buildCandidate();
    if (!candidate) return;
    if (!candidate.apiKey) {
      setStatusMsg({ ok: false, text: '请先填写 API Key 再进入下一步' });
      return;
    }
    setDraft(candidate);
    setStatusMsg(null);
    setDirection('forward');
    setStep(3);
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setStatusMsg(null);
    try {
      const models = await fetchProviderModels(draft);
      if (models.length === 0) {
        setStatusMsg({ ok: false, text: '接口未返回模型列表，可手动输入添加' });
      } else {
        setDraft((prev) => ({
          ...prev,
          models,
          defaultModel: models.some((m) => m.id === prev.defaultModel)
            ? prev.defaultModel
            : models[0].id,
        }));
        setStatusMsg({ ok: true, text: `已拉取 ${models.length} 个模型` });
      }
    } catch (err) {
      setStatusMsg({ ok: false, text: err instanceof Error ? err.message : '拉取失败' });
    } finally {
      setFetchingModels(false);
    }
  };

  const addManualModel = () => {
    const id = newModelId.trim();
    if (!id) return;
    if (!draft.models.some((m) => m.id === id)) {
      setDraft((prev) => ({
        ...prev,
        defaultModel: prev.defaultModel || id,
        models: [...prev.models, toModelDefinition(id)],
      }));
    }
    setNewModelId('');
  };

  const handleFinish = async () => {
    const candidate = buildCandidate();
    if (!candidate) return;
    setSaving(true);
    try {
      await onComplete(candidate);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            if (step === 1) {
              onCancel();
            } else {
              setDirection('backward');
              setStep((s) => (s === 3 ? 2 : 1));
            }
          }}
          className="flex items-center gap-1.5 text-muted hover:text-fg active:scale-95 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{step === 1 ? '返回列表' : '上一步'}</span>
        </button>

        <div className="text-muted font-mono tabular-nums">步骤 {step} / 3</div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map((idx) => (
          <div
            key={idx}
            className={`h-1 rounded-full transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              idx <= step ? 'bg-accent scale-x-100' : 'bg-fg/10'
            }`}
          />
        ))}
      </div>

      <div
        key={step}
        className={direction === 'forward' ? 'cb-step-forward' : 'cb-step-backward'}
      >
      {step === 1 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">选择接口协议</h3>
            <p className="text-muted mt-0.5">
              选择对应的官方协议或中转站兼容协议，下一步填写地址与密钥。
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(Object.keys(PROTOCOL_TEMPLATES) as ProtocolType[]).map((proto) => {
              const tpl = PROTOCOL_TEMPLATES[proto];
              const selected = protocol === proto;
              return (
                <button
                  key={proto}
                  type="button"
                  onClick={() => selectProtocol(proto)}
                  className={`p-3.5 rounded-2xl border text-left active:scale-[0.985] transition ${
                    selected
                      ? 'border-fg/40 bg-elevated text-fg'
                      : 'border-borderc bg-surface/50 text-fg hover:bg-surface'
                  }`}
                >
                  <div className="font-semibold text-[13px]">{tpl.shortLabel}</div>
                  <div className="text-[11px] text-muted mt-1 leading-relaxed">
                    {tpl.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-fg">
              填写连接信息（{PROTOCOL_TEMPLATES[draft.protocol].shortLabel}）
            </h3>
            <p className="text-muted mt-0.5">支持官方接口或任意兼容中转站地址。</p>
          </div>

          <label className="block space-y-1">
            <span className="text-muted">显示名称</span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full px-3 py-2 rounded-xl bg-surface border border-borderc text-fg focus:outline-none focus:border-fg/40"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-muted">Base URL</span>
            <input
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder={PROTOCOL_TEMPLATES[draft.protocol].defaultBaseUrl}
              className="w-full px-3 py-2 rounded-xl bg-surface border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
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
                className="w-full pl-3 pr-10 py-2 rounded-xl bg-surface border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
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

          <details>
            <summary className="cursor-pointer text-muted hover:text-fg">
              高级：自定义请求头 (JSON)
            </summary>
            <textarea
              rows={2}
              value={headersText}
              onChange={(e) => setHeadersText(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-xl bg-surface border border-borderc font-mono text-fg focus:outline-none focus:border-fg/40"
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

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTest()}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-borderc bg-surface hover:bg-elevated text-fg transition disabled:opacity-50"
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
              onClick={handleNextToModels}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg font-semibold hover:opacity-90 transition"
            >
              <span>下一步</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-fg">配置可用模型</h3>
              <p className="text-muted mt-0.5">拉取在线列表或手动添加模型，并点选默认模型。</p>
            </div>
            <button
              type="button"
              disabled={fetchingModels}
              onClick={() => void handleFetchModels()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface border border-borderc hover:bg-elevated text-fg shrink-0 disabled:opacity-50"
            >
              {fetchingModels ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>拉取模型</span>
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
              placeholder={`输入模型 ID，如 ${PROTOCOL_TEMPLATES[draft.protocol].placeholderModel}`}
              className="flex-1 px-3 py-2 rounded-xl bg-surface border border-borderc text-fg font-mono focus:outline-none focus:border-fg/40"
            />
            <button
              type="button"
              onClick={addManualModel}
              className="px-3.5 py-2 rounded-xl border border-borderc bg-surface hover:bg-elevated text-fg"
            >
              添加
            </button>
          </div>

          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
            {draft.models.map((m) => {
              const selected = draft.defaultModel === m.id;
              return (
                <div
                  key={m.id}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border transition ${
                    selected
                      ? 'border-fg/35 bg-elevated text-fg'
                      : 'border-borderc bg-surface/40 text-muted hover:text-fg'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, defaultModel: m.id })}
                    className="flex-1 text-left flex items-center justify-between min-w-0"
                  >
                    <span className="truncate font-mono">{m.id}</span>
                    {selected && <span className="text-[11px] text-fg ml-2 shrink-0">默认</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const remaining = draft.models.filter((x) => x.id !== m.id);
                      setDraft({
                        ...draft,
                        models: remaining,
                        defaultModel:
                          draft.defaultModel === m.id ? remaining[0]?.id ?? '' : draft.defaultModel,
                      });
                    }}
                    className="p-1 text-muted hover:text-rose-400 shrink-0"
                    title="移除模型"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

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

          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleFinish()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg font-semibold hover:opacity-90 transition disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              <span>完成并启用</span>
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
