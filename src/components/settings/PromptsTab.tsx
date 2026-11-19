import React, { useEffect, useState } from 'react';
import { Check, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_RENDER_ENHANCEMENT_PROMPT } from '@/services/prompts/presets';
import type { SystemPromptPreset } from '@/types/prompt';

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
  const [selectedPresetId, setSelectedPresetId] = useState(promptSettings.defaultPresetId);
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
    flash('已新建自定义预设');
  };

  return (
    <div className="space-y-6">
      {savedNotice && (
        <div className="px-3 py-2 rounded-xl border border-borderc bg-surface text-xs text-fg">
          {savedNotice}
        </div>
      )}

      {/* Rendering Enhancement Protocol Card */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-fg">
              视觉与学术渲染增强协议
            </div>
            <p className="text-xs text-muted leading-relaxed">
              开启后，系统会自动附带这段协议到所有角色提示词末尾，引导模型稳定输出规范的 LaTeX 公式、SVG 原理电路图、Mermaid 流程图、ECharts 图表与交互实验。
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              void updatePromptSettings({
                renderEnhancementEnabled: !promptSettings.renderEnhancementEnabled,
              })
            }
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition ${
              promptSettings.renderEnhancementEnabled
                ? 'bg-accent text-accentfg'
                : 'bg-surface border border-borderc text-muted'
            }`}
          >
            {promptSettings.renderEnhancementEnabled ? '已开启' : '已关闭'}
          </button>
        </div>

        <textarea
          rows={9}
          value={renderDraft}
          onChange={(e) => setRenderDraft(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl bg-bg/90 border border-borderc text-xs text-fg leading-relaxed font-mono focus:outline-none focus:border-fg/40"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setRenderDraft(DEFAULT_RENDER_ENHANCEMENT_PROMPT);
              void updatePromptSettings({
                renderEnhancementPrompt: DEFAULT_RENDER_ENHANCEMENT_PROMPT,
              });
              flash('已恢复默认渲染增强协议');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-borderc text-xs text-muted hover:text-fg transition"
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
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold transition"
          >
            <Check className="w-3.5 h-3.5" />
            <span>保存协议内容</span>
          </button>
        </div>
      </div>

      {/* Persona Presets Manager */}
      <div className="rounded-2xl border border-borderc bg-surface/40 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-fg">角色与学习系统提示词预设</div>
            <div className="text-xs text-muted">内置多套学术与教学预设，支持任意编辑或新建</div>
          </div>
          <button
            type="button"
            onClick={() => void handleCreateCustom()}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-elevated border border-borderc hover:border-fg/35 text-xs text-fg transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建预设</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {promptPresets.map((p) => {
            const isSelected = presetDraft?.id === p.id;
            const isDefault = promptSettings.defaultPresetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedPresetId(p.id)}
                className={`px-3 py-1.5 rounded-xl text-xs border transition flex items-center gap-1.5 ${
                  isSelected
                    ? 'border-fg/35 bg-elevated text-fg font-medium'
                    : 'border-borderc bg-bg/60 text-muted hover:text-fg'
                }`}
              >
                <span>{p.name}</span>
                {isDefault && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-fg/10 text-fg">
                    默认
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {presetDraft && (
          <div className="space-y-3 pt-2 border-t border-borderc/60">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-muted">预设名称</span>
                <input
                  value={presetDraft.name}
                  onChange={(e) => setPresetDraft({ ...presetDraft, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
                />
              </label>
              <label className="space-y-1">
                <span className="text-muted">简要说明</span>
                <input
                  value={presetDraft.description}
                  onChange={(e) =>
                    setPresetDraft({ ...presetDraft, description: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-xl bg-bg border border-borderc text-fg focus:outline-none focus:border-fg/40"
                />
              </label>
            </div>

            <label className="block space-y-1 text-xs">
              <span className="text-muted">系统提示词正文</span>
              <textarea
                rows={6}
                value={presetDraft.content}
                onChange={(e) => setPresetDraft({ ...presetDraft, content: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl bg-bg border border-borderc text-fg text-xs leading-relaxed focus:outline-none focus:border-fg/40"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {presetDraft.isBuiltIn ? (
                  <button
                    type="button"
                    onClick={() => {
                      void resetBuiltinPreset(presetDraft.id);
                      flash('已还原该内置预设');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-borderc text-xs text-muted hover:text-fg"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>还原默认</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void deletePromptPreset(presetDraft.id);
                      flash('已删除自定义预设');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>删除</span>
                  </button>
                )}

                {promptSettings.defaultPresetId !== presetDraft.id && (
                  <button
                    type="button"
                    onClick={() => {
                      void updatePromptSettings({ defaultPresetId: presetDraft.id });
                      flash(`已将「${presetDraft.name}」设为默认预设`);
                    }}
                    className="px-3 py-1.5 rounded-xl border border-borderc text-xs text-fg hover:border-fg/40"
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
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-accentfg text-xs font-semibold"
              >
                <Check className="w-3.5 h-3.5" />
                <span>保存此预设</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
