import { create } from 'zustand';
import { db, KV_KEYS, loadInitialState, setKv } from '@/db/database';
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
  parseLlmMemoryExtraction,
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
import { createDemoShowcaseData, DEMO_CONVERSATION_ID } from '@/components/chat/DemoShowcase';

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const deletedConvIds = new Set<string>();
let memoryNoticeTimer: ReturnType<typeof setTimeout> | null = null;

function resolveValidProviderAndModel(
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
  } else if (!conv?.providerId && activeProv && activeProv.id === provider.id && activeModelId) {
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
  initApp: () => Promise<void>;
  reloadFromDatabase: () => Promise<void>;
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
      .where('conversationId')
      .equals(conversationId)
      .sortBy('createdAt');
    set((s) => ({
      messagesByConv: {
        ...s.messagesByConv,
        [conversationId]: list,
      },
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

  const persistMemoryEntries = async (entries: MemoryEntry[], explicitDoc?: string) => {
    const doc = explicitDoc !== undefined ? explicitDoc : serializeMemoryDocument(entries);
    const parsedEntries = explicitDoc !== undefined ? parseMemoryDocument(doc) : entries;
    await setKv(KV_KEYS.MEMORY_DOCUMENT, doc);
    void writeNativeMemoryFile(doc);
    set({ memoryDocument: doc, memoryEntries: parsedEntries });
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

    const toCompact = activeMessages.slice(0, activeMessages.length - keepRecent);
    const lastCompactedMsg = toCompact[toCompact.length - 1];

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

      const finalSummary =
        summaryText.trim() || buildFallbackLocalSummary(conversation.contextSummary, toCompact);

      const allUsableCount = allMessages.filter(
        (m) => m.role === 'user' || m.role === 'assistant'
      ).length;
      const prevCompactedTotal = Math.max(
        conversation.compactedCount ?? 0,
        allUsableCount - activeMessages.length
      );

      const updatedConv: Conversation = {
        ...conversation,
        contextSummary: finalSummary,
        compactedUntilMessageId: lastCompactedMsg.id,
        compactedCount: prevCompactedTotal + toCompact.length,
        updatedAt: Date.now(),
      };

      if (!isConvDeleted(conversation.id)) {
        await db.conversations.put(updatedConv);
        set((s) => ({
          conversations: s.conversations
            .map((c) => (c.id === updatedConv.id ? updatedConv : c))
            .sort((a, b) => b.updatedAt - a.updatedAt),
        }));
      }

      return {
        ok: true,
        message: `已压缩 ${toCompact.length} 条较早消息，保留最近 ${keepRecent} 条活跃上下文`,
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
    if (!state.memorySettings.enabled || !state.memorySettings.autoExtract) return;
    const trigger = detectMemoryTrigger(userText);
    if (!trigger) return;

    const sensCheck = detectSensitiveInfo(userText);
    let extracted: MemoryEntry[] = [];

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
        extracted = parseLlmMemoryExtraction(
          rawOut,
          get().memorySettings.recordSensitiveInfo,
          convId
        );
      } catch {
        extracted = [];
      } finally {
        clearTimeout(timer);
      }
    }

    const latestBeforeMerge = get();
    if (!latestBeforeMerge.memorySettings.enabled || !latestBeforeMerge.memorySettings.autoExtract) {
      return;
    }

    if (extracted.length === 0) {
      extracted = extractMemoriesLocal(userText, latestBeforeMerge.memorySettings, convId);
    }

    if (extracted.length === 0) {
      if (sensCheck.isSensitive && !latestBeforeMerge.memorySettings.recordSensitiveInfo) {
        flashMemoryNotice('检测到敏感隐私信息，已按设置跳过记忆写入');
      }
      return;
    }

    const merged = mergeMemoryEntries(
      latestBeforeMerge.memoryEntries,
      extracted,
      latestBeforeMerge.memorySettings.recordSensitiveInfo
    );

    if (merged.addedCount > 0 || merged.updatedCount > 0) {
      await persistMemoryEntries(merged.entries);
      const changed = merged.addedCount + merged.updatedCount;
      const suffix = merged.skippedSensitiveCount > 0 ? '（已自动过滤敏感条目）' : '';
      flashMemoryNotice(`已写入 ${changed} 条长期记忆${suffix}`);
    } else if (
      merged.skippedSensitiveCount > 0 ||
      (sensCheck.isSensitive && !latestBeforeMerge.memorySettings.recordSensitiveInfo)
    ) {
      flashMemoryNotice('检测到敏感隐私信息，已按设置跳过记忆写入');
    }
  };

  const runAssistantStream = async (
    conversation: Conversation,
    historyBeforeReply: Message[],
    provider: ProviderConfig,
    modelId: string
  ) => {
    const state = get();
    const assistantMsgId = uid('msg');
    const startedAt = Date.now();

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

    await db.messages.put(initialAssistant);
    const controller = new AbortController();
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

    const syncAssistantMessage = (status: Message['status'], error?: string, forceDb = false) => {
      if (isConvDeleted(conversation.id)) return;

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

      const updated: Message = {
        ...initialAssistant,
        parts,
        updatedAt: Date.now(),
        usage,
        error,
        status,
      };

      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversation.id]: (s.messagesByConv[conversation.id] || []).map((m) =>
            m.id === assistantMsgId ? updated : m
          ),
        },
      }));

      const now = Date.now();
      if (forceDb || now - lastFlush > 380) {
        lastFlush = now;
        void db.messages.put(updated);
      }
    };

    try {
      const modelDef = provider.models.find((m) => m.id === modelId);
      let effectiveConv =
        get().conversations.find((c) => c.id === conversation.id) ?? conversation;

      const preflightStats = computeContextUsageStats({
        messages: historyBeforeReply,
        compactedUntilMessageId: effectiveConv.compactedUntilMessageId,
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
            syncAssistantMessage('streaming');
          },
          onTextDelta: (delta) => {
            if (reasoningStartMs !== null && reasoningDurationMs === 0) {
              reasoningDurationMs = Date.now() - reasoningStartMs;
            }
            answerText += delta;
            syncAssistantMessage('streaming');
          },
          onUsage: (u) => {
            usage = u;
          },
        },
        controller.signal
      );

      syncAssistantMessage('done', undefined, true);
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (isAbort) {
        syncAssistantMessage('aborted', undefined, true);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        syncAssistantMessage('error', message, true);
      }
    } finally {
      const updatedAt = Date.now();
      const deleted = isConvDeleted(conversation.id);
      if (!deleted) {
        await db.conversations.update(conversation.id, { updatedAt });
      }
      set((s) => {
        const nextControllers = { ...s.abortControllers };
        delete nextControllers[conversation.id];
        const nextStreamingByConv = { ...s.streamingByConv };
        delete nextStreamingByConv[conversation.id];
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

    initApp: async () => {
      const loaded = await loadInitialState();
      let memoryDoc = loaded.memoryDocument;
      if (!memoryDoc || !memoryDoc.trim()) {
        const nativeDoc = await readNativeMemoryFile();
        if (nativeDoc && nativeDoc.trim()) {
          memoryDoc = nativeDoc;
          await setKv(KV_KEYS.MEMORY_DOCUMENT, nativeDoc);
        }
      }
      if (!memoryDoc || !memoryDoc.trim()) {
        memoryDoc = MEMORY_FILE_HEADER;
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
          : activeProv?.defaultModel ?? activeProv?.models[0]?.id ?? null;

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

    reloadFromDatabase: async () => {
      Object.values(get().abortControllers).forEach((ctrl) => ctrl.abort());
      set({ messagesByConv: {}, streamingMessageId: null, streamingByConv: {}, abortControllers: {} });
      await get().initApp();
    },

    openDemoShowcase: async () => {
      deletedConvIds.delete(DEMO_CONVERSATION_ID);
      const now = Date.now();
      const rawDemo = createDemoShowcaseData(now);
      const demoConv: Conversation = {
        ...rawDemo.conversation,
        updatedAt: now,
      };
      await db.transaction('rw', [db.conversations, db.messages], async () => {
        await db.conversations.put(demoConv);
        await db.messages.bulkPut(rawDemo.messages);
      });
      await setKv(KV_KEYS.ACTIVE_CONVERSATION, demoConv.id);
      set((s) => ({
        conversations: [demoConv, ...s.conversations.filter((c) => c.id !== demoConv.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt
        ),
        messagesByConv: {
          ...s.messagesByConv,
          [demoConv.id]: rawDemo.messages,
        },
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
        messagesByConv: { ...s.messagesByConv, [conv.id]: [] },
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
      set({
        activeConversationId: id,
        ...(provider ? { activeProviderId: provider.id, activeModelId: modelId } : {}),
      });
      if (!get().messagesByConv[id]) {
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

      const remaining = get().conversations.filter((c) => c.id !== id);
      let nextActive = get().activeConversationId;
      if (nextActive === id) {
        nextActive = remaining[0]?.id ?? null;
        await setKv(KV_KEYS.ACTIVE_CONVERSATION, nextActive);
      }

      set((s) => {
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

      let state = get();
      let conv = state.conversations.find((c) => c.id === state.activeConversationId);
      if (!conv) {
        conv = await state.createConversation('新对话');
        state = get();
      }
      if (state.abortControllers[conv.id]) return;

      const { provider, modelId } = resolveValidProviderAndModel(
        conv,
        state.providers,
        state.activeProviderId,
        state.activeModelId
      );

      if (!provider || !provider.apiKey.trim()) {
        throw new Error('NO_PROVIDER_CONFIGURED');
      }

      const existing = state.messagesByConv[conv.id] || (await loadMessagesFor(conv.id));
      const now = Date.now();
      const parts: ContentPart[] = [
        ...(images ?? []),
        ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
      ];
      const userMessage: Message = {
        id: uid('msg'),
        conversationId: conv.id,
        role: 'user',
        parts,
        createdAt: now,
        updatedAt: now,
        status: 'done',
      };

      // Auto-title on first user message
      let nextTitle = conv.title;
      if (existing.length === 0 || conv.title === '新对话') {
        nextTitle = trimmed
          ? trimmed.replace(/\s+/g, ' ').slice(0, 26) + (trimmed.length > 26 ? '…' : '')
          : '图片提问';
      }

      const updatedConv: Conversation = {
        ...conv,
        title: nextTitle,
        updatedAt: now,
        providerId: provider.id,
        modelId,
      };

      await db.transaction('rw', [db.messages, db.conversations], async () => {
        await db.messages.put(userMessage);
        await db.conversations.put(updatedConv);
      });

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
      await runAssistantStream(updatedConv, nextHistory, provider, modelId);
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
      if (!conv || state.abortControllers[convId]) return;

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

      const msgs = state.messagesByConv[convId] || [];
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
          }
        : conv;

      await db.transaction('rw', [db.messages, db.conversations], async () => {
        await db.messages.bulkDelete(removedIds);
        if (invalidateCompaction) await db.conversations.put(nextConv);
      });

      set((s) => ({
        conversations: invalidateCompaction
          ? s.conversations.map((c) => (c.id === convId ? nextConv : c))
          : s.conversations,
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: historyBefore,
        },
      }));

      await runAssistantStream(nextConv, historyBefore, provider, modelId);
    },

    editAndResend: async (userMessageId, newText) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      const state = get();
      const convId = state.activeConversationId;
      if (!convId) return;
      const conv = state.conversations.find((c) => c.id === convId);
      if (!conv || state.abortControllers[convId]) return;

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

      const msgs = state.messagesByConv[convId] || [];
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
          }
        : conv;

      await db.transaction('rw', [db.messages, db.conversations], async () => {
        await db.messages.put(updatedUserMsg);
        if (removedIds.length > 0) await db.messages.bulkDelete(removedIds);
        if (invalidateCompaction) await db.conversations.put(nextConv);
      });

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
      await runAssistantStream(nextConv, nextHistory, provider, modelId);
    },

    deleteMessage: async (messageId) => {
      const state = get();
      const convId = state.activeConversationId;
      if (!convId) return;
      const conv = state.conversations.find((c) => c.id === convId);
      const prevMsgs = state.messagesByConv[convId] || [];
      const remaining = prevMsgs.filter((m) => m.id !== messageId);

      let nextConv = conv;
      let convChanged = false;
      if (conv && conv.compactedUntilMessageId === messageId) {
        convChanged = true;
        const deletedIdx = prevMsgs.findIndex((m) => m.id === messageId);
        const prevUsableBeforeBoundary = prevMsgs
          .slice(0, Math.max(0, deletedIdx))
          .filter((m) => m.role === 'user' || m.role === 'assistant');
        const prevBoundary = prevUsableBeforeBoundary[prevUsableBeforeBoundary.length - 1];
        if (prevBoundary) {
          nextConv = {
            ...conv,
            compactedUntilMessageId: prevBoundary.id,
            compactedCount: Math.max(1, (conv.compactedCount ?? 1) - 1),
          };
        } else {
          nextConv = {
            ...conv,
            contextSummary: undefined,
            compactedUntilMessageId: undefined,
            compactedCount: undefined,
          };
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
          [convId]: remaining,
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
      const exists = get().providers.some((p) => p.id === provider.id);
      const nextProviders = exists
        ? get().providers.map((p) => (p.id === provider.id ? provider : p))
        : [...get().providers, provider];

      set({ providers: nextProviders });

      if (!get().activeProviderId || get().activeProviderId === provider.id) {
        const model = provider.defaultModel || provider.models[0]?.id || null;
        await get().setActiveProviderModel(provider.id, model || '');
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

      await setKv(KV_KEYS.ACTIVE_PROVIDER, providerId);
      await setKv(KV_KEYS.ACTIVE_MODEL, modelId);
      set({ activeProviderId: providerId, activeModelId: modelId });

      if (activeConv) {
        await db.conversations.update(activeConv.id, {
          providerId,
          modelId,
          reasoningEffort: nextEffort,
        });
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeConv.id
              ? { ...c, providerId, modelId, reasoningEffort: nextEffort }
              : c
          ),
        }));
      }
    },

    fetchProviderModels: async (provider) => {
      const adapter = getProviderAdapter(provider.protocol);
      if (!adapter.listModels) return provider.models;
      return adapter.listModels(provider);
    },

    testProviderConnection: async (provider, modelId) => {
      const adapter = getProviderAdapter(provider.protocol);
      const ctrl = new AbortController();
      let snippet = '';
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
      await setKv(KV_KEYS.APPEARANCE, next);
    },

    updateGeneration: async (patch) => {
      let next!: GenerationSettings;
      set((s) => {
        next = { ...s.generation, ...patch };
        return { generation: next };
      });
      await setKv(KV_KEYS.GENERATION, next);
    },

    updateWebDav: async (patch) => {
      let next!: WebDavSyncSettings;
      set((s) => {
        next = { ...s.webdav, ...patch };
        return { webdav: next };
      });
      await setKv(KV_KEYS.WEBDAV, next);
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
        const errNext = {
          ...state.modelProfileSync,
          remoteUrl: url,
          lastStatus: msg,
        };
        await setKv(KV_KEYS.MODEL_PROFILES, errNext);
        set({ modelProfileSync: errNext });
        throw new Error(msg);
      }

      const rules = parseModelProfileRulesJson(res.body);
      const next: ModelProfileSyncSettings = {
        ...state.modelProfileSync,
        remoteUrl: url,
        remoteRules: rules,
        lastSyncedAt: Date.now(),
        lastStatus: `已同步 ${rules.length} 条在线规则`,
      };
      await setKv(KV_KEYS.MODEL_PROFILES, next);
      set({ modelProfileSync: next });
      return { count: rules.length };
    },

    updateContextSettings: async (patch) => {
      let next!: ContextSettings;
      set((s) => {
        next = { ...s.contextSettings, ...patch };
        return { contextSettings: next };
      });
      await setKv(KV_KEYS.CONTEXT, next);
    },

    updateMemorySettings: async (patch) => {
      let next!: MemorySettings;
      set((s) => {
        next = { ...s.memorySettings, ...patch };
        return { memorySettings: next };
      });
      await setKv(KV_KEYS.MEMORY_SETTINGS, next);
    },

    saveMemoryDocument: async (markdown) => {
      await persistMemoryEntries(parseMemoryDocument(markdown), markdown);
    },

    upsertMemoryEntry: async (entry) => {
      const state = get();
      const exists = state.memoryEntries.some((m) => m.id === entry.id);
      const nextEntries = exists
        ? state.memoryEntries.map((m) => (m.id === entry.id ? entry : m))
        : [entry, ...state.memoryEntries];
      await persistMemoryEntries(nextEntries);
    },

    deleteMemoryEntry: async (id) => {
      const nextEntries = get().memoryEntries.filter((m) => m.id !== id);
      await persistMemoryEntries(nextEntries);
    },

    clearAllMemories: async () => {
      await persistMemoryEntries([], `${MEMORY_FILE_HEADER}\n`);
    },

    clearMemoryNotice: () => set({ memoryNotice: null }),
  };
});
