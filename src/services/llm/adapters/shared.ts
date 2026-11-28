import type {
  ContentPart,
  CustomModelParams,
  Message,
  ModelCapabilities,
  ModelDefinition,
  ProtocolType,
  ProviderConfig,
  ReasoningEffort,
} from '@/types/chat';
import type { ChatStreamRequest } from '@/types/provider';
import type {
  GenerationSettings,
  ModelReasoningProfile,
  ReasoningLevelOption,
} from '@/types/settings';
import {
  coerceReasoningEffort,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import { SSEParser } from '@/services/llm/sseParser';
import { simpleRequest, streamRequest } from '@/services/transport/streamHttp';

export function resolveThinkingBudget(effort: ReasoningEffort): number {
  switch (effort) {
    case 'off':
      return 0;
    case 'minimal':
      return 1024;
    case 'low':
      return 2048;
    case 'medium':
      return 8192;
    case 'high':
      return 16384;
    case 'xhigh':
      return 24576;
    case 'max':
      return 32768;
    case 'auto':
      return -1;
  }
}

const UNSAFE_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively merges extra payload fields onto an adapter request payload while
 * guarding against prototype pollution keys.
 */
export function deepMergePayload(
  base: Record<string, unknown>,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  if (!extra || !isPlainObject(extra)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, val] of Object.entries(extra)) {
    if (UNSAFE_MERGE_KEYS.has(key) || val === undefined) continue;
    const existing = out[key];
    if (isPlainObject(existing) && isPlainObject(val)) {
      out[key] = deepMergePayload(existing, val);
    } else if (isPlainObject(val)) {
      out[key] = deepMergePayload({}, val);
    } else {
      out[key] = val;
    }
  }
  return out;
}

export interface ResolvedEffectiveParams {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  seed?: number;
  stop?: string[];
  thinkingBudget?: number;
  extraBody?: Record<string, unknown>;
}

/**
 * Resolves effective generation parameters by layering:
 *   global generation (gated by enabledParams) -> per-model params -> per-conversation params.
 */
export function resolveEffectiveParams(
  globalGen: GenerationSettings,
  modelParams?: CustomModelParams,
  convParams?: CustomModelParams
): ResolvedEffectiveParams {
  const enabled = globalGen.enabledParams ?? {
    temperature: true,
    topP: true,
    maxTokens: true,
    presencePenalty: false,
    frequencyPenalty: false,
  };

  const temperature =
    convParams?.temperature ??
    modelParams?.temperature ??
    (enabled.temperature !== false ? globalGen.temperature : undefined);

  const topP =
    convParams?.topP ??
    modelParams?.topP ??
    (enabled.topP !== false ? globalGen.topP : undefined);

  const maxTokens =
    convParams?.maxTokens ??
    modelParams?.maxTokens ??
    (enabled.maxTokens !== false ? globalGen.maxTokens : undefined);

  const presencePenalty =
    convParams?.presencePenalty ??
    modelParams?.presencePenalty ??
    (enabled.presencePenalty ? globalGen.presencePenalty : undefined);

  const frequencyPenalty =
    convParams?.frequencyPenalty ??
    modelParams?.frequencyPenalty ??
    (enabled.frequencyPenalty ? globalGen.frequencyPenalty : undefined);

  const seed = convParams?.seed ?? modelParams?.seed;
  const stop = convParams?.stop ?? modelParams?.stop;
  const thinkingBudget = convParams?.thinkingBudget ?? modelParams?.thinkingBudget;

  let mergedExtra: Record<string, unknown> | undefined;
  if (globalGen.extraBody) mergedExtra = deepMergePayload({}, globalGen.extraBody);
  if (modelParams?.extraBody) {
    mergedExtra = deepMergePayload(mergedExtra || {}, modelParams.extraBody);
  }
  if (convParams?.extraBody) {
    mergedExtra = deepMergePayload(mergedExtra || {}, convParams.extraBody);
  }

  return {
    temperature,
    topP,
    maxTokens,
    presencePenalty,
    frequencyPenalty,
    seed,
    stop,
    thinkingBudget,
    extraBody: mergedExtra,
  };
}

export function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function extractTextFromParts(parts: ContentPart[]): string {
  if (parts.length === 1) {
    const p = parts[0];
    return p.type === 'text' ? p.text.trim() : '';
  }
  const texts: string[] = [];
  for (const p of parts) {
    if (p.type === 'text') texts.push(p.text);
  }
  return texts.join('\n').trim();
}

