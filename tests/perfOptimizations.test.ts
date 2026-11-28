// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBlock } from '@/components/renderer/MarkdownBlock';
import {
  canonicalizeLanguage,
  clearHighlightCacheForTests,
  getCachedHighlight,
  highlightCode,
} from '@/components/renderer/shikiHighlighter';
import {
  buildProtocolModelsUrl,
  extractDataUrlParts,
  mergeHeadersCaseInsensitive,
} from '@/services/llm/adapters/shared';
import {
  computeContextUsageStats,
  estimateTokens,
} from '@/services/llm/contextManager';
import { resolveModelReasoningProfile } from '@/services/llm/modelProfiles';
import { SSEParser } from '@/services/llm/sseParser';
import {
  hasSensitiveInfo,
  mergeMemoryEntries,
  retrieveRelevantMemories,
} from '@/services/memory/memoryEngine';
import type { Message } from '@/types/chat';
import type { MemoryEntry } from '@/types/memory';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
} from '@/types/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Wave 2-5 performance & correctness regressions', () => {
  beforeEach(() => {
    clearHighlightCacheForTests();
  });

  it('shikiHighlighter falls back without poisoning valid languages and populates sync LRU cache', async () => {
    expect(canonicalizeLanguage('TS')).toBe('typescript');
    expect(canonicalizeLanguage('plaintext')).toBe('text');

    const unknownHtml = await highlightCode('const x = 1;', 'nonexistent-lang-xyz', 'github-dark-default');
    expect(unknownHtml).toContain('const x = 1;');

    const partialHtml = await highlightCode('def f(): pass', 'pyt', 'github-dark-default');
    expect(partialHtml).toContain('def f(): pass');

    // Subsequent valid language highlights must still succeed with full syntax spans
    const tsCode = 'export const answer: number = 42;';
    const tsHtml = await highlightCode(tsCode, 'ts', 'github-dark-default');
    expect(tsHtml).toContain('<span');
    expect(tsHtml).toContain('answer');

    const pyCode = 'def greet(name: str) -> str:\n    return name';
    const pyHtml = await highlightCode(pyCode, 'python', 'github-dark-default');
    expect(pyHtml).toContain('<span');
    expect(pyHtml).toContain('greet');

    const cachedTs = getCachedHighlight(tsCode, 'ts', 'github-dark-default');
    expect(cachedTs).toBe(tsHtml);
  });

  describe('MarkdownBlock child node stability across streaming updates', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
    });

    afterEach(() => {
      act(() => {
        root.unmount();
      });
      container.remove();
    });

    it('preserves existing <table> DOM identity across streaming deltas and completion', () => {
      const baseTable = '| A | B |\n| - | - |\n| 1 | 2 |\n\nhello';
      const onInspect = vi.fn();

      act(() => {
        root.render(
          createElement(MarkdownBlock, {
            content: baseTable,
            theme: 'dark',
            appearance: DEFAULT_APPEARANCE_SETTINGS,
            isStreaming: true,
            onInspect,
          })
        );
      });

      const firstTable = container.querySelector('table');
      expect(firstTable).not.toBeNull();

      act(() => {
        root.render(
          createElement(MarkdownBlock, {
            content: `${baseTable} world`,
            theme: 'dark',
            appearance: DEFAULT_APPEARANCE_SETTINGS,
            isStreaming: true,
            onInspect,
          })
        );
      });

      expect(container.querySelector('table')).toBe(firstTable);

      act(() => {
        root.render(
          createElement(MarkdownBlock, {
            content: `${baseTable} world!`,
            theme: 'dark',
            appearance: DEFAULT_APPEARANCE_SETTINGS,
            isStreaming: false,
            onInspect,
          })
        );
      });

      expect(container.querySelector('table')).toBe(firstTable);
    });
  });

  it('contextManager estimates tokens consistently and applies calibrated prompt usage', () => {
    expect(estimateTokens('')).toBe(0);
    const ascii = estimateTokens('Hello world from TypeScript');
    const cjk = estimateTokens('你好，请解释量子纠缠与熵增原理');
    const mixed = estimateTokens('function sum(a: number, b: number) { return a + b; } // 求和');
    expect(ascii).toBeGreaterThan(0);
    expect(cjk).toBeGreaterThan(0);
    expect(mixed).toBeGreaterThan(0);

    const messages: Message[] = [
      {
        id: 'u1',
        conversationId: 'c1',
        role: 'user',
        parts: [{ type: 'text', text: 'First question' }],
        createdAt: 1000,
        updatedAt: 1000,
        status: 'done',
      },
      {
        id: 'a1',
        conversationId: 'c1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'First answer with details' }],
        createdAt: 2000,
        updatedAt: 2000,
        status: 'done',
        usage: {
          inputTokens: 1700,
          outputTokens: 200,
          totalTokens: 1900,
        },
      },
      {
        id: 'u2',
        conversationId: 'c1',
        role: 'user',
        parts: [{ type: 'text', text: 'Follow up question' }],
        createdAt: 3000,
        updatedAt: 3000,
        status: 'done',
      },
    ];

    const stats = computeContextUsageStats({
      messages,
      systemPromptBase: 'You are a helpful assistant.',
      draftText: 'Next draft message',
      modelId: 'gpt-4o',
      contextSettings: {
        ...DEFAULT_CONTEXT_SETTINGS,
        autoCompactEnabled: true,
        customMaxContextTokens: 2048,
        autoCompactThreshold: 0.8,
        keepRecentMessages: 2,
      },
      maxContextMessages: 20,
    });

    expect(stats.usedTokens).toBeGreaterThan(1900);
    expect(stats.ratio).toBeGreaterThan(0.8);
    expect(stats.percent).toBeGreaterThan(80);
    expect(stats.willAutoCompact).toBe(true);
  });

  it('SSEParser reassembles split CRLF frames, multi-line data, and flushes trailing buffer', () => {
    const parser = new SSEParser();
    const events1 = parser.feed('event: delta\r\nid: 1\r');
    expect(events1).toHaveLength(0);

    const events2 = parser.feed('\ndata: {"a":1}\r\ndata: {"b":2}\r\n\r\ndata: {"tail":');
    expect(events2).toHaveLength(1);
    expect(events2[0]).toEqual({
      event: 'delta',
      id: '1',
      data: '{"a":1}\n{"b":2}',
    });

    const events3 = parser.feed('true}');
    expect(events3).toHaveLength(0);

    const flushed = parser.flush();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].data).toBe('{"tail":true}');
  });

  it('modelProfiles stays deterministic across repeated calls on slashed and non-slashed IDs', () => {
    const resultsSlashed = Array.from({ length: 4 }, () =>
      resolveModelReasoningProfile({ modelId: 'openai/gpt-5.2', protocol: 'openai-chat' })
    );
    const resultsPlain = Array.from({ length: 4 }, () =>
      resolveModelReasoningProfile({ modelId: 'gpt-5.2', protocol: 'openai-chat' })
    );

    for (const res of resultsSlashed) {
      expect(res.profile.id).toBe(resultsSlashed[0].profile.id);
      expect(res.source).toBe(resultsSlashed[0].source);
    }
    for (const res of resultsPlain) {
      expect(res.profile.id).toBe(resultsPlain[0].profile.id);
      expect(res.source).toBe(resultsPlain[0].source);
    }
  });

  it('memoryEngine filters sensitive strings, merges in O(N), and retrieves deterministically', () => {
    expect(hasSensitiveInfo('我的手机号是 13812345678')).toBe(true);
    expect(hasSensitiveInfo('邮箱 test@example.com')).toBe(true);
    expect(hasSensitiveInfo('密钥 sk-1234567890abcdef1234567890')).toBe(true);
    expect(hasSensitiveInfo('我平时喜欢用 TypeScript 和 Vite 开发前端项目')).toBe(false);

    const now = Date.now();
    const existing: MemoryEntry[] = [
      {
        id: 'm1',
        category: 'preference',
        content: '用户偏好 TypeScript 严格模式',
        tags: ['typescript', 'code'],
        createdAt: now - 5000,
        updatedAt: now - 5000,
      },
      {
        id: 'm2',
        category: 'fact',
        content: '用户喜欢喝美式咖啡',
        tags: ['drink'],
        createdAt: now - 4000,
        updatedAt: now - 4000,
      },
    ];
    const incoming: MemoryEntry[] = [
      {
        id: 'm3',
        category: 'preference',
        content: '用户偏好 TypeScript 严格模式！',
        tags: ['ts', 'strict'],
        pinned: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'm4',
        category: 'fact',
        content: '密码是 123456 手机号 13900001111',
        tags: [],
        sensitive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'm5',
        category: 'project',
        content: '正在开发 ChatBeauty 桌面端',
        tags: ['chatbeauty', 'electron'],
        createdAt: now,
        updatedAt: now,
      },
    ];

    const merged = mergeMemoryEntries(existing, incoming, false);
    expect(merged.updatedCount).toBe(1);
    expect(merged.addedCount).toBe(1);
    expect(merged.skippedSensitiveCount).toBe(1);
    expect(merged.entries).toHaveLength(3);
    expect(merged.entries.find((e) => e.id === 'm1')?.pinned).toBe(true);
    expect(merged.entries.some((e) => e.content.includes('13900001111'))).toBe(false);

    const firstLookup = retrieveRelevantMemories(
      merged.entries,
      'ChatBeauty Electron 打包',
      [],
      DEFAULT_MEMORY_SETTINGS
    );
    const secondLookup = retrieveRelevantMemories(
      merged.entries,
      'ChatBeauty Electron 打包',
      [],
      DEFAULT_MEMORY_SETTINGS
    );
    expect(firstLookup[0]?.id).toBe('m5');
    expect(secondLookup.map((e) => e.id)).toEqual(firstLookup.map((e) => e.id));
  });

  it('adapters/shared helpers parse data URLs, merge headers case-insensitively, and build model URLs', () => {
    expect(extractDataUrlParts('data:image/png;charset=utf-8;base64,iVBORw0KGgo=')).toEqual({
      mimeType: 'image/png',
      base64: 'iVBORw0KGgo=',
    });
    expect(extractDataUrlParts('https://example.com/a.png')).toBeNull();
    expect(extractDataUrlParts('data:image/png;base64,')).toBeNull();
    expect(extractDataUrlParts('data:image/png,abc')).toBeNull();

    expect(
      mergeHeadersCaseInsensitive(
        { 'Content-Type': 'application/json', Authorization: 'Bearer old' },
        { authorization: 'Bearer new', 'X-Custom': 'yes' }
      )
    ).toEqual({
      'Content-Type': 'application/json',
      authorization: 'Bearer new',
      'X-Custom': 'yes',
    });

    expect(buildProtocolModelsUrl('openai-chat', 'https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/models'
    );
    expect(buildProtocolModelsUrl('openai-responses', 'https://proxy.example.com/v1/responses')).toBe(
      'https://proxy.example.com/v1/models'
    );
    expect(
      buildProtocolModelsUrl('gemini', 'https://generativelanguage.googleapis.com/v1beta', {
        geminiPageSize: 100,
      })
    ).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');
    expect(buildProtocolModelsUrl('anthropic', 'https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com/v1/models'
    );
  });
});
