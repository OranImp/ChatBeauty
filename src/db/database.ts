import Dexie, { type Table } from 'dexie';
import type { Conversation, Message, ProviderConfig } from '@/types/chat';
import type { PromptSettings, SystemPromptPreset } from '@/types/prompt';
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
  type ModelProfileSyncSettings,
  type WebDavSyncSettings,
} from '@/types/settings';
import {
  BUILTIN_PROMPT_PRESETS,
  DEFAULT_PROMPT_SETTINGS,
  DEFAULT_RENDER_ENHANCEMENT_PROMPT,
} from '@/services/prompts/presets';

export interface KvRecord {
  key: string;
  value: unknown;
}

class ChatBeautyDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  providers!: Table<ProviderConfig, string>;
  promptPresets!: Table<SystemPromptPreset, string>;
  kv!: Table<KvRecord, string>;

  constructor() {
    super('ChatBeautyDB');
    this.version(1).stores({
      conversations: 'id, updatedAt, pinned',
      messages: 'id, conversationId, createdAt',
      providers: 'id, protocol, createdAt',
      promptPresets: 'id, category, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new ChatBeautyDatabase();

const KV_KEYS = {
  INITIALIZED: 'app:initialized_v1',
  APPEARANCE: 'settings:appearance',
  GENERATION: 'settings:generation',
  PROMPT: 'settings:prompt',
  WEBDAV: 'settings:webdav',
  MODEL_PROFILES: 'settings:modelProfiles',
  CONTEXT: 'settings:context',
  MEMORY_SETTINGS: 'settings:memory',
  MEMORY_DOCUMENT: 'memory:document_v1',
  ACTIVE_CONVERSATION: 'state:activeConversationId',
  ACTIVE_PROVIDER: 'state:activeProviderId',
  ACTIVE_MODEL: 'state:activeModelId',
} as const;

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  if (!row || row.value === undefined) return fallback;
  if (row.value === null && fallback !== null) return fallback;
  return row.value as T;
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

let seedingPromise: Promise<void> | null = null;

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seedingPromise) return seedingPromise;
  seedingPromise = (async () => {
    const initialized = await getKv<boolean>(KV_KEYS.INITIALIZED, false);
    if (!initialized) {
      await db.transaction(
        'rw',
        [db.promptPresets, db.conversations, db.messages, db.kv],
        async () => {
          const alreadyInit = await getKv<boolean>(KV_KEYS.INITIALIZED, false);
          if (alreadyInit) return;

          const existingPresets = await db.promptPresets.count();
          if (existingPresets === 0) {
            await db.promptPresets.bulkPut(BUILTIN_PROMPT_PRESETS);
          }

          await setKv(KV_KEYS.APPEARANCE, DEFAULT_APPEARANCE_SETTINGS);
          await setKv(KV_KEYS.GENERATION, DEFAULT_GENERATION_SETTINGS);
          await setKv(KV_KEYS.PROMPT, DEFAULT_PROMPT_SETTINGS);
          await setKv(KV_KEYS.WEBDAV, DEFAULT_WEBDAV_SETTINGS);
          await setKv(KV_KEYS.MODEL_PROFILES, DEFAULT_MODEL_PROFILE_SYNC_SETTINGS);
          await setKv(KV_KEYS.CONTEXT, DEFAULT_CONTEXT_SETTINGS);
          await setKv(KV_KEYS.MEMORY_SETTINGS, DEFAULT_MEMORY_SETTINGS);
          await setKv(KV_KEYS.MEMORY_DOCUMENT, '');
          await setKv(KV_KEYS.INITIALIZED, true);
        }
      );
      return;
    }

    // Ensure new built-in presets exist if upgraded
    const existingIds = new Set((await db.promptPresets.toArray()).map((p) => p.id));
    const missing = BUILTIN_PROMPT_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      await db.promptPresets.bulkPut(missing);
    }

    // Migrate legacy default blue accent to restrained monochrome default
    const savedAppearance = await getKv<AppearanceSettings>(
      KV_KEYS.APPEARANCE,
      DEFAULT_APPEARANCE_SETTINGS
    );
    if (savedAppearance?.accentColor?.toLowerCase() === '#38bdf8') {
      await setKv(KV_KEYS.APPEARANCE, {
        ...savedAppearance,
        accentColor: DEFAULT_APPEARANCE_SETTINGS.accentColor,
      });
    }

    // Upgrade unmodified legacy built-in render prompt with SVG wire-collision avoidance rule
    const savedPrompt = await getKv<PromptSettings>(KV_KEYS.PROMPT, DEFAULT_PROMPT_SETTINGS);
    if (
      savedPrompt?.renderEnhancementPrompt?.includes('仔细计算坐标确保文字与连线**互不遮挡、居中对齐**') &&
      !savedPrompt.renderEnhancementPrompt.includes('垂直支路元件')
    ) {
      await setKv(KV_KEYS.PROMPT, {
        ...savedPrompt,
        renderEnhancementPrompt: DEFAULT_RENDER_ENHANCEMENT_PROMPT,
      });
    }
  })().finally(() => {
    seedingPromise = null;
  });
  return seedingPromise;
}

