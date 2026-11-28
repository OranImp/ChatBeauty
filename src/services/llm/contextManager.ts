import type { Message, ModelDefinition } from '@/types/chat';
import type { ContextSettings } from '@/types/settings';
import { extractTextFromParts } from './adapters/shared';

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

const messageTokenCache = new WeakMap<Message, number>();

/**
 * Estimates token usage for bilingual (CJK + Latin/code) strings without intermediate allocations.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  const len = text.length;
  for (let i = 0; i < len; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjkCount++;
    }
  }
  const nonCjkCount = len - cjkCount;
  return Math.ceil(cjkCount * 0.9 + nonCjkCount * 0.28);
}

/**
 * Estimates tokens consumed by a stored chat message when serialized as prompt context.
 * Reasoning blocks are excluded since they are not re-sent on follow-up turns.
 */
export function estimateMessageTokens(msg: Message): number {
  if (msg.status !== 'streaming') {
    const cached = messageTokenCache.get(msg);
    if (cached !== undefined) return cached;
  }
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
  const result = total > 0 ? total + 6 : 0;
  if (msg.status !== 'streaming') {
    messageTokenCache.set(msg, result);
  }
  return result;
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

  // Late-2026 Frontier 1M+ Context Tier
  if (/gpt-5\.4/.test(id)) return 1_050_000;
  if (/gemini-(?:4|3|2\.5|2\.0|1\.5)/.test(id)) return 1_048_576;
  if (/doubao-seed-2\.1/.test(id)) return 1_024_000;
  if (
    /claude-(?:fable|mythos)/.test(id) ||
    /claude-(?:opus|sonnet|haiku)[.-](?:5|4[.-][6-9])/.test(id)
  ) {
    return 1_000_000;
  }
  if (/deepseek-(?:v4|flash)/.test(id)) return 1_000_000;
  if (/qwen(?:4|3\.[6-9])/.test(id)) return 1_000_000;
  if (/glm-5\.[2-9]/.test(id)) return 1_000_000;
  if (/kimi-k3/.test(id)) return 1_000_000;
  if (/minimax-m3/.test(id)) return 1_000_000;
  if (/gpt-4\.1|grok-4.*fast/.test(id)) return 1_000_000;

  // 500K / 272K / 256K / 200K / 128K Tiers
  // GPT-6 Sol/Terra use 500K & Astra/Luna/others use 256K to trigger auto-compaction before doubled long-context pricing.
  if (/gpt-6.*(?:sol|terra)|grok-4/.test(id)) return 500_000;
  if (/gpt-5/.test(id)) return 272_000;
  if (/gpt-6|kimi-k2|doubao-seed|qwen3/.test(id)) return 256_000;
  if (/o3|o4|claude-(?:opus|sonnet|haiku|3\.5|3\.7|4)|glm-5|minimax-m2/.test(id)) {
    return 200_000;
  }
  if (/gpt-4|gpt-realtime|deepseek-(?:chat|reasoner|r1)|glm-4/.test(id)) return 128_000;

  return settings?.defaultContextWindow && settings.defaultContextWindow > 0
    ? settings.defaultContextWindow
    : 200_000;
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
  compactedAt?: number;
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
  let activeHistory = allUsable;
  if (options.compactedUntilMessageId) {
    const compactIdx = allUsable.findIndex((m) => m.id === options.compactedUntilMessageId);
    if (compactIdx >= 0) {
      activeHistory = allUsable.slice(compactIdx + 1);
    }
  }
  const compactedMessageCount = Math.max(0, allUsable.length - activeHistory.length);
  const sentMessages =
    options.maxContextMessages > 0 && activeHistory.length > options.maxContextMessages
      ? activeHistory.slice(-options.maxContextMessages)
      : activeHistory;

  const systemTokens = estimateTokens(options.systemPromptBase);
  const memoryTokens = estimateTokens(options.retrievedMemoriesText || '');
  const summaryTokens = estimateTokens(options.contextSummary || '');

  const sentCount = sentMessages.length;
  const msgTokens = new Array<number>(sentCount);
  const prefixTokens = new Array<number>(sentCount + 1);
  prefixTokens[0] = 0;
  for (let i = 0; i < sentCount; i++) {
    const t = estimateMessageTokens(sentMessages[i]);
    msgTokens[i] = t;
    prefixTokens[i + 1] = prefixTokens[i] + t;
  }
  const historyTokens = prefixTokens[sentCount];
  const draftTokens =
    estimateTokens(options.draftText || '') + Math.max(0, options.draftImageCount || 0) * 1024;

  const estimatedTotal =
    systemTokens + memoryTokens + summaryTokens + historyTokens + draftTokens;

  // Calibrate against the latest valid done assistant message's server input tokens
  // Skip calibration if compaction, sliding-window truncation, or early message deletion invalidated the prior prompt.
  let lastCalibratedIdx = -1;
  if (activeHistory.length === sentCount) {
    for (let i = sentCount - 1; i >= 0; i--) {
      const m = sentMessages[i];
      if (m.role === 'assistant' && m.status === 'done' && (m.usage?.inputTokens ?? 0) > 0) {
        const msgTime = m.updatedAt || m.createdAt;
        if (options.compactedAt && msgTime <= options.compactedAt) {
          break;
        }
        const estimatedPrefixBeforeCalibrated =
          systemTokens + memoryTokens + summaryTokens + prefixTokens[i];
        if (
          (m.usage?.inputTokens ?? 0) <=
          Math.max(4000, estimatedPrefixBeforeCalibrated * 2.5)
        ) {
          lastCalibratedIdx = i;
        }
        break;
      }
    }
  }

  let usedTokens = estimatedTotal;
  if (lastCalibratedIdx >= 0) {
    const calibratedMsg = sentMessages[lastCalibratedIdx];
    const hasReasoningPart = calibratedMsg.parts.some(
      (p) => p.type === 'reasoning' && p.text.trim().length > 0
    );
    const calibratedCompletionTokens =
      !hasReasoningPart && (calibratedMsg.usage?.outputTokens ?? 0) > 0
        ? calibratedMsg.usage!.outputTokens!
        : msgTokens[lastCalibratedIdx];
    const tailTokensAfterCalibrated = historyTokens - prefixTokens[lastCalibratedIdx + 1];
    usedTokens = Math.max(
      0,
      (calibratedMsg.usage?.inputTokens ?? 0) +
        calibratedCompletionTokens +
        tailTokensAfterCalibrated +
        draftTokens
    );
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
    const prev = previousSummary.trim();
    if (prev.length <= 1100) {
      bullets.push(prev);
    } else {
      const tail = prev.slice(-1100);
      const nl = tail.indexOf('\n');
      bullets.push(`…\n${nl >= 0 ? tail.slice(nl + 1) : tail}`);
    }
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
  const tail = combined.slice(-2390);
  const firstNewline = tail.indexOf('\n');
  return `…\n${firstNewline >= 0 ? tail.slice(firstNewline + 1) : tail}`;
}
