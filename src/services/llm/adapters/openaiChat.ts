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

function buildChatEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl) || 'https://api.openai.com/v1';
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

export class OpenAIChatAdapter implements LLMProviderAdapter {
  readonly protocol = 'openai-chat' as const;

  async chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const endpoint = buildChatEndpoint(req.provider.baseUrl);
    const contextMsgs = sliceContextMessages(req.messages, req.generation.maxContextMessages);

    const apiMessages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | Array<Record<string, unknown>>;
    }> = [];

    if (req.systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: req.systemPrompt.trim() });
    }

    for (const msg of contextMsgs) {
      const text = extractTextFromParts(msg.parts);
      const images = msg.parts.filter((p) => p.type === 'image');

      if (msg.role === 'user' && images.length > 0) {
        const blocks: Array<Record<string, unknown>> = [];
        if (text) blocks.push({ type: 'text', text });
        for (const img of images) {
          const url = img.dataUrl || img.url;
          if (url) blocks.push({ type: 'image_url', image_url: { url } });
        }
        if (blocks.length > 0) {
          apiMessages.push({ role: 'user', content: blocks });
        }
      } else if (text) {
        apiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      }
    }

    const { profile, effort, activeLevel, effective, allowSampling } =
      resolveRequestExecutionContext(req, 'openai-chat');

    const modelLower = req.modelId.toLowerCase();
    const usesMaxCompletionTokens = /(^|\/)(o[134]($|[-._])|gpt-[56]($|[-._]))/.test(modelLower);

    let payload: Record<string, unknown> = {
      model: req.modelId,
      messages: apiMessages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (effective.maxTokens !== undefined) {
      if (usesMaxCompletionTokens) {
        payload.max_completion_tokens = effective.maxTokens;
      } else {
        payload.max_tokens = effective.maxTokens;
      }
    }

    if (allowSampling) {
      if (effective.temperature !== undefined) payload.temperature = effective.temperature;
      if (effective.topP !== undefined) payload.top_p = effective.topP;
    }

    if (effective.presencePenalty !== undefined && allowSampling) {
      payload.presence_penalty = effective.presencePenalty;
    }
    if (effective.frequencyPenalty !== undefined && allowSampling) {
      payload.frequency_penalty = effective.frequencyPenalty;
    }
    if (effective.seed !== undefined) payload.seed = effective.seed;
    if (effective.stop && effective.stop.length > 0) payload.stop = effective.stop;

    if (profile.strategy === 'deepseek-v4') {
      if (effort === 'off') {
        payload.thinking = { type: 'disabled' };
      } else {
        payload.thinking = { type: 'enabled' };
        payload.reasoning_effort = activeLevel?.apiValue ?? effort;
      }
    } else if (profile.strategy === 'openai-effort') {
      if (effort !== 'off' || activeLevel?.apiValue === 'none') {
        payload.reasoning_effort = activeLevel?.apiValue ?? effort;
      }
    } else if (
      profile.strategy === 'anthropic-adaptive' ||
      profile.strategy === 'anthropic-budget' ||
      profile.strategy === 'gemini-level' ||
      profile.strategy === 'gemini-budget'
    ) {
      if (effort !== 'off') {
        payload.reasoning_effort = effort === 'auto' ? 'medium' : effort;
      }
    } else if (profile.strategy === 'toggle-effort') {
      if (effort === 'off') {
        if (/(glm|doubao)/.test(modelLower)) {
          payload.thinking = { type: 'disabled' };
        } else if (/qwen(?:3|4)/.test(modelLower)) {
          payload.enable_thinking = false;
        } else {
          payload.thinking = { type: 'disabled' };
          payload.reasoning_effort = 'none';
        }
      } else {
        payload.reasoning_effort = activeLevel?.apiValue ?? effort;
        if (/(glm|doubao)/.test(modelLower)) {
          payload.thinking = { type: 'enabled' };
        } else if (/qwen(?:3|4)/.test(modelLower)) {
          payload.enable_thinking = true;
        }
      }
    }

    payload = deepMergePayload(payload, effective.extraBody);
    const body = JSON.stringify(payload);

    const headers = buildEffectiveProviderHeaders(req.provider, {
      includeContentType: true,
      sessionId: req.sessionId,
    });

    await streamSseJsonEvents(
      {
        url: endpoint,
        headers,
        body,
        signal,
        onDone: callbacks.onDone,
      },
      (_eventName, parsed) => {
        if (parsed.error && typeof parsed.error === 'object') {
          const errObj = parsed.error as { message?: string };
          throw new Error(errObj.message || 'OpenAI Chat 流返回错误');
        }

        const choices = parsed.choices as
          | Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                reasoning?: string | null;
              };
            }>
          | undefined;

        const delta = choices?.[0]?.delta;
        if (delta) {
          const reasoning = delta.reasoning_content || delta.reasoning;
          if (typeof reasoning === 'string' && reasoning.length > 0) {
            callbacks.onReasoningDelta(reasoning);
          }
          if (typeof delta.content === 'string' && delta.content.length > 0) {
            callbacks.onTextDelta(delta.content);
          }
        }

        const usage = parsed.usage as
          | {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              completion_tokens_details?: { reasoning_tokens?: number };
            }
          | undefined;
        if (
          usage &&
          (typeof usage.prompt_tokens === 'number' ||
            typeof usage.completion_tokens === 'number' ||
            typeof usage.total_tokens === 'number')
        ) {
          callbacks.onUsage?.({
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
            totalTokens: usage.total_tokens,
          });
        }
      }
    );
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const json = await fetchJsonWithAuth<{ data?: Array<{ id: string }> }>({
      url: buildProtocolModelsUrl('openai-chat', provider.baseUrl),
      provider,
      sessionPrefix: 'models',
      signal,
    });
    const list = json.data ?? [];
    return list
      .map((item) => toModelDefinition(item.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