export async function loadInitialState(): Promise<{
  conversations: Conversation[];
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
  activeConversationId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
}> {
  await ensureDatabaseSeeded();

  // Reconcile any messages left in 'streaming' state by an unexpected crash or reload
  const staleStreaming = await db.messages.filter((m) => m.status === 'streaming').toArray();
  if (staleStreaming.length > 0) {
    const now = Date.now();
    await db.messages.bulkPut(
      staleStreaming.map((m) => ({ ...m, status: 'aborted' as const, updatedAt: now }))
    );
  }

  const [
    conversations,
    providers,
    promptPresets,
    appearance,
    generation,
    promptSettings,
    webdav,
    modelProfileSync,
    contextSettings,
    memorySettings,
    memoryDocument,
    activeConversationId,
    activeProviderId,
    activeModelId,
  ] = await Promise.all([
    db.conversations.orderBy('updatedAt').reverse().toArray(),
    db.providers.orderBy('createdAt').toArray(),
    db.promptPresets.toArray(),
    getKv<AppearanceSettings>(KV_KEYS.APPEARANCE, DEFAULT_APPEARANCE_SETTINGS),
    getKv<GenerationSettings>(KV_KEYS.GENERATION, DEFAULT_GENERATION_SETTINGS),
    getKv<PromptSettings>(KV_KEYS.PROMPT, DEFAULT_PROMPT_SETTINGS),
    getKv<WebDavSyncSettings>(KV_KEYS.WEBDAV, DEFAULT_WEBDAV_SETTINGS),
    getKv<ModelProfileSyncSettings>(
      KV_KEYS.MODEL_PROFILES,
      DEFAULT_MODEL_PROFILE_SYNC_SETTINGS
    ),
    getKv<ContextSettings>(KV_KEYS.CONTEXT, DEFAULT_CONTEXT_SETTINGS),
    getKv<MemorySettings>(KV_KEYS.MEMORY_SETTINGS, DEFAULT_MEMORY_SETTINGS),
    getKv<string>(KV_KEYS.MEMORY_DOCUMENT, ''),
    getKv<string | null>(KV_KEYS.ACTIVE_CONVERSATION, null),
    getKv<string | null>(KV_KEYS.ACTIVE_PROVIDER, null),
    getKv<string | null>(KV_KEYS.ACTIVE_MODEL, null),
  ]);

  return {
    conversations,
    providers,
    promptPresets,
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS, ...appearance },
    generation: {
      ...DEFAULT_GENERATION_SETTINGS,
      ...generation,
      enabledParams: {
        ...DEFAULT_GENERATION_SETTINGS.enabledParams,
        ...generation.enabledParams,
      },
    },
    promptSettings: { ...DEFAULT_PROMPT_SETTINGS, ...promptSettings },
    webdav: { ...DEFAULT_WEBDAV_SETTINGS, ...webdav },
    modelProfileSync: { ...DEFAULT_MODEL_PROFILE_SYNC_SETTINGS, ...modelProfileSync },
    contextSettings: { ...DEFAULT_CONTEXT_SETTINGS, ...contextSettings },
    memorySettings: { ...DEFAULT_MEMORY_SETTINGS, ...memorySettings },
    memoryDocument: typeof memoryDocument === 'string' ? memoryDocument : '',
    activeConversationId,
    activeProviderId,
    activeModelId,
  };
}

export { KV_KEYS };