export function sliceContextMessages(messages: Message[], maxMessages: number): Message[] {
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (maxMessages <= 0 || usable.length <= maxMessages) return usable;
  return usable.slice(-maxMessages);
}

const MAX_CAPABILITY_CACHE = 512;
const capabilityCache = new Map<string, ModelCapabilities>();

export function inferModelCapabilities(modelId: string): ModelCapabilities {
  const cached = capabilityCache.get(modelId);
  if (cached) return cached;

  const id = modelId.toLowerCase();
  const isImageGen =
    id.includes('dall-e') ||
    id.includes('gpt-image') ||
    id.includes('imagen') ||
    id.includes('flux') ||
    id.includes('sdxl');
  const isAudio = id.includes('whisper') || id.includes('tts') || id.includes('transcribe');
  const { profile } = resolveModelReasoningProfile({ modelId });
  const isReasoning = !isImageGen && !isAudio && profile.strategy !== 'none';
  const isVision =
    !isImageGen &&
    !isAudio &&
    (id.includes('gpt-4') ||
      id.includes('gpt-5') ||
      id.includes('gpt-6') ||
      id.includes('o3') ||
      id.includes('o4') ||
      id.includes('gemini') ||
      id.includes('claude-3') ||
      id.includes('claude-sonnet-4') ||
      id.includes('claude-opus-4') ||
      id.includes('claude-haiku-4') ||
      id.includes('claude-sonnet-5') ||
      id.includes('claude-opus-5') ||
      id.includes('claude-haiku-5') ||
      id.includes('claude-5') ||
      id.includes('deepseek-flash') ||
      id.includes('qwen3.5') ||
      id.includes('qwen3.8') ||
      id.includes('glm-5') ||
      id.includes('kimi-k2.5') ||
      id.includes('kimi-k3') ||
      id.includes('k3.1') ||
      id.includes('grok-4') ||
      id.includes('doubao-seed-2') ||
      id.includes('vision') ||
      id.includes('vl'));

  const result: ModelCapabilities = {
    chat: !isImageGen && !isAudio,
    reasoning: isReasoning,
    vision: isVision,
    imageGen: isImageGen,
    speechIn: id.includes('whisper') || id.includes('transcribe') || id.includes('gemini'),
    speechOut: id.includes('tts'),
  };
  capabilityCache.set(modelId, result);
  if (capabilityCache.size > MAX_CAPABILITY_CACHE) {
    const oldest = capabilityCache.keys().next().value;
    if (oldest !== undefined) capabilityCache.delete(oldest);
  }
  return result;
}

export function toModelDefinition(id: string, displayName?: string): ModelDefinition {
  return {
    id,
    name: displayName || id,
    capabilities: inferModelCapabilities(id),
  };
}

export function getModelDisplayName(
  modelDef?: Pick<ModelDefinition, 'id' | 'name'> | null,
  fallbackId = ''
): string {
  const custom = modelDef?.name?.trim();
  return custom || modelDef?.id || fallbackId;
}

export function hasCustomModelDisplayName(
  modelDef?: Pick<ModelDefinition, 'id' | 'name'> | null
): boolean {
  const custom = modelDef?.name?.trim();
  return Boolean(custom && modelDef && custom !== modelDef.id);
}

export function isModelReasoningCapable(
  modelId: string,
  models: ModelDefinition[]
): boolean {
  const found = models.find((m) => m.id === modelId);
  if (found && found.capabilities.reasoning !== undefined) {
    return found.capabilities.reasoning;
  }
  return Boolean(inferModelCapabilities(modelId).reasoning);
}

export function extractDataUrlParts(dataUrl: string): { mimeType: string; base64: string } | null {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx <= 0 || commaIdx + 1 >= dataUrl.length) return null;
  const header = dataUrl.slice(0, commaIdx);
  const match = /^data:([^;,]+)(?:;[^;,]+)*;base64$/i.exec(header);
  if (!match) return null;
  return { mimeType: match[1], base64: dataUrl.slice(commaIdx + 1) };
}

export function parseHttpHeadersJson(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('自定义 Headers JSON 格式无效');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义 Headers 必须为键值对 JSON 对象');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(`Header "${k}" 的值必须为字符串`);
    }
    out[k] = v;
  }
  return out;
}

