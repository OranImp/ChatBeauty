import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import type { EndpointBenchmarkResult } from '@/services/llm/endpointBenchmark';
import {
  buildPreviewHeadersJson,
  extractExtraHeadersFromPreviewJson,
  toModelDefinition,
  trimBaseUrl,
} from '@/services/llm/adapters/shared';
import { triggerDownload } from '@/components/renderer/svgUtils';
import { Collapsible } from '@/components/ui/MotionPrimitives';
import type { CustomModelParams, ModelDefinition, ProviderConfig } from '@/types/chat';

export function pruneParams(params?: CustomModelParams): CustomModelParams | undefined {
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

export function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : undefined;
}

export function mergeFetchedModelsPreservingAliases(
  fetched: ModelDefinition[],
  existing: ModelDefinition[]
): ModelDefinition[] {
  const existingMap = new Map(existing.map((m) => [m.id, m]));
  return fetched.map((m) => {
    const prev = existingMap.get(m.id);
    const hasPrevAlias = Boolean(prev?.name?.trim() && prev.name.trim() !== prev.id);
    return {
      ...m,
      ...(hasPrevAlias ? { name: prev!.name.trim() } : {}),
      ...(prev?.params ? { params: prev.params } : {}),
    };
  });
}

export function getProviderUrlKey(
  p: Pick<ProviderConfig, 'id' | 'protocol' | 'baseUrl'>,
  urlOverride?: string
): string {
  return `${p.id}::${trimBaseUrl(
    urlOverride || p.baseUrl || PROTOCOL_TEMPLATES[p.protocol].defaultBaseUrl
  )}`;
}

export function exportProvidersConfigJson(providers: ProviderConfig[]): void {
  const json = JSON.stringify(providers, null, 2);
  triggerDownload(
    `chatbeauty-providers-${new Date().toISOString().slice(0, 10)}.json`,
    new Blob([json], { type: 'application/json' })
  );
}

export function parseImportedProvidersJson(
  raw: string,
  existingIds: Set<string>
): ProviderConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const results: ProviderConfig[] = [];

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
          ...(typeof rec.name === 'string' && rec.name.trim() ? { name: rec.name.trim() } : {}),
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

    results.push({
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
    });
  }

  return results;
}

type HeadersPreviewTarget = Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'presetId'>;

