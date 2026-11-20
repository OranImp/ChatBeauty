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
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_MODEL_PROFILE_SYNC_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
  type AppearanceSettings,
  type GenerationSettings,
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
import { toStableSessionId } from '@/services/llm/adapters/shared';
import {
  coerceReasoningEffort,
  parseModelProfileRulesJson,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import { simpleRequest, syncBackgroundStreamingState } from '@/services/transport/streamHttp';
import { createDemoShowcaseData, DEMO_CONVERSATION_ID } from '@/components/chat/DemoShowcase';

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const deletedConvIds = new Set<string>();

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

    // Build effective system prompt
    const presetId = conversation.systemPromptPresetId || state.promptSettings.defaultPresetId;
    const preset = state.promptPresets.find((p) => p.id === presetId);
    const renderEnabled =
      conversation.enableRenderPrompt !== undefined
        ? conversation.enableRenderPrompt
        : state.promptSettings.renderEnhancementEnabled;

    const systemPrompt = composeSystemPrompt({
      presetContent: preset?.content,
      customSystemPrompt: conversation.customSystemPrompt,
      renderEnabled,
      renderPrompt: state.promptSettings.renderEnhancementPrompt,
    });

    let reasoningText = '';
    let answerText = '';
    let reasoningStartMs: number | null = null;
    let reasoningDurationMs = 0;
    let usage: Message['usage'] | undefined;
    let lastFlush = 0;

    const isConvDeleted = () =>
      deletedConvIds.has(conversation.id) ||
      !get().conversations.some((c) => c.id === conversation.id);

    const syncAssistantMessage = (status: Message['status'], error?: string, forceDb = false) => {
      if (isConvDeleted()) return;

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
      const adapter = getProviderAdapter(provider.protocol);
      const modelDef = provider.models.find((m) => m.id === modelId);
      const { profile } = resolveModelReasoningProfile({
        modelId,
        protocol: provider.protocol,
        modelDef,
        customRules: state.modelProfileSync.customRules,
        remoteRules: state.modelProfileSync.remoteRules,
      });
      const effectiveReasoning = coerceReasoningEffort(
        conversation.reasoningEffort ?? state.generation.reasoningEffort,
        profile
      );
      await adapter.chatStream(
        {
          provider,
          modelId,
          systemPrompt,
          messages: historyBeforeReply,
          generation: {
            ...state.generation,
            reasoningEffort: effectiveReasoning,
          },
          modelParams: modelDef?.params,
          conversationParams: conversation.customParams,
          reasoningProfile: profile,
          sessionId: toStableSessionId(conversation.id),
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
      const deleted = isConvDeleted();
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
    activeConversationId: null,
    activeProviderId: null,
    activeModelId: null,
    streamingMessageId: null,
    streamingByConv: {},
    abortControllers: {},

    initApp: async () => {
      const loaded = await loadInitialState();
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
      await db.messages.bulkDelete(removedIds);

      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: historyBefore,
        },
      }));

      await runAssistantStream(conv, historyBefore, provider, modelId);
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

      await db.transaction('rw', [db.messages], async () => {
        await db.messages.put(updatedUserMsg);
        if (removedIds.length > 0) await db.messages.bulkDelete(removedIds);
      });

      const nextHistory = [...msgs.slice(0, targetIdx), updatedUserMsg];
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: nextHistory,
        },
      }));

      await runAssistantStream(conv, nextHistory, provider, modelId);
    },

    deleteMessage: async (messageId) => {
      const convId = get().activeConversationId;
      if (!convId) return;
      await db.messages.delete(messageId);
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [convId]: (s.messagesByConv[convId] || []).filter((m) => m.id !== messageId),
        },
      }));
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
  };
});
