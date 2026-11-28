import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import { getRuntimeEnvironment } from '@/services/transport/streamHttp';
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

function buildAnthropicMessagesEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl) || 'https://api.anthropic.com/v1';
  if (clean.endsWith('/messages')) return clean;
  if (clean.endsWith('/v1')) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

export class AnthropicAdapter implements LLMProviderAdapter {
  readonly protocol = 'anthropic' as const;

  async chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const endpoint = buildAnthropicMessagesEndpoint(req.provider.baseUrl);
    const contextMsgs = sliceContextMessages(req.messages, req.generation.maxContextMessages);

    const apiMessages: Array<{
      role: 'user' | 'assistant';
      content: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of contextMsgs) {
      const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
      // Anthropic requires the conversation to begin with a user turn; skip before parsing images
      if (apiMessages.length === 0 && role !== 'user') continue;
      const blocks: Array<Record<string, unknown>> = [];

      for (const img of msg.parts) {
        if (img.type === 'image' && img.dataUrl) {
          const parsed = extractDataUrlParts(img.dataUrl);
          if (parsed) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: parsed.mimeType,
                data: parsed.base64,
              },
            });
          }
        }
      }

      const text = extractTextFromParts(msg.parts);
      if (text) blocks.push({ type: 'text', text });
      if (blocks.length === 0) continue;

      const prev = apiMessages[apiMessages.length - 1];
      if (prev && prev.role === role) {
        prev.content.push(...blocks);
      } else {
        apiMessages.push({ role, content: blocks });
      }
    }

    const { modelParams, profile, effort, activeLevel, effective } =
      resolveRequestExecutionContext(req, 'anthropic');

    let payload: Record<string, unknown> = {
      model: req.modelId,
      messages: apiMessages,
      stream: true,
    };

    if (req.systemPrompt.trim()) {
      payload.system = req.systemPrompt.trim();
    }

    if (effective.stop && effective.stop.length > 0) {
      payload.stop_sequences = effective.stop;
    }

    const baseMaxTokens = effective.maxTokens ?? req.generation.maxTokens ?? 8192;
    let allowSampling = profile.supportsSamplingWhenOff !== false;

    if (profile.strategy === 'anthropic-adaptive') {
      if (effort !== 'off') {
        payload.thinking = { type: 'adaptive' };
        payload.output_config = { effort: activeLevel?.apiValue ?? effort };
        payload.max_tokens = Math.max(baseMaxTokens, 8192);
        allowSampling = false;
      } else {
        payload.max_tokens = baseMaxTokens;
      }
    } else {
      const budget =
        effective.thinkingBudget !== undefined
          ? effective.thinkingBudget
          : activeLevel?.budgetTokens ?? resolveThinkingBudget(effort);
      const thinkingEnabled =
        (profile.strategy === 'anthropic-budget' || profile.strategy === 'openai-effort') &&
        effort !== 'off' &&
        budget >= 1024;

      if (thinkingEnabled) {
        payload.thinking = {
          type: 'enabled',
          budget_tokens: budget,
        };
        payload.max_tokens = Math.max(baseMaxTokens, budget + 1024);
        // Anthropic rejects non-1 temperature and top_p when Extended Thinking is enabled
        allowSampling = false;
      } else {
        payload.max_tokens = baseMaxTokens;
      }
    }

    if (allowSampling) {
      const explicitTopPOverride =
        req.conversationParams?.topP !== undefined || modelParams?.topP !== undefined;
      const topPLayer =
        req.conversationParams?.topP !== undefined
          ? 2
          : modelParams?.topP !== undefined
            ? 1
            : 0;
      const tempLayer =
        req.conversationParams?.temperature !== undefined
          ? 2
          : modelParams?.temperature !== undefined
            ? 1
            : 0;

      // Anthropic Claude 4+ rejects requests specifying both temperature and top_p.
      if (effective.topP !== undefined && explicitTopPOverride && topPLayer > tempLayer) {
        payload.top_p = effective.topP;
      } else if (effective.temperature !== undefined) {
        payload.temperature = effective.temperature;
      } else if (effective.topP !== undefined) {
        payload.top_p = effective.topP;
      }
    }

    payload = deepMergePayload(payload, effective.extraBody);

    const headers = buildEffectiveProviderHeaders(req.provider, {
      includeContentType: true,
      sessionId: req.sessionId,
      isWebRuntime: getRuntimeEnvironment() === 'web',
    });

    let inputTokens = 0;
    let outputTokens = 0;

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

        if (type === 'message_start') {
          const msg = parsed.message as
            | {
                usage?: {
                  input_tokens?: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
                };
              }
            | undefined;
          if (msg?.usage) {
            inputTokens =
              (msg.usage.input_tokens ?? 0) +
              (msg.usage.cache_creation_input_tokens ?? 0) +
              (msg.usage.cache_read_input_tokens ?? 0);
          }
          return;
        }

        if (type === 'content_block_delta') {
          const delta = parsed.delta as
            | { type?: string; text?: string; thinking?: string }
            | undefined;
          if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            callbacks.onReasoningDelta(delta.thinking);
          } else if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            callbacks.onTextDelta(delta.text);
          }
          return;
        }

        if (type === 'message_delta') {
          const usage = parsed.usage as
            | {
                input_tokens?: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
                output_tokens?: number;
              }
            | undefined;
          if (usage) {
            const hasInputUpdate =
              usage.input_tokens !== undefined ||
              usage.cache_creation_input_tokens !== undefined ||
              usage.cache_read_input_tokens !== undefined;
            if (hasInputUpdate) {
              inputTokens =
                (usage.input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0);
            }
            if (usage.output_tokens !== undefined) {
              outputTokens = usage.output_tokens;
              callbacks.onUsage?.({
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
              });
            }
          }
          return;
        }

        if (type === 'error') {
          const err = parsed.error as { message?: string } | undefined;
          throw new Error(err?.message || 'Anthropic API 返回错误');
        }
      }
    );
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const modelsBase = buildProtocolModelsUrl('anthropic', provider.baseUrl);
    const url = `${modelsBase}${modelsBase.includes('?') ? '&' : '?'}limit=1000`;
    const json = await fetchJsonWithAuth<{
      data?: Array<{ id: string; display_name?: string }>;
    }>({
      url,
      provider,
      sessionPrefix: 'models',
      signal,
      isWebRuntime: getRuntimeEnvironment() === 'web',
    });
    return (json.data ?? [])
      .map((item) => toModelDefinition(item.id, item.display_name))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