export const AUTO_SESSION_HEADER_PLACEHOLDER = '<自动按会话固定ID>';

export function toStableSessionId(conversationId?: string): string {
  const cleaned = (conversationId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) return 'ses_chatbeauty_default';
  return cleaned.startsWith('ses_') ? cleaned : `ses_${cleaned}`;
}

export function isOpenCodeProvider(
  provider: Pick<ProviderConfig, 'presetId' | 'baseUrl'>
): boolean {
  if (provider.presetId === 'opencode-go' || provider.presetId === 'opencode-zen') {
    return true;
  }
  return /opencode\.ai/i.test(provider.baseUrl || '');
}

export function buildProviderDefaultHeaders(
  provider: Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'presetId'>,
  options?: {
    includeContentType?: boolean;
    sessionId?: string;
    forPreview?: boolean;
    isWebRuntime?: boolean;
  }
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options?.includeContentType !== false) {
    headers['Content-Type'] = 'application/json';
  }

  const apiKey = (provider.apiKey || '').trim();
  if (provider.protocol === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
  } else if (provider.protocol === 'anthropic') {
    if (apiKey) headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    if (options?.isWebRuntime) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
  } else {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }

  if (isOpenCodeProvider(provider)) {
    headers['x-opencode-session'] = options?.forPreview
      ? AUTO_SESSION_HEADER_PLACEHOLDER
      : options?.sessionId || toStableSessionId();
    headers['x-opencode-client'] = 'chatbeauty';
  }

  return headers;
}

export function mergeHeadersCaseInsensitive(
  base: Record<string, string>,
  extra?: Record<string, string>
): Record<string, string> {
  if (!extra) return { ...base };
  const byLower = new Map<string, { key: string; value: string }>();
  for (const [k, v] of Object.entries(base)) {
    byLower.set(k.toLowerCase(), { key: k, value: v });
  }
  for (const [k, v] of Object.entries(extra)) {
    const trimmedKey = k.trim();
    if (!trimmedKey || typeof v !== 'string') continue;
    byLower.set(trimmedKey.toLowerCase(), { key: trimmedKey, value: v });
  }
  const out: Record<string, string> = {};
  for (const entry of byLower.values()) {
    out[entry.key] = entry.value;
  }
  return out;
}

export function buildEffectiveProviderHeaders(
  provider: Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'presetId' | 'extraHeaders'>,
  options?: {
    includeContentType?: boolean;
    sessionId?: string;
    isWebRuntime?: boolean;
  }
): Record<string, string> {
  const defaults = buildProviderDefaultHeaders(provider, options);
  const filteredExtra: Record<string, string> = {};
  if (provider.extraHeaders) {
    for (const [k, v] of Object.entries(provider.extraHeaders)) {
      if (v === AUTO_SESSION_HEADER_PLACEHOLDER) continue;
      filteredExtra[k] = v;
    }
  }
  return mergeHeadersCaseInsensitive(defaults, filteredExtra);
}

export function buildPreviewHeadersJson(
  provider: Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'presetId'>,
  extraHeaders?: Record<string, string>
): string {
  const defaults = buildProviderDefaultHeaders(provider, {
    includeContentType: true,
    forPreview: true,
  });
  const merged = mergeHeadersCaseInsensitive(defaults, extraHeaders);
  return JSON.stringify(merged, null, 2);
}

export function extractExtraHeadersFromPreviewJson(
  rawJson: string,
  provider: Pick<ProviderConfig, 'protocol' | 'baseUrl' | 'apiKey' | 'presetId'>
): Record<string, string> {
  const parsed = parseHttpHeadersJson(rawJson);
  const defaults = buildProviderDefaultHeaders(provider, {
    includeContentType: true,
    forPreview: true,
  });
  const defaultByLower = new Map<string, string>();
  for (const [k, v] of Object.entries(defaults)) {
    defaultByLower.set(k.toLowerCase(), v);
  }

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const trimmedKey = k.trim();
    if (!trimmedKey) continue;
    if (v === AUTO_SESSION_HEADER_PLACEHOLDER) continue;
    const lower = trimmedKey.toLowerCase();
    if (defaultByLower.has(lower) && defaultByLower.get(lower) === v) {
      continue;
    }
    out[trimmedKey] = v;
  }
  return out;
}

