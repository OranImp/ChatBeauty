import { db, getKv, KV_KEYS, setKv } from './database';
import type { Conversation, Message } from '@/types/chat';
import {
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_GENERATION_SETTINGS,
  DEFAULT_WEBDAV_SETTINGS,
  type AppBackupV1,
  type AppearanceSettings,
  type GenerationSettings,
  type WebDavSyncSettings,
} from '@/types/settings';
import { DEFAULT_PROMPT_SETTINGS } from '@/services/prompts/presets';
import type { PromptSettings } from '@/types/prompt';

export async function exportFullBackup(): Promise<AppBackupV1> {
  const [conversations, messages, providers, promptPresets, appearance, generation, prompt, webdav] =
    await Promise.all([
      db.conversations.toArray(),
      db.messages.toArray(),
      db.providers.toArray(),
      db.promptPresets.toArray(),
      getKv<AppearanceSettings>(KV_KEYS.APPEARANCE, DEFAULT_APPEARANCE_SETTINGS),
      getKv<GenerationSettings>(KV_KEYS.GENERATION, DEFAULT_GENERATION_SETTINGS),
      getKv<PromptSettings>(KV_KEYS.PROMPT, DEFAULT_PROMPT_SETTINGS),
      getKv<WebDavSyncSettings>(KV_KEYS.WEBDAV, DEFAULT_WEBDAV_SETTINGS),
    ]);

  return {
    version: 1,
    app: 'ChatBeauty',
    exportedAt: Date.now(),
    conversations,
    messages,
    providers,
    promptPresets,
    settings: {
      appearance,
      generation,
      prompt,
      webdav,
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

      if (data.conversations?.length) await db.conversations.bulkPut(data.conversations);
      if (data.messages?.length) await db.messages.bulkPut(data.messages);
      if (data.providers?.length) await db.providers.bulkPut(data.providers);
      if (data.promptPresets?.length) await db.promptPresets.bulkPut(data.promptPresets);

      if (data.settings) {
        if (data.settings.appearance) await setKv(KV_KEYS.APPEARANCE, data.settings.appearance);
        if (data.settings.generation) await setKv(KV_KEYS.GENERATION, data.settings.generation);
        if (data.settings.prompt) await setKv(KV_KEYS.PROMPT, data.settings.prompt);
        if (data.settings.webdav) await setKv(KV_KEYS.WEBDAV, data.settings.webdav);
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
      const label = m.role === 'user' ? '## 👤 用户' : `## ✨ 助手${m.modelId ? ` (${m.modelId})` : ''}`;
      return `${label}\n\n${messagePartsToMarkdown(m)}`;
    })
    .join('\n\n---\n\n');
  return `${header}\n${body}\n`;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  body { background: #0b0d12; color: #f4f4f5; font-family: system-ui, -apple-system, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.7; }
  h1 { font-size: 1.6rem; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 12px; }
  .msg { background: #14161d; border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 16px 20px; margin: 18px 0; }
  .msg.user { border-color: rgba(56,189,248,0.35); }
  h3 { margin: 0 0 10px 0; font-size: 0.9rem; color: #38bdf8; }
  pre.raw { white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 0; }
</style>
</head>
<body>
  <h1>${escapeHtml(conv.title)}</h1>
  ${items}
</body>
</html>`;
}
