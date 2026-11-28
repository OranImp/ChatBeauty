import type { Message } from '@/types/chat';
import type { MemoryCategory, MemoryEntry, MemorySettings } from '@/types/memory';
import { estimateTokens } from '@/services/llm/contextManager';
import { extractTextFromParts } from '@/services/llm/adapters/shared';

export const MEMORY_FILE_HEADER = '# ChatBeauty 记忆库\n\n<!-- chatbeauty-memory-v1 -->';

const CATEGORY_ORDER: MemoryCategory[] = ['profile', 'preference', 'project', 'fact'];

const CATEGORY_HEADINGS: Record<MemoryCategory, string> = {
  profile: '## 个人画像与身份 (profile)',
  preference: '## 偏好与习惯 (preference)',
  project: '## 项目与长期目标 (project)',
  fact: '## 其他记录 (fact)',
};

function uidMemory(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function stableManualId(category: MemoryCategory, content: string): string {
  const raw = `${category}:${content}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `mem_m_${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36).slice(0, 5)}`;
}

function formatDateIso(ts: number): string {
  const d = new Date(ts || Date.now());
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function parseDateIso(raw?: string): number {
  if (!raw) return Date.now();
  const parsed = Date.parse(raw.trim());
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Serializes memory entries into a clean single Markdown file (`chatbeauty-memory.md`).
 */
export function serializeMemoryDocument(entries: MemoryEntry[]): string {
  const buckets: Record<MemoryCategory, MemoryEntry[]> = {
    profile: [],
    preference: [],
    project: [],
    fact: [],
  };
  for (const entry of entries) {
    (buckets[entry.category] ?? buckets.fact).push(entry);
  }

  const lines: string[] = [MEMORY_FILE_HEADER, ''];
  for (const cat of CATEGORY_ORDER) {
    lines.push(CATEGORY_HEADINGS[cat]);
    const items = buckets[cat].sort(
      (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
    );

    if (items.length === 0) {
      lines.push('');
      continue;
    }

    for (const item of items) {
      const cleanContent = item.content.replace(/[\r\n]+/g, ' ').trim();
      if (!cleanContent) continue;
      const cleanTags = item.tags
        .map((t) => t.replace(/[|,[\]]/g, '').trim())
        .filter(Boolean)
        .join(',');
      const meta = [
        `id:${item.id}`,
        `pinned:${Boolean(item.pinned)}`,
        `sensitive:${Boolean(item.sensitive)}`,
        `tags:${cleanTags}`,
        `updated:${formatDateIso(item.updatedAt)}`,
      ].join(' | ');
      lines.push(`- [${meta}] ${cleanContent}`);
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function detectSectionCategory(headingLine: string): MemoryCategory | null {
  const lower = headingLine.toLowerCase();
  if (lower.includes('(profile)') || lower.includes('个人画像')) return 'profile';
  if (lower.includes('(preference)') || lower.includes('偏好')) return 'preference';
  if (lower.includes('(project)') || lower.includes('项目')) return 'project';
  if (lower.includes('(fact)') || lower.includes('其他')) return 'fact';
  return null;
}

/**
 * Parses `chatbeauty-memory.md`, tolerating both structured metadata lines
 * and manual plain `- content` bullets authored directly by the user.
 */
export function parseMemoryDocument(markdown: string): MemoryEntry[] {
  if (!markdown || !markdown.trim()) return [];
  const entries: MemoryEntry[] = [];
  const seenIds = new Set<string>();
  let currentCategory: MemoryCategory = 'fact';

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('# ') || line.startsWith('<!--')) continue;
    if (line.startsWith('## ')) {
      const cat = detectSectionCategory(line);
      if (cat) currentCategory = cat;
      continue;
    }

    const structured = line.match(/^[-*]\s+\[(.*?)\]\s+(.+)$/);
    if (
      structured &&
      /(?:^|\|)\s*(?:id|pinned|sensitive|tags|updated):/i.test(structured[1])
    ) {
      const metaRaw = structured[1];
      const content = structured[2].trim();
      if (!content) continue;

      let id = '';
      let pinned = false;
      let sensitive = false;
      let hasSensitiveKey = false;
      let tags: string[] = [];
      let updatedAt = Date.now();

      for (const part of metaRaw.split('|')) {
        const idx = part.indexOf(':');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim().toLowerCase();
        const v = part.slice(idx + 1).trim();
        if (k === 'id') id = v;
        else if (k === 'pinned') pinned = v === 'true';
        else if (k === 'sensitive') {
          hasSensitiveKey = true;
          sensitive = v === 'true';
        } else if (k === 'tags') {
          tags = v
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        } else if (k === 'updated') {
          updatedAt = parseDateIso(v);
        }
      }

      if (!id || seenIds.has(id)) {
        id = stableManualId(currentCategory, content);
      }
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      entries.push({
        id,
        category: currentCategory,
        content,
        tags,
        pinned,
        sensitive: hasSensitiveKey ? sensitive : hasSensitiveInfo(content),
        createdAt: updatedAt,
        updatedAt,
      });
      continue;
    }

    const plainBullet = line.match(/^[-*]\s+(.+)$/);
    if (plainBullet) {
      const content = plainBullet[1].trim();
      if (!content) continue;
      const id = stableManualId(currentCategory, content);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const now = Date.now();
      entries.push({
        id,
        category: currentCategory,
        content,
        tags: extractAutoTags(content),
        pinned: false,
        sensitive: hasSensitiveInfo(content),
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return entries;
}

const EXPLICIT_MEMORY_RE =
  /(请记住|记住一下|记住这个|帮我记|记一下|记下来|别忘了|以后都|从现在起记住|remember\s+that|please\s+remember|don'?t\s+forget|note\s+that|from\s+now\s+on)/i;

const PERSONAL_INFO_RE =
  /(?:^|[\s，。！？,.!?:;])(我叫|我的名字|我是|我在.{1,18}(?:工作|上班|上学|读研|读博|学习|就读|实习)|我的(?:专业|职业|工作|学校|公司|职业|研究方向|习惯|偏好|目标是)|我(?:习惯|偏好|平时用|喜欢用|更喜欢|正在做|正在开发|住在|擅长)|my\s+name\s+is|i\s+am\s+(?:a|an|currently|working|studying)|i\s+work\s+(?:as|at|for)|i\s+prefer|i\s+usually|i\s+live\s+in)/i;

/**
 * Detects whether user input either explicitly asks to remember something
 * or discloses personal profile / preference / long-term project context.
 */
export function detectMemoryTrigger(text: string): 'explicit' | 'personal-info' | null {
  const cleaned = text.trim();
  if (!cleaned || cleaned.length < 3) return null;
  if (EXPLICIT_MEMORY_RE.test(cleaned)) return 'explicit';
  if (PERSONAL_INFO_RE.test(cleaned)) return 'personal-info';
  return null;
}

const SENSITIVE_PATTERNS: Array<{ reason: string; regex: RegExp; replacement: string }> = [
  {
    reason: '手机/电话号码',
    regex: /(?<!\d)1[3-9]\d{9}(?!\d)|\+\d{1,3}[-\s]?\d{6,12}/g,
    replacement: '[已脱敏电话]',
  },
  {
    reason: '电子邮箱',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[已脱敏邮箱]',
  },
  {
    reason: '身份证/证件号码',
    regex: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    replacement: '[已脱敏证件号]',
  },
  {
    reason: '银行卡/账号',
    regex: /(?<!\d)(?:\d{4}[-\s]?){3,4}\d{3,4}(?!\d)/g,
    replacement: '[已脱敏卡号]',
  },
  {
    reason: 'API 密钥 / Token / 密码',
    regex:
      /\b(?:sk|rk|pk|ghp|gho|AIza|xox[baprs])[-_A-Za-z0-9]{10,}\b|(?:密码|口令|password|secret|token)\s*(?:是|为|:|：|=)\s*\S+/gi,
    replacement: '[已脱敏密钥]',
  },
  {
    reason: '详细住址',
    regex: /(?:住在|地址|门牌|收货地址)[^\n，。；]{0,20}?(?:\d+号|\d+栋|\d+单元|\d+室|小区)/g,
    replacement: '[已脱敏住址]',
  },
  {
    reason: '健康/病历/薪资财务隐私',
    regex:
      /(?:月薪|年薪|工资|存款|负债|社保|病历|诊断|抑郁症|肿瘤|糖尿病|高血压|血压|服用.{1,10}药)/g,
    replacement: '[敏感隐私]',
  },
];

export function hasSensitiveInfo(text: string): boolean {
  for (const rule of SENSITIVE_PATTERNS) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) {
      rule.regex.lastIndex = 0;
      return true;
    }
    rule.regex.lastIndex = 0;
  }
  return false;
}

export function detectSensitiveInfo(text: string): { isSensitive: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const rule of SENSITIVE_PATTERNS) {
    rule.regex.lastIndex = 0;
    if (rule.regex.test(text)) {
      reasons.push(rule.reason);
    }
    rule.regex.lastIndex = 0;
  }
  return {
    isSensitive: reasons.length > 0,
    reasons,
  };
}

export function sanitizeSensitiveText(text: string): string {
  let out = text;
  for (const rule of SENSITIVE_PATTERNS) {
    rule.regex.lastIndex = 0;
    out = out.replace(rule.regex, rule.replacement);
    rule.regex.lastIndex = 0;
  }
  return out;
}

const AUTO_TAG_KEYWORD_MAP: Array<[RegExp, string]> = [
  [/TypeScript|TS|React|Vue|Python|Rust|Go|Java|C\+\+/i, '编程'],
  [/学生|研究生|本科|大学|学院|专业|学校/, '学业'],
  [/工程|架构|代码|前端|后端|全栈|开发/, '工程'],
  [/偏好|习惯|喜欢|风格|格式|简短|详细/, '偏好'],
  [/项目|产品|App|应用|ChatBeauty/i, '项目'],
];

function extractAutoTags(text: string): string[] {
  const tags = new Set<string>();
  const ascii = text.toLowerCase().match(/\b[a-z][a-z0-9.+_-]{1,20}\b/g) || [];
  for (const w of ascii.slice(0, 4)) tags.add(w);

  for (const [re, tag] of AUTO_TAG_KEYWORD_MAP) {
    if (re.test(text)) tags.add(tag);
  }
  return Array.from(tags).slice(0, 5);
}

function inferCategoryLocal(text: string, trigger: 'explicit' | 'personal-info' | null): MemoryCategory {
  if (/偏好|习惯|喜欢用|喜欢看|以后都|别忘了以后|格式|回答风格|prefer|always\s+use/i.test(text)) {
    return 'preference';
  }
  if (/项目|正在做|正在开发|目标|计划|毕业设计|仓库|project/i.test(text)) {
    return 'project';
  }
  if (
    trigger === 'personal-info' ||
    /我叫|我是|专业|职业|工作|学校|公司|年级|my name|i work|i am/i.test(text)
  ) {
    return 'profile';
  }
  return 'fact';
}

/**
 * Deterministic fallback extraction when background LLM extraction isn't run or fails.
 */
export function extractMemoriesLocal(
  text: string,
  settings: MemorySettings,
  convId?: string
): MemoryEntry[] {
  const trigger = detectMemoryTrigger(text);
  if (!trigger) return [];

  const sentences = text
    .split(/[\r\n。！？；;!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3 && s.length <= 180);

  const out: MemoryEntry[] = [];
  const now = Date.now();

  for (const rawSent of sentences) {
    const cleaned = rawSent
      .replace(/^(请记住|记住一下|记住这个|帮我记|记一下|记下来|别忘了|please remember|remember that)[：:，,\s]*/i, '')
      .trim();
    if (!cleaned || cleaned.length < 3) continue;
    if (
      trigger !== 'explicit' &&
      !PERSONAL_INFO_RE.test(cleaned) &&
      !EXPLICIT_MEMORY_RE.test(rawSent)
    ) {
      continue;
    }

    const isSens = hasSensitiveInfo(cleaned);
    if (isSens && !settings.recordSensitiveInfo) {
      continue;
    }

    const category = inferCategoryLocal(cleaned, trigger);
    out.push({
      id: uidMemory(),
      category,
      content: cleaned,
      tags: extractAutoTags(cleaned),
      pinned: category === 'profile' || trigger === 'explicit',
      sensitive: isSens,
      createdAt: now,
      updatedAt: now,
      sourceConvId: convId,
    });
  }

  return out;
}

export function buildMemoryExtractionPrompt(userText: string, allowSensitive: boolean): string {
  return [
    '请分析下面用户输入，判断是否包含「用户明确要求记住的内容」或「值得长期记住的个人信息/偏好/项目背景」。',
    allowSensitive
      ? '若包含敏感个人信息也可提取，并将 sensitive 字段标为 true。'
      : '【严格隐私规则】严禁提取任何手机号、邮箱、身份证/银行卡号、详细家庭地址、密码/API Key 或医疗/薪资敏感信息；若整条消息仅包含此类敏感信息，请返回空数组 []。',
    '仅输出严格 JSON 数组，不要输出任何额外解释或代码块围栏之外的文字，格式如下：',
    '[{"category":"profile|preference|project|fact","content":"简明第三人称或陈述句描述","tags":["关键词"],"pinned":false,"sensitive":false}]',
    '若没有值得长期记住的内容，请直接返回 []。',
    '',
    `用户输入：${userText}`,
  ].join('\n');
}

export function parseLlmMemoryExtractionDetailed(
  rawText: string,
  allowSensitive: boolean,
  convId?: string
): {
  entries: MemoryEntry[];
  hadValidJson: boolean;
  skippedSensitiveCount: number;
} {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) return { entries: [], hadValidJson: false, skippedSensitiveCount: 0 };

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return { entries: [], hadValidJson: false, skippedSensitiveCount: 0 };
  }
  if (!Array.isArray(parsed)) return { entries: [], hadValidJson: false, skippedSensitiveCount: 0 };

  const now = Date.now();
  const out: MemoryEntry[] = [];
  let skippedSensitiveCount = 0;
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content.replace(/\s+/g, ' ').trim() : '';
    if (!content || content.length < 3) continue;

    const markedSensitive = Boolean(obj.sensitive) || hasSensitiveInfo(content);
    if (markedSensitive && !allowSensitive) {
      skippedSensitiveCount += 1;
      continue;
    }

    const rawCat = typeof obj.category === 'string' ? obj.category : 'fact';
    const category: MemoryCategory = CATEGORY_ORDER.includes(rawCat as MemoryCategory)
      ? (rawCat as MemoryCategory)
      : 'fact';
    const tags = Array.isArray(obj.tags)
      ? obj.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 6)
      : extractAutoTags(content);

    out.push({
      id: uidMemory(),
      category,
      content,
      tags: tags.length > 0 ? tags : extractAutoTags(content),
      pinned: Boolean(obj.pinned),
      sensitive: markedSensitive,
      createdAt: now,
      updatedAt: now,
      sourceConvId: convId,
    });
  }
  return { entries: out, hadValidJson: true, skippedSensitiveCount };
}

export function parseLlmMemoryExtraction(
  rawText: string,
  allowSensitive: boolean,
  convId?: string
): MemoryEntry[] {
  return parseLlmMemoryExtractionDetailed(rawText, allowSensitive, convId).entries;
}

function normalizeForDedup(s: string): string {
  return s
    .toLowerCase()
    .replace(/[，。！？、；："'`~·.,!?;:()\s[\]-]/g, '');
}

