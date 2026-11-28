import {
  db,
  discardPendingSettingsKv,
  flushPendingSettingsKv,
  getKv,
  KV_KEYS,
  resolveKvValue,
  type KvRecord,
} from './database';
import type { Conversation, Message } from '@/types/chat';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CONTEXT_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_MEMORY_SETTINGS,
  DEFAULT_MODEL_PROFILE_SYNC_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
  type AppBackupV1,
  type AppearanceSettings,
  type ContextSettings,
  type GenerationSettings,
  type MemorySettings,
  type ModelProfileSyncSettings,
  type WebDavSyncSettings,
} from '@/types/settings';
import { DEFAULT_PROMPT_SETTINGS } from '@/services/prompts/presets';
import {
  mergeMemoryEntries,
  parseMemoryDocument,
  serializeMemoryDocument,
} from '@/services/memory/memoryEngine';
import type { PromptSettings } from '@/types/prompt';

export async function exportFullBackup(): Promise<AppBackupV1> {
  await flushPendingSettingsKv();
  const [conversations, messages, providers, promptPresets, kvRows] = await db.transaction(
    'r',
    [db.conversations, db.messages, db.providers, db.promptPresets, db.kv],
    () =>
      Promise.all([
        db.conversations.toArray(),
        db.messages.toArray(),
        db.providers.toArray(),
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
        ]),
      ])
  );

  const appearance = resolveKvValue<AppearanceSettings>(kvRows[0], DEFAULT_APPEARANCE_SETTINGS);
  const generation = resolveKvValue<GenerationSettings>(kvRows[1], DEFAULT_GENERATION_SETTINGS);
  const prompt = resolveKvValue<PromptSettings>(kvRows[2], DEFAULT_PROMPT_SETTINGS);
  const webdav = resolveKvValue<WebDavSyncSettings>(kvRows[3], DEFAULT_WEBDAV_SETTINGS);
  const modelProfiles = resolveKvValue<ModelProfileSyncSettings>(
    kvRows[4],
    DEFAULT_MODEL_PROFILE_SYNC_SETTINGS
  );
  const context = resolveKvValue<ContextSettings>(kvRows[5], DEFAULT_CONTEXT_SETTINGS);
  const memory = resolveKvValue<MemorySettings>(kvRows[6], DEFAULT_MEMORY_SETTINGS);
  const memoryDocument = resolveKvValue<string>(kvRows[7], '');

  return {
    version: 1,
    app: 'ChatBeauty',
    exportedAt: Date.now(),
    conversations,
    messages,
    providers,
    promptPresets,
    memoryDocument,
    settings: {
      appearance,
      generation,
      prompt,
      webdav,
      modelProfiles,
      context,
      memory,
    },
  };
}

