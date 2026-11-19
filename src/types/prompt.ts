export type PromptCategory = 'study' | 'visual' | 'coding' | 'general' | 'custom';

export interface SystemPromptPreset {
  id: string;
  name: string;
  description: string;
  content: string;
  isBuiltIn: boolean;
  category: PromptCategory;
  updatedAt: number;
}

export interface PromptSettings {
  defaultPresetId: string;
  renderEnhancementEnabled: boolean;
  renderEnhancementPrompt: string;
}
