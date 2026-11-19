import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import { SSEParser } from '@/services/llm/sseParser';
import { getRuntimeEnvironment, simpleRequest, streamRequest } from '@/services/transport/streamHttp';
import {
  extractDataUrlParts,
  extractTextFromParts,
  isModelReasoningCapable,
  resolveThinkingBudget,
  sliceContextMessages,
  toModelDefinition,
  trimBaseUrl,
} from './shared';

function buildAnthropicEndpoint(baseUrl: string, suffix: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://api.anthropic.com/v1');
  if (clean.endsWith(suffix)) return clean;
  if (clean.endsWith('/v1')) return `${clean}${suffix}`;
  return `${clean}/v1${suffix}`;
}

export class AnthropicAdapter implements LLMProviderAdapter {
  readonly protocol = 'anthropic' as const;

  async chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const endpoint = buildAnthropicEndpoint(req.provider.baseUrl, '/messages');
    const contextMsgs = sliceContextMessages(req.messages, req.generation.maxContextMessages);

    const apiMessages: Array<{
      role: 'user' | 'assistant';
      content: Array<Record<string, unknown>>;
    }> = [];

    for (const msg of contextMsgs) {
      const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
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

    // Anthropic requires the conversation to begin with a user turn
    while (apiMessages.length > 0 && apiMessages[0].role !== 'user') {
      apiMessages.shift();
    }

    const budget = resolveThinkingBudget(req.generation.reasoningEffort);
    const thinkingEnabled =
      isModelReasoningCapable(req.modelId, req.provider.models) && budget >= 1024;

    const payload: Record<string, unknown> = {
      model: req.modelId,
      messages: apiMessages,
      stream: true,
    };

    if (req.systemPrompt.trim()) {
      payload.system = req.systemPrompt.trim();
    }

    if (thinkingEnabled) {
      payload.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
      payload.max_tokens = Math.max(req.generation.maxTokens, budget + 1024);
      // Anthropic rejects non-1 temperature and top_p when Extended Thinking is enabled
    } else {
      payload.max_tokens = req.generation.maxTokens;
      payload.temperature = req.generation.temperature;
      payload.top_p = req.generation.topP;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': req.provider.apiKey.trim(),
      'anthropic-version': '2023-06-01',
      ...(getRuntimeEnvironment() === 'web'
        ? { 'anthropic-dangerous-direct-browser-access': 'true' }
        : {}),
      ...req.provider.extraHeaders,
    };

    const parser = new SSEParser();
    let inputTokens = 0;
    let outputTokens = 0;

    const handleEvent = (eventName: string, rawData: string) => {
      if (rawData === '[DONE]') return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = (typeof parsed.type === 'string' ? parsed.type : eventName) || '';

      if (type === 'message_start') {
        const msg = parsed.message as { usage?: { input_tokens?: number } } | undefined;
        if (msg?.usage?.input_tokens) {
          inputTokens = msg.usage.input_tokens;
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
        const usage = parsed.usage as { output_tokens?: number } | undefined;
        if (usage?.output_tokens !== undefined) {
          outputTokens = usage.output_tokens;
          callbacks.onUsage?.({
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          });
        }
        return;
      }

      if (type === 'error') {
        const err = parsed.error as { message?: string } | undefined;
        throw new Error(err?.message || 'Anthropic API 返回错误');
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
      url: buildAnthropicEndpoint(provider.baseUrl, '/models'),
      method: 'GET',
      headers: {
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': '2023-06-01',
        ...(getRuntimeEnvironment() === 'web'
          ? { 'anthropic-dangerous-direct-browser-access': 'true' }
          : {}),
        ...provider.extraHeaders,
      },
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`拉取模型失败 (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
    }
    const json = JSON.parse(res.body) as {
      data?: Array<{ id: string; display_name?: string }>;
    };
    return (json.data ?? [])
      .map((item) => toModelDefinition(item.id, item.display_name))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