export function mergeMemoryEntries(
  existing: MemoryEntry[],
  incoming: MemoryEntry[],
  allowSensitive: boolean
): {
  entries: MemoryEntry[];
  addedCount: number;
  updatedCount: number;
  skippedSensitiveCount: number;
} {
  const next = [...existing];
  const normalizedExisting = next.map((e) => normalizeForDedup(e.content));
  const exactIndexMap = new Map<string, number>();
  for (let i = 0; i < normalizedExisting.length; i++) {
    if (!exactIndexMap.has(normalizedExisting[i])) {
      exactIndexMap.set(normalizedExisting[i], i);
    }
  }
  const newlyAdded: MemoryEntry[] = [];
  const normalizedAdded: string[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let skippedSensitiveCount = 0;

  for (const item of incoming) {
    const clean = item.content.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) continue;
    const sens = Boolean(item.sensitive) || hasSensitiveInfo(clean);
    if (sens && !allowSensitive) {
      skippedSensitiveCount += 1;
      continue;
    }

    const normNew = normalizeForDedup(clean);
    let dupInExistingIdx = exactIndexMap.get(normNew) ?? -1;
    if (dupInExistingIdx === -1 && normNew.length >= 6) {
      for (let i = 0; i < normalizedExisting.length; i++) {
        const normOld = normalizedExisting[i];
        if (normOld.length < 6) continue;
        const minLen = Math.min(normOld.length, normNew.length);
        const maxLen = Math.max(normOld.length, normNew.length);
        if (minLen / maxLen >= 0.5 && (normOld.includes(normNew) || normNew.includes(normOld))) {
          dupInExistingIdx = i;
          break;
        }
      }
    }

    if (dupInExistingIdx >= 0) {
      const prev = next[dupInExistingIdx];
      const nextContent = clean.length >= prev.content.length ? clean : prev.content;
      next[dupInExistingIdx] = {
        ...prev,
        content: nextContent,
        category: item.category || prev.category,
        tags: Array.from(new Set([...prev.tags, ...item.tags])).slice(0, 6),
        pinned: Boolean(prev.pinned || item.pinned),
        sensitive: Boolean(prev.sensitive || sens),
        updatedAt: Date.now(),
      };
      const updatedNorm = normalizeForDedup(nextContent);
      normalizedExisting[dupInExistingIdx] = updatedNorm;
      exactIndexMap.set(updatedNorm, dupInExistingIdx);
      updatedCount += 1;
      continue;
    }

    // Check against earlier items within the same incoming batch
    let dupInAddedIdx = -1;
    for (let i = 0; i < normalizedAdded.length; i++) {
      const normOld = normalizedAdded[i];
      if (normOld === normNew) {
        dupInAddedIdx = i;
        break;
      }
      if (normOld.length >= 6 && normNew.length >= 6) {
        const minLen = Math.min(normOld.length, normNew.length);
        const maxLen = Math.max(normOld.length, normNew.length);
        if (minLen / maxLen >= 0.5 && (normOld.includes(normNew) || normNew.includes(normOld))) {
          dupInAddedIdx = i;
          break;
        }
      }
    }

    if (dupInAddedIdx >= 0) {
      const prev = newlyAdded[dupInAddedIdx];
      const nextContent = clean.length >= prev.content.length ? clean : prev.content;
      newlyAdded[dupInAddedIdx] = {
        ...prev,
        content: nextContent,
        category: item.category || prev.category,
        tags: Array.from(new Set([...prev.tags, ...item.tags])).slice(0, 6),
        pinned: Boolean(prev.pinned || item.pinned),
        sensitive: Boolean(prev.sensitive || sens),
        updatedAt: Date.now(),
      };
      normalizedAdded[dupInAddedIdx] = normalizeForDedup(nextContent);
      updatedCount += 1;
    } else {
      newlyAdded.push({
        ...item,
        content: clean,
        sensitive: sens,
      });
      normalizedAdded.push(normNew);
      addedCount += 1;
    }
  }

  const entries = newlyAdded.length > 0 ? [...newlyAdded.reverse(), ...next] : next;
  return { entries, addedCount, updatedCount, skippedSensitiveCount };
}