export function useProviderHeadersEditor(
  draft: HeadersPreviewTarget | null,
  initialOpen = false,
  initialExtraHeaders?: Record<string, string>
) {
  const [customExtraHeaders, setCustomExtraHeaders] = useState<Record<string, string>>(
    () => initialExtraHeaders || {}
  );
  const [headersErr, setHeadersErr] = useState<string | null>(null);
  const [headersOpen, setHeadersOpen] = useState(initialOpen);
  const [headersText, setHeadersText] = useState(() =>
    draft ? buildPreviewHeadersJson(draft, initialExtraHeaders || {}) : '{}'
  );

  const customExtraHeadersRef = useRef(customExtraHeaders);
  customExtraHeadersRef.current = customExtraHeaders;
  const headersErrRef = useRef(headersErr);
  headersErrRef.current = headersErr;

  useEffect(() => {
    if (!draft || headersErrRef.current) return;
    const nextText = buildPreviewHeadersJson(draft, customExtraHeadersRef.current);
    setHeadersText((prev) => (prev === nextText ? prev : nextText));
  }, [draft?.protocol, draft?.baseUrl, draft?.apiKey, draft?.presetId]);

  const syncHeadersForDraft = useCallback(
    (target: HeadersPreviewTarget, nextExtra: Record<string, string> = {}) => {
      customExtraHeadersRef.current = nextExtra;
      headersErrRef.current = null;
      setCustomExtraHeaders(nextExtra);
      setHeadersErr(null);
      setHeadersText(buildPreviewHeadersJson(target, nextExtra));
    },
    []
  );

  const handleHeadersJsonChange = useCallback(
    (raw: string) => {
      setHeadersText(raw);
      if (!draft) return;
      try {
        const extracted = extractExtraHeadersFromPreviewJson(raw, draft);
        customExtraHeadersRef.current = extracted;
        headersErrRef.current = null;
        setCustomExtraHeaders(extracted);
        setHeadersErr(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '自定义 Headers JSON 格式无效';
        headersErrRef.current = msg;
        setHeadersErr(msg);
      }
    },
    [draft]
  );

  const resetAutoHeaders = useCallback(() => {
    if (!draft) return;
    syncHeadersForDraft(draft, {});
  }, [draft, syncHeadersForDraft]);

  const resolveLiveExtraHeaders = useCallback(
    (target: HeadersPreviewTarget): Record<string, string> => {
      return extractExtraHeadersFromPreviewJson(headersText, target);
    },
    [headersText]
  );

  const getLiveExtraHeadersOrFallback = useCallback(
    (target: HeadersPreviewTarget): Record<string, string> => {
      try {
        return extractExtraHeadersFromPreviewJson(headersText, target);
      } catch {
        return customExtraHeadersRef.current;
      }
    },
    [headersText]
  );

  return {
    customExtraHeaders,
    headersText,
    headersErr,
    headersOpen,
    setHeadersOpen,
    syncHeadersForDraft,
    handleHeadersJsonChange,
    resetAutoHeaders,
    resolveLiveExtraHeaders,
    getLiveExtraHeadersOrFallback,
  };
}

interface ProviderHeadersAccordionProps {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  headersText: string;
  headersErr: string | null;
  onChange: (next: string) => void;
  onReset: () => void;
  variant?: 'edit' | 'wizard';
}

export const ProviderHeadersAccordion: React.FC<ProviderHeadersAccordionProps> = ({
  title,
  subtitle,
  open,
  onToggle,
  headersText,
  headersErr,
  onChange,
  onReset,
  variant = 'edit',
}) => {
  const isWizard = variant === 'wizard';
  return (
    <div
      className={`rounded-xl border border-borderc overflow-hidden min-w-0 ${
        isWizard ? 'bg-surface/40' : 'bg-bg/50'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full min-w-0 flex items-center justify-between gap-2 px-3 py-2.5 text-left text-muted hover:text-fg hover:bg-fg/[0.03] transition"
      >
        <span className="truncate">{title}</span>
        <ChevronRight
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            open ? 'rotate-90 text-fg' : ''
          }`}
        />
      </button>
      <Collapsible open={open}>
        <div className="px-3 pb-3 pt-2 border-t border-borderc space-y-1.5 min-w-0">
          <div
            className={`flex flex-wrap items-center justify-between gap-2 ${
              isWizard ? 'text-xs' : 'text-[11px] text-muted'
            }`}
          >
            <span className={isWizard ? 'text-muted' : undefined}>{subtitle}</span>
            <button
              type="button"
              onClick={onReset}
              className={
                isWizard
                  ? 'px-2 py-0.5 rounded-lg border border-borderc bg-bg hover:bg-elevated text-muted hover:text-fg transition shrink-0'
                  : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-borderc bg-bg hover:bg-elevated text-fg transition shrink-0'
              }
            >
              {!isWizard && <RefreshCw className="w-3 h-3" />}
              <span>恢复自动头</span>
            </button>
          </div>
          <textarea
            rows={5}
            value={headersText}
            onChange={(e) => onChange(e.target.value)}
            className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg focus:outline-none focus:border-fg/40"
          />
          {headersErr && (
            <div
              className={`${
                isWizard ? 'text-xs' : 'text-[11px] break-words'
              } text-rose-600 dark:text-rose-400`}
            >
              {headersErr}
            </div>
          )}
        </div>
      </Collapsible>
    </div>
  );
};

interface LatencyBadgeProps {
  result: EndpointBenchmarkResult;
  fallbackErrorText: string;
  compact?: boolean;
  pill?: boolean;
}

export const LatencyBadge: React.FC<LatencyBadgeProps> = ({
  result,
  fallbackErrorText,
  compact = false,
  pill = true,
}) => {
  const tone = result.ok
    ? result.latencyMs < 800
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300';

  return (
    <span
      className={`text-[11px] font-mono border shrink-0 ${
        compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
      } ${pill ? 'rounded-full' : 'rounded'} ${tone}`}
    >
      {result.ok ? `${result.latencyMs} ms` : result.error || fallbackErrorText}
    </span>
  );
};
