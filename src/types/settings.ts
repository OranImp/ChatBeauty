import type { Conversation, Message, ProviderConfig } from './chat';
import type { PromptSettings, SystemPromptPreset } from './prompt';

export type ThemeMode = 'oled' | 'dark' | 'light' | 'system';

export interface AppearanceSettings {
  theme: ThemeMode;
  accentColor: string;
  fontFamily: 'system' | 'serif' | 'mono' | 'custom';
  customFontName: string;
  fontSize: number;
  lineHeight: number;
  mathScale: number;
  contentMaxWidth: number;
  codeTheme: 'auto' | 'github-dark-default' | 'vitesse-black' | 'github-light';
  showLineNumbers: boolean;
  autoPreviewArtifacts: boolean;
  customCss: string;
  sendOnEnter: boolean;
}

export interface GenerationSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high';
  reasoningBudgetTokens: number;
  maxContextMessages: number;
}

export interface WebDavSyncSettings {
  enabled: boolean;
  endpoint: string;
  username: string;
  password: string;
  remotePath: string;
  autoSync: boolean;
  lastSyncedAt?: number;
  lastStatus?: string;
}

export interface AppBackupV1 {
  version: 1;
  app: 'ChatBeauty';
  exportedAt: number;
  conversations: Conversation[];
  messages: Message[];
  providers: ProviderConfig[];
  promptPresets: SystemPromptPreset[];
  settings: {
    appearance: AppearanceSettings;
    generation: GenerationSettings;
    prompt: PromptSettings;
    webdav: WebDavSyncSettings;
  };
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'oled',
  accentColor: '#38bdf8',
  fontFamily: 'system',
  customFontName: '',
  fontSize: 16,
  lineHeight: 1.72,
  mathScale: 1.06,
  contentMaxWidth: 780,
  codeTheme: 'auto',
  showLineNumbers: false,
  autoPreviewArtifacts: true,
  customCss: '',
  sendOnEnter: true,
};

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  topP: 0.95,
  maxTokens: 8192,
  reasoningEffort: 'medium',
  reasoningBudgetTokens: 4096,
  maxContextMessages: 24,
};

export const DEFAULT_WEBDAV_SETTINGS: WebDavSyncSettings = {
  enabled: false,
  endpoint: '',
  username: '',
  password: '',
  remotePath: '/ChatBeauty/backup.json',
  autoSync: false,
};
