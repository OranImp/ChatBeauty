import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, ProviderConfig } from '@/types/chat';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';

const mockStreamRequest = vi.fn();
const mockSimpleRequest = vi.fn();

vi.mock('@/services/transport/streamHttp', () => ({
  streamRequest: (...args: unknown[]) => mockStreamRequest(...args),
  simpleRequest: (...args: unknown[]) => mockSimpleRequest(...args),
  getRuntimeEnvironment: () => 'electron',
}));

import { getProviderAdapter } from '@/services/llm/registry';
import { BUILTIN_REASONING_PROFILES } from '@/services/llm/modelProfiles';

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
    mockSimpleRequest.mockReset();
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
    const antPayload = JSON.parse(callArg.body) as Record<string, unknown>;
    expect(callArg.url).toBe('https://api.anthropic.com/v1/messages');
    expect(antPayload.temperature).toBeUndefined();
    expect(antPayload.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    expect(reasoning).toBe('先分析');
    expect(text).toBe('结论');
    expect(usage).toEqual({
      inputTokens: 18,
      outputTokens: 7,
      totalTokens: 25,
    });
  });

  it('respects reasoningEffort: off across Responses (GPT-5.2), Gemini 2.5 Flash, and Anthropic adapters', async () => {
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
          defaultModel: 'gpt-5.2',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gpt-5.2',
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
    expect(respPayload.reasoning).toEqual({ effort: 'none' });

    await getProviderAdapter('gemini').chatStream(
      {
        provider: {
          id: 'p3',
          name: 'Gemini',
          protocol: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIzaTest',
          defaultModel: 'gemini-2.5-flash',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gemini-2.5-flash',
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
    expect(gemPayload.generationConfig.thinkingConfig).toEqual({
      includeThoughts: false,
      thinkingBudget: 0,
    });

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
    expect(antPayload.top_p).toBeUndefined();
  });

  it('applies series-specific effort, Gemini 3 thinkingLevel, and layered custom model/conversation extraBody', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: [DONE]\n\n');
    });

    // 1) OpenAI Chat with gpt-5.2 xhigh -> max_completion_tokens + reasoning_effort: xhigh + extraBody
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          id: 'p1',
          name: 'OpenAI',
          protocol: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          defaultModel: 'gpt-5.2',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gpt-5.2',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'xhigh' },
        modelParams: { seed: 42, extraBody: { store: false } },
        conversationParams: { maxTokens: 4096, extraBody: { metadata: { tab: 'math' } } },
        reasoningProfile: BUILTIN_REASONING_PROFILES['openai-gpt5-xhigh'],
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const chatBody = JSON.parse(
      (mockStreamRequest.mock.calls[0][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(chatBody.max_completion_tokens).toBe(4096);
    expect(chatBody.max_tokens).toBeUndefined();
    expect(chatBody.reasoning_effort).toBe('xhigh');
    expect(chatBody.temperature).toBeUndefined();
    expect(chatBody.seed).toBe(42);
    expect(chatBody.store).toBe(false);
    expect(chatBody.metadata).toEqual({ tab: 'math' });

    // 2) OpenAI Responses on o3 downgrades 'off' -> 'low'
    await getProviderAdapter('openai-responses').chatStream(
      {
        provider: {
          id: 'p2',
          name: 'OpenAI Resp',
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
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const o3Body = JSON.parse(
      (mockStreamRequest.mock.calls[1][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(o3Body.reasoning).toEqual({ effort: 'low', summary: 'auto' });

    // 3) Gemini 3 Flash sends thinkingLevel & merges generationConfig extraBody
    await getProviderAdapter('gemini').chatStream(
      {
        provider: {
          id: 'p3',
          name: 'Gemini',
          protocol: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIza',
          defaultModel: 'gemini-3-flash',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gemini-3-flash',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'minimal' },
        conversationParams: {
          extraBody: { generationConfig: { candidateCount: 1 } },
        },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const gem3Body = JSON.parse(
      (mockStreamRequest.mock.calls[2][0] as { body: string }).body
    ) as { generationConfig: Record<string, unknown> };
    expect(gem3Body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'minimal',
    });
    expect(gem3Body.generationConfig.candidateCount).toBe(1);

    // 4) Anthropic respects custom thinkingBudget override & stop_sequences
    await getProviderAdapter('anthropic').chatStream(
      {
        provider: {
          id: 'p4',
          name: 'Anthropic',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant',
          defaultModel: 'claude-sonnet-4-5',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'claude-sonnet-4-5',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, maxTokens: 4096, reasoningEffort: 'medium' },
        modelParams: { thinkingBudget: 12000, stop: ['DONE'] },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const antBody = JSON.parse(
      (mockStreamRequest.mock.calls[3][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(antBody.thinking).toEqual({ type: 'enabled', budget_tokens: 12000 });
    expect(antBody.max_tokens).toBe(13024);
    expect(antBody.stop_sequences).toEqual(['DONE']);
  });

  it('supports 2026 frontier models: GPT-6 Astra, DeepSeek V4, Claude 4.6/5.5 Adaptive Thinking, and Gemini 4 Carbon', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: [DONE]\n\n');
    });

    // 1) OpenAI Chat with gpt-6.2-astra -> max_completion_tokens, reasoning_effort: max, no temperature/top_p
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          id: 'p1',
          name: 'OpenAI',
          protocol: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          defaultModel: 'gpt-6.2-astra',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gpt-6.2-astra',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'max' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const astraBody = JSON.parse(
      (mockStreamRequest.mock.calls[0][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(astraBody.max_completion_tokens).toBe(8192);
    expect(astraBody.max_tokens).toBeUndefined();
    expect(astraBody.reasoning_effort).toBe('max');
    expect(astraBody.temperature).toBeUndefined();
    expect(astraBody.top_p).toBeUndefined();

    // 2) DeepSeek V4 Pro: high reasoning vs disabled on off
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          id: 'p1b',
          name: 'DeepSeek',
          protocol: 'openai-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-ds',
          defaultModel: 'deepseek-v4-pro',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'deepseek-v4-pro',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'high' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const dsHigh = JSON.parse(
      (mockStreamRequest.mock.calls[1][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(dsHigh.thinking).toEqual({ type: 'enabled' });
    expect(dsHigh.reasoning_effort).toBe('high');

    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          id: 'p1b',
          name: 'DeepSeek',
          protocol: 'openai-chat',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-ds',
          defaultModel: 'deepseek-v4-pro',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'deepseek-v4-pro',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const dsOff = JSON.parse(
      (mockStreamRequest.mock.calls[2][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(dsOff.thinking).toEqual({ type: 'disabled' });
    expect(dsOff.reasoning_effort).toBeUndefined();

    // 3) Anthropic Claude Sonnet 5.5 -> Adaptive Thinking + output_config, NO sampling even when off
    const antProvider: ProviderConfig = {
      id: 'p4',
      name: 'Anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant',
      defaultModel: 'claude-sonnet-5-5',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProvider,
        modelId: 'claude-sonnet-5-5',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'xhigh' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const c55Active = JSON.parse(
      (mockStreamRequest.mock.calls[3][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(c55Active.thinking).toEqual({ type: 'adaptive' });
    expect(c55Active.output_config).toEqual({ effort: 'xhigh' });
    expect(c55Active.temperature).toBeUndefined();
    expect(c55Active.top_p).toBeUndefined();

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProvider,
        modelId: 'claude-sonnet-5-5',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const c55Off = JSON.parse(
      (mockStreamRequest.mock.calls[4][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(c55Off.thinking).toBeUndefined();
    expect(c55Off.output_config).toBeUndefined();
    expect(c55Off.temperature).toBeUndefined();
    expect(c55Off.top_p).toBeUndefined();

    // 4) Anthropic Claude Sonnet 4.6 -> Adaptive when active, allows temperature when off
    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProvider,
        modelId: 'claude-sonnet-4-6',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'high' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const c46Active = JSON.parse(
      (mockStreamRequest.mock.calls[5][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(c46Active.thinking).toEqual({ type: 'adaptive' });
    expect(c46Active.output_config).toEqual({ effort: 'high' });

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProvider,
        modelId: 'claude-sonnet-4-6',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const c46Off = JSON.parse(
      (mockStreamRequest.mock.calls[6][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(c46Off.thinking).toBeUndefined();
    expect(c46Off.temperature).toBe(0.7);

    // 5) Gemini 4 Carbon -> thinkingLevel: xhigh (no thinkingBudget) + totalThoughtTokens usage fallback
    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'data: {"candidates":[{"content":{"parts":[{"text":"推理","thought":true},{"text":"答案"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":6,"totalThoughtTokens":12,"totalTokenCount":28}}\n\n'
      );
    });
    let gemUsage: unknown;
    await getProviderAdapter('gemini').chatStream(
      {
        provider: {
          id: 'p3',
          name: 'Gemini',
          protocol: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIza',
          defaultModel: 'gemini-4-carbon',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gemini-4-carbon',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'xhigh' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {}, onUsage: (u) => (gemUsage = u) },
      new AbortController().signal
    );
    const gem4Body = JSON.parse(
      (mockStreamRequest.mock.calls[7][0] as { body: string }).body
    ) as { generationConfig: Record<string, unknown> };
    expect(gem4Body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'xhigh',
    });
    expect(gemUsage).toEqual({
      inputTokens: 10,
      outputTokens: 6,
      reasoningTokens: 12,
      totalTokens: 28,
    });
  });

  it('prevents Anthropic temperature+top_p conflict, strips /messages on listModels, and surfaces Responses API top-level error messages', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: [DONE]\n\n');
    });

    const antProvider: ProviderConfig = {
      id: 'p4',
      name: 'Anthropic',
      protocol: 'anthropic',
      baseUrl: 'https://relay.example.com/v1/messages',
      apiKey: 'sk-ant',
      defaultModel: 'claude-3-5-sonnet-20241022',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProvider,
        modelId: 'claude-3-5-sonnet-20241022',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
        conversationParams: { topP: 0.8 },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const antTopPOnly = JSON.parse(
      (mockStreamRequest.mock.calls[0][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(antTopPOnly.top_p).toBe(0.8);
    expect(antTopPOnly.temperature).toBeUndefined();

    mockSimpleRequest.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] }),
    });
    const models = await getProviderAdapter('anthropic').listModels?.(antProvider);
    expect(mockSimpleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://relay.example.com/v1/models' })
    );
    expect(models?.[0]?.id).toBe('claude-sonnet-5-5');

    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'event: error\ndata: {"type":"error","code":"invalid_request","message":"Top-level Responses API failure"}\n\n'
      );
    });
    await expect(
      getProviderAdapter('openai-responses').chatStream(
        {
          provider: {
            id: 'p2',
            name: 'OpenAI',
            protocol: 'openai-responses',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'sk-resp',
            defaultModel: 'gpt-6.2-sol',
            models: [],
            enabled: true,
            createdAt: 1,
          },
          modelId: 'gpt-6.2-sol',
          systemPrompt: '',
          messages: userMessages,
          generation: DEFAULT_GENERATION_SETTINGS,
        },
        { onReasoningDelta: () => {}, onTextDelta: () => {} },
        new AbortController().signal
      )
    ).rejects.toThrow('Top-level Responses API failure');
  });
});
