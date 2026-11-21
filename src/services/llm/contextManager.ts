import type { Message, ModelDefinition } from '@/types/chat';
import type { ContextSettings } from '@/types/settings';
import { extractTextFromParts, sliceContextMessages } from './adapters/shared';

export interface ContextUsageStats {
  usedTokens: number;
  maxTokens: number;
  ratio: number;
  percent: number;
  systemTokens: number;
  memoryTokens: number;
  summaryTokens: number;
  historyTokens: number;
  draftTokens: number;
  activeMessageCount: number;
  compactedMessageCount: number;
  threshold: number;
  willAutoCompact: boolean;
}

const CJK_REGEX = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/g;

/**
 * Estimates token usage for bilingual (CJK + Latin/code) strings.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cjkMatches = text.match(CJK_REGEX);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount * 0.9 + nonCjkCount * 0.28);
}

/**
 * Estimates tokens consumed by a stored chat message when serialized as prompt context.
 * Reasoning blocks are excluded since they are not re-sent on follow-up turns.
 */
export function estimateMessageTokens(msg: Message): number {
  let total = 0;
  for (const part of msg.parts) {
    if (part.type === 'text' && part.text) {
      total += estimateTokens(part.text);
    } else if (part.type === 'image') {
      total += 1024;
    } else if (part.type === 'file') {
      total += 256;
    }
  }
  return total > 0 ? total + 6 : 0;
}

/**
 * Resolves the effective context window size (tokens) for a model.
 * Priority: user override > model metadata > model family rule > default.
 */
export function inferModelContextWindow(
  modelId: string,
  modelDef?: ModelDefinition,
  settings?: Pick<ContextSettings, 'customMaxContextTokens' | 'defaultContextWindow'>
): number {
  if (settings?.customMaxContextTokens && settings.customMaxContextTokens > 0) {
    return Math.max(2048, Math.round(settings.customMaxContextTokens));
  }
  if (modelDef?.contextLength && modelDef.contextLength > 0) {
    return modelDef.contextLength;
  }

  const id = (modelId || '').toLowerCase();
  if (/gemini-(4|3|2\.5|2\.0|1\.5)/.test(id)) return 1_000_000;
  if (/gpt-4\.1/.test(id)) return 1_000_000;
  if (/claude-(opus|sonnet|haiku|3\.5|3\.7|4|5)/.test(id)) return 200_000;
  if (/gpt-(6|5)|grok-4/.test(id)) return 256_000;
  if (/gpt-4|o3|o4|deepseek|qwen3|glm-5|kimi|doubao-seed/.test(id)) return 128_000;

  return settings?.defaultContextWindow && settings.defaultContextWindow > 0
    ? settings.defaultContextWindow
    : 128_000;
}

/**
 * Selects usable (user/assistant) messages strictly after the compaction boundary.
 */
export function selectActiveHistoryMessages(
  messages: Message[],
  compactedUntilMessageId?: string
): Message[] {
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!compactedUntilMessageId) return usable;
  const idx = usable.findIndex((m) => m.id === compactedUntilMessageId);
  if (idx < 0) return usable;
  return usable.slice(idx + 1);
}

/**
 * Computes real-time context occupancy stats calibrated with the latest
 * server-reported usage when available inside the active window.
 */
