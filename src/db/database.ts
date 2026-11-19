import Dexie, { type Table } from 'dexie';
import type { Conversation, Message, ProviderConfig } from '@/types/chat';
import type { PromptSettings, SystemPromptPreset } from '@/types/prompt';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
  type AppearanceSettings,
  type GenerationSettings,
  type WebDavSyncSettings,
} from '@/types/settings';
import { BUILTIN_PROMPT_PRESETS, DEFAULT_PROMPT_SETTINGS } from '@/services/prompts/presets';
import { createDemoShowcaseData } from '@/components/chat/DemoShowcase';

export interface KvRecord {
  key: string;
  value: unknown;
}

class ChatBeatyDatabase extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  providers!: Table<ProviderConfig, string>;
  promptPresets!: Table<SystemPromptPreset, string>;
  kv!: Table<KvRecord, string>;

  constructor() {
    super('ChatBeatyDB');
    this.version(1).stores({
      conversations: 'id, updatedAt, pinned',
      messages: 'id, conversationId, createdAt',
      providers: 'id, protocol, createdAt',
      promptPresets: 'id, category, updatedAt',
      kv: 'key',
    });
  }
}

export const db = new ChatBeatyDatabase();

const KV_KEYS = {
  INITIALIZED: 'app:initialized_v1',
  APPEARANCE: 'settings:appearance',
  GENERATION: 'settings:generation',
  PROMPT: 'settings:prompt',
  WEBDAV: 'settings:webdav',
  ACTIVE_CONVERSATION: 'state:activeConversationId',
  ACTIVE_PROVIDER: 'state:activeProviderId',
  ACTIVE_MODEL: 'state:activeModelId',
} as const;

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  if (!row || row.value === undefined) return fallback;
  return row.value as T;
}

export async function setKv<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

export async function ensureDatabaseSeeded(): Promise<void> {
  const initialized = await getKv<boolean>(KV_KEYS.INITIALIZED, false);
  if (!initialized) {
    await db.transaction(
      'rw',
      [db.promptPresets, db.conversations, db.messages, db.kv],
      async () => {
        const existingPresets = await db.promptPresets.count();
        if (existingPresets === 0) {
          await db.promptPresets.bulkPut(BUILTIN_PROMPT_PRESETS);
        }

        const existingConvs = await db.conversations.count();
        if (existingConvs === 0) {
          const demo = createDemoShowcaseData();
          await db.conversations.put(demo.conversation);
          await db.messages.bulkPut(demo.messages);
          await setKv(KV_KEYS.ACTIVE_CONVERSATION, demo.conversation.id);
        }

        await setKv(KV_KEYS.APPEARANCE, DEFAULT_APPEARANCE_SETTINGS);
        await setKv(KV_KEYS.GENERATION, DEFAULT_GENERATION_SETTINGS);
        await setKv(KV_KEYS.PROMPT, DEFAULT_PROMPT_SETTINGS);
        await setKv(KV_KEYS.WEBDAV, DEFAULT_WEBDAV_SETTINGS);
        await setKv(KV_KEYS.INITIALIZED, true);
      }
    );
  } else {
    // Ensure new built-in presets exist if upgraded
    const existingIds = new Set((await db.promptPresets.toArray()).map((p) => p.id));
    const missing = BUILTIN_PROMPT_PRESETS.filter((p) => !existingIds.has(p.id));
    if (missing.length > 0) {
      await db.promptPresets.bulkPut(missing);
    }
  }
}

export async function loadInitialState(): Promise<{
  conversations: Conversation[];
  providers: ProviderConfig[];
  promptPresets: SystemPromptPreset[];
  appearance: AppearanceSettings;
  generation: GenerationSettings;
  promptSettings: PromptSettings;
  webdav: WebDavSyncSettings;
  activeConversationId: string | null;
  activeProviderId: string | null;
  activeModelId: string | null;
}> {
  await ensureDatabaseSeeded();
  const [
    conversations,
    providers,
    promptPresets,
    appearance,
    generation,
    promptSettings,
    webdav,
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
    getKv<string | null>(KV_KEYS.ACTIVE_CONVERSATION, null),
    getKv<string | null>(KV_KEYS.ACTIVE_PROVIDER, null),
    getKv<string | null>(KV_KEYS.ACTIVE_MODEL, null),
  ]);

  return {
    conversations,
    providers,
    promptPresets,
    appearance: { ...DEFAULT_APPEARANCE_SETTINGS, ...appearance },
    generation: { ...DEFAULT_GENERATION_SETTINGS, ...generation },
    promptSettings: { ...DEFAULT_PROMPT_SETTINGS, ...promptSettings },
    webdav: { ...DEFAULT_WEBDAV_SETTINGS, ...webdav },
    activeConversationId,
    activeProviderId,
    activeModelId,
  };
}

export { KV_KEYS };
