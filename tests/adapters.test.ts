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

import {
  getProviderAdapter,
  PROTOCOL_TEMPLATES,
  PROVIDER_BRAND_PRESETS,
} from '@/services/llm/registry';
import {
  AUTO_SESSION_HEADER_PLACEHOLDER,
  buildPreviewHeadersJson,
  extractExtraHeadersFromPreviewJson,
  getModelDisplayName,
  hasCustomModelDisplayName,
  toStableSessionId,
} from '@/services/llm/adapters/shared';
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
      expect.objectContaining({ url: 'https://relay.example.com/v1/models?limit=1000' })
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

  it('serializes multimodal image + text and image-only user messages across all 4 adapters', async () => {
    mockStreamRequest.mockImplementation(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: [DONE]\n\n');
    });

    const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const sampleDataUrl = `data:image/png;base64,${sampleBase64}`;

    const multiMsgs: Message[] = [
      {
        id: 'm_img_text',
        conversationId: 'c1',
        role: 'user',
        parts: [
          { type: 'image', mimeType: 'image/png', dataUrl: sampleDataUrl, alt: 'circuit.png' },
          { type: 'text', text: '分析这张电路图' },
        ],
        createdAt: 1,
        updatedAt: 1,
        status: 'done',
      },
      {
        id: 'm_img_only',
        conversationId: 'c1',
        role: 'user',
        parts: [{ type: 'image', mimeType: 'image/png', dataUrl: sampleDataUrl, alt: 'only.png' }],
        createdAt: 2,
        updatedAt: 2,
        status: 'done',
      },
    ];

    // 1) OpenAI Chat
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          id: 'p1',
          name: 'OpenAI',
          protocol: 'openai-chat',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          defaultModel: 'gpt-6.2-sol',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gpt-6.2-sol',
        systemPrompt: '',
        messages: multiMsgs,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const chatBody = JSON.parse(
      (mockStreamRequest.mock.calls[0][0] as { body: string }).body
    ) as { messages: Array<{ role: string; content: unknown }> };
    expect(chatBody.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '分析这张电路图' },
          { type: 'image_url', image_url: { url: sampleDataUrl } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: sampleDataUrl } }],
      },
    ]);

    // 2) OpenAI Responses
    await getProviderAdapter('openai-responses').chatStream(
      {
        provider: {
          id: 'p2',
          name: 'Responses',
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
        messages: multiMsgs,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const respBody = JSON.parse(
      (mockStreamRequest.mock.calls[1][0] as { body: string }).body
    ) as { input: Array<{ role: string; content: unknown }> };
    expect(respBody.input).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '分析这张电路图' },
          { type: 'input_image', image_url: sampleDataUrl },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_image', image_url: sampleDataUrl }],
      },
    ]);

    // 3) Gemini
    await getProviderAdapter('gemini').chatStream(
      {
        provider: {
          id: 'p3',
          name: 'Gemini',
          protocol: 'gemini',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
          apiKey: 'AIza',
          defaultModel: 'gemini-4-neon',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'gemini-4-neon',
        systemPrompt: '',
        messages: multiMsgs,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const gemBody = JSON.parse(
      (mockStreamRequest.mock.calls[2][0] as { body: string }).body
    ) as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> };
    expect(gemBody.contents[0].parts).toEqual([
      { text: '分析这张电路图' },
      { inlineData: { mimeType: 'image/png', data: sampleBase64 } },
      { inlineData: { mimeType: 'image/png', data: sampleBase64 } },
    ]);

    // 4) Anthropic
    await getProviderAdapter('anthropic').chatStream(
      {
        provider: {
          id: 'p4',
          name: 'Anthropic',
          protocol: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: 'sk-ant',
          defaultModel: 'claude-sonnet-5-5',
          models: [],
          enabled: true,
          createdAt: 1,
        },
        modelId: 'claude-sonnet-5-5',
        systemPrompt: '',
        messages: multiMsgs,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );
    const antBody = JSON.parse(
      (mockStreamRequest.mock.calls[3][0] as { body: string }).body
    ) as { messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };
    expect(antBody.messages[0].content).toEqual([
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: sampleBase64 },
      },
      { type: 'text', text: '分析这张电路图' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: sampleBase64 },
      },
    ]);
  });

  it('defines valid CC-Switch brand presets with unique ids and complete metadata', () => {
    expect(PROVIDER_BRAND_PRESETS.length).toBeGreaterThanOrEqual(11);
    const ids = new Set<string>();
    for (const preset of PROVIDER_BRAND_PRESETS) {
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
      expect(Object.keys(PROTOCOL_TEMPLATES)).toContain(preset.protocol);
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(preset.suggestedModels.length).toBeGreaterThan(0);
      expect(preset.suggestedModels.some((m) => m.id === preset.defaultModel)).toBe(true);
    }
    const opencodeGo = PROVIDER_BRAND_PRESETS.find((p) => p.id === 'opencode-go');
    expect(opencodeGo).toBeDefined();
    expect(opencodeGo?.baseUrl).toContain('opencode.ai');
  });

  it('generates deterministic per-conversation session IDs via toStableSessionId', () => {
    const a1 = toStableSessionId('conv-alpha');
    const a2 = toStableSessionId('conv-alpha');
    const b1 = toStableSessionId('conv-beta');
    const empty = toStableSessionId('');
    expect(a1).toBe(a2);
    expect(a1).toMatch(/^ses_/);
    expect(b1).toMatch(/^ses_/);
    expect(a1).not.toBe(b1);
    expect(empty).toMatch(/^ses_/);
  });

  it('automatically injects fixed x-opencode-session and x-opencode-client for OpenCode Go across protocols while honoring overrides', async () => {
    mockStreamRequest.mockResolvedValue({ status: 200, headers: {}, bodyText: '' });

    const opencodePresetProvider: ProviderConfig = {
      id: 'p-oc-go',
      name: 'OpenCode Go',
      presetId: 'opencode-go',
      protocol: 'openai-chat',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'oc-secret-key',
      defaultModel: 'kimi-k3',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    const fixedSession = toStableSessionId('chat-room-42');
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: opencodePresetProvider,
        modelId: 'kimi-k3',
        systemPrompt: '',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
        sessionId: fixedSession,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const openAiReq = mockStreamRequest.mock.calls[0][0] as { headers: Record<string, string> };
    expect(openAiReq.headers['x-opencode-session']).toBe(fixedSession);
    expect(openAiReq.headers['x-opencode-client']).toBe('chatbeauty');
    expect(openAiReq.headers['Authorization']).toBe('Bearer oc-secret-key');

    // Also match custom providers without presetId that point to opencode.ai on Anthropic protocol
    const customOpenCodeAnthropic: ProviderConfig = {
      id: 'p-oc-custom',
      name: 'Custom OpenCode Claude',
      protocol: 'anthropic',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'oc-ant-key',
      defaultModel: 'claude-sonnet-4-5',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    await getProviderAdapter('anthropic').chatStream(
      {
        provider: customOpenCodeAnthropic,
        modelId: 'claude-sonnet-4-5',
        systemPrompt: '',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
        sessionId: fixedSession,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const antReq = mockStreamRequest.mock.calls[1][0] as { headers: Record<string, string> };
    expect(antReq.headers['x-opencode-session']).toBe(fixedSession);
    expect(antReq.headers['x-api-key']).toBe('oc-ant-key');

    // User extraHeaders override should take precedence over generated sessionId
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: {
          ...opencodePresetProvider,
          extraHeaders: { 'x-opencode-session': 'ses_explicit_override' },
        },
        modelId: 'kimi-k3',
        systemPrompt: '',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
        sessionId: fixedSession,
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {} },
      new AbortController().signal
    );

    const overrideReq = mockStreamRequest.mock.calls[2][0] as { headers: Record<string, string> };
    expect(overrideReq.headers['x-opencode-session']).toBe('ses_explicit_override');
  });

  it('syncs live preview headers JSON from provider fields while keeping only custom/overridden entries in extraHeaders', () => {
    const baseOpenAi: ProviderConfig = {
      id: 'p-live',
      name: 'Live Test',
      protocol: 'openai-chat',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-first',
      defaultModel: 'gpt-4o',
      models: [],
      enabled: true,
      createdAt: 1,
    };

    const preview1 = JSON.parse(buildPreviewHeadersJson(baseOpenAi)) as Record<string, string>;
    expect(preview1['Content-Type']).toBe('application/json');
    expect(preview1['Authorization']).toBe('Bearer sk-first');

    // Add a custom header alongside untouched defaults -> extraction omits untouched defaults
    const editedJson = JSON.stringify({ ...preview1, 'X-Custom-Routing': 'canary' }, null, 2);
    const extractedCustom = extractExtraHeadersFromPreviewJson(editedJson, baseOpenAi);
    expect(extractedCustom).toEqual({ 'X-Custom-Routing': 'canary' });

    // Switching protocol + apiKey + opencode.ai updates defaults live while preserving X-Custom-Routing
    const switchedProvider: ProviderConfig = {
      ...baseOpenAi,
      protocol: 'anthropic',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-ant-second',
    };
    const preview2 = JSON.parse(
      buildPreviewHeadersJson(switchedProvider, extractedCustom)
    ) as Record<string, string>;
    expect(preview2['x-api-key']).toBe('sk-ant-second');
    expect(preview2['Authorization']).toBeUndefined();
    expect(preview2['x-opencode-session']).toBe(AUTO_SESSION_HEADER_PLACEHOLDER);
    expect(preview2['X-Custom-Routing']).toBe('canary');

    // Placeholder session header must not pollute persisted extraHeaders
    const extractedAfterSwitch = extractExtraHeadersFromPreviewJson(
      JSON.stringify(preview2, null, 2),
      switchedProvider
    );
    expect(extractedAfterSwitch).toEqual({ 'X-Custom-Routing': 'canary' });
  });

  it('handles Wave 2 regressions: Anthropic cache tokens, Gemini leading model/blockReason, Chat reasoning alias & Responses refusal/incomplete', async () => {
    // 1. Anthropic sums input_tokens + cache_creation_input_tokens + cache_read_input_tokens
    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":100,"cache_creation_input_tokens":40,"cache_read_input_tokens":60}}}\n\n' +
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}\n\n' +
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      );
    });
    const antProv: ProviderConfig = {
      id: 'p-ant-cache',
      name: 'Ant',
      protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant',
      defaultModel: 'claude-sonnet-4-6',
      models: [],
      enabled: true,
      createdAt: 1,
    };
    let antUsage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    await getProviderAdapter('anthropic').chatStream(
      {
        provider: antProv,
        modelId: 'claude-sonnet-4-6',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'off' },
      },
      { onReasoningDelta: () => {}, onTextDelta: () => {}, onUsage: (u) => (antUsage = u) },
      new AbortController().signal
    );
    expect(antUsage).toEqual({ inputTokens: 200, outputTokens: 25, totalTokens: 225 });

    // 2. Gemini strips leading model turn and surfaces promptFeedback.blockReason
    const leadingModelMsgs: Message[] = [
      {
        id: 'm0',
        conversationId: 'c1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'stale assistant intro' }],
        createdAt: 0,
        updatedAt: 0,
        status: 'done',
      },
      ...userMessages,
    ];
    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk('data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n');
    });
    const gemProv: ProviderConfig = {
      id: 'p-gem',
      name: 'Gemini',
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'AIza',
      defaultModel: 'gemini-2.5-pro',
      models: [],
      enabled: true,
      createdAt: 1,
    };
    await expect(
      getProviderAdapter('gemini').chatStream(
        {
          provider: gemProv,
          modelId: 'gemini-2.5-pro',
          systemPrompt: '',
          messages: leadingModelMsgs,
          generation: DEFAULT_GENERATION_SETTINGS,
        },
        { onReasoningDelta: () => {}, onTextDelta: () => {} },
        new AbortController().signal
      )
    ).rejects.toThrow(/SAFETY/);

    const gemSentBody = JSON.parse(
      (mockStreamRequest.mock.calls[1][0] as { body: string }).body
    ) as { contents: Array<{ role: string }> };
    expect(gemSentBody.contents[0].role).toBe('user');

    // 3. OpenAI Chat parses delta.reasoning alias and maps aggregator anthropic/gemini reasoning_effort
    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'data: {"choices":[{"delta":{"reasoning":"relay thought"}}]}\n\n' +
          'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n' +
          'data: [DONE]\n\n'
      );
    });
    const relayProv: ProviderConfig = {
      id: 'p-relay',
      name: 'Relay',
      protocol: 'openai-chat',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-relay',
      defaultModel: 'claude-opus-4-6',
      models: [],
      enabled: true,
      createdAt: 1,
    };
    let relayReasoning = '';
    await getProviderAdapter('openai-chat').chatStream(
      {
        provider: relayProv,
        modelId: 'claude-opus-4-6',
        systemPrompt: '',
        messages: userMessages,
        generation: { ...DEFAULT_GENERATION_SETTINGS, reasoningEffort: 'high' },
      },
      { onReasoningDelta: (d) => (relayReasoning += d), onTextDelta: () => {} },
      new AbortController().signal
    );
    expect(relayReasoning).toBe('relay thought');
    const relayBody = JSON.parse(
      (mockStreamRequest.mock.calls[2][0] as { body: string }).body
    ) as Record<string, unknown>;
    expect(relayBody.reasoning_effort).toBe('high');

    // 4. OpenAI Responses handles response.refusal.delta and response.incomplete usage
    mockStreamRequest.mockImplementationOnce(async (opts: { onChunk: (c: string) => void }) => {
      opts.onChunk(
        'event: response.refusal.delta\ndata: {"type":"response.refusal.delta","delta":"Cannot comply"}\n\n' +
          'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"usage":{"input_tokens":50,"output_tokens":12,"total_tokens":62}}}\n\n'
      );
    });
    const respProv: ProviderConfig = {
      id: 'p-resp',
      name: 'OpenAI',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-resp',
      defaultModel: 'gpt-6.2-sol',
      models: [],
      enabled: true,
      createdAt: 1,
    };
    let respText = '';
    let respUsage: unknown;
    await getProviderAdapter('openai-responses').chatStream(
      {
        provider: respProv,
        modelId: 'gpt-6.2-sol',
        systemPrompt: '',
        messages: userMessages,
        generation: DEFAULT_GENERATION_SETTINGS,
      },
      { onReasoningDelta: () => {}, onTextDelta: (d) => (respText += d), onUsage: (u) => (respUsage = u) },
      new AbortController().signal
    );
    expect(respText).toBe('Cannot comply');
    expect(respUsage).toEqual({
      inputTokens: 50,
      outputTokens: 12,
      reasoningTokens: undefined,
      totalTokens: 62,
    });
  });

  it('resolves custom model display names cleanly while falling back to model ID', () => {
    expect(getModelDisplayName({ id: 'gpt-6.2-sol', name: 'Sol 主力' })).toBe('Sol 主力');
    expect(hasCustomModelDisplayName({ id: 'gpt-6.2-sol', name: 'Sol 主力' })).toBe(true);

    expect(getModelDisplayName({ id: 'gpt-6.2-sol', name: '   ' })).toBe('gpt-6.2-sol');
    expect(hasCustomModelDisplayName({ id: 'gpt-6.2-sol', name: '   ' })).toBe(false);

    expect(getModelDisplayName({ id: 'gpt-6.2-sol', name: 'gpt-6.2-sol' })).toBe('gpt-6.2-sol');
    expect(hasCustomModelDisplayName({ id: 'gpt-6.2-sol', name: 'gpt-6.2-sol' })).toBe(false);

    expect(getModelDisplayName(undefined, 'fallback-id')).toBe('fallback-id');
    expect(hasCustomModelDisplayName(undefined)).toBe(false);
  });
});
