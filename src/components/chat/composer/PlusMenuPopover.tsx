import React from 'react';
import { ImagePlus } from 'lucide-react';
import { MAX_ATTACHED_IMAGES } from '@/services/media/imageUtils';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { Conversation } from '@/types/chat';
import type { SystemPromptPreset } from '@/types/prompt';

interface PlusMenuPopoverProps {
  attachedImagesCount: number;
  activeConv: Conversation | undefined;
  renderEnabled: boolean;
  promptPresets: SystemPromptPreset[];
  activePresetId: string;
  onUploadImage: () => void;
  onOpenPromptsSettings: () => void;
  onUpdateConversationConfig: (convId: string, patch: Partial<Conversation>) => void | Promise<void>;
}

export const PlusMenuPopover: React.FC<PlusMenuPopoverProps> = ({
  attachedImagesCount,
  activeConv,
  renderEnabled,
  promptPresets,
  activePresetId,
  onUploadImage,
  onOpenPromptsSettings,
  onUpdateConversationConfig,
}) => {
  return (
    <div className="p-3 space-y-3">
      <div className="space-y-1">
        <div className="text-[11px] text-muted px-1">多模态与图片输入</div>
        <button
          type="button"
          onClick={onUploadImage}
          className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface/75 hover:bg-fg/10 border border-borderc/60 active:scale-[0.985] text-fg transition"
        >
          <span className="flex items-center gap-2">
            <ImagePlus className="w-4 h-4 text-accent" />
            <span>上传图片（识图）</span>
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-muted">
            {attachedImagesCount > 0
              ? `已附 ${attachedImagesCount}/${MAX_ATTACHED_IMAGES} 张`
              : `最多 ${MAX_ATTACHED_IMAGES} 张`}
          </span>
        </button>
      </div>

      <div className="pt-2 border-t border-borderc space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-fg">提示词与渲染协议</span>
          <button
            type="button"
            onClick={onOpenPromptsSettings}
            className="text-muted hover:text-fg transition"
          >
            编辑预设
          </button>
        </div>

        {activeConv && (
          <>
            <div
              className="cb-list-item flex items-center justify-between px-2.5 py-2 rounded-xl bg-surface border border-borderc"
              style={{ '--stagger-i': 0 } as React.CSSProperties}
            >
              <span className="text-fg">学术公式与 SVG 渲染增强</span>
              <ToggleSwitch
                checked={renderEnabled}
                onChange={(checked) =>
                  void onUpdateConversationConfig(activeConv.id, {
                    enableRenderPrompt: checked,
                  })
                }
                ariaLabel="渲染增强"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              {promptPresets.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    void onUpdateConversationConfig(activeConv.id, {
                      systemPromptPresetId: p.id,
                    })
                  }
                  style={{ '--stagger-i': idx + 1 } as React.CSSProperties}
                  className={`cb-list-item px-2.5 py-1 rounded-lg active:scale-[0.97] transition ${
                    activePresetId === p.id
                      ? 'bg-accent text-accentfg font-medium'
                      : 'bg-surface text-muted hover:text-fg'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
