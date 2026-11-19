import type { ModelDefinition, ProviderConfig } from '@/types/chat';
import type { ChatStreamCallbacks, ChatStreamRequest, LLMProviderAdapter } from '@/types/provider';
import { SSEParser } from '@/services/llm/sseParser';
import { simpleRequest, streamRequest } from '@/services/transport/streamHttp';
import {
  extractDataUrlParts,
  extractTextFromParts,
  isModelReasoningCapable,
  sliceContextMessages,
  toModelDefinition,
  trimBaseUrl,
} from './shared';

function normalizeGeminiModel(modelId: string): string {
  return modelId.replace(/^models\//, '');
}

function buildGeminiStreamEndpoint(baseUrl: string, modelId: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  const model = encodeURIComponent(normalizeGeminiModel(modelId));
  return `${clean}/models/${model}:streamGenerateContent?alt=sse`;
}

function buildGeminiModelsEndpoint(baseUrl: string): string {
  const clean = trimBaseUrl(baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
  return `${clean}/models`;
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

    const generationConfig: Record<string, unknown> = {
      temperature: req.generation.temperature,
      topP: req.generation.topP,
      maxOutputTokens: req.generation.maxTokens,
    };

    if (
      isModelReasoningCapable(req.modelId, req.provider.models) &&
      req.generation.reasoningBudgetTokens > 0
    ) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: req.generation.reasoningBudgetTokens,
      };
    }

    const payload: Record<string, unknown> = {
      contents,
      generationConfig,
    };

    if (req.systemPrompt.trim()) {
      payload.systemInstruction = {
        parts: [{ text: req.systemPrompt.trim() }],
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': req.provider.apiKey.trim(),
      ...req.provider.extraHeaders,
    };

    const parser = new SSEParser();

    const handleData = (raw: string) => {
      if (raw === '[DONE]') return;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

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
            totalTokenCount?: number;
          }
        | undefined;
      if (usage) {
        callbacks.onUsage?.({
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          reasoningTokens: usage.thoughtsTokenCount,
          totalTokens: usage.totalTokenCount,
        });
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
          handleData(evt.data);
        }
      },
    });

    for (const evt of parser.flush()) {
      handleData(evt.data);
    }

    callbacks.onDone?.();
  }

  async listModels(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]> {
    const res = await simpleRequest({
      url: buildGeminiModelsEndpoint(provider.baseUrl),
      method: 'GET',
      headers: {
        'x-goog-api-key': provider.apiKey.trim(),
        ...provider.extraHeaders,
      },
      signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`拉取模型失败 (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
    }
    const json = JSON.parse(res.body) as {
      models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
    };
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
