import { describe, expect, it } from 'vitest';
import {
  detectMemoryTrigger,
  detectSensitiveInfo,
  extractMemoriesLocal,
  formatMemoriesForPrompt,
  mergeMemoryEntries,
  parseLlmMemoryExtraction,
  parseMemoryDocument,
  retrieveRelevantMemories,
  sanitizeSensitiveText,
  serializeMemoryDocument,
} from '@/services/memory/memoryEngine';
import { DEFAULT_MEMORY_SETTINGS } from '@/types/memory';
import type { Message } from '@/types/chat';

function makeUserMsg(text: string): Message {
  return {
    id: `m_${Math.random()}`,
    conversationId: 'c1',
    role: 'user',
    parts: [{ type: 'text', text }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'done',
  };
}

describe('memoryEngine — single-file Markdown memory & selective retrieval', () => {
  it('defaults sensitive info recording to OFF while memory is enabled', () => {
    expect(DEFAULT_MEMORY_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_MEMORY_SETTINGS.autoExtract).toBe(true);
    expect(DEFAULT_MEMORY_SETTINGS.recordSensitiveInfo).toBe(false);
  });

  it('detects explicit memory commands and personal info disclosures accurately', () => {
    expect(detectMemoryTrigger('请记住以后代码回答一律使用 TypeScript 严格模式')).toBe('explicit');
    expect(detectMemoryTrigger('我是华东理工大学化学工程专业的研究生，正在做反应工程课题')).toBe(
      'personal-info'
    );
    expect(detectMemoryTrigger('请解释什么是傅里叶变换')).toBeNull();
  });

  it('filters sensitive info when recordSensitiveInfo=false and preserves it when allowed', () => {
    const secretText = '请记住我的手机号是 13812345678，以及 API key sk-1234567890abcdef';
    expect(detectSensitiveInfo(secretText).isSensitive).toBe(true);
    expect(sanitizeSensitiveText(secretText)).toContain('[已脱敏电话]');
    expect(sanitizeSensitiveText(secretText)).toContain('[已脱敏密钥]');

    const blocked = extractMemoriesLocal(secretText, {
      ...DEFAULT_MEMORY_SETTINGS,
      recordSensitiveInfo: false,
    });
    expect(blocked.length).toBe(0);

    const allowed = extractMemoriesLocal(secretText, {
      ...DEFAULT_MEMORY_SETTINGS,
      recordSensitiveInfo: true,
    });
    expect(allowed.length).toBe(1);
    expect(allowed[0].sensitive).toBe(true);
  });

  it('round-trips structured entries cleanly through a single Markdown file', () => {
    const entries = [
      {
        id: 'mem_1',
        category: 'profile' as const,
        content: '正在攻读化学工程硕士学位',
        tags: ['学业', '化工'],
        pinned: true,
        sensitive: false,
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: 'mem_2',
        category: 'preference' as const,
        content: '偏好使用简洁明了的分步公式推导',
        tags: ['偏好'],
        pinned: false,
        sensitive: false,
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        id: 'mem_3',
        category: 'fact' as const,
        content: '备用联系邮箱 example@domain.com',
        tags: ['邮箱'],
        pinned: false,
        sensitive: true,
        createdAt: 1000,
        updatedAt: 2000,
      },
    ];

    const md = serializeMemoryDocument(entries);
    expect(md).toContain('# ChatBeauty 记忆库');
    expect(md).toContain('## 个人画像与身份 (profile)');
    expect(md).toContain('pinned:true');
    expect(md).toContain('sensitive:true');

    const parsed = parseMemoryDocument(md);
    expect(parsed.length).toBe(3);
    expect(parsed.find((e) => e.category === 'profile')?.pinned).toBe(true);
    expect(parsed.find((e) => e.category === 'preference')?.tags).toContain('偏好');
    expect(parsed.find((e) => e.sensitive)?.sensitive).toBe(true);
  });

  it('retrieves only relevant subset on demand within budget & hides sensitive entries when toggled off', () => {
    const pool = [
      {
        id: 'p1',
        category: 'profile' as const,
        content: '我是前端工程师，擅长 React 和 TypeScript 开发',
        tags: ['react', 'typescript', '前端'],
        pinned: true,
        sensitive: false,
        createdAt: 1,
        updatedAt: 100,
      },
      {
        id: 'p2',
        category: 'project' as const,
        content: '当前重点项目是化工反应动力学 Python 数值模拟',
        tags: ['python', '化工'],
        pinned: false,
        sensitive: false,
        createdAt: 1,
        updatedAt: 90,
      },
      {
        id: 'p3',
        category: 'fact' as const,
        content: '每周三下午固定去游泳馆训练',
        tags: ['生活'],
        pinned: false,
        sensitive: false,
        createdAt: 1,
        updatedAt: 80,
      },
      {
        id: 'p4',
        category: 'fact' as const,
        content: '个人手机号码 13900001111 与邮箱 test@example.com',
        tags: ['react'],
        pinned: true,
        sensitive: true,
        createdAt: 1,
        updatedAt: 110,
      },
    ];

    const selected = retrieveRelevantMemories(
      pool,
      '请帮我优化这个 React 和 TypeScript 组件的状态更新逻辑',
      [makeUserMsg('我们正在用 React hooks')],
      {
        ...DEFAULT_MEMORY_SETTINGS,
        recordSensitiveInfo: false,
        maxInjectedMemories: 2,
      }
    );

    expect(selected.some((e) => e.id === 'p1')).toBe(true);
    expect(selected.some((e) => e.id === 'p3')).toBe(false);
    expect(selected.some((e) => e.id === 'p4')).toBe(false);
    expect(formatMemoriesForPrompt(selected)).toContain('[画像]');

    const disabled = retrieveRelevantMemories(pool, 'React', [], {
      ...DEFAULT_MEMORY_SETTINGS,
      enabled: false,
    });
    expect(disabled).toEqual([]);
  });

  it('parses LLM JSON extraction output and deduplicates merged entries', () => {
    const raw = '```json\n[{"category":"preference","content":"以后请始终使用中文回复并附带完整 TypeScript 类型","tags":["typescript","偏好"],"pinned":true,"sensitive":false}]\n```';
    const parsed = parseLlmMemoryExtraction(raw, false, 'conv_1');
    expect(parsed.length).toBe(1);
    expect(parsed[0].category).toBe('preference');

    const firstMerge = mergeMemoryEntries([], parsed, false);
    expect(firstMerge.addedCount).toBe(1);

    const dupMerge = mergeMemoryEntries(firstMerge.entries, parsed, false);
    expect(dupMerge.addedCount).toBe(0);
    expect(dupMerge.updatedCount).toBe(1);
  });
});
