import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import { SSEParser } from '@/services/llm/sseParser';
import { simpleRequest, streamRequest } from '@/services/transport/streamHttp';
import {
  extractTextFromParts,
  sliceContextMessages,
  toModelDefinition,
  trimBaseUrl,
} from './shared';

function buildChatEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://api.openai.com/v1');
  if (clean.endsWith('/chat/completions')) return clean;
  return `${clean}/chat/completions`;
}

function buildModelsEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://api.openai.com/v1');
  if (clean.endsWith('/chat/completions')) {
    return clean.replace(/\/chat\/completions$/, '/models');
  }
  return `${clean}/models`;
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
        apiMessages.push({ role: 'user', content: blocks });
      } else if (text) {
        apiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
      }
    }

    const body = JSON.stringify({
      model: req.modelId,
      messages: apiMessages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: req.generation.temperature,
      top_p: req.generation.topP,
      max_tokens: req.generation.maxTokens,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.provider.apiKey.trim()}`,
      ...req.provider.extraHeaders,
    };

    const parser = new SSEParser();

    const handleEventData = (raw: string) => {
      if (raw === '[DONE]') return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

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
        const reasoning = delta.reasoning_content ?? delta.reasoning;
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
      if (usage) {
        callbacks.onUsage?.({
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          reasoningTokens: usage.completion_tokens_details?.reasoning_tokens,
          totalTokens: usage.total_tokens,
        });
      }
    };

    await streamRequest({
      url: endpoint,
      method: 'POST',
      headers,
      body,
      signal,
      onChunk: (chunk) => {
        for (const evt of parser.feed(chunk)) {
          handleEventData(evt.data);
        }
      },
    });

    for (const evt of parser.flush()) {
      handleEventData(evt.data);
    }

    callbacks.onDone?.();
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const res = await simpleRequest({
      url: buildModelsEndpoint(provider.baseUrl),
      method: 'GET',
      headers: {
        Authorization: `Bearer ${provider.apiKey.trim()}`,
        ...provider.extraHeaders,
      },
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`拉取模型失败 (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
    }
    const json = JSON.parse(res.body) as { data?: Array<{ id: string }> };
    const list = json.data ?? [];
    return list
      .map((item) => toModelDefinition(item.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
}
