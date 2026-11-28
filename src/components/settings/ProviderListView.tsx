import React, { useRef, useState } from 'react';
import { ChevronRight, Copy, Download, Gauge, Loader2, Plus, Upload } from 'lucide-react';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { getModelDisplayName } from '@/services/llm/adapters/shared';
import type { EndpointBenchmarkResult } from '@/services/llm/endpointBenchmark';
import { useFlashNotice } from '@/hooks/useFlashNotice';
import type { ProviderConfig } from '@/types/chat';
import { SettingsSection } from './SettingsPrimitives';
import {
  LatencyBadge,
  exportProvidersConfigJson,
  getProviderUrlKey,
  parseImportedProvidersJson,
} from './providerShared';

interface ProviderListViewProps {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  benchmarkByUrl: Record<string, EndpointBenchmarkResult>;
  benchmarkingUrls: Record<string, boolean>;
  viewAnim: string;
  onEnableProvider: (providerId: string, modelId: string) => Promise<void>;
  onBenchmarkEndpoint: (p: ProviderConfig, urlOverride?: string) => Promise<EndpointBenchmarkResult>;
  onEditProvider: (p: ProviderConfig) => void;
  onStartWizard: () => void;
  saveProvider: (p: ProviderConfig) => Promise<void>;
}

export const ProviderListView: React.FC<ProviderListViewProps> = ({
  providers,
  activeProviderId,
  benchmarkByUrl,
  benchmarkingUrls,
  viewAnim,
  onEnableProvider,
  onBenchmarkEndpoint,
  onEditProvider,
  onStartWizard,
  saveProvider,
}) => {
  const { notice: listNotice, setNotice: setListNotice } = useFlashNotice<{
    ok: boolean;
    text: string;
  }>(2800);
  const [benchmarkingAll, setBenchmarkingAll] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const handleBenchmarkAll = async () => {
    if (providers.length === 0 || benchmarkingAll) return;
    setBenchmarkingAll(true);
    setListNotice(null);
    try {
      const results = await Promise.all(providers.map((p) => onBenchmarkEndpoint(p)));
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
    exportProvidersConfigJson(providers);
    setListNotice({ ok: true, text: `已导出 ${providers.length} 个供应商配置` });
  };

  const handleImportProviders = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const raw = await file.text();
      const existingIds = new Set(providers.map((p) => p.id));
      const items = parseImportedProvidersJson(raw, existingIds);
      for (const normalized of items) {
        await saveProvider(normalized);
      }

      if (items.length === 0) {
        setListNotice({ ok: false, text: '未识别到有效的供应商配置条目' });
      } else {
        setListNotice({ ok: true, text: `已成功导入 ${items.length} 个供应商配置` });
      }
    } catch (err) {
      setListNotice({
        ok: false,
        text: err instanceof Error ? `导入失败：${err.message}` : '导入 JSON 格式无效',
      });
    }
  };

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
            onClick={onStartWizard}
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
              onClick={onStartWizard}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accentfg text-xs font-semibold active:scale-95 transition"
            >
              <Plus className="w-4 h-4" />
              <span>立即配置</span>
            </button>
          </div>
        ) : (
          providers.map((p) => {
            const isActive = p.id === activeProviderId;
            const benchKey = getProviderUrlKey(p);
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
                      <LatencyBadge result={bench} fallbackErrorText="连接异常" pill />
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
                        void onEnableProvider(p.id, p.defaultModel || p.models[0]?.id || '')
                      }
                      className="px-2.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
                    >
                      启用
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isBenching}
                    onClick={() => void onBenchmarkEndpoint(p)}
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
                    onClick={() => onEditProvider(p)}
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