const MAX_QUERY_SCAN_CHARS = 1200;
const MAX_QUERY_TOKENS = 160;

interface PreparedMemoryMeta {
  contentLower: string;
  tagsLower: string[];
  tokenCost: number;
}

const memoryMetaCache = new WeakMap<MemoryEntry, PreparedMemoryMeta>();

function getPreparedMemoryMeta(entry: MemoryEntry): PreparedMemoryMeta {
  const cached = memoryMetaCache.get(entry);
  if (cached) return cached;
  const meta: PreparedMemoryMeta = {
    contentLower: entry.content.toLowerCase(),
    tagsLower: entry.tags.map((t) => t.toLowerCase()),
    tokenCost: estimateTokens(entry.content) + 8,
  };
  memoryMetaCache.set(entry, meta);
  return meta;
}

function tokenizeQuery(text: string): string[] {
  if (!text) return [];
  const bounded = text.length > MAX_QUERY_SCAN_CHARS ? text.slice(0, MAX_QUERY_SCAN_CHARS) : text;
  const tokens = new Set<string>();
  const lower = bounded.toLowerCase();

  const asciiWords = lower.match(/[a-z0-9][a-z0-9._+-]{1,24}/g) || [];
  for (const w of asciiWords) {
    tokens.add(w);
    if (tokens.size >= MAX_QUERY_TOKENS) return Array.from(tokens);
  }

  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    if (run.length <= 6) {
      tokens.add(run);
      if (tokens.size >= MAX_QUERY_TOKENS) return Array.from(tokens);
    }
    for (let i = 0; i <= run.length - 2; i++) {
      tokens.add(run.slice(i, i + 2));
      if (tokens.size >= MAX_QUERY_TOKENS) return Array.from(tokens);
      if (i <= run.length - 3) {
        tokens.add(run.slice(i, i + 3));
        if (tokens.size >= MAX_QUERY_TOKENS) return Array.from(tokens);
      }
    }
  }

  return Array.from(tokens);
}

