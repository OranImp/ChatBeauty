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
    this.version(2).stores({
      conversations: 'id, updatedAt, pinned',
      messages: 'id, [conversationId+createdAt], conversationId, createdAt, status',
      providers: 'id, protocol, createdAt',
      promptPresets: 'id, category, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new ChatBeautyDatabase();

const CURRENT_MIGRATION_VERSION = 2;

const KV_KEYS = {
  INITIALIZED: 'app:initialized_v1',
  MIGRATION_VERSION: 'app:migration_v',
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

function resolveKvValue<T>(row: KvRecord | undefined, fallback: T): T {
  if (!row || row.value === undefined) return fallback;
  if (row.value === null && fallback !== null) return fallback;
  return row.value as T;
}

const pendingKvTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingKvValues = new Map<string, unknown>();

export function scheduleDebouncedKv(key: string, value: unknown, delayMs = 250): void {
  pendingKvValues.set(key, value);
  const existing = pendingKvTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingKvTimers.delete(key);
    if (!pendingKvValues.has(key)) return;
    const latest = pendingKvValues.get(key);
    pendingKvValues.delete(key);
    void setKv(key, latest).catch(() => undefined);
  }, delayMs);
  pendingKvTimers.set(key, timer);
}

export async function flushPendingSettingsKv(): Promise<void> {
  if (pendingKvTimers.size > 0) {
    for (const timer of pendingKvTimers.values()) {
      clearTimeout(timer);
    }
    pendingKvTimers.clear();
  }
  if (pendingKvValues.size === 0) return;
  const entries = Array.from(pendingKvValues.entries()).map(([key, value]) => ({ key, value }));
  pendingKvValues.clear();
  await db.kv.bulkPut(entries);
}

export function discardPendingSettingsKv(): void {
  for (const timer of pendingKvTimers.values()) {
    clearTimeout(timer);
  }
  pendingKvTimers.clear();
  pendingKvValues.clear();
}

let seedingPromise: Promise<void> | null = null;

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seedingPromise) return seedingPromise;
  seedingPromise = (async () => {
    const [initRow, migRow] = await db.kv.bulkGet([
      KV_KEYS.INITIALIZED,
      KV_KEYS.MIGRATION_VERSION,
    ]);
    const initialized = resolveKvValue<boolean>(initRow, false);
    if (!initialized) {
      await db.transaction('rw', [db.promptPresets, db.kv], async () => {
        const alreadyInit = await getKv<boolean>(KV_KEYS.INITIALIZED, false);
        if (alreadyInit) return;

        const existingPresets = await db.promptPresets.count();
        if (existingPresets === 0) {
          await db.promptPresets.bulkPut(BUILTIN_PROMPT_PRESETS);
        }

        await db.kv.bulkPut([
          { key: KV_KEYS.APPEARANCE, value: DEFAULT_APPEARANCE_SETTINGS },
          { key: KV_KEYS.GENERATION, value: DEFAULT_GENERATION_SETTINGS },
          { key: KV_KEYS.PROMPT, value: DEFAULT_PROMPT_SETTINGS },
          { key: KV_KEYS.WEBDAV, value: DEFAULT_WEBDAV_SETTINGS },
          { key: KV_KEYS.MODEL_PROFILES, value: DEFAULT_MODEL_PROFILE_SYNC_SETTINGS },
          { key: KV_KEYS.CONTEXT, value: DEFAULT_CONTEXT_SETTINGS },
          { key: KV_KEYS.MEMORY_SETTINGS, value: DEFAULT_MEMORY_SETTINGS },
          { key: KV_KEYS.MEMORY_DOCUMENT, value: '' },
          { key: KV_KEYS.INITIALIZED, value: true },
          { key: KV_KEYS.MIGRATION_VERSION, value: CURRENT_MIGRATION_VERSION },
        ]);
      });
      return;
    }

    // Ensure new built-in presets exist if upgraded (keys-only check avoids deserializing preset bodies)
    const existingIds = new Set(await db.promptPresets.toCollection().primaryKeys());
    const missing = BUILTIN_PROMPT_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      await db.promptPresets.bulkPut(missing);
    }

    const migrationVersion = resolveKvValue<number>(migRow, 0);
    if (migrationVersion < CURRENT_MIGRATION_VERSION) {
      const [appRow, promptRow] = await db.kv.bulkGet([KV_KEYS.APPEARANCE, KV_KEYS.PROMPT]);
      const savedAppearance = resolveKvValue<AppearanceSettings>(
        appRow,
        DEFAULT_APPEARANCE_SETTINGS
      );
      const savedPrompt = resolveKvValue<PromptSettings>(promptRow, DEFAULT_PROMPT_SETTINGS);
      const updates: KvRecord[] = [
        { key: KV_KEYS.MIGRATION_VERSION, value: CURRENT_MIGRATION_VERSION },
      ];

      if (savedAppearance?.accentColor?.toLowerCase() === '#38bdf8') {
        updates.push({
          key: KV_KEYS.APPEARANCE,
          value: {
            ...savedAppearance,
            accentColor: DEFAULT_APPEARANCE_SETTINGS.accentColor,
          },
        });
      }

      if (
        savedPrompt?.renderEnhancementPrompt?.includes(
          '仔细计算坐标确保文字与连线**互不遮挡、居中对齐**'
        ) &&
        !savedPrompt.renderEnhancementPrompt.includes('垂直支路元件')
      ) {
        updates.push({
          key: KV_KEYS.PROMPT,
          value: {
            ...savedPrompt,
            renderEnhancementPrompt: DEFAULT_RENDER_ENHANCEMENT_PROMPT,
          },
        });
      }

      await db.kv.bulkPut(updates);
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

  // Reconcile any messages left in 'streaming' state using indexed lookup (avoids full-table scan)
  const now = Date.now();
  await db.messages.where('status').equals('streaming').modify({
    status: 'aborted' as const,
    updatedAt: now,
  });

  const [conversations, providers, promptPresets, kvRows] = await Promise.all([
    db.conversations.orderBy('updatedAt').reverse().toArray(),
    db.providers.orderBy('createdAt').toArray(),
    db.promptPresets.toArray(),
    db.kv.bulkGet([
      KV_KEYS.APPEARANCE,
      KV_KEYS.GENERATION,
      KV_KEYS.PROMPT,
      KV_KEYS.WEBDAV,
      KV_KEYS.MODEL_PROFILES,
      KV_KEYS.CONTEXT,
      KV_KEYS.MEMORY_SETTINGS,
      KV_KEYS.MEMORY_DOCUMENT,
      KV_KEYS.ACTIVE_CONVERSATION,
      KV_KEYS.ACTIVE_PROVIDER,
      KV_KEYS.ACTIVE_MODEL,
    ]),
  ]);

  const appearance = resolveKvValue<AppearanceSettings>(kvRows[0], DEFAULT_APPEARANCE_SETTINGS);
  const generation = resolveKvValue<GenerationSettings>(kvRows[1], DEFAULT_GENERATION_SETTINGS);
  const promptSettings = resolveKvValue<PromptSettings>(kvRows[2], DEFAULT_PROMPT_SETTINGS);
  const webdav = resolveKvValue<WebDavSyncSettings>(kvRows[3], DEFAULT_WEBDAV_SETTINGS);
  const modelProfileSync = resolveKvValue<ModelProfileSyncSettings>(
    kvRows[4],
    DEFAULT_MODEL_PROFILE_SYNC_SETTINGS
  );
  const contextSettings = resolveKvValue<ContextSettings>(kvRows[5], DEFAULT_CONTEXT_SETTINGS);
  const memorySettings = resolveKvValue<MemorySettings>(kvRows[6], DEFAULT_MEMORY_SETTINGS);
  const memoryDocument = resolveKvValue<string>(kvRows[7], '');
  const activeConversationId = resolveKvValue<string | null>(kvRows[8], null);
  const activeProviderId = resolveKvValue<string | null>(kvRows[9], null);
  const activeModelId = resolveKvValue<string | null>(kvRows[10], null);

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

export { KV_KEYS, resolveKvValue };
