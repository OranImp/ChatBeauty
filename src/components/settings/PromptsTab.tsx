import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  FileCode2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_RENDER_ENHANCEMENT_PROMPT } from '@/services/prompts/presets';
import type { SystemPromptPreset } from '@/types/prompt';
import {
  SettingsCollapsibleRow,
  SettingsNavRow,
  SettingsSection,
  SettingsToggleRow,
} from './SettingsPrimitives';

export const PromptsTab: React.FC = () => {
  const {
    promptPresets,
    promptSettings,
    savePromptPreset,
    deletePromptPreset,
    resetBuiltinPreset,
    updatePromptSettings,
  } = useAppStore();

  const [renderDraft, setRenderDraft] = useState(promptSettings.renderEnhancementPrompt);
  const [renderPromptOpen, setRenderPromptOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(promptSettings.defaultPresetId);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [prevEditingId, setPrevEditingId] = useState<string | null>(null);
  const [subViewAnim, setSubViewAnim] = useState<'cb-step-forward' | 'cb-step-backward' | ''>('');
  if (editingPresetId !== prevEditingId) {
    setPrevEditingId(editingPresetId);
    setSubViewAnim(editingPresetId ? 'cb-step-forward' : 'cb-step-backward');
  }

  const [presetDraft, setPresetDraft] = useState<SystemPromptPreset | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    setRenderDraft(promptSettings.renderEnhancementPrompt);
  }, [promptSettings.renderEnhancementPrompt]);

  useEffect(() => {
    const found =
      promptPresets.find((p) => p.id === selectedPresetId) || promptPresets[0] || null;
    setPresetDraft(found ? structuredClone(found) : null);
  }, [selectedPresetId, promptPresets]);

  const flash = (msg: string) => {
    setSavedNotice(msg);
    setTimeout(() => setSavedNotice(null), 1800);
  };

  const handleCreateCustom = async () => {
    const custom: SystemPromptPreset = {
      id: `custom_${Date.now()}`,
      name: '自定义学习导师',
      description: '用户自定义的专属系统提示词',
      content: '请结合具体例题与直觉解释回答我的问题。',
      isBuiltIn: false,
      category: 'custom',
      updatedAt: Date.now(),
    };
    await savePromptPreset(custom);
    setSelectedPresetId(custom.id);
    setEditingPresetId(custom.id);
    flash('已新建自定义预设');
  };

  if (editingPresetId && presetDraft) {
    return (
      <div
        key={`prompts-edit-${presetDraft.id}`}
        className={`${subViewAnim} space-y-4 text-[13.5px] min-w-0 max-w-full`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setEditingPresetId(null)}
            className="flex items-center gap-1.5 text-muted hover:text-fg active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回预设列表</span>
          </button>

          <div className="flex items-center gap-2">
            {promptSettings.defaultPresetId === presetDraft.id && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                当前默认
              </span>
            )}
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-fg/10 text-muted">
              {presetDraft.isBuiltIn ? '内置预设' : '自定义预设'}
            </span>
          </div>
        </div>

        {savedNotice && (
          <div className="cb-panel-enter px-3 py-2 rounded-xl border border-borderc bg-surface text-xs text-fg break-words">
            {savedNotice}
          </div>
        )}

        <SettingsSection title={`编辑预设：${presetDraft.name}`}>
          <div className="p-3.5 sm:p-4 space-y-3.5 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
              <label className="space-y-1 min-w-0">
                <span className="text-xs text-muted">预设名称</span>
                <input
                  value={presetDraft.name}
                  onChange={(e) => setPresetDraft({ ...presetDraft, name: e.target.value })}
                  className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
                />
              </label>
              <label className="space-y-1 min-w-0">
                <span className="text-xs text-muted">简要说明</span>
                <input
                  value={presetDraft.description}
                  onChange={(e) =>
                    setPresetDraft({ ...presetDraft, description: e.target.value })
                  }
                  className="w-full min-w-0 px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
                />
              </label>
            </div>

            <label className="block space-y-1 min-w-0">
              <span className="text-xs text-muted">系统提示词正文</span>
              <textarea
                rows={7}
                value={presetDraft.content}
                onChange={(e) => setPresetDraft({ ...presetDraft, content: e.target.value })}
                className="w-full min-w-0 px-3 py-2.5 rounded-xl bg-bg border border-borderc text-fg text-[13.5px] leading-relaxed focus:outline-none focus:border-fg/40"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-2">
                {presetDraft.isBuiltIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      void resetBuiltinPreset(presetDraft.id);
                      flash('已还原该内置预设');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>还原默认</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void deletePromptPreset(presetDraft.id);
                      setEditingPresetId(null);
                      flash('已删除自定义预设');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除预设</span>
                  </button>
                )}

                {promptSettings.defaultPresetId !== presetDraft.id && (
                  <button
                    type="button"
                    onClick={() => {
                      void updatePromptSettings({ defaultPresetId: presetDraft.id });
                      flash(`已将「${presetDraft.name}」设为默认预设`);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-fg transition"
                  >
                    设为新对话默认
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  void savePromptPreset(presetDraft);
                  flash('预设内容已保存');
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存此预设</span>
              </button>
            </div>
          </div>
        </SettingsSection>
      </div>
    );
  }

  const isDefaultRenderPrompt =
    renderDraft.trim() === DEFAULT_RENDER_ENHANCEMENT_PROMPT.trim();

  return (
    <div
      key="prompts-list"
      className={`${subViewAnim} space-y-5 text-[13.5px] min-w-0 max-w-full`}
    >
      {savedNotice && (
        <div className="cb-panel-enter px-3 py-2 rounded-xl border border-borderc bg-surface text-xs text-fg break-words">
          {savedNotice}
        </div>
      )}

      <SettingsSection title="视觉与学术渲染增强协议">
        <SettingsToggleRow
          icon={<Sparkles className="w-4 h-4 text-accent" />}
          title="启用渲染增强协议"
          description="自动附带协议到提示词末尾，引导模型稳定输出 LaTeX 公式、SVG、Mermaid 与 ECharts"
          checked={promptSettings.renderEnhancementEnabled}
          onChange={(checked) =>
            void updatePromptSettings({ renderEnhancementEnabled: checked })
          }
          ariaLabel="启用渲染增强协议"
        />
        <SettingsCollapsibleRow
          icon={<FileCode2 className="w-4 h-4" />}
          title="编辑渲染增强协议正文"
          description="按需自定义附带在系统提示词后的格式规范说明"
          value={isDefaultRenderPrompt ? '默认协议' : '已自定义'}
          open={renderPromptOpen}
          onToggle={() => setRenderPromptOpen((v) => !v)}
        >
          <div className="space-y-2.5 min-w-0">
            <textarea
              rows={9}
              value={renderDraft}
              onChange={(e) => setRenderDraft(e.target.value)}
              className="w-full min-w-0 px-3 py-2.5 rounded-xl bg-bg border border-borderc text-xs text-fg leading-relaxed font-mono focus:outline-none focus:border-fg/40"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenderDraft(DEFAULT_RENDER_ENHANCEMENT_PROMPT);
                  void updatePromptSettings({
                    renderEnhancementPrompt: DEFAULT_RENDER_ENHANCEMENT_PROMPT,
                  });
                  flash('已恢复默认渲染增强协议');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-borderc bg-bg hover:bg-elevated text-xs text-muted hover:text-fg transition"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>恢复默认</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void updatePromptSettings({ renderEnhancementPrompt: renderDraft });
                  flash('渲染增强协议已保存');
                }}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold hover:opacity-90 active:scale-95 transition"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存协议内容</span>
              </button>
            </div>
          </div>
        </SettingsCollapsibleRow>
      </SettingsSection>

      <SettingsSection
        title="角色与学习提示词预设"
        description="点击任意预设进入二级编辑与默认切换"
        action={
          <button
            type="button"
            onClick={() => void handleCreateCustom()}
            className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-elevated border border-borderc hover:border-fg/35 text-xs text-fg active:scale-95 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建预设</span>
          </button>
        }
      >
        {promptPresets.map((p) => {
          const isDefault = promptSettings.defaultPresetId === p.id;
          return (
            <SettingsNavRow
              key={p.id}
              icon={<MessageSquareText className="w-4 h-4" />}
              title={p.name}
              description={p.description}
              badge={
                isDefault ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 shrink-0">
                    默认
                  </span>
                ) : null
              }
              value={p.isBuiltIn ? '内置' : '自定义'}
              onClick={() => {
                setSelectedPresetId(p.id);
                setEditingPresetId(p.id);
              }}
            />
          );
        })}
      </SettingsSection>
    </div>
  );
};
