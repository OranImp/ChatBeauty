import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import { SSEParser } from '@/services/llm/sseParser';
import { simpleRequest, streamRequest } from '@/services/transport/streamHttp';
import {
  buildEffectiveProviderHeaders,
  deepMergePayload,
  extractTextFromParts,
  resolveEffectiveParams,
  sliceContextMessages,
  toModelDefinition,
  toStableSessionId,
  trimBaseUrl,
} from './shared';
import {
  coerceReasoningEffort,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';

function buildResponsesEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://api.openai.com/v1');
  if (clean.endsWith('/responses')) return clean;
  return `${clean}/responses`;
}

function buildModelsEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://api.openai.com/v1');
  if (clean.endsWith('/responses')) {
    return clean.replace(/\/responses$/, '/models');
  }
  return `${clean}/models`;
}

export class OpenAIResponsesAdapter implements LLMProviderAdapter {
  readonly protocol = 'openai-responses' as const;

  async chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const endpoint = buildResponsesEndpoint(req.provider.baseUrl);
    const contextMsgs = sliceContextMessages(req.messages, req.generation.maxContextMessages);

    const input: Array<Record<string, unknown>> = [];

    for (const msg of contextMsgs) {
      const text = extractTextFromParts(msg.parts);
      const images = msg.parts.filter((p) => p.type === 'image');

      if (msg.role === 'user') {
        if (images.length > 0) {
          const blocks: Array<Record<string, unknown>> = [];
          if (text) blocks.push({ type: 'input_text', text });
          for (const img of images) {
            const url = img.dataUrl || img.url;
            if (url) blocks.push({ type: 'input_image', image_url: url });
          }
          input.push({ role: 'user', content: blocks });
        } else if (text) {
          input.push({ role: 'user', content: text });
        }
      } else if (msg.role === 'assistant' && text) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        });
      }
    }

    const modelDef = req.provider.models.find((m) => m.id === req.modelId);
    const modelParams = req.modelParams ?? modelDef?.params;
    const profile =
      req.reasoningProfile ??
      resolveModelReasoningProfile({
        modelId: req.modelId,
        protocol: 'openai-responses',
        modelDef,
      }).profile;
    const effort = coerceReasoningEffort(req.generation.reasoningEffort, profile);
    const activeLevel = profile.levels.find((l) => l.value === effort);
    const effective = resolveEffectiveParams(req.generation, modelParams, req.conversationParams);

    let payload: Record<string, unknown> = {
      model: req.modelId,
      input,
      stream: true,
    };

    if (effective.maxTokens !== undefined) {
      payload.max_output_tokens = effective.maxTokens;
    }

    if (req.systemPrompt.trim()) {
      payload.instructions = req.systemPrompt.trim();
    }

    if (
      profile.strategy === 'openai-effort' ||
      profile.strategy === 'toggle-effort' ||
      profile.strategy === 'deepseek-v4'
    ) {
      if (effort !== 'off') {
        payload.reasoning = {
          effort: activeLevel?.apiValue ?? effort,
          summary: 'auto',
        };
      } else if (profile.strategy !== 'deepseek-v4' && activeLevel?.apiValue === 'none') {
        payload.reasoning = { effort: 'none' };
      }
    }

    const thinkingActive = profile.strategy !== 'none' && effort !== 'off';
    const allowSampling = thinkingActive
      ? profile.supportsSamplingWhenThinking !== false
      : profile.supportsSamplingWhenOff !== false;
    if (allowSampling) {
      if (effective.temperature !== undefined) payload.temperature = effective.temperature;
      if (effective.topP !== undefined) payload.top_p = effective.topP;
    }

    payload = deepMergePayload(payload, effective.extraBody);

    const headers = buildEffectiveProviderHeaders(req.provider, {
      includeContentType: true,
      sessionId: req.sessionId,
    });

    const parser = new SSEParser();

    const handleEvent = (eventName: string, rawData: string) => {
      if (rawData === '[DONE]') return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = (typeof parsed.type === 'string' ? parsed.type : eventName) || '';

      if (type === 'response.output_text.delta') {
        if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
          callbacks.onTextDelta(parsed.delta);
        }
        return;
      }

      if (
        type === 'response.reasoning_summary_text.delta' ||
        type === 'response.reasoning_text.delta' ||
        type === 'response.reasoning.delta'
      ) {
        if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
          callbacks.onReasoningDelta(parsed.delta);
        }
        return;
      }

      if (type === 'response.completed' || type === 'response.done') {
        const resp = parsed.response as
          | {
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                total_tokens?: number;
                output_tokens_details?: { reasoning_tokens?: number };
              };
            }
          | undefined;
        if (resp?.usage) {
          callbacks.onUsage?.({
            inputTokens: resp.usage.input_tokens,
            outputTokens: resp.usage.output_tokens,
            reasoningTokens: resp.usage.output_tokens_details?.reasoning_tokens,
            totalTokens: resp.usage.total_tokens,
          });
        }
        return;
      }

      if (type === 'error' || type === 'response.failed') {
        const err = (parsed.error ||
          (parsed.response as { error?: { message?: string } } | undefined)?.error) as
          | { message?: string }
          | undefined;
        const msg =
          (typeof parsed.message === 'string' && parsed.message) ||
          err?.message ||
          'OpenAI Responses API 返回错误';
        throw new Error(msg);
      }
    };

    await streamRequest({
      url: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
      onChunk: (chunk) => {
        for (const evt of parser.feed(chunk)) {
          handleEvent(evt.event, evt.data);
        }
      },
    });

    for (const evt of parser.flush()) {
      handleEvent(evt.event, evt.data);
    }

    callbacks.onDone?.();
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const res = await simpleRequest({
      url: buildModelsEndpoint(provider.baseUrl),
      method: 'GET',
      headers: buildEffectiveProviderHeaders(provider, {
        includeContentType: false,
        sessionId: toStableSessionId(`models_${provider.id}`),
      }),
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`拉取模型失败 (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
    }
    const json = JSON.parse(res.body) as { data?: Array<{ id: string }> };
    return (json.data ?? [])
      .map((item) => toModelDefinition(item.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
