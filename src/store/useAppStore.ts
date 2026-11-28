import Dexie from 'dexie';
import { create } from 'zustand';
import {
  db,
  discardPendingSettingsKv,
  KV_KEYS,
  loadInitialState,
  scheduleDebouncedKv,
  setKv,
} from '@/db/database';
import type {
  ContentPart,
  Conversation,
  Message,
  ModelDefinition,
  ProviderConfig,
} from '@/types/chat';
import type { PromptSettings, SystemPromptPreset } from '@/types/prompt';
import type { MemoryEntry } from '@/types/memory';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_MODEL_PROFILE_SYNC_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
  type AppearanceSettings,
  type ContextSettings,
  type GenerationSettings,
  type MemorySettings,
  type ModelProfileRule,
  type ModelProfileSyncSettings,
  type WebDavSyncSettings,
} from '@/types/settings';
import {
  BUILTIN_PROMPT_PRESETS,
  composeSystemPrompt,
  DEFAULT_PROMPT_SETTINGS,
} from '@/services/prompts/presets';
import { getProviderAdapter, PROTOCOL_TEMPLATES } from '@/services/llm/registry';
import { extractTextFromParts, toStableSessionId } from '@/services/llm/adapters/shared';
import {
  buildCompactionPrompt,
  buildFallbackLocalSummary,
  computeContextUsageStats,
  selectActiveHistoryMessages,
} from '@/services/llm/contextManager';
import {
  buildMemoryExtractionPrompt,
  detectMemoryTrigger,
  detectSensitiveInfo,
  extractMemoriesLocal,
  formatMemoriesForPrompt,
  MEMORY_FILE_HEADER,
  mergeMemoryEntries,
  parseLlmMemoryExtractionDetailed,
  parseMemoryDocument,
  retrieveRelevantMemories,
  serializeMemoryDocument,
} from '@/services/memory/memoryEngine';
import {
  coerceReasoningEffort,
  parseModelProfileRulesJson,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import {
  readNativeMemoryFile,
  simpleRequest,
  syncBackgroundStreamingState,
  writeNativeMemoryFile,
} from '@/services/transport/streamHttp';

const DEMO_CONVERSATION_ID = 'demo-showcase-full-adder';
const MAX_CACHED_CONVS = 8;
const STREAM_DB_FLUSH_MS = 1500;

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const deletedConvIds = new Set<string>();
const recentLoadedConvOrder: string[] = [];
let memoryNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let restoreEpoch = 0;
let memoryWriteQueue: Promise<void> = Promise.resolve();

function touchAndPruneMessagesMap(
  prevMap: Record<string, Message[]>,
  keepConvId: string,
  newList: Message[],
  activeConversationId: string | null,
  streamingByConv: Record<string, string>,
  abortControllers: Record<string, AbortController>,
  compactingByConv: Record<string, boolean>
): Record<string, Message[]> {
  const existingIdx = recentLoadedConvOrder.indexOf(keepConvId);
  if (existingIdx !== -1) {
    recentLoadedConvOrder.splice(existingIdx, 1);
  }
  recentLoadedConvOrder.push(keepConvId);

  const nextMap: Record<string, Message[]> = {
    ...prevMap,
    [keepConvId]: newList,
  };

  let i = 0;
  while (recentLoadedConvOrder.length > MAX_CACHED_CONVS && i < recentLoadedConvOrder.length) {
    const candidateId = recentLoadedConvOrder[i];
    const isProtected =
      candidateId === keepConvId ||
      candidateId === activeConversationId ||
      Boolean(streamingByConv[candidateId]) ||
      Boolean(abortControllers[candidateId]) ||
      Boolean(compactingByConv[candidateId]);
    if (isProtected) {
      i += 1;
      continue;
    }
    recentLoadedConvOrder.splice(i, 1);
    delete nextMap[candidateId];
  }

  return nextMap;
}

export function resolveValidProviderAndModel(
  conv: Conversation | undefined,
  providers: ProviderConfig[],
  activeProviderId: string | null,
  activeModelId: string | null
): { provider: ProviderConfig | undefined; modelId: string } {
  const convProv = conv?.providerId ? providers.find((p) => p.id === conv.providerId) : undefined;
  const activeProv = activeProviderId
    ? providers.find((p) => p.id === activeProviderId)
    : undefined;
  const provider =
    convProv ?? activeProv ?? providers.find((p) => p.enabled) ?? providers[0];

  if (!provider) {
    return { provider: undefined, modelId: '' };
  }

  let candidateModel = '';
  if (convProv && conv?.modelId) {
    candidateModel = conv.modelId;
  } else if (!convProv && activeProv && activeProv.id === provider.id && activeModelId) {
    candidateModel = activeModelId;
  } else if (conv?.modelId && provider.models.some((m) => m.id === conv.modelId)) {
    candidateModel = conv.modelId;
  }

  const modelId =
    candidateModel ||
    provider.defaultModel ||
    provider.models[0]?.id ||
    PROTOCOL_TEMPLATES[provider.protocol].placeholderModel;

  return { provider, modelId };
}

interface AppState {
  ready: boolean;
  conversations: Conversation[];
  messagesByConv: Record<string, Message[]>;
  providers: ProviderConfig[];
  promptPresets: SystemPromptPreset[];
  appearance: AppearanceSettings;
  generation: GenerationSettings;
  promptSettings: PromptSettings;
  webdav: WebDavSyncSettings;
  modelProfileSync: ModelProfileSyncSettings;
  contextSettings: ContextSettings;
  memorySettings: MemorySettings;
  memoryDocument: string;
  memoryEntries: MemoryEntry[];
  compactingByConv: Record<string, boolean>;
  memoryNotice: string | null;

  activeConversationId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;

  streamingMessageId: string | null;
  streamingByConv: Record<string, string>;
  abortControllers: Record<string, AbortController>;

  // Actions
  initApp: (options?: {
    skipNativeMemoryFallback?: boolean;
    syncNativeMemoryFile?: boolean;
  }) => Promise<void>;
  prepareForDatabaseRestore: () => void;
  reloadFromDatabase: (options?: { fromRestore?: boolean }) => Promise<void>;
  openDemoShowcase: () => Promise<void>;

  createConversation: (title?: string) => Promise<Conversation>;
  selectConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePinConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  updateConversationConfig: (
    id: string,
    patch: Partial<
      Pick<
        Conversation,
        | 'providerId'
        | 'modelId'
        | 'reasoningEffort'
        | 'customParams'
        | 'systemPromptPresetId'
        | 'customSystemPrompt'
        | 'enableRenderPrompt'
      >
    >
  ) => Promise<void>;

  sendMessage: (
    text: string,
    images?: Array<Extract<ContentPart, { type: 'image' }>>
  ) => Promise<void>;
  stopStreaming: (conversationId?: string) => void;
  regenerateMessage: (assistantMessageId: string) => Promise<void>;
  editAndResend: (userMessageId: string, newText: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  compactConversation: (conversationId: string) => Promise<{ ok: boolean; message: string }>;

  saveProvider: (provider: ProviderConfig) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setActiveProviderModel: (providerId: string, modelId: string) => Promise<void>;
  fetchProviderModels: (provider: ProviderConfig) => Promise<ModelDefinition[]>;
  testProviderConnection: (provider: ProviderConfig, modelId: string) => Promise<string>;

  savePromptPreset: (preset: SystemPromptPreset) => Promise<void>;
  deletePromptPreset: (id: string) => Promise<void>;
  resetBuiltinPreset: (id: string) => Promise<void>;
  updatePromptSettings: (patch: Partial<PromptSettings>) => Promise<void>;

  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  updateGeneration: (patch: Partial<GenerationSettings>) => Promise<void>;
  updateWebDav: (patch: Partial<WebDavSyncSettings>) => Promise<void>;
  updateModelProfileSync: (patch: Partial<ModelProfileSyncSettings>) => Promise<void>;
  syncRemoteModelProfiles: (urlOverride?: string) => Promise<{ count: number }>;
  saveCustomModelProfileRules: (rules: ModelProfileRule[]) => Promise<void>;

  updateContextSettings: (patch: Partial<ContextSettings>) => Promise<void>;
  updateMemorySettings: (patch: Partial<MemorySettings>) => Promise<void>;
  saveMemoryDocument: (markdown: string) => Promise<void>;
  upsertMemoryEntry: (entry: MemoryEntry) => Promise<void>;
  deleteMemoryEntry: (id: string) => Promise<void>;
  clearAllMemories: () => Promise<void>;
  clearMemoryNotice: () => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const loadMessagesFor = async (conversationId: string) => {
    const list = await db.messages
      .where('[conversationId+createdAt]')
      .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
      .toArray();
    set((s) => ({
      messagesByConv: touchAndPruneMessagesMap(
        s.messagesByConv,
        conversationId,
        list,
        s.activeConversationId,
        s.streamingByConv,
        s.abortControllers,
        s.compactingByConv
      ),
    }));
    return list;
  };

  const flashMemoryNotice = (msg: string) => {
    if (memoryNoticeTimer) clearTimeout(memoryNoticeTimer);
    set({ memoryNotice: msg });
    memoryNoticeTimer = setTimeout(() => {
      set((s) => (s.memoryNotice === msg ? { memoryNotice: null } : s));
    }, 4200);
  };

  const persistMemoryMutation = async (
    mutator: (prevEntries: MemoryEntry[]) => {
      entries: MemoryEntry[];
      explicitDoc?: string;
      notice?: string | null;
      skipWrite?: boolean;
    }
  ) => {
    let nextDoc = '';
    let shouldWrite = false;
    let noticeMsg: string | null = null;
    set((s) => {
      const result = mutator(s.memoryEntries);
      if (result.skipWrite) {
        noticeMsg = result.notice ?? null;
        return {};
      }
      shouldWrite = true;
      noticeMsg = result.notice ?? null;
      nextDoc =
        result.explicitDoc !== undefined
          ? result.explicitDoc
          : serializeMemoryDocument(result.entries);
      const parsed =
        result.explicitDoc !== undefined ? parseMemoryDocument(nextDoc) : result.entries;
      return { memoryDocument: nextDoc, memoryEntries: parsed };
    });

    if (noticeMsg) {
      flashMemoryNotice(noticeMsg);
    }

    if (!shouldWrite) return;

    const docToPersist = nextDoc;
    const job = memoryWriteQueue.then(async () => {
      await setKv(KV_KEYS.MEMORY_DOCUMENT, docToPersist);
      await writeNativeMemoryFile(docToPersist);
    });
    memoryWriteQueue = job.catch(() => undefined);
    await job;
  };

  const isConvDeleted = (convId: string) =>
    deletedConvIds.has(convId) || !get().conversations.some((c) => c.id === convId);

  const performCompaction = async (
    conversation: Conversation,
    allMessages: Message[],
    providerOverride?: ProviderConfig,
    modelIdOverride?: string,
    outerSignal?: AbortSignal
  ): Promise<{ ok: boolean; message: string; updatedConv: Conversation }> => {
    const state = get();
    const epoch = restoreEpoch;
    if (state.compactingByConv[conversation.id]) {
      return { ok: false, message: '正在压缩上下文中…', updatedConv: conversation };
    }

    const activeMessages = selectActiveHistoryMessages(
      allMessages,
      conversation.compactedUntilMessageId
    );
    const keepRecent = Math.max(2, state.contextSettings.keepRecentMessages || 10);
    if (activeMessages.length <= keepRecent) {
      return {
        ok: false,
        message: `当前活跃上下文仅 ${activeMessages.length} 条，不超过保留条数（${keepRecent} 条），无需压缩`,
        updatedConv: conversation,
      };
    }

    // Ensure the post-compaction window starts on a 'user' message so Anthropic/Gemini schemas remain valid.
    let splitIdx = activeMessages.length - keepRecent;
    while (splitIdx < activeMessages.length && activeMessages[splitIdx]?.role !== 'user') {
      splitIdx += 1;
    }
    if (splitIdx <= 0 || splitIdx >= activeMessages.length) {
      const altIdx = activeMessages.length - keepRecent - 1;
      if (altIdx > 0 && activeMessages[altIdx]?.role === 'user') {
        splitIdx = altIdx;
      } else {
        return {
          ok: false,
          message: '当前活跃上下文无可安全拆分的历史轮次，暂无需压缩',
          updatedConv: conversation,
        };
      }
    }

    const toCompact = activeMessages.slice(0, splitIdx);
    const lastCompactedMsg = toCompact[toCompact.length - 1];
    const keptCount = activeMessages.length - toCompact.length;

    set((s) => ({
      compactingByConv: { ...s.compactingByConv, [conversation.id]: true },
    }));

    try {
      const prompt = buildCompactionPrompt(conversation.contextSummary, toCompact);
      let summaryText = '';

      const resolved =
        providerOverride && modelIdOverride
          ? { provider: providerOverride, modelId: modelIdOverride }
          : resolveValidProviderAndModel(
              conversation,
              state.providers,
              state.activeProviderId,
              state.activeModelId
            );

      if (resolved.provider && resolved.provider.apiKey.trim() && resolved.modelId) {
        const timeoutCtrl = new AbortController();
        const timer = setTimeout(() => timeoutCtrl.abort(), 16000);
        const onOuterAbort = () => timeoutCtrl.abort();
        outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

        try {
          const adapter = getProviderAdapter(resolved.provider.protocol);
          const now = Date.now();
          const compactUserMsg: Message = {
            id: uid('compact'),
            conversationId: conversation.id,
            role: 'user',
            parts: [{ type: 'text', text: prompt }],
            createdAt: now,
            updatedAt: now,
            status: 'done',
          };
          await adapter.chatStream(
            {
              provider: resolved.provider,
              modelId: resolved.modelId,
              systemPrompt: '你是精确、凝练的对话上下文摘要器。只输出结构化摘要要点。',
              messages: [compactUserMsg],
              generation: {
                ...state.generation,
                temperature: 0.2,
                maxTokens: 1024,
                reasoningEffort: 'off',
              },
              sessionId: toStableSessionId(`${conversation.id}:compact`),
            },
            {
              onReasoningDelta: () => {},
              onTextDelta: (delta) => {
                summaryText += delta;
              },
            },
            timeoutCtrl.signal
          );
        } catch {
          if (outerSignal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          summaryText = '';
        } finally {
          clearTimeout(timer);
          outerSignal?.removeEventListener('abort', onOuterAbort);
        }
      }

      if (epoch !== restoreEpoch || isConvDeleted(conversation.id)) {
        return { ok: false, message: '对话已重置或删除', updatedConv: conversation };
      }

      const currentMsgs = get().messagesByConv[conversation.id] || [];
      if (!currentMsgs.some((m) => m.id === lastCompactedMsg.id)) {
        return {
          ok: false,
          message: '压缩期间对话历史已变动，已取消本次摘要',
          updatedConv: conversation,
        };
      }

      const latestConv =
        get().conversations.find((c) => c.id === conversation.id) ??
        (await db.conversations.get(conversation.id)) ??
        conversation;

      const finalSummary =
        summaryText.trim() || buildFallbackLocalSummary(latestConv.contextSummary, toCompact);

      const allUsableCount = allMessages.filter(
        (m) => m.role === 'user' || m.role === 'assistant'
      ).length;
      const prevCompactedTotal = Math.max(
        latestConv.compactedCount ?? 0,
        allUsableCount - activeMessages.length
      );
      const compactedAt = Date.now();
      const patch: Partial<Conversation> = {
        contextSummary: finalSummary,
        compactedUntilMessageId: lastCompactedMsg.id,
        compactedCount: prevCompactedTotal + toCompact.length,
        compactedAt,
        updatedAt: compactedAt,
      };

      const updatedConv: Conversation = {
        ...latestConv,
        ...patch,
      };

      await db.conversations.update(conversation.id, patch);
      set((s) => ({
        conversations: s.conversations
          .map((c) => (c.id === conversation.id ? { ...c, ...patch } : c))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      }));

      return {
        ok: true,
        message: `已压缩 ${toCompact.length} 条较早消息，保留最近 ${keptCount} 条活跃上下文`,
        updatedConv,
      };
    } finally {
      set((s) => {
        const nextCompacting = { ...s.compactingByConv };
        delete nextCompacting[conversation.id];
        return { compactingByConv: nextCompacting };
      });
    }
  };

  const extractAndSaveMemory = async (
    userText: string,
    convId: string,
    provider: ProviderConfig,
    modelId: string
  ) => {
    const state = get();
    const epoch = restoreEpoch;
    if (!state.memorySettings.enabled || !state.memorySettings.autoExtract) return;
    const trigger = detectMemoryTrigger(userText);
    if (!trigger) return;

    const sensCheck = detectSensitiveInfo(userText);
    let extracted: MemoryEntry[] = [];
    let llmSucceeded = false;
    let llmSkippedSensitiveCount = 0;

    if (provider.apiKey.trim() && modelId) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      let rawOut = '';
      try {
        const adapter = getProviderAdapter(provider.protocol);
        const now = Date.now();
        const promptMsg: Message = {
          id: uid('mem_req'),
          conversationId: convId,
          role: 'user',
          parts: [
            {
              type: 'text',
              text: buildMemoryExtractionPrompt(
                userText,
                state.memorySettings.recordSensitiveInfo
              ),
            },
          ],
          createdAt: now,
          updatedAt: now,
          status: 'done',
        };
        await adapter.chatStream(
          {
            provider,
            modelId,
            systemPrompt:
              '你是用户的长期记忆整理助手。仅按要求输出 JSON 数组，不要输出多余解释。',
            messages: [promptMsg],
            generation: {
              ...state.generation,
              temperature: 0.1,
              maxTokens: 512,
              reasoningEffort: 'off',
            },
            sessionId: toStableSessionId(`${convId}:memory`),
          },
          {
            onReasoningDelta: () => {},
            onTextDelta: (delta) => {
              rawOut += delta;
            },
          },
          ctrl.signal
        );
        const detailed = parseLlmMemoryExtractionDetailed(
          rawOut,
          get().memorySettings.recordSensitiveInfo,
          convId
        );
        if (detailed.hadValidJson) {
          llmSucceeded = true;
          extracted = detailed.entries;
          llmSkippedSensitiveCount = detailed.skippedSensitiveCount;
        }
      } catch {
        extracted = [];
      } finally {
        clearTimeout(timer);
      }
    }

    const latestBeforeMerge = get();
    if (
      epoch !== restoreEpoch ||
      !latestBeforeMerge.memorySettings.enabled ||
      !latestBeforeMerge.memorySettings.autoExtract
    ) {
      return;
    }

    if (!llmSucceeded) {
      extracted = extractMemoriesLocal(userText, latestBeforeMerge.memorySettings, convId);
    }

    if (extracted.length === 0) {
      if (
        (llmSkippedSensitiveCount > 0 || sensCheck.isSensitive) &&
        !latestBeforeMerge.memorySettings.recordSensitiveInfo
      ) {
        flashMemoryNotice('检测到敏感隐私信息，已按设置跳过记忆写入');
      }
      return;
    }

    await persistMemoryMutation((prevEntries) => {
      const latestSettings = get().memorySettings;
      if (epoch !== restoreEpoch || !latestSettings.enabled || !latestSettings.autoExtract) {
        return { entries: prevEntries, skipWrite: true };
      }
      const merged = mergeMemoryEntries(
        prevEntries,
        extracted,
        latestSettings.recordSensitiveInfo
      );
      if (merged.addedCount > 0 || merged.updatedCount > 0) {
        const changed = merged.addedCount + merged.updatedCount;
        const suffix =
          merged.skippedSensitiveCount + llmSkippedSensitiveCount > 0
            ? '（已自动过滤敏感条目）'
            : '';
        return {
          entries: merged.entries,
          notice: `已写入 ${changed} 条长期记忆${suffix}`,
        };
      }
      const skippedNotice =
        merged.skippedSensitiveCount > 0 ||
        llmSkippedSensitiveCount > 0 ||
        (sensCheck.isSensitive && !latestSettings.recordSensitiveInfo)
          ? '检测到敏感隐私信息，已按设置跳过记忆写入'
          : null;
      return { entries: prevEntries, skipWrite: true, notice: skippedNotice };
    });
  };

  const runAssistantStream = async (
    conversation: Conversation,
    historyBeforeReply: Message[],
    provider: ProviderConfig,
    modelId: string,
    pendingController?: AbortController
  ) => {
    const state = get();
    const epoch = restoreEpoch;
    const assistantMsgId = uid('msg');
    const startedAt = Date.now();
    const controller = pendingController ?? new AbortController();

    const initialAssistant: Message = {
      id: assistantMsgId,
      conversationId: conversation.id,
      role: 'assistant',
      parts: [],
      createdAt: startedAt,
      updatedAt: startedAt,
      modelId,
      providerId: provider.id,
      protocol: provider.protocol,
      status: 'streaming',
    };

    if (controller.signal.aborted || epoch !== restoreEpoch || isConvDeleted(conversation.id)) {
      set((s) => {
        if (s.abortControllers[conversation.id] !== controller) return {};
        const nextControllers = { ...s.abortControllers };
        delete nextControllers[conversation.id];
        return { abortControllers: nextControllers };
      });
      return;
    }

    set((s) => ({
      streamingMessageId: assistantMsgId,
      streamingByConv: { ...s.streamingByConv, [conversation.id]: assistantMsgId },
      abortControllers: { ...s.abortControllers, [conversation.id]: controller },
      messagesByConv: {
        ...s.messagesByConv,
        [conversation.id]: [...(s.messagesByConv[conversation.id] || []), initialAssistant],
      },
    }));
    void syncBackgroundStreamingState(
      Object.keys(get().abortControllers).length,
      get().appearance.backgroundGeneration ?? true
    );

    const presetId = conversation.systemPromptPresetId || state.promptSettings.defaultPresetId;
    const preset = state.promptPresets.find((p) => p.id === presetId);
    const renderEnabled =
      conversation.enableRenderPrompt !== undefined
        ? conversation.enableRenderPrompt
        : state.promptSettings.renderEnhancementEnabled;

    const systemPromptBase = composeSystemPrompt({
      presetContent: preset?.content,
      customSystemPrompt: conversation.customSystemPrompt,
      renderEnabled,
      renderPrompt: state.promptSettings.renderEnhancementPrompt,
    });

    const latestUserMsg = [...historyBeforeReply].reverse().find((m) => m.role === 'user');
    const latestQueryText = latestUserMsg ? extractTextFromParts(latestUserMsg.parts) : '';
    const relevantMemories = retrieveRelevantMemories(
      get().memoryEntries,
      latestQueryText,
      historyBeforeReply,
      get().memorySettings
    );
    const retrievedMemoriesText = formatMemoriesForPrompt(relevantMemories);

    let reasoningText = '';
    let answerText = '';
    let reasoningStartMs: number | null = null;
    let reasoningDurationMs = 0;
    let usage: Message['usage'] | undefined;
    let lastFlush = 0;
    let dirty = false;
    let rafId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let dbWriteInFlight = false;

    const buildAssistantSnapshot = (
      status: Message['status'],
      error?: string
    ): Message => {
      const parts: Message['parts'] = [];
      if (reasoningText) {
        parts.push({
          type: 'reasoning',
          text: reasoningText,
          durationMs: reasoningDurationMs || undefined,
        });
      }
      if (answerText) {
        parts.push({ type: 'text', text: answerText });
      }
      return {
        ...initialAssistant,
        parts,
        updatedAt: Date.now(),
        usage,
        error,
        status,
      };
    };

    const applyAssistantSnapshotToStore = (updated: Message) => {
      set((s) => {
        const currentList = s.messagesByConv[conversation.id];
        if (!currentList || currentList.length === 0) return {};
        let targetIdx = -1;
        for (let i = currentList.length - 1; i >= 0; i--) {
          if (currentList[i].id === assistantMsgId) {
            targetIdx = i;
            break;
          }
        }
        if (targetIdx === -1) return {};
        const nextList = currentList.slice();
        nextList[targetIdx] = updated;
        return {
          messagesByConv: {
            ...s.messagesByConv,
            [conversation.id]: nextList,
          },
        };
      });
    };

    const cancelScheduledFlush = () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      timerId = null;
    };

    const flushStreamingSnapshot = () => {
      cancelScheduledFlush();
      if (!dirty) return;
      dirty = false;
      if (epoch !== restoreEpoch || isConvDeleted(conversation.id)) return;

      const updated = buildAssistantSnapshot('streaming');
      applyAssistantSnapshotToStore(updated);

      const now = Date.now();
      if (!dbWriteInFlight && now - lastFlush >= STREAM_DB_FLUSH_MS) {
        lastFlush = now;
        dbWriteInFlight = true;
        void db.messages
          .put(updated)
          .catch(() => undefined)
          .finally(() => {
            dbWriteInFlight = false;
          });
      }
    };

    const scheduleStreamFlush = () => {
      dirty = true;
      if (rafId !== null || timerId !== null) return;
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(flushStreamingSnapshot);
      }
      timerId = setTimeout(flushStreamingSnapshot, 32);
    };

    const finalizeAssistantMessage = async (status: Message['status'], error?: string) => {
      cancelScheduledFlush();
      dirty = false;
      if (epoch !== restoreEpoch || isConvDeleted(conversation.id)) return;
      const updated = buildAssistantSnapshot(status, error);
      applyAssistantSnapshotToStore(updated);
      await db.messages.put(updated);
    };

    try {
      await db.messages.put(initialAssistant);
      if (controller.signal.aborted || epoch !== restoreEpoch || isConvDeleted(conversation.id)) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const modelDef = provider.models.find((m) => m.id === modelId);
      let effectiveConv =
        get().conversations.find((c) => c.id === conversation.id) ?? conversation;

      const preflightStats = computeContextUsageStats({
        messages: historyBeforeReply,
        compactedUntilMessageId: effectiveConv.compactedUntilMessageId,
        compactedAt: effectiveConv.compactedAt,
        contextSummary: effectiveConv.contextSummary,
        systemPromptBase,
        retrievedMemoriesText,
        modelId,
        modelDef,
        contextSettings: get().contextSettings,
        maxContextMessages: get().generation.maxContextMessages,
      });

      if (preflightStats.willAutoCompact) {
        const compactRes = await performCompaction(
          effectiveConv,
          historyBeforeReply,
          provider,
          modelId,
          controller.signal
        );
        if (compactRes.ok) {
          effectiveConv = compactRes.updatedConv;
        }
      }

      const activeHistory = selectActiveHistoryMessages(
        historyBeforeReply,
        effectiveConv.compactedUntilMessageId
      );

      const systemPrompt = composeSystemPrompt({
        presetContent: preset?.content,
        customSystemPrompt: effectiveConv.customSystemPrompt,
        renderEnabled,
        renderPrompt: get().promptSettings.renderEnhancementPrompt,
        retrievedMemoriesText,
        contextSummary: effectiveConv.contextSummary,
      });

      const adapter = getProviderAdapter(provider.protocol);
      const { profile } = resolveModelReasoningProfile({
        modelId,
        protocol: provider.protocol,
        modelDef,
        customRules: state.modelProfileSync.customRules,
        remoteRules: state.modelProfileSync.remoteRules,
      });
      const effectiveReasoning = coerceReasoningEffort(
        effectiveConv.reasoningEffort ?? state.generation.reasoningEffort,
        profile
      );
      await adapter.chatStream(
        {
          provider,
          modelId,
          systemPrompt,
          messages: activeHistory,
          generation: {
            ...state.generation,
            reasoningEffort: effectiveReasoning,
          },
          modelParams: modelDef?.params,
          conversationParams: effectiveConv.customParams,
          reasoningProfile: profile,
          sessionId: toStableSessionId(effectiveConv.id),
        },
        {
          onReasoningDelta: (delta) => {
            if (reasoningStartMs === null) reasoningStartMs = Date.now();
            reasoningText += delta;
            reasoningDurationMs = Date.now() - reasoningStartMs;
            scheduleStreamFlush();
          },
          onTextDelta: (delta) => {
            if (reasoningStartMs !== null && reasoningDurationMs === 0) {
              reasoningDurationMs = Date.now() - reasoningStartMs;
            }
            answerText += delta;
            scheduleStreamFlush();
          },
          onUsage: (u) => {
            usage = u;
          },
        },
        controller.signal
      );

      await finalizeAssistantMessage('done');
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        await finalizeAssistantMessage('aborted');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        await finalizeAssistantMessage('error', message);
      }
    } finally {
      cancelScheduledFlush();
      const updatedAt = Date.now();
      const staleEpoch = epoch !== restoreEpoch;
      const deleted = staleEpoch || isConvDeleted(conversation.id);
      if (!deleted) {
        await db.conversations.update(conversation.id, { updatedAt });
      }
      set((s) => {
        const nextControllers = { ...s.abortControllers };
        if (nextControllers[conversation.id] === controller) {
          delete nextControllers[conversation.id];
        }
        const nextStreamingByConv = { ...s.streamingByConv };
        if (nextStreamingByConv[conversation.id] === assistantMsgId) {
          delete nextStreamingByConv[conversation.id];
        }
        return {
          streamingMessageId: s.streamingMessageId === assistantMsgId ? null : s.streamingMessageId,
          streamingByConv: nextStreamingByConv,
          abortControllers: nextControllers,
          conversations: deleted
            ? s.conversations
            : s.conversations
                .map((c) => (c.id === conversation.id ? { ...c, updatedAt } : c))
                .sort((a, b) => b.updatedAt - a.updatedAt),
        };
      });
      void syncBackgroundStreamingState(
        Object.keys(get().abortControllers).length,
        get().appearance.backgroundGeneration ?? true
      );
    }
  };

  return {
    ready: false,
    conversations: [],
    messagesByConv: {},
    providers: [],
    promptPresets: BUILTIN_PROMPT_PRESETS,
    appearance: DEFAULT_APPEARANCE_SETTINGS,
    generation: DEFAULT_GENERATION_SETTINGS,
    promptSettings: DEFAULT_PROMPT_SETTINGS,
    webdav: DEFAULT_WEBDAV_SETTINGS,
    modelProfileSync: DEFAULT_MODEL_PROFILE_SYNC_SETTINGS,
    contextSettings: DEFAULT_CONTEXT_SETTINGS,
    memorySettings: DEFAULT_MEMORY_SETTINGS,
    memoryDocument: MEMORY_FILE_HEADER,
    memoryEntries: parseMemoryDocument(MEMORY_FILE_HEADER),
    compactingByConv: {},
    memoryNotice: null,
    activeConversationId: null,
    activeProviderId: null,
    activeModelId: null,
    streamingMessageId: null,
    streamingByConv: {},
    abortControllers: {},

    initApp: async (options) => {
      const loaded = await loadInitialState();
      let memoryDoc = loaded.memoryDocument;
      if ((!memoryDoc || !memoryDoc.trim()) && !options?.skipNativeMemoryFallback) {
        const nativeDoc = await readNativeMemoryFile();
        if (nativeDoc && nativeDoc.trim()) {
          memoryDoc = nativeDoc;
          await setKv(KV_KEYS.MEMORY_DOCUMENT, nativeDoc);
        }
      }
      if (!memoryDoc || !memoryDoc.trim()) {
        memoryDoc = `${MEMORY_FILE_HEADER}\n`;
      }
      if (options?.syncNativeMemoryFile) {
        await writeNativeMemoryFile(memoryDoc);
      }
      const memoryEntries = parseMemoryDocument(memoryDoc);

      let activeConvId = loaded.activeConversationId;
      if (!activeConvId || !loaded.conversations.some((c) => c.id === activeConvId)) {
        activeConvId = loaded.conversations[0]?.id ?? null;
      }

      const activeProv =
        loaded.providers.find((p) => p.id === loaded.activeProviderId) ??
        loaded.providers.find((p) => p.enabled) ??
        loaded.providers[0] ??
        null;

      const activeModel =
        loaded.activeModelId &&
        activeProv?.models.some((m) => m.id === loaded.activeModelId)
          ? loaded.activeModelId
          : activeProv?.defaultModel || activeProv?.models[0]?.id || null;

      set({
        ready: true,
        conversations: loaded.conversations,
        providers: loaded.providers,
        promptPresets: loaded.promptPresets,
        appearance: loaded.appearance,
        generation: loaded.generation,
        promptSettings: loaded.promptSettings,
        webdav: loaded.webdav,
        modelProfileSync: loaded.modelProfileSync,
        contextSettings: loaded.contextSettings,
        memorySettings: loaded.memorySettings,
        memoryDocument: memoryDoc,
        memoryEntries,
        activeConversationId: activeConvId,
        activeProviderId: activeProv?.id ?? null,
        activeModelId: activeModel,
      });

      if (activeConvId) {
        await loadMessagesFor(activeConvId);
      }
    },

    prepareForDatabaseRestore: () => {
      restoreEpoch += 1;
      deletedConvIds.clear();
      recentLoadedConvOrder.length = 0;
      discardPendingSettingsKv();
      Object.values(get().abortControllers).forEach((ctrl) => ctrl.abort());
      set({
        conversations: [],
        messagesByConv: {},
        compactingByConv: {},
        streamingMessageId: null,
        streamingByConv: {},
        abortControllers: {},
      });
    },

    reloadFromDatabase: async (options) => {
      get().prepareForDatabaseRestore();
      await get().initApp({
        skipNativeMemoryFallback: Boolean(options?.fromRestore),
        syncNativeMemoryFile: Boolean(options?.fromRestore),
      });
    },

    openDemoShowcase: async () => {
      get().stopStreaming(DEMO_CONVERSATION_ID);
      deletedConvIds.delete(DEMO_CONVERSATION_ID);
      const { createDemoShowcaseData } = await import('@/components/chat/DemoShowcase');
      const now = Date.now();
      const rawDemo = createDemoShowcaseData(now);
      const demoConv: Conversation = {
        ...rawDemo.conversation,
        updatedAt: now,
      };
      await db.transaction('rw', [db.conversations, db.messages], async () => {
        await db.messages.where('conversationId').equals(DEMO_CONVERSATION_ID).delete();
        await db.conversations.put(demoConv);
        await db.messages.bulkPut(rawDemo.messages);
      });
      await setKv(KV_KEYS.ACTIVE_CONVERSATION, demoConv.id);
      set((s) => ({
        conversations: [demoConv, ...s.conversations.filter((c) => c.id !== demoConv.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt
        ),
        messagesByConv: touchAndPruneMessagesMap(
          s.messagesByConv,
          demoConv.id,
          rawDemo.messages,
          demoConv.id,
          s.streamingByConv,
          s.abortControllers,
          s.compactingByConv
        ),
        activeConversationId: demoConv.id,
      }));
    },

    createConversation: async (title = '新对话') => {
      const state = get();
      const now = Date.now();
      const conv: Conversation = {
        id: uid('conv'),
        title,
        createdAt: now,
        updatedAt: now,
        providerId: state.activeProviderId ?? undefined,
        modelId: state.activeModelId ?? undefined,
        systemPromptPresetId: state.promptSettings.defaultPresetId,
        enableRenderPrompt: state.promptSettings.renderEnhancementEnabled,
      };
      await db.conversations.put(conv);
      await setKv(KV_KEYS.ACTIVE_CONVERSATION, conv.id);
      set((s) => ({
        conversations: [conv, ...s.conversations],
        activeConversationId: conv.id,
        messagesByConv: touchAndPruneMessagesMap(
          s.messagesByConv,
          conv.id,
          [],
          conv.id,
          s.streamingByConv,
          s.abortControllers,
          s.compactingByConv
        ),
      }));
      return conv;
    },

    selectConversation: async (id) => {
      await setKv(KV_KEYS.ACTIVE_CONVERSATION, id);
      const state = get();
      const conv = state.conversations.find((c) => c.id === id);
      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );
      const existingList = state.messagesByConv[id];
      set((s) => ({
        activeConversationId: id,
        ...(provider ? { activeProviderId: provider.id, activeModelId: modelId } : {}),
        ...(existingList
          ? {
              messagesByConv: touchAndPruneMessagesMap(
                s.messagesByConv,
                id,
                existingList,
                id,
                s.streamingByConv,
                s.abortControllers,
                s.compactingByConv
              ),
            }
          : {}),
      }));
      if (!existingList) {
        await loadMessagesFor(id);
      }
    },

    renameConversation: async (id, title) => {
      const trimmed = title.trim() || '未命名对话';
      await db.conversations.update(id, { title: trimmed });
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, title: trimmed } : c)),
      }));
    },

    togglePinConversation: async (id) => {
      const conv = get().conversations.find((c) => c.id === id);
      if (!conv) return;
      const pinned = !conv.pinned;
      await db.conversations.update(id, { pinned });
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)),
      }));
    },

    deleteConversation: async (id) => {
      deletedConvIds.add(id);
      get().stopStreaming(id);
      await db.transaction('rw', [db.conversations, db.messages], async () => {
        await db.messages.where('conversationId').equals(id).delete();
        await db.conversations.delete(id);
      });

      let nextActive: string | null = null;
      set((s) => {
        const remaining = s.conversations.filter((c) => c.id !== id);
        nextActive =
          s.activeConversationId === id ? remaining[0]?.id ?? null : s.activeConversationId;
        const nextMap = { ...s.messagesByConv };
        delete nextMap[id];
        const nextStreamingByConv = { ...s.streamingByConv };
        delete nextStreamingByConv[id];
        return {
          conversations: remaining,
          activeConversationId: nextActive,
          messagesByConv: nextMap,
          streamingByConv: nextStreamingByConv,
        };
      });

      await setKv(KV_KEYS.ACTIVE_CONVERSATION, nextActive);

      if (nextActive && !get().messagesByConv[nextActive]) {
        await loadMessagesFor(nextActive);
      }
    },

    updateConversationConfig: async (id, patch) => {
      set((s) => ({
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
      await db.conversations.update(id, patch);
    },

    sendMessage: async (text, images) => {
      const trimmed = text.trim();
      const hasImages = Boolean(images && images.length > 0);
      if (!trimmed && !hasImages) return;

      const epoch = restoreEpoch;
      let state = get();
      let conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) {
        conv = await state.createConversation('新对话');
        state = get();
      }
      if (state.abortControllers[conv.id] || state.compactingByConv[conv.id]) return;

      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );

      if (!provider || !provider.apiKey.trim()) {
        throw new Error('NO_PROVIDER_CONFIGURED');
      }

      const pendingController = new AbortController();
      const convId = conv.id;
      set((s) => ({
        abortControllers: { ...s.abortControllers, [convId]: pendingController },
      }));

      let handedOff = false;
      try {
        const existing = get().messagesByConv[convId] || (await loadMessagesFor(convId));
        if (pendingController.signal.aborted || epoch !== restoreEpoch || isConvDeleted(convId)) {
          return;
        }
        const latestConv = get().conversations.find((c) => c.id === convId) ?? conv;
        const now = Date.now();
        const parts: ContentPart[] = [
          ...(images ?? []),
          ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
        ];
        const userMessage: Message = {
          id: uid('msg'),
          conversationId: convId,
          role: 'user',
          parts,
          createdAt: now,
          updatedAt: now,
          status: 'done',
        };

        // Auto-title on first user message
        let nextTitle = latestConv.title;
        if (existing.length === 0 || latestConv.title === '新对话') {
          nextTitle = trimmed
            ? trimmed.replace(/\s+/g, ' ').slice(0, 26) + (trimmed.length > 26 ? '…' : '')
            : '图片提问';
        }

        const updatedConv: Conversation = {
          ...latestConv,
          title: nextTitle,
          updatedAt: now,
          providerId: provider.id,
          modelId,
        };

        await db.transaction('rw', [db.messages, db.conversations], async () => {
          await db.messages.put(userMessage);
          await db.conversations.put(updatedConv);
        });

        if (pendingController.signal.aborted || epoch !== restoreEpoch || isConvDeleted(convId)) {
          return;
        }

        const nextHistory = [...existing, userMessage];
        set((s) => ({
          conversations: s.conversations
            .map((c) => (c.id === updatedConv.id ? updatedConv : c))
            .sort((a, b) => b.updatedAt - a.updatedAt),
          messagesByConv: {
            ...s.messagesByConv,
            [updatedConv.id]: nextHistory,
          },
        }));

        if (trimmed) {
          void extractAndSaveMemory(trimmed, updatedConv.id, provider, modelId);
        }
        handedOff = true;
        await runAssistantStream(updatedConv, nextHistory, provider, modelId, pendingController);
      } finally {
        if (!handedOff) {
          set((s) => {
            if (s.abortControllers[convId] !== pendingController) return {};
            const nextControllers = { ...s.abortControllers };
            delete nextControllers[convId];
            return { abortControllers: nextControllers };
          });
        }
      }
    },

    stopStreaming: (conversationId) => {
      const targetId = conversationId || get().activeConversationId;
      if (!targetId) return;
      const ctrl = get().abortControllers[targetId];
      if (ctrl) ctrl.abort();
    },

    regenerateMessage: async (assistantMessageId) => {
      const state = get();
      const convId = state.activeConversationId;
      if (!convId) return;
      const conv = state.conversations.find((c) => c.id === convId);
      if (!conv || state.abortControllers[convId] || state.compactingByConv[convId]) return;

      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );
      if (!provider || !provider.apiKey.trim()) {
        throw new Error('NO_PROVIDER_CONFIGURED');
      }
      if (!modelId) throw new Error('请先选择模型');

      const epoch = restoreEpoch;
      const pendingController = new AbortController();
      set((s) => ({
        abortControllers: { ...s.abortControllers, [convId]: pendingController },
      }));

      let handedOff = false;
      try {
        const msgs = get().messagesByConv[convId] || [];
        const targetIdx = msgs.findIndex((m) => m.id === assistantMessageId);
        if (targetIdx === -1) return;

        const historyBefore = msgs.slice(0, targetIdx);
        const removedIds = msgs.slice(targetIdx).map((m) => m.id);
        const invalidateCompaction =
          Boolean(conv.compactedUntilMessageId) &&
          !historyBefore.some((m) => m.id === conv.compactedUntilMessageId);
        const nextConv: Conversation = invalidateCompaction
          ? {
              ...conv,
              contextSummary: undefined,
              compactedUntilMessageId: undefined,
              compactedCount: undefined,
              compactedAt: undefined,
            }
          : conv;

        await db.transaction('rw', [db.messages, db.conversations], async () => {
          await db.messages.bulkDelete(removedIds);
          if (invalidateCompaction) await db.conversations.put(nextConv);
        });

        if (pendingController.signal.aborted || epoch !== restoreEpoch || isConvDeleted(convId)) {
          return;
        }

        set((s) => ({
          conversations: invalidateCompaction
            ? s.conversations.map((c) => (c.id === convId ? nextConv : c))
            : s.conversations,
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: historyBefore,
          },
        }));

        handedOff = true;
        await runAssistantStream(nextConv, historyBefore, provider, modelId, pendingController);
      } finally {
        if (!handedOff) {
          set((s) => {
            if (s.abortControllers[convId] !== pendingController) return {};
            const nextControllers = { ...s.abortControllers };
            delete nextControllers[convId];
            return { abortControllers: nextControllers };
          });
        }
      }
    },

    editAndResend: async (userMessageId, newText) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      const state = get();
      const convId = state.activeConversationId;
      if (!convId) return;
      const conv = state.conversations.find((c) => c.id === convId);
      if (!conv || state.abortControllers[convId] || state.compactingByConv[convId]) return;

      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );
      if (!provider || !provider.apiKey.trim()) {
        throw new Error('NO_PROVIDER_CONFIGURED');
      }
      if (!modelId) throw new Error('请先选择模型');

      const epoch = restoreEpoch;
      const pendingController = new AbortController();
      set((s) => ({
        abortControllers: { ...s.abortControllers, [convId]: pendingController },
      }));

      let handedOff = false;
      try {
        const msgs = get().messagesByConv[convId] || [];
        const targetIdx = msgs.findIndex((m) => m.id === userMessageId);
        if (targetIdx === -1) return;

        const preservedNonText = msgs[targetIdx].parts.filter((p) => p.type !== 'text');
        const updatedUserMsg: Message = {
          ...msgs[targetIdx],
          parts: [...preservedNonText, { type: 'text', text: trimmed }],
          updatedAt: Date.now(),
        };
        const removedIds = msgs.slice(targetIdx + 1).map((m) => m.id);
        const prefixBeforeEdit = msgs.slice(0, targetIdx);
        const invalidateCompaction =
          Boolean(conv.compactedUntilMessageId) &&
          !prefixBeforeEdit.some((m) => m.id === conv.compactedUntilMessageId);
        const nextConv: Conversation = invalidateCompaction
          ? {
              ...conv,
              contextSummary: undefined,
              compactedUntilMessageId: undefined,
              compactedCount: undefined,
              compactedAt: undefined,
            }
          : conv;

        await db.transaction('rw', [db.messages, db.conversations], async () => {
          await db.messages.put(updatedUserMsg);
          if (removedIds.length > 0) await db.messages.bulkDelete(removedIds);
          if (invalidateCompaction) await db.conversations.put(nextConv);
        });

        if (pendingController.signal.aborted || epoch !== restoreEpoch || isConvDeleted(convId)) {
          return;
        }

        const nextHistory = [...prefixBeforeEdit, updatedUserMsg];
        set((s) => ({
          conversations: invalidateCompaction
            ? s.conversations.map((c) => (c.id === convId ? nextConv : c))
            : s.conversations,
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: nextHistory,
          },
        }));

        void extractAndSaveMemory(trimmed, nextConv.id, provider, modelId);
        handedOff = true;
        await runAssistantStream(nextConv, nextHistory, provider, modelId, pendingController);
      } finally {
        if (!handedOff) {
          set((s) => {
            if (s.abortControllers[convId] !== pendingController) return {};
            const nextControllers = { ...s.abortControllers };
            delete nextControllers[convId];
            return { abortControllers: nextControllers };
          });
        }
      }
    },

    deleteMessage: async (messageId) => {
      const state = get();
      const convId = state.activeConversationId;
      if (!convId) return;
      if (state.abortControllers[convId] || state.compactingByConv[convId]) return;
      const conv = state.conversations.find((c) => c.id === convId);
      const prevMsgs = state.messagesByConv[convId] || [];

      let nextConv = conv;
      let convChanged = false;
      if (conv && conv.compactedUntilMessageId) {
        const boundaryIdx = prevMsgs.findIndex((m) => m.id === conv.compactedUntilMessageId);
        const deletedIdx = prevMsgs.findIndex((m) => m.id === messageId);
        if (boundaryIdx >= 0 && deletedIdx >= 0 && deletedIdx <= boundaryIdx) {
          convChanged = true;
          if (conv.compactedUntilMessageId === messageId) {
            const prevUsableBeforeBoundary = prevMsgs
              .slice(0, deletedIdx)
              .filter((m) => m.role === 'user' || m.role === 'assistant');
            const prevBoundary = prevUsableBeforeBoundary[prevUsableBeforeBoundary.length - 1];
            if (prevBoundary) {
              nextConv = {
                ...conv,
                compactedUntilMessageId: prevBoundary.id,
                compactedCount: prevUsableBeforeBoundary.length,
              };
            } else {
              nextConv = {
                ...conv,
                contextSummary: undefined,
                compactedUntilMessageId: undefined,
                compactedCount: undefined,
                compactedAt: undefined,
              };
            }
          } else {
            const remainingUpToBoundary = prevMsgs
              .slice(0, boundaryIdx + 1)
              .filter((m) => m.id !== messageId && (m.role === 'user' || m.role === 'assistant'));
            nextConv = {
              ...conv,
              compactedCount: remainingUpToBoundary.length,
            };
          }
        }
      }

      await db.transaction('rw', [db.messages, db.conversations], async () => {
        await db.messages.delete(messageId);
        if (convChanged && nextConv) await db.conversations.put(nextConv);
      });

      set((s) => ({
        conversations:
          convChanged && nextConv
            ? s.conversations.map((c) => (c.id === convId ? nextConv : c))
            : s.conversations,
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).filter((m) => m.id !== messageId),
        },
      }));
    },

    compactConversation: async (conversationId) => {
      const state = get();
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) return { ok: false, message: '未找到对话' };
      if (state.abortControllers[conversationId]) {
        return { ok: false, message: '对话正在生成中，请稍候再压缩' };
      }
      const msgs = state.messagesByConv[conversationId] || [];
      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );
      const res = await performCompaction(conv, msgs, provider, modelId);
      return { ok: res.ok, message: res.message };
    },

    saveProvider: async (provider) => {
      await db.providers.put(provider);
      const curState = get();
      const exists = curState.providers.some((p) => p.id === provider.id);
      const nextProviders = exists
        ? curState.providers.map((p) => (p.id === provider.id ? provider : p))
        : [...curState.providers, provider];

      set({ providers: nextProviders });

      if (!curState.activeProviderId) {
        const model = provider.defaultModel || provider.models[0]?.id || '';
        await get().setActiveProviderModel(provider.id, model);
      } else if (curState.activeProviderId === provider.id) {
        const curModel = curState.activeModelId;
        const modelStillValid =
          Boolean(curModel) &&
          (provider.defaultModel === curModel ||
            provider.models.some((m) => m.id === curModel));
        if (!modelStillValid) {
          const fallback = provider.defaultModel || provider.models[0]?.id || '';
          await get().setActiveProviderModel(provider.id, fallback);
        }
      }
    },

    deleteProvider: async (id) => {
      await db.providers.delete(id);
      const remaining = get().providers.filter((p) => p.id !== id);
      set({ providers: remaining });
      if (get().activeProviderId === id) {
        const next = remaining[0];
        if (next) {
          await get().setActiveProviderModel(
            next.id,
            next.defaultModel || next.models[0]?.id || ''
          );
        } else {
          await setKv(KV_KEYS.ACTIVE_PROVIDER, null);
          await setKv(KV_KEYS.ACTIVE_MODEL, null);
          set({ activeProviderId: null, activeModelId: null });
        }
      }
    },

    setActiveProviderModel: async (providerId, modelId) => {
      const state = get();
      const targetProvider = state.providers.find((p) => p.id === providerId);
      const targetModelDef = targetProvider?.models.find((m) => m.id === modelId);
      const { profile: targetProfile } = resolveModelReasoningProfile({
        modelId,
        protocol: targetProvider?.protocol,
        modelDef: targetModelDef,
        customRules: state.modelProfileSync.customRules,
        remoteRules: state.modelProfileSync.remoteRules,
      });

      const activeConv = state.conversations.find((c) => c.id === state.activeConversationId);
      const prevProvider = state.providers.find(
        (p) => p.id === (activeConv?.providerId || state.activeProviderId)
      );
      const prevModelId =
        activeConv?.modelId || state.activeModelId || prevProvider?.defaultModel || '';
      const prevModelDef = prevProvider?.models.find((m) => m.id === prevModelId);
      const { profile: prevProfile } = resolveModelReasoningProfile({
        modelId: prevModelId,
        protocol: prevProvider?.protocol,
        modelDef: prevModelDef,
        customRules: state.modelProfileSync.customRules,
        remoteRules: state.modelProfileSync.remoteRules,
      });

      const currentEffort = activeConv?.reasoningEffort ?? state.generation.reasoningEffort;
      const nextEffort =
        prevProfile.strategy === 'none' &&
        (currentEffort === 'off' || currentEffort === undefined)
          ? targetProfile.defaultLevel
          : coerceReasoningEffort(currentEffort, targetProfile);

      set({ activeProviderId: providerId, activeModelId: modelId });

      if (activeConv) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeConv.id
              ? { ...c, providerId, modelId, reasoningEffort: nextEffort }
              : c
          ),
        }));
      }

      await db.transaction('rw', [db.kv, db.conversations], async () => {
        await db.kv.bulkPut([
          { key: KV_KEYS.ACTIVE_PROVIDER, value: providerId },
          { key: KV_KEYS.ACTIVE_MODEL, value: modelId },
        ]);
        if (activeConv) {
          await db.conversations.update(activeConv.id, {
            providerId,
            modelId,
            reasoningEffort: nextEffort,
          });
        }
      });
    },

    fetchProviderModels: async (provider) => {
      const adapter = getProviderAdapter(provider.protocol);
      if (!adapter.listModels) return provider.models;
      return adapter.listModels(provider);
    },

    testProviderConnection: async (provider, modelId) => {
      const adapter = getProviderAdapter(provider.protocol);
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, 15_000);
      let snippet = '';
      try {
        await adapter.chatStream(
          {
            provider,
            modelId,
            systemPrompt: 'Reply strictly with OK.',
            messages: [
              {
                id: 'test_1',
                conversationId: 'test',
                role: 'user',
                parts: [{ type: 'text', text: 'Ping' }],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                status: 'done',
              },
            ],
            generation: {
              ...get().generation,
              maxTokens: 256,
              reasoningEffort: 'off',
              reasoningBudgetTokens: 0,
            },
            sessionId: toStableSessionId(`test_${provider.id}`),
          },
          {
            onTextDelta: (d) => {
              snippet += d;
            },
            onReasoningDelta: () => {},
          },
          ctrl.signal
        );
      } catch (err) {
        if (timedOut) {
          throw new Error('连接测试超时 (15s)');
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      return snippet.trim() || '连接正常';
    },

    savePromptPreset: async (preset) => {
      const updated = { ...preset, updatedAt: Date.now() };
      await db.promptPresets.put(updated);
      const exists = get().promptPresets.some((p) => p.id === updated.id);
      set({
        promptPresets: exists
          ? get().promptPresets.map((p) => (p.id === updated.id ? updated : p))
          : [...get().promptPresets, updated],
      });
    },

    deletePromptPreset: async (id) => {
      await db.promptPresets.delete(id);
      const remaining = get().promptPresets.filter((p) => p.id !== id);
      set({ promptPresets: remaining });
      if (get().promptSettings.defaultPresetId === id) {
        await get().updatePromptSettings({ defaultPresetId: remaining[0]?.id || 'stem-tutor' });
      }
    },

    resetBuiltinPreset: async (id) => {
      const builtin = BUILTIN_PROMPT_PRESETS.find((p) => p.id === id);
      if (!builtin) return;
      await db.promptPresets.put(builtin);
      set((s) => ({
        promptPresets: s.promptPresets.map((p) => (p.id === id ? builtin : p)),
      }));
    },

    updatePromptSettings: async (patch) => {
      let next!: PromptSettings;
      set((s) => {
        next = { ...s.promptSettings, ...patch };
        return { promptSettings: next };
      });
      await setKv(KV_KEYS.PROMPT, next);
    },

    updateAppearance: async (patch) => {
      let next!: AppearanceSettings;
      set((s) => {
        next = { ...s.appearance, ...patch };
        return { appearance: next };
      });
      scheduleDebouncedKv(KV_KEYS.APPEARANCE, next);
    },

    updateGeneration: async (patch) => {
      let next!: GenerationSettings;
      set((s) => {
        next = { ...s.generation, ...patch };
        return { generation: next };
      });
      scheduleDebouncedKv(KV_KEYS.GENERATION, next);
    },

    updateWebDav: async (patch) => {
      let next!: WebDavSyncSettings;
      set((s) => {
        next = { ...s.webdav, ...patch };
        return { webdav: next };
      });
      scheduleDebouncedKv(KV_KEYS.WEBDAV, next);
    },

    updateModelProfileSync: async (patch) => {
      let next!: ModelProfileSyncSettings;
      set((s) => {
        next = { ...s.modelProfileSync, ...patch };
        return { modelProfileSync: next };
      });
      await setKv(KV_KEYS.MODEL_PROFILES, next);
    },

    saveCustomModelProfileRules: async (rules) => {
      let next!: ModelProfileSyncSettings;
      set((s) => {
        next = { ...s.modelProfileSync, customRules: rules };
        return { modelProfileSync: next };
      });
      await setKv(KV_KEYS.MODEL_PROFILES, next);
    },

    syncRemoteModelProfiles: async (urlOverride) => {
      const state = get();
      const url = (urlOverride ?? state.modelProfileSync.remoteUrl).trim();
      if (!url) {
        throw new Error('请填写规则库同步 URL');
      }
      const res = await simpleRequest({
        url,
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (res.status < 200 || res.status >= 300) {
        const msg = `同步失败 (HTTP ${res.status})`;
        let errNext!: ModelProfileSyncSettings;
        set((s) => {
          errNext = { ...s.modelProfileSync, remoteUrl: url, lastStatus: msg };
          return { modelProfileSync: errNext };
        });
        await setKv(KV_KEYS.MODEL_PROFILES, errNext);
        throw new Error(msg);
      }

      const rules = parseModelProfileRulesJson(res.body);
      let next!: ModelProfileSyncSettings;
      set((s) => {
        next = {
          ...s.modelProfileSync,
          remoteUrl: url,
          remoteRules: rules,
          lastSyncedAt: Date.now(),
          lastStatus: `已同步 ${rules.length} 条在线规则`,
        };
        return { modelProfileSync: next };
      });
      await setKv(KV_KEYS.MODEL_PROFILES, next);
      return { count: rules.length };
    },

    updateContextSettings: async (patch) => {
      let next!: ContextSettings;
      set((s) => {
        next = { ...s.contextSettings, ...patch };
        return { contextSettings: next };
      });
      scheduleDebouncedKv(KV_KEYS.CONTEXT, next);
    },

    updateMemorySettings: async (patch) => {
      let next!: MemorySettings;
      set((s) => {
        next = { ...s.memorySettings, ...patch };
        return { memorySettings: next };
      });
      scheduleDebouncedKv(KV_KEYS.MEMORY_SETTINGS, next);
    },

    saveMemoryDocument: async (markdown) => {
      await persistMemoryMutation(() => ({
        entries: [],
        explicitDoc: markdown,
      }));
    },

    upsertMemoryEntry: async (entry) => {
      const sanitizedTags = entry.tags.map((t) => t.trim()).filter(Boolean).slice(0, 6);
      const normalized: MemoryEntry = {
        ...entry,
        content: entry.content.replace(/[\r\n]+/g, ' ').trim(),
        tags: sanitizedTags,
      };
      await persistMemoryMutation((prevEntries) => {
        const exists = prevEntries.some((m) => m.id === normalized.id);
        return {
          entries: exists
            ? prevEntries.map((m) => (m.id === normalized.id ? normalized : m))
            : [normalized, ...prevEntries],
        };
      });
    },

    deleteMemoryEntry: async (id) => {
      await persistMemoryMutation((prevEntries) => ({
        entries: prevEntries.filter((m) => m.id !== id),
      }));
    },

    clearAllMemories: async () => {
      await persistMemoryMutation(() => ({
        entries: [],
        explicitDoc: `${MEMORY_FILE_HEADER}\n`,
      }));
    },

    clearMemoryNotice: () => set({ memoryNotice: null }),
  };
});
