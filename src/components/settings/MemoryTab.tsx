import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brain,
  Check,
  Code2,
  Download,
  FileText,
  ListChecks,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { MemoryCategory, MemoryEntry } from '@/types/memory';
import { MEMORY_FILE_HEADER, parseMemoryDocument } from '@/services/memory/memoryEngine';
import { SmoothSlider } from '@/components/ui/SmoothSlider';
import {
  SettingsCollapsibleRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

const CATEGORY_LABELS: Record<MemoryCategory, string> = {
  profile: '个人画像',
  preference: '偏好习惯',
  project: '项目目标',
  fact: '其他记录',
};

export const MemoryTab: React.FC = () => {
  const {
    memorySettings,
    memoryEntries,
    memoryDocument,
    updateMemorySettings,
    saveMemoryDocument,
    upsertMemoryEntry,
    deleteMemoryEntry,
    clearAllMemories,
  } = useAppStore();

  const [viewMode, setViewMode] = useState<'entries' | 'source'>('entries');
  const [searchQuery, setSearchQuery] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | MemoryCategory | 'sensitive'>('all');
  const [budgetOpen, setBudgetOpen] = useState(false);

  // Source editor state
  const [sourceText, setSourceText] = useState(memoryDocument || `${MEMORY_FILE_HEADER}\n`);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // New / Edit entry composer
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<MemoryCategory>('fact');
  const [draftContent, setDraftContent] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [draftPinned, setDraftPinned] = useState(false);
  const [draftSensitive, setDraftSensitive] = useState(false);

  const importRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSourceText(memoryDocument || `${MEMORY_FILE_HEADER}\n`);
  }, [memoryDocument]);

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice(null), 2400);
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return memoryEntries.filter((entry) => {
      if (catFilter === 'sensitive' && !entry.sensitive) return false;
      if (catFilter !== 'all' && catFilter !== 'sensitive' && entry.category !== catFilter) {
        return false;
      }
      if (!q) return true;
      return (
        entry.content.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [memoryEntries, searchQuery, catFilter]);

  const parsedSourcePreviewCount = useMemo(
    () => parseMemoryDocument(sourceText).length,
    [sourceText]
  );

  const openNewEntry = () => {
    setEditingId(null);
    setDraftCategory('fact');
    setDraftContent('');
    setDraftTags('');
    setDraftPinned(false);
    setDraftSensitive(false);
    setCreating(true);
  };

  const openEditEntry = (entry: MemoryEntry) => {
    setCreating(false);
    setEditingId(entry.id);
    setDraftCategory(entry.category);
    setDraftContent(entry.content);
    setDraftTags(entry.tags.join(', '));
    setDraftPinned(Boolean(entry.pinned));
    setDraftSensitive(Boolean(entry.sensitive));
  };

  const saveEntryForm = async () => {
    const clean = draftContent.replace(/[\r\n]+/g, ' ').trim();
    if (!clean) {
      flash(false, '记忆内容不能为空');
      return;
    }
    const existing = editingId ? memoryEntries.find((e) => e.id === editingId) : undefined;
    const now = Date.now();
    const tags = draftTags
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 6);

    await upsertMemoryEntry({
      id: existing?.id || `mem_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      category: draftCategory,
      content: clean,
      tags,
      pinned: draftPinned,
      sensitive: draftSensitive,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      sourceConvId: existing?.sourceConvId,
    });

    setCreating(false);
    setEditingId(null);
    flash(true, existing ? '已更新记忆条目' : '已添加到单文件记忆库');
  };

  const handleExportMd = () => {
    const content = memoryDocument || `${MEMORY_FILE_HEADER}\n`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'chatbeauty-memory.md';
    a.click();
    URL.revokeObjectURL(url);
    flash(true, '已导出单文件记忆库 chatbeauty-memory.md');
  };

  const handleImportMd: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await saveMemoryDocument(text);
      const count = parseMemoryDocument(text).length;
      flash(true, `已导入并解析 ${count} 条记忆`);
    } catch (err) {
      flash(false, err instanceof Error ? err.message : '导入记忆文件失败');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-5 text-[13.5px] min-w-0 max-w-full">
      {notice && (
        <div
          className={`cb-panel-enter px-3 py-2 rounded-xl border text-xs break-words ${
            notice.ok
              ? 'border-borderc bg-surface text-fg'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
          }`}
        >
          {notice.text}
        </div>
      )}

      <SettingsSection title="记忆策略与隐私">
        <SettingsToggleRow
          icon={<Brain className="w-4 h-4 text-accent" />}
          title="启用记忆库"
          description="开启后，每次对话将按需检索相关记忆注入上下文"
          checked={memorySettings.enabled}
          onChange={(checked) => void updateMemorySettings({ enabled: checked })}
          ariaLabel="启用记忆库"
        />

        <SettingsToggleRow
          icon={<Sparkles className="w-4 h-4" />}
          title="自动识别并记录"
          description="在明确要求记忆（「记住……」）或自然透露个人信息/偏好时自动整理写入"
          checked={memorySettings.autoExtract}
          onChange={(checked) => void updateMemorySettings({ autoExtract: checked })}
          ariaLabel="自动识别并记录"
        />

        <SettingsToggleRow
          icon={<ShieldAlert className="w-4 h-4" />}
          title="允许记录敏感信息"
          description="默认关闭以自动过滤手机号、邮箱、证件号、住址、密钥及健康/薪资隐私"
          checked={memorySettings.recordSensitiveInfo}
          onChange={(checked) => void updateMemorySettings({ recordSensitiveInfo: checked })}
          ariaLabel="允许记录敏感信息"
        />

        <SettingsCollapsibleRow
          icon={<ListChecks className="w-4 h-4" />}
          title="按需读取预算"
          description="限制单次对话最多注入的记忆条数与 Token 上限，避免干扰上下文"
          value={`最多 ${memorySettings.maxInjectedMemories} 条 · ${memorySettings.maxInjectedTokens} tok`}
          open={budgetOpen}
          onToggle={() => setBudgetOpen((v) => !v)}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 min-w-0">
            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>单次最多读取条数</span>
                <span className="font-mono tabular-nums text-fg">
                  {memorySettings.maxInjectedMemories} 条
                </span>
              </div>
              <SmoothSlider
                min={1}
                max={15}
                decimals={0}
                value={memorySettings.maxInjectedMemories}
                onChange={(val) =>
                  void updateMemorySettings({ maxInjectedMemories: Math.round(val) })
                }
                ariaLabel="单次最多读取条数"
              />
            </div>

            <div className="space-y-1.5 min-w-0">
              <div className="flex justify-between text-xs text-muted">
                <span>按需注入 Token 预算</span>
                <span className="font-mono tabular-nums text-fg">
                  {memorySettings.maxInjectedTokens} tokens
                </span>
              </div>
              <SmoothSlider
                min={200}
                max={2000}
                decimals={0}
                value={memorySettings.maxInjectedTokens}
                onChange={(val) =>
                  void updateMemorySettings({
                    maxInjectedTokens: Math.round(val / 50) * 50,
                  })
                }
                ariaLabel="按需注入 Token 预算"
              />
            </div>
          </div>
        </SettingsCollapsibleRow>
      </SettingsSection>

      <SettingsSection
        title={`单文件记忆库 (${memoryEntries.length} 条)`}
        description="统一保存为单个 chatbeauty-memory.md（桌面端同步写入本地应用目录）"
        action={
          <div className="inline-flex rounded-xl border border-borderc bg-surface/80 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('entries')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition ${
                viewMode === 'entries'
                  ? 'bg-elevated text-fg font-medium shadow-sm'
                  : 'text-muted hover:text-fg'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>条目视图</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('source')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg transition ${
                viewMode === 'source'
                  ? 'bg-elevated text-fg font-medium shadow-sm'
                  : 'text-muted hover:text-fg'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>单文件源码</span>
            </button>
          </div>
        }
      >
        <div className="px-3.5 sm:px-4 py-3 flex flex-wrap items-center justify-between gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={handleExportMd}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 .md</span>
            </button>
            <button
              type="button"
              onClick={() => importRef.current?.click()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入 .md</span>
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".md,.markdown,.txt"
              onChange={(e) => void handleImportMd(e)}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {memoryEntries.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  void clearAllMemories().then(() => flash(true, '已清空全部记忆条目'))
                }
                className="px-2.5 py-1.5 rounded-xl border border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/10 transition"
              >
                清空
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setViewMode('entries');
                openNewEntry();
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>新增记忆</span>
            </button>
          </div>
        </div>

        {viewMode === 'source' ? (
          <div className="px-3.5 sm:px-4 py-3.5 space-y-2.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
              <span>直接编辑单文件 Markdown（支持按分组添加 `- 记忆内容`）</span>
              <span className="font-mono">预览识别：{parsedSourcePreviewCount} 条</span>
            </div>
            <textarea
              rows={13}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={`${MEMORY_FILE_HEADER}\n\n## 个人画像与身份 (profile)\n- 喜欢严谨直观的推导`}
              className="w-full min-w-0 px-3 py-2.5 rounded-xl bg-bg border border-borderc font-mono text-xs text-fg leading-relaxed focus:outline-none focus:border-fg/40"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSourceText(memoryDocument || `${MEMORY_FILE_HEADER}\n`)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>还原已保存内容</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  void saveMemoryDocument(sourceText).then(() =>
                    flash(true, `已保存单文件记忆库（共 ${parsedSourcePreviewCount} 条）`)
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存单文件</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 sm:p-4 space-y-3 min-w-0">
            {(creating || editingId) && (
              <div className="cb-panel-enter p-3 rounded-xl border border-accent/35 bg-bg/85 space-y-2.5 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-fg">
                    {editingId ? '编辑记忆条目' : '新增记忆条目'}
                  </span>
                  <select
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value as MemoryCategory)}
                    aria-label="记忆分类"
                    className="px-2.5 py-1 rounded-lg bg-surface border border-borderc text-xs text-fg"
                  >
                    <option value="profile">个人画像</option>
                    <option value="preference">偏好习惯</option>
                    <option value="project">项目目标</option>
                    <option value="fact">其他记录</option>
                  </select>
                </div>

                <textarea
                  rows={2}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="例如：正在准备数字信号处理课程，偏好先看电路物理直觉再推导公式"
                  className="w-full min-w-0 px-3 py-2 rounded-xl bg-surface border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
                />

                <input
                  value={draftTags}
                  onChange={(e) => setDraftTags(e.target.value)}
                  placeholder="关键词标签，逗号分隔（例如：学习偏好, DSP, 电路）"
                  className="w-full min-w-0 px-3 py-1.5 rounded-xl bg-surface border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
                />

                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftPinned}
                        onChange={(e) => setDraftPinned(e.target.checked)}
                      />
                      <span>置顶核心画像</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={draftSensitive}
                        onChange={(e) => setDraftSensitive(e.target.checked)}
                      />
                      <span>标记为敏感</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setEditingId(null);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-borderc text-xs text-muted hover:text-fg"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveEntryForm()}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-accent text-accentfg text-xs font-semibold"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>保存</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索记忆内容或关键词..."
                  className="w-full min-w-0 pl-8 pr-3 py-1.5 rounded-xl bg-bg border border-borderc text-xs text-fg focus:outline-none focus:border-fg/40"
                />
              </div>

              <div className="flex flex-wrap gap-1 min-w-0">
                {(
                  [
                    ['all', '全部'],
                    ['profile', '画像'],
                    ['preference', '偏好'],
                    ['project', '项目'],
                    ['fact', '其他'],
                    ['sensitive', '敏感'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCatFilter(key)}
                    className={`px-2 py-1 rounded-lg border text-[11px] transition ${
                      catFilter === key
                        ? 'border-accent bg-accent text-accentfg font-medium'
                        : 'border-borderc bg-bg/70 text-muted hover:text-fg'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-borderc p-6 text-center text-xs text-muted">
                {memoryEntries.length === 0
                  ? '暂无记忆。当你在对话中说「记住……」或介绍自己的身份偏好时，系统会按需沉淀到单文件记忆库中。'
                  : '未找到匹配的记忆条目'}
              </div>
            ) : (
              <div className="space-y-2 min-w-0">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl border border-borderc bg-bg/65 space-y-2 min-w-0"
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <p className="text-[13px] text-fg leading-relaxed break-words flex-1 min-w-0">
                        {entry.content}
                      </p>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void upsertMemoryEntry({
                              ...entry,
                              pinned: !entry.pinned,
                              updatedAt: Date.now(),
                            })
                          }
                          className={`p-1 rounded-lg hover:bg-fg/10 transition ${
                            entry.pinned ? 'text-accent' : 'text-muted hover:text-fg'
                          }`}
                          title={entry.pinned ? '取消置顶' : '置顶'}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditEntry(entry)}
                          className="p-1 rounded-lg text-muted hover:text-fg hover:bg-fg/10 transition"
                          title="编辑记忆"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteMemoryEntry(entry.id)}
                          className="p-1 rounded-lg text-muted hover:text-rose-400 hover:bg-fg/10 transition"
                          title="删除记忆"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                      <span className="px-1.5 py-0.5 rounded bg-fg/10 text-muted">
                        {CATEGORY_LABELS[entry.category]}
                      </span>
                      {entry.pinned && (
                        <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent">
                          置顶
                        </span>
                      )}
                      {entry.sensitive && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          敏感
                        </span>
                      )}
                      {entry.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 rounded bg-surface border border-borderc text-muted font-mono"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SettingsSection>
    </div>
  );
};