export function buildProtocolModelsUrl(
  protocol: ProtocolType,
  baseUrl: string,
  options?: { geminiPageSize?: number }
): string {
  const defaultBase =
    protocol === 'gemini'
      ? 'https://generativelanguage.googleapis.com/v1beta'
      : protocol === 'anthropic'
        ? 'https://api.anthropic.com/v1'
        : 'https://api.openai.com/v1';
  const clean = trimBaseUrl(baseUrl) || defaultBase;

  if (protocol === 'gemini') {
    const modelsUrl = clean.endsWith('/models') ? clean : `${clean}/models`;
    return options?.geminiPageSize ? `${modelsUrl}?pageSize=${options.geminiPageSize}` : modelsUrl;
  }

  if (protocol === 'anthropic') {
    if (clean.endsWith('/messages')) {
      return clean.replace(/\/messages$/, '/models');
    }
    if (clean.endsWith('/models')) return clean;
    if (clean.endsWith('/v1')) return `${clean}/models`;
    return `${clean}/v1/models`;
  }

  if (clean.endsWith('/chat/completions')) {
    return clean.replace(/\/chat\/completions$/, '/models');
  }
  if (clean.endsWith('/responses')) {
    return clean.replace(/\/responses$/, '/models');
  }
  return clean.endsWith('/models') ? clean : `${clean}/models`;
}

export interface RequestExecutionContext {
  modelDef: ModelDefinition | undefined;
  modelParams: CustomModelParams | undefined;
  profile: ModelReasoningProfile;
  effort: ReasoningEffort;
  activeLevel: ReasoningLevelOption | undefined;
  effective: ResolvedEffectiveParams;
  thinkingActive: boolean;
  allowSampling: boolean;
}

export function resolveRequestExecutionContext(
  req: ChatStreamRequest,
  protocol: ProtocolType
): RequestExecutionContext {
  const modelDef = req.provider.models.find((m) => m.id === req.modelId);
  const modelParams = req.modelParams ?? modelDef?.params;
  const profile =
    req.reasoningProfile ??
    resolveModelReasoningProfile({
      modelId: req.modelId,
      protocol,
      modelDef,
    }).profile;
  const effort = coerceReasoningEffort(req.generation.reasoningEffort, profile);
  const activeLevel = profile.levels.find((l) => l.value === effort);
  const effective = resolveEffectiveParams(req.generation, modelParams, req.conversationParams);
  const thinkingActive = profile.strategy !== 'none' && effort !== 'off';
  const allowSampling = thinkingActive
    ? profile.supportsSamplingWhenThinking !== false
    : profile.supportsSamplingWhenOff !== false;

  return {
    modelDef,
    modelParams,
    profile,
    effort,
    activeLevel,
    effective,
    thinkingActive,
    allowSampling,
  };
}

export async function streamSseJsonEvents(
  options: {
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    onDone?: () => void;
  },
  onEvent: (eventName: string, parsed: Record<string, unknown>) => void
): Promise<void> {
  const parser = new SSEParser();

  const dispatch = (eventName: string, rawData: string) => {
    if (rawData === '[DONE]') return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }
    onEvent(eventName, parsed);
  };

  await streamRequest({
    url: options.url,
    method: 'POST',
    headers: options.headers,
    body: options.body,
    signal: options.signal,
    onChunk: (chunk) => {
      for (const evt of parser.feed(chunk)) {
        dispatch(evt.event, evt.data);
      }
    },
  });

  for (const evt of parser.flush()) {
    dispatch(evt.event, evt.data);
  }

  options.onDone?.();
}

export async function fetchJsonWithAuth<T>(options: {
  url: string;
  provider: ProviderConfig;
  sessionPrefix: string;
  signal?: AbortSignal;
  isWebRuntime?: boolean;
}): Promise<T> {
  const res = await simpleRequest({
    url: options.url,
    method: 'GET',
    headers: buildEffectiveProviderHeaders(options.provider, {
      includeContentType: false,
      sessionId: toStableSessionId(`${options.sessionPrefix}_${options.provider.id}`),
      isWebRuntime: options.isWebRuntime,
    }),
    signal: options.signal,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`拉取模型失败 (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new Error('拉取模型失败：返回内容非有效 JSON');
  }
}