/**
 * Selects only the subset of memories relevant to the active prompt/context
 * while enforcing both item count and token budgets.
 */
export function retrieveRelevantMemories(
  entries: MemoryEntry[],
  queryText: string,
  recentMessages: Message[],
  settings: MemorySettings
): MemoryEntry[] {
  if (!settings.enabled || entries.length === 0) return [];

  const eligible = settings.recordSensitiveInfo
    ? entries
    : entries.filter((e) => !e.sensitive);
  if (eligible.length === 0) return [];

  const recentUserTexts: string[] = [];
  for (let i = recentMessages.length - 1; i >= 0 && recentUserTexts.length < 2; i--) {
    const m = recentMessages[i];
    if (m.role === 'user') {
      const t = extractTextFromParts(m.parts);
      if (t) recentUserTexts.push(t);
    }
  }
  recentUserTexts.reverse();

  const combinedParts = [queryText, ...recentUserTexts].filter(Boolean);
  const combinedQuery = combinedParts.join('\n');
  const queryTokens = tokenizeQuery(combinedQuery);

  const scored: Array<{ entry: MemoryEntry; meta: PreparedMemoryMeta; relevance: number; totalScore: number }> = [];
  if (queryTokens.length === 0) {
    for (const entry of eligible) {
      if (entry.pinned) {
        scored.push({
          entry,
          meta: getPreparedMemoryMeta(entry),
          relevance: 0,
          totalScore: 1.5,
        });
      }
    }
  } else {
    for (const entry of eligible) {
      const meta = getPreparedMemoryMeta(entry);
      const { contentLower, tagsLower } = meta;
      let relevance = 0;

      for (const tok of queryTokens) {
        for (let i = 0; i < tagsLower.length; i++) {
          const t = tagsLower[i];
          if (t.includes(tok) || (t.length >= 2 && tok.includes(t))) {
            relevance += 4;
            break;
          }
        }
        if (contentLower.includes(tok)) {
          relevance += 2;
        }
      }

      if (relevance > 0 || entry.pinned) {
        const pinScore = entry.pinned ? 1.5 : 0;
        scored.push({ entry, meta, relevance, totalScore: relevance + pinScore });
      }
    }
  }

  scored.sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      b.relevance - a.relevance ||
      b.entry.updatedAt - a.entry.updatedAt
  );

  const maxCount = Math.max(1, settings.maxInjectedMemories);
  const maxTokens = Math.max(100, settings.maxInjectedTokens);
  const selected: MemoryEntry[] = [];
  let tokenSum = 0;
  let pinnedFallbackCount = 0;

  for (const row of scored) {
    if (selected.length >= maxCount) break;
    const isPinnedFallback = row.relevance === 0 && row.entry.pinned;
    if (isPinnedFallback && pinnedFallbackCount >= 2) {
      continue;
    }
    const cost = row.meta.tokenCost;
    if (selected.length > 0 && tokenSum + cost > maxTokens) {
      continue;
    }
    if (isPinnedFallback) {
      pinnedFallbackCount += 1;
    }
    selected.push(row.entry);
    tokenSum += cost;
  }

  return selected;
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  return memories
    .map((m) => {
      const label =
        m.category === 'profile'
          ? '画像'
          : m.category === 'preference'
            ? '偏好'
            : m.category === 'project'
              ? '项目'
              : '记录';
      return `- [${label}] ${m.content}`;
    })
    .join('\n');
}