export function computeContextUsageStats(options: {
  messages: Message[];
  compactedUntilMessageId?: string;
  contextSummary?: string;
  systemPromptBase: string;
  retrievedMemoriesText?: string;
  draftText?: string;
  draftImageCount?: number;
  modelId: string;
  modelDef?: ModelDefinition;
  contextSettings: ContextSettings;
  maxContextMessages: number;
}): ContextUsageStats {
  const allUsable = options.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const activeHistory = selectActiveHistoryMessages(
    allUsable,
    options.compactedUntilMessageId
  );
  const compactedMessageCount = Math.max(0, allUsable.length - activeHistory.length);
  const sentMessages = sliceContextMessages(activeHistory, options.maxContextMessages);

  const systemTokens = estimateTokens(options.systemPromptBase);
  const memoryTokens = estimateTokens(options.retrievedMemoriesText || '');
  const summaryTokens = estimateTokens(options.contextSummary || '');
  const historyTokens = sentMessages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
  const draftTokens =
    estimateTokens(options.draftText || '') + Math.max(0, options.draftImageCount || 0) * 1024;

  const estimatedTotal =
    systemTokens + memoryTokens + summaryTokens + historyTokens + draftTokens;

  // Calibrate against the latest done assistant message's true server input+output tokens
  let lastCalibratedIdx = -1;
  for (let i = sentMessages.length - 1; i >= 0; i--) {
    const m = sentMessages[i];
    if (m.role === 'assistant' && m.status === 'done' && (m.usage?.inputTokens ?? 0) > 0) {
      lastCalibratedIdx = i;
      break;
    }
  }

  let usedTokens = estimatedTotal;
  if (lastCalibratedIdx >= 0) {
    const calibratedMsg = sentMessages[lastCalibratedIdx];
    const promptPlusCompletion =
      (calibratedMsg.usage?.inputTokens ?? 0) +
      (calibratedMsg.usage?.outputTokens ?? estimateMessageTokens(calibratedMsg));
    const tailTokens = sentMessages
      .slice(lastCalibratedIdx + 1)
      .reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    usedTokens = Math.max(0, promptPlusCompletion + tailTokens + draftTokens);
  }

  const maxTokens = inferModelContextWindow(
    options.modelId,
    options.modelDef,
    options.contextSettings
  );
  const threshold = Math.min(0.95, Math.max(0.5, options.contextSettings.autoCompactThreshold));
  const ratio = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 0;
  const percent = Math.min(100, Math.round(ratio * 100));
  const willAutoCompact = Boolean(
    options.contextSettings.autoCompactEnabled &&
      ratio >= threshold &&
      activeHistory.length > options.contextSettings.keepRecentMessages
  );

  return {
    usedTokens,
    maxTokens,
    ratio,
    percent,
    systemTokens,
    memoryTokens,
    summaryTokens,
    historyTokens,
    draftTokens,
    activeMessageCount: sentMessages.length,
    compactedMessageCount,
    threshold,
    willAutoCompact,
  };
}

export function buildCompactionPrompt(
  previousSummary: string | undefined,
  messagesToCompact: Message[]
): string {
  const lines: string[] = [];
  if (previousSummary?.trim()) {
    lines.push('【既有上下文摘要】');
    lines.push(previousSummary.trim());
    lines.push('');
  }
  lines.push('【待合并压缩的较早对话记录】');
  for (const msg of messagesToCompact) {
    const roleLabel = msg.role === 'user' ? '用户' : '助手';
    const text = extractTextFromParts(msg.parts);
    const hasImages = msg.parts.some((p) => p.type === 'image');
    const summaryText = text
      ? text.length > 800
        ? `${text.slice(0, 800)}…`
        : text
      : hasImages
        ? '[附带图片]'
        : '';
    if (summaryText) {
      lines.push(`- ${roleLabel}：${summaryText.replace(/\s+/g, ' ')}`);
    }
  }
  lines.push('');
  lines.push(
    '请将上述较早对话合并提炼为结构化、信息高密度的中文上下文摘要（不超过 600 字）：保留用户核心目标、重要事实结论、关键代码/公式约定、已确定决策与未完待续问题，使用简洁要点列出，勿输出寒暄。'
  );
  return lines.join('\n');
}

export function buildFallbackLocalSummary(
  previousSummary: string | undefined,
  messagesToCompact: Message[]
): string {
  const bullets: string[] = [];
  if (previousSummary?.trim()) {
    bullets.push(previousSummary.trim());
  }
  for (const msg of messagesToCompact) {
    const roleLabel = msg.role === 'user' ? '用户' : '助手';
    const raw = extractTextFromParts(msg.parts).replace(/\s+/g, ' ').trim();
    if (!raw) {
      if (msg.parts.some((p) => p.type === 'image')) {
        bullets.push(`- ${roleLabel}：[发送/参考了图片]`);
      }
      continue;
    }
    const clipped = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    bullets.push(`- ${roleLabel}：${clipped}`);
  }
  const combined = bullets.join('\n');
  if (combined.length <= 2400) return combined;
  return `${combined.slice(0, 2390)}…`;
}
