import type {
  ContentPart,
  CustomModelParams,
  Message,
  ModelCapabilities,
  ModelDefinition,
  ReasoningEffort,
} from '@/types/chat';
import type { GenerationSettings } from '@/types/settings';
import { resolveModelReasoningProfile } from '@/services/llm/modelProfiles';

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
  return parts
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}

export function sliceContextMessages(messages: Message[], maxMessages: number): Message[] {
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (maxMessages <= 0 || usable.length <= maxMessages) return usable;
  return usable.slice(-maxMessages);
}

export function inferModelCapabilities(modelId: string): ModelCapabilities {
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

  return {
    chat: !isImageGen && !isAudio,
    reasoning: isReasoning,
    vision: isVision,
    imageGen: isImageGen,
    speechIn: id.includes('whisper') || id.includes('transcribe') || id.includes('gemini'),
    speechOut: id.includes('tts'),
  };
}

export function toModelDefinition(id: string, displayName?: string): ModelDefinition {
  return {
    id,
    name: displayName || id,
    capabilities: inferModelCapabilities(id),
  };
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
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
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
