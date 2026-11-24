import { describe, expect, it } from 'vitest';
import {
  buildCompactionPrompt,
  buildFallbackLocalSummary,
  computeContextUsageStats,
  estimateTokens,
  inferModelContextWindow,
  selectActiveHistoryMessages,
} from '@/services/llm/contextManager';
import { DEFAULT_CONTEXT_SETTINGS } from '@/types/settings';
import type { Message } from '@/types/chat';

function makeMsg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  usage?: Message['usage']
): Message {
  return {
    id,
    conversationId: 'conv_1',
    role,
    parts: [{ type: 'text', text }],
    createdAt: 1000,
    updatedAt: 1000,
    status: 'done',
    usage,
  };
}

describe('contextManager — token accounting & auto-compaction', () => {
  it('defaults keepRecentMessages to 10, autoCompactThreshold to 80%, and fallback window to 200K', () => {
    expect(DEFAULT_CONTEXT_SETTINGS.autoCompactEnabled).toBe(true);
    expect(DEFAULT_CONTEXT_SETTINGS.autoCompactThreshold).toBe(0.8);
    expect(DEFAULT_CONTEXT_SETTINGS.keepRecentMessages).toBe(10);
    expect(DEFAULT_CONTEXT_SETTINGS.defaultContextWindow).toBe(200_000);
  });

  it('infers late-2026 model context windows accurately with override priority', () => {
    expect(inferModelContextWindow('gpt-6.2-sol')).toBe(500_000);
    expect(inferModelContextWindow('gpt-6.1-terra')).toBe(500_000);
    expect(inferModelContextWindow('gpt-6.2-astra')).toBe(256_000);
    expect(inferModelContextWindow('gpt-6-luna')).toBe(256_000);
    expect(inferModelContextWindow('gpt-5.4')).toBe(1_050_000);
    expect(inferModelContextWindow('claude-fable-5-2')).toBe(1_000_000);
    expect(inferModelContextWindow('claude-sonnet-5-5')).toBe(1_000_000);
    expect(inferModelContextWindow('claude-opus-4-6')).toBe(1_000_000);
    expect(inferModelContextWindow('gemini-4-argon')).toBe(1_048_576);
    expect(inferModelContextWindow('deepseek-v4-pro')).toBe(1_000_000);
    expect(inferModelContextWindow('deepseek-flash')).toBe(1_000_000);
    expect(inferModelContextWindow('qwen4-max')).toBe(1_000_000);
    expect(inferModelContextWindow('glm-5.3')).toBe(1_000_000);
    expect(inferModelContextWindow('kimi-k3.1-pro')).toBe(1_000_000);
    expect(inferModelContextWindow('minimax-m3')).toBe(1_000_000);
    expect(inferModelContextWindow('doubao-seed-2.1-pro')).toBe(1_024_000);
    expect(inferModelContextWindow('grok-4.7')).toBe(500_000);
    expect(inferModelContextWindow('claude-haiku-4-5')).toBe(200_000);
    expect(inferModelContextWindow('deepseek-chat')).toBe(128_000);
    expect(inferModelContextWindow('unknown-custom-model')).toBe(200_000);
    expect(
      inferModelContextWindow('custom-model', {
        id: 'custom-model',
        name: 'custom-model',
        capabilities: { chat: true },
        contextLength: 65536,
      })
    ).toBe(65536);
    expect(
      inferModelContextWindow('gemini-4-argon', undefined, {
        customMaxContextTokens: 500000,
        defaultContextWindow: 200000,
      })
    ).toBe(500000);
  });

  it('slices active history strictly after compactedUntilMessageId while preserving full array', () => {
    const msgs = Array.from({ length: 14 }, (_, i) =>
      makeMsg(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant', `第 ${i + 1} 条测试对话内容`)
    );
    expect(selectActiveHistoryMessages(msgs).length).toBe(14);
    const active = selectActiveHistoryMessages(msgs, 'm4');
    expect(active.length).toBe(10);
    expect(active[0].id).toBe('m5');
    expect(active[active.length - 1].id).toBe('m14');
  });

  it('triggers willAutoCompact when occupancy exceeds threshold and active messages > keepRecentMessages', () => {
    const msgs = Array.from({ length: 12 }, (_, i) =>
      makeMsg(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant', '这是一段较长的连续推演上下文。'.repeat(40))
    );

    const stats = computeContextUsageStats({
      messages: msgs,
      systemPromptBase: 'System base prompt',
      retrievedMemoriesText: '- [画像] 化学工程学生',
      draftText: '请继续补充机理分析',
      modelId: 'gpt-4o',
      contextSettings: {
        ...DEFAULT_CONTEXT_SETTINGS,
        customMaxContextTokens: 2048,
        autoCompactThreshold: 0.8,
        keepRecentMessages: 10,
      },
      maxContextMessages: 32,
    });

    expect(stats.ratio).toBeGreaterThanOrEqual(0.8);
    expect(stats.willAutoCompact).toBe(true);
    expect(stats.activeMessageCount).toBe(12);
    expect(stats.memoryTokens).toBeGreaterThan(0);
    expect(stats.draftTokens).toBeGreaterThan(0);
  });

  it('does not trigger auto-compaction when active messages <= keepRecentMessages (10)', () => {
    const msgs = Array.from({ length: 10 }, (_, i) =>
      makeMsg(`m${i + 1}`, i % 2 === 0 ? 'user' : 'assistant', '非常长的文本'.repeat(120))
    );
    const stats = computeContextUsageStats({
      messages: msgs,
      systemPromptBase: 'Sys',
      modelId: 'gpt-4o',
      contextSettings: {
        ...DEFAULT_CONTEXT_SETTINGS,
        customMaxContextTokens: 2048,
        autoCompactThreshold: 0.8,
        keepRecentMessages: 10,
      },
      maxContextMessages: 32,
    });

    expect(stats.ratio).toBeGreaterThanOrEqual(0.8);
    expect(stats.willAutoCompact).toBe(false);
  });

  it('calibrates total tokens against the latest assistant server usage + tail delta', () => {
    const msgs = [
      makeMsg('m1', 'user', 'hi'),
      makeMsg('m2', 'assistant', 'hello', { inputTokens: 1500, outputTokens: 200 }),
      makeMsg('m3', 'user', 'follow up question'),
    ];
    const draft = 'draft text';
    const stats = computeContextUsageStats({
      messages: msgs,
      systemPromptBase: 'Sys',
      draftText: draft,
      modelId: 'deepseek-chat',
      contextSettings: DEFAULT_CONTEXT_SETTINGS,
      maxContextMessages: 20,
    });

    expect(stats.usedTokens).toBeGreaterThanOrEqual(1700 + estimateTokens('follow up question') + estimateTokens(draft));
  });

  it('builds structured compaction prompts and bounded fallback summaries', () => {
    const msgs = [
      makeMsg('m1', 'user', '我们需要推导热力学第一定律'),
      makeMsg('m2', 'assistant', '核心方程为 ΔU = Q + W'),
    ];
    const prompt = buildCompactionPrompt('之前讨论了封闭体系定义', msgs);
    expect(prompt).toContain('之前讨论了封闭体系定义');
    expect(prompt).toContain('ΔU = Q + W');

    const fallback = buildFallbackLocalSummary('之前摘要', msgs);
    expect(fallback).toContain('之前摘要');
    expect(fallback).toContain('热力学第一定律');
  });

  it('skips stale pre-compaction usage calibration and excludes discarded reasoning tokens', () => {
    const preCompactAssistant: Message = {
      ...makeMsg('m2', 'assistant', 'older answer', { inputTokens: 8000, outputTokens: 300 }),
      createdAt: 1000,
      updatedAt: 1000,
    };
    const staleCalibrated = computeContextUsageStats({
      messages: [makeMsg('m1', 'user', 'hi'), preCompactAssistant, makeMsg('m3', 'user', 'next')],
      compactedAt: 2000,
      systemPromptBase: 'Sys',
      modelId: 'deepseek-chat',
      contextSettings: DEFAULT_CONTEXT_SETTINGS,
      maxContextMessages: 20,
    });
    expect(staleCalibrated.usedTokens).toBeLessThan(1000);

    const reasoningAssistant: Message = {
      id: 'm_r',
      conversationId: 'conv_1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'very long hidden chain of thought'.repeat(50) },
        { type: 'text', text: 'concise final answer' },
      ],
      createdAt: 3000,
      updatedAt: 3000,
      status: 'done',
      usage: { inputTokens: 1200, outputTokens: 2500 },
    };
    const stats = computeContextUsageStats({
      messages: [makeMsg('m1', 'user', 'hi'), reasoningAssistant],
      compactedAt: 500,
      systemPromptBase: 'Sys',
      modelId: 'deepseek-reasoner',
      contextSettings: DEFAULT_CONTEXT_SETTINGS,
      maxContextMessages: 20,
    });
    expect(stats.usedTokens).toBeLessThan(1300);
  });

  it('retains tail context in buildFallbackLocalSummary when previous summary exceeds bound', () => {
    const oldHead = 'OLD_PREFIX_MARKER '.repeat(80);
    const recentTail = '\nTAIL_KEEP_MARKER_987';
    const fallback = buildFallbackLocalSummary(`${oldHead}${recentTail}`, [
      makeMsg('m1', 'user', 'LATEST_TURN_MARKER'),
    ]);
    expect(fallback).toContain('TAIL_KEEP_MARKER_987');
    expect(fallback).toContain('LATEST_TURN_MARKER');
    expect(fallback).not.toContain('OLD_PREFIX_MARKER');
  });
});
