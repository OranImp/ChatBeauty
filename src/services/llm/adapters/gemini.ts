import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import {
  buildEffectiveProviderHeaders,
  buildProtocolModelsUrl,
  deepMergePayload,
  extractDataUrlParts,
  extractTextFromParts,
  fetchJsonWithAuth,
  resolveRequestExecutionContext,
  resolveThinkingBudget,
  sliceContextMessages,
  streamSseJsonEvents,
  toModelDefinition,
  trimBaseUrl,
} from './shared';

function normalizeGeminiModel(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

function buildGeminiStreamEndpoint(baseUrl: string, modelId: string): string {
  const clean =
    trimBaseUrl(baseUrl) || 'https://generativelanguage.googleapis.com/v1beta';
  const model = encodeURIComponent(normalizeGeminiModel(modelId));
  return `${clean}/models/${model}:streamGenerateContent?alt=sse`;
}

export class GeminiAdapter implements LLMProviderAdapter {
  readonly protocol = 'gemini' as const;

  async chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const endpoint = buildGeminiStreamEndpoint(req.provider.baseUrl, req.modelId);
    const contextMsgs = sliceContextMessages(req.messages, req.generation.maxContextMessages);

    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [];

    for (const msg of contextMsgs) {
      const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
      // Gemini requires starting with a user turn; skip leading assistant messages before decoding images
      if (contents.length === 0 && role !== 'user') continue;
      const parts: Array<Record<string, unknown>> = [];
      const text = extractTextFromParts(msg.parts);
      if (text) parts.push({ text });

      for (const img of msg.parts) {
        if (img.type === 'image' && img.dataUrl) {
          const parsed = extractDataUrlParts(img.dataUrl);
          if (parsed) {
            parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.base64 } });
          }
        }
      }

      if (parts.length === 0) continue;

      const prev = contents[contents.length - 1];
      if (prev && prev.role === role) {
        prev.parts.push(...parts);
      } else {
        contents.push({ role, parts });
      }
    }

    const { profile, effort, activeLevel, effective, allowSampling } =
      resolveRequestExecutionContext(req, 'gemini');

    const generationConfig: Record<string, unknown> = {};
    if (allowSampling) {
      if (effective.temperature !== undefined) generationConfig.temperature = effective.temperature;
      if (effective.topP !== undefined) generationConfig.topP = effective.topP;
      if (effective.presencePenalty !== undefined) {
        generationConfig.presencePenalty = effective.presencePenalty;
      }
      if (effective.frequencyPenalty !== undefined) {
        generationConfig.frequencyPenalty = effective.frequencyPenalty;
      }
    }
    if (effective.maxTokens !== undefined) generationConfig.maxOutputTokens = effective.maxTokens;
    if (effective.seed !== undefined) generationConfig.seed = effective.seed;
    if (effective.stop && effective.stop.length > 0) generationConfig.stopSequences = effective.stop;

    if (profile.strategy === 'gemini-budget') {
      const budget =
        effective.thinkingBudget !== undefined
          ? effective.thinkingBudget
          : activeLevel?.budgetTokens ?? resolveThinkingBudget(effort);
      if (budget === 0) {
        generationConfig.thinkingConfig = {
          includeThoughts: false,
          thinkingBudget: 0,
        };
      } else {
        generationConfig.thinkingConfig = {
          includeThoughts: true,
          thinkingBudget: budget,
        };
      }
    } else if (profile.strategy === 'gemini-level') {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: activeLevel?.apiValue ?? effort,
      };
    }

    let payload: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (req.systemPrompt.trim()) {
      payload.systemInstruction = {
        parts: [{ text: req.systemPrompt.trim() }],
      };
    }

    payload = deepMergePayload(payload, effective.extraBody);

    const headers = buildEffectiveProviderHeaders(req.provider, {
      includeContentType: true,
      sessionId: req.sessionId,
    });

    await streamSseJsonEvents(
      {
        url: endpoint,
        headers,
        body: JSON.stringify(payload),
        signal,
        onDone: callbacks.onDone,
      },
      (_eventName, parsed) => {
        if (parsed.error && typeof parsed.error === 'object') {
          const err = parsed.error as { message?: string };
          throw new Error(err.message || 'Gemini API 返回错误');
        }

        const candidates = parsed.candidates as
          | Array<{
              content?: {
                parts?: Array<{ text?: string; thought?: boolean }>;
              };
            }>
          | undefined;

        const promptFeedback = parsed.promptFeedback as { blockReason?: string } | undefined;
        if (promptFeedback?.blockReason && (!Array.isArray(candidates) || candidates.length === 0)) {
          throw new Error(`Gemini 拦截了请求 (${promptFeedback.blockReason})`);
        }

        const parts = candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part.text !== 'string' || part.text.length === 0) continue;
            if (part.thought) {
              callbacks.onReasoningDelta(part.text);
            } else {
              callbacks.onTextDelta(part.text);
            }
          }
        }

        const usage = parsed.usageMetadata as
          | {
              promptTokenCount?: number;
              candidatesTokenCount?: number;
              thoughtsTokenCount?: number;
              totalThoughtTokens?: number;
              totalTokenCount?: number;
            }
          | undefined;
        if (usage) {
          callbacks.onUsage?.({
            inputTokens: usage.promptTokenCount,
            outputTokens: usage.candidatesTokenCount,
            reasoningTokens: usage.thoughtsTokenCount ?? usage.totalThoughtTokens,
            totalTokens: usage.totalTokenCount,
          });
        }
      }
    );
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const json = await fetchJsonWithAuth<{
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    }>({
      url: buildProtocolModelsUrl('gemini', provider.baseUrl, { geminiPageSize: 1000 }),
      provider,
      sessionPrefix: 'models',
      signal,
    });
    return (json.models ?? [])
      .filter(
        (m) =>
          !m.supportedGenerationMethods ||
          m.supportedGenerationMethods.includes('generateContent')
      )
      .map((m) => toModelDefinition(normalizeGeminiModel(m.name), m.displayName))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
