import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ProviderConfig } from '@/types/chat';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';

const mockStreamRequest = vi.fn();

vi.mock('@/services/transport/streamHttp', () => ({
  streamRequest: (...args: unknown[]) => mockStreamRequest(...args),
  simpleRequest: vi.fn(),
  getRuntimeEnvironment: () => 'electron',
}));

import { getProviderAdapter } from '@/services/llm/registry';

const userMessages: Message[] = [
  {
    id: 'm1',
    conversationId: 'c1',
    role: 'user',
    parts: [{ type: 'text', text: '推导全加器' }],
    createdAt: 1,
    updatedAt: 1,
    status: 'done',
  },
];

describe('LLM Protocol Adapters', () => {
  beforeEach(() => {
    mockStreamRequest.mockReset();
  });

  it('parses OpenAI Chat Completions text, reasoning_content, and usage', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"答案："}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"$S=A\\\\oplus B$"}}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n' +
          'data: [DONE]\n\n'
      );
    });

    const provider: ProviderConfig = {
      id: 'p1',
      name: 'OpenAI',
      protocol: 'openai-chat',
      baseUrl: 'https://relay.example.com/v1/',
      apiKey: 'sk-test',
      defaultModel: 'deepseek-reasoner',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    let reasoning = '';
    let text = '';
    let usage: unknown;
    let done = false;

    await getProviderAdapter('openai-chat').chatStream(
      {
        provider,
        modelId: 'deepseek-reasoner',
        systemPrompt: '你是导师',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      {
        onReasoningDelta: (d) => (reasoning += d),
        onTextDelta: (d) => (text += d),
        onUsage: (u) => (usage = u),
        onDone: () => (done = true),
      },
      new AbortController().signal
    );

    expect(mockStreamRequest).toHaveBeenCalledTimes(1);
    const callArg = mockStreamRequest.mock.calls[0][0] as { url: string; body: string };
    expect(callArg.url).toBe('https://relay.example.com/v1/chat/completions');
    expect(reasoning).toBe('思考中');
    expect(text).toBe('答案：$S=A\\oplus B$');
    expect(usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      reasoningTokens: undefined,
      totalTokens: 15,
    });
    expect(done).toBe(true);
  });

  it('parses OpenAI Responses API events and omits temperature for reasoning models', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'event: response.reasoning_summary_text.delta\n' +
          'data: {"type":"response.reasoning_summary_text.delta","delta":"Step1 "}\n\n' +
          'event: response.output_text.delta\n' +
          'data: {"type":"response.output_text.delta","delta":"Output"}\n\n' +
          'event: response.completed\n' +
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":8,"total_tokens":20,"output_tokens_details":{"reasoning_tokens":3}}}}\n\n'
      );
    });

    const provider: ProviderConfig = {
      id: 'p2',
      name: 'OpenAI Responses',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-resp',
      defaultModel: 'o3',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    let reasoning = '';
    let text = '';
    let usage: unknown;

    await getProviderAdapter('openai-responses').chatStream(
      {
        provider,
        modelId: 'o3',
        systemPrompt: 'System',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      {
        onReasoningDelta: (d) => (reasoning += d),
        onTextDelta: (d) => (text += d),
        onUsage: (u) => (usage = u),
      },
      new AbortController().signal
    );

    const callArg = mockStreamRequest.mock.calls[0][0] as { url: string; body: string };
    const payload = JSON.parse(callArg.body) as Record<string, unknown>;
    expect(callArg.url).toBe('https://api.openai.com/v1/responses');
    expect(payload.instructions).toBe('System');
    expect(payload.temperature).toBeUndefined();
    expect(payload.reasoning).toEqual({ effort: 'medium', summary: 'auto' });
    expect(reasoning).toBe('Step1 ');
    expect(text).toBe('Output');
    expect(usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      reasoningTokens: 3,
      totalTokens: 20,
    });
  });

  it('parses Google Gemini SSE thought parts and text parts', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'data: {"candidates":[{"content":{"parts":[{"text":"思路","thought":true},{"text":"正文"}]}}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":4,"thoughtsTokenCount":2,"totalTokenCount":15}}\n\n'
      );
    });

    const provider: ProviderConfig = {
      id: 'p3',
      name: 'Gemini',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIzaTest',
      defaultModel: 'gemini-2.5-pro',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    let reasoning = '';
    let text = '';
    let usage: unknown;

    await getProviderAdapter('gemini').chatStream(
      {
        provider,
        modelId: 'gemini-2.5-pro',
        systemPrompt: '导师',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      {
        onReasoningDelta: (d) => (reasoning += d),
        onTextDelta: (d) => (text += d),
        onUsage: (u) => (usage = u),
      },
      new AbortController().signal
    );

    const callArg = mockStreamRequest.mock.calls[0][0] as {
      url: string;
      headers: Record<string, string>;
    };
    expect(callArg.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse'
    );
    expect(callArg.headers['x-goog-api-key']).toBe('AIzaTest');
    expect(reasoning).toBe('思路');
    expect(text).toBe('正文');
    expect(usage).toEqual({
      inputTokens: 9,
      outputTokens: 4,
      reasoningTokens: 2,
      totalTokens: 15,
    });
  });

  it('parses Anthropic thinking_delta & text_delta and omits temperature when thinking is active', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":18}}}\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"先分析"}}\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"结论"}}\n\n' +
          'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7}}\n\n'
      );
    });

    const provider: ProviderConfig = {
      id: 'p4',
      name: 'Anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-test',
      defaultModel: 'claude-sonnet-4-20250514',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    let reasoning = '';
    let text = '';
    let usage: unknown;

    await getProviderAdapter('anthropic').chatStream(
      {
        provider,
        modelId: 'claude-sonnet-4-20250514',
        systemPrompt: 'Tutor',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      {
        onReasoningDelta: (d) => (reasoning += d),
        onTextDelta: (d) => (text += d),
        onUsage: (u) => (usage = u),
      },
      new AbortController().signal
    );

    const callArg = mockStreamRequest.mock.calls[0][0] as { url: string; body: string };
    const payload = JSON.parse(callArg.body) as Record<string, unknown>;
    expect(callArg.url).toBe('https://api.anthropic.com/v1/messages');
    expect(payload.temperature).toBeUndefined();
    expect(payload.thinking).toEqual({ type: 'enabled', budget_tokens: 6144 });
    expect(reasoning).toBe('先分析');
    expect(text).toBe('结论');
    expect(usage).toEqual({
      inputTokens: 18,
      outputTokens: 7,
      totalTokens: 25,
    });
  });

  it('respects reasoningEffort: off across Responses, Gemini, and Anthropic adapters', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: [DONE]\n\n');
    });

    const offGen = { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' as const };

    await getProviderAdapter('openai-responses').chatStream(
      {
        provider: {
          id: 'p2',
          name: 'OpenAI',
          protocol: 'openai-responses',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-resp',
          defaultModel: 'o3',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'o3',
        systemPrompt: '',
        messages: userMessages,
        generation: offGen,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const respPayload = JSON.parse(
      (mockStreamRequest.mock.calls[0][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(respPayload.reasoning).toBeUndefined();

    await getProviderAdapter('gemini').chatStream(
      {
        provider: {
          id: 'p3',
          name: 'Gemini',
          protocol: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIzaTest',
          defaultModel: 'gemini-2.5-pro',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gemini-2.5-pro',
        systemPrompt: '',
        messages: userMessages,
        generation: offGen,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const gemPayload = JSON.parse(
      (mockStreamRequest.mock.calls[1][0] as { body: string }).body
    ) as { generationConfig: Record<string, unknown> };
    expect(gemPayload.generationConfig.thinkingConfig).toBeUndefined();

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: {
          id: 'p4',
          name: 'Anthropic',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant',
          defaultModel: 'claude-sonnet-4-20250514',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'claude-sonnet-4-20250514',
        systemPrompt: '',
        messages: userMessages,
        generation: offGen,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const antPayload = JSON.parse(
      (mockStreamRequest.mock.calls[2][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(antPayload.thinking).toBeUndefined();
    expect(antPayload.temperature).toBe(0.7);
  });
});