export async function importFullBackup(
  data: AppBackupV1,
  mode: 'merge' | 'replace'
): Promise<void> {
  if (!data || data.app !== 'ChatBeauty' || data.version !== 1) {
    throw new Error('无效的 ChatBeauty 备份文件格式');
  }

  discardPendingSettingsKv();
  const incomingEntries =
    mode === 'merge' && typeof data.memoryDocument === 'string'
      ? parseMemoryDocument(data.memoryDocument)
      : null;

  await db.transaction(
    'rw',
    [db.conversations, db.messages, db.providers, db.promptPresets, db.kv],
    async () => {
      if (mode === 'replace') {
        await Promise.all([
          db.conversations.clear(),
          db.messages.clear(),
          db.providers.clear(),
          db.promptPresets.clear(),
        ]);
      }

      const putOps: Array<Promise<unknown>> = [];
      if (data.conversations?.length) putOps.push(db.conversations.bulkPut(data.conversations));
      if (data.messages?.length) putOps.push(db.messages.bulkPut(data.messages));
      if (data.providers?.length) putOps.push(db.providers.bulkPut(data.providers));
      if (data.promptPresets?.length) putOps.push(db.promptPresets.bulkPut(data.promptPresets));
      if (putOps.length > 0) {
        await Promise.all(putOps);
      }

      const kvUpdates: KvRecord[] = [];
      if (mode === 'replace') {
        kvUpdates.push(
          {
            key: KV_KEYS.MEMORY_DOCUMENT,
            value: typeof data.memoryDocument === 'string' ? data.memoryDocument : '',
          },
          {
            key: KV_KEYS.APPEARANCE,
            value: data.settings?.appearance ?? DEFAULT_APPEARANCE_SETTINGS,
          },
          {
            key: KV_KEYS.GENERATION,
            value: data.settings?.generation ?? DEFAULT_GENERATION_SETTINGS,
          },
          {
            key: KV_KEYS.PROMPT,
            value: data.settings?.prompt ?? DEFAULT_PROMPT_SETTINGS,
          },
          {
            key: KV_KEYS.WEBDAV,
            value: data.settings?.webdav ?? DEFAULT_WEBDAV_SETTINGS,
          },
          {
            key: KV_KEYS.MODEL_PROFILES,
            value: data.settings?.modelProfiles ?? DEFAULT_MODEL_PROFILE_SYNC_SETTINGS,
          },
          {
            key: KV_KEYS.CONTEXT,
            value: data.settings?.context ?? DEFAULT_CONTEXT_SETTINGS,
          },
          {
            key: KV_KEYS.MEMORY_SETTINGS,
            value: data.settings?.memory ?? DEFAULT_MEMORY_SETTINGS,
          },
          { key: KV_KEYS.ACTIVE_CONVERSATION, value: null },
          { key: KV_KEYS.ACTIVE_PROVIDER, value: null },
          { key: KV_KEYS.ACTIVE_MODEL, value: null }
        );
      } else {
        if (incomingEntries && incomingEntries.length > 0) {
          const existingDoc = await getKv<string>(KV_KEYS.MEMORY_DOCUMENT, '');
          const existingEntries = parseMemoryDocument(existingDoc);
          const merged = mergeMemoryEntries(existingEntries, incomingEntries, true);
          kvUpdates.push({
            key: KV_KEYS.MEMORY_DOCUMENT,
            value: serializeMemoryDocument(merged.entries),
          });
        }
        if (data.settings) {
          if (data.settings.appearance) {
            kvUpdates.push({ key: KV_KEYS.APPEARANCE, value: data.settings.appearance });
          }
          if (data.settings.generation) {
            kvUpdates.push({ key: KV_KEYS.GENERATION, value: data.settings.generation });
          }
          if (data.settings.prompt) {
            kvUpdates.push({ key: KV_KEYS.PROMPT, value: data.settings.prompt });
          }
          if (data.settings.webdav) {
            const currentWebdav = await getKv<WebDavSyncSettings>(
              KV_KEYS.WEBDAV,
              DEFAULT_WEBDAV_SETTINGS
            );
            if (!currentWebdav.endpoint.trim()) {
              kvUpdates.push({ key: KV_KEYS.WEBDAV, value: data.settings.webdav });
            }
          }
          if (data.settings.modelProfiles) {
            kvUpdates.push({ key: KV_KEYS.MODEL_PROFILES, value: data.settings.modelProfiles });
          }
          if (data.settings.context) {
            kvUpdates.push({ key: KV_KEYS.CONTEXT, value: data.settings.context });
          }
          if (data.settings.memory) {
            kvUpdates.push({ key: KV_KEYS.MEMORY_SETTINGS, value: data.settings.memory });
          }
        }
      }

      if (kvUpdates.length > 0) {
        await db.kv.bulkPut(kvUpdates);
      }
    }
  );
}

function messagePartsToMarkdown(msg: Message): string {
  const blocks: string[] = [];
  for (const part of msg.parts) {
    if (part.type === 'reasoning' && part.text.trim()) {
      blocks.push(`<details>\n<summary>思考过程</summary>\n\n${part.text}\n\n</details>`);
    } else if (part.type === 'text' && part.text) {
      blocks.push(part.text);
    } else if (part.type === 'image') {
      blocks.push(`![${part.alt || 'image'}](${part.url || part.dataUrl || ''})`);
    }
  }
  return blocks.join('\n\n');
}

export function exportConversationMarkdown(conv: Conversation, messages: Message[]): string {
  const header = `# ${conv.title}\n\n> 导出时间：${new Date().toLocaleString()}\n\n---\n`;
  const body = messages
    .map((m) => {
      const label = m.role === 'user' ? '## 用户' : `## 助手${m.modelId ? ` (${m.modelId})` : ''}`;
      return `${label}\n\n${messagePartsToMarkdown(m)}`;
    })
    .join('\n\n---\n\n');
  return `${header}\n${body}\n`;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"]/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

export function exportConversationHtml(conv: Conversation, messages: Message[]): string {
  const items = messages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : `助手 ${m.modelId ? `(${m.modelId})` : ''}`;
      const text = messagePartsToMarkdown(m);
      return `<section class="msg ${m.role}"><h3>${escapeHtml(role)}</h3><pre class="raw">${escapeHtml(text)}</pre></section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(conv.title)} - ChatBeauty</title>
<style>
  body { background: #0d0d0f; color: #f4f4f5; font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.7; }
  h1 { font-size: 1.6rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 12px; }
  .msg { background: #161618; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px; margin: 18px 0; }
  .msg.user { border-color: rgba(255,255,255,0.2); }
  h3 { margin: 0 0 10px 0; font-size: 0.9rem; color: #e4e4e7; }
  pre.raw { white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(conv.title)}</h1>
  ${items}
</body>
</html>`;
}
