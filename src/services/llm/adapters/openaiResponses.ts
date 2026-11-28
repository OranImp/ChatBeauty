import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import {
  buildEffectiveProviderHeaders,
  buildProtocolModelsUrl,
  deepMergePayload,
  extractTextFromParts,
  fetchJsonWithAuth,
  resolveRequestExecutionContext,
  sliceContextMessages,
  streamSseJsonEvents,
  toModelDefinition,
  trimBaseUrl,
} from './shared';

function buildResponsesEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl) || 'https://api.openai.com/v1';
  if (clean.endsWith('/responses')) return clean;
  return `${clean}/responses`;
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
          if (blocks.length > 0) {
            input.push({ role: 'user', content: blocks });
          }
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

    const { profile, effort, activeLevel, effective, allowSampling } =
      resolveRequestExecutionContext(req, 'openai-responses');

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

    if (allowSampling) {
      if (effective.temperature !== undefined) payload.temperature = effective.temperature;
      if (effective.topP !== undefined) payload.top_p = effective.topP;
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
      (eventName, parsed) => {
        const type = (typeof parsed.type === 'string' ? parsed.type : eventName) || '';

        if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
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

        if (
          type === 'response.completed' ||
          type === 'response.done' ||
          type === 'response.incomplete'
        ) {
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
      }
    );
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const json = await fetchJsonWithAuth<{ data?: Array<{ id: string }> }>({
      url: buildProtocolModelsUrl('openai-responses', provider.baseUrl),
      provider,
      sessionPrefix: 'models',
      signal,
    });
    return (json.data ?? [])
      .map((item) => toModelDefinition(item.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
