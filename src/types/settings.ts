import type { Conversation, Message, ProtocolType, ProviderConfig, ReasoningEffort } from './chat';
import type { PromptSettings, SystemPromptPreset } from './prompt';

export type ThemeMode = 'oled' | 'dark' | 'light' | 'system';

export type ReasoningStrategy =
  | 'none'
  | 'openai-effort'
  | 'gemini-budget'
  | 'gemini-level'
  | 'anthropic-budget'
  | 'anthropic-adaptive'
  | 'deepseek-v4'
  | 'fixed'
  | 'toggle-effort';

export interface ReasoningLevelOption {
  value: ReasoningEffort;
  label: string;
  desc: string;
  budgetTokens?: number;
  apiValue?: string;
}

export interface ModelReasoningProfile {
  id: string;
  familyName: string;
  strategy: ReasoningStrategy;
  levels: ReasoningLevelOption[];
  defaultLevel: ReasoningEffort;
  supportsSamplingWhenThinking?: boolean;
  supportsSamplingWhenOff?: boolean;
}

export interface ModelProfileRule {
  pattern: string;
  profileId: string;
  protocols?: ProtocolType[];
  note?: string;
}

export interface ModelProfileSyncSettings {
  remoteUrl: string;
  remoteRules: ModelProfileRule[];
  customRules: ModelProfileRule[];
  lastSyncedAt?: number;
  lastStatus?: string;
}

export interface AppearanceSettings {
  theme: ThemeMode;
  accentColor: string;
  fontFamily: 'system' | 'serif' | 'mono' | 'custom';
  customFontName: string;
  fontSize: number;
  uiScale: number;
  lineHeight: number;
  mathScale: number;
  contentMaxWidth: number;
  codeTheme: 'auto' | 'github-dark-default' | 'vitesse-black' | 'github-light';
  showLineNumbers: boolean;
  autoPreviewArtifacts: boolean;
  hideMediaFrames: boolean;
  backgroundGeneration: boolean;
  closeToTray: boolean;
  androidBatteryPromptDismissed?: boolean;
  customCss: string;
  sendOnEnter: boolean;
}

export interface GenerationSettings {
  temperature: number;
  topP: number;
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
  reasoningBudgetTokens: number;
  maxContextMessages: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  extraBody?: Record<string, unknown>;
  enabledParams?: {
    temperature?: boolean;
    topP?: boolean;
    maxTokens?: boolean;
    presencePenalty?: boolean;
    frequencyPenalty?: boolean;
  };
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
    modelProfiles?: ModelProfileSyncSettings;
  };
}

export const DEFAULT_APPEARANCE_SETTINGS: AppearanceSettings = {
  theme: 'dark',
  accentColor: '#d97757',
  fontFamily: 'system',
  customFontName: '',
  fontSize: 16,
  uiScale: 1.06,
  lineHeight: 1.72,
  mathScale: 1.06,
  contentMaxWidth: 780,
  codeTheme: 'auto',
  showLineNumbers: false,
  autoPreviewArtifacts: true,
  hideMediaFrames: false,
  backgroundGeneration: true,
  closeToTray: true,
  androidBatteryPromptDismissed: false,
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
  presencePenalty: 0,
  frequencyPenalty: 0,
  enabledParams: {
    temperature: true,
    topP: true,
    maxTokens: true,
    presencePenalty: false,
    frequencyPenalty: false,
  },
};

export const DEFAULT_MODEL_PROFILE_SYNC_SETTINGS: ModelProfileSyncSettings = {
  remoteUrl: 'https://raw.githubusercontent.com/OranImp/ChatBeauty/main/public/model-profiles.json',
  remoteRules: [],
  customRules: [],
};

export const DEFAULT_WEBDAV_SETTINGS: WebDavSyncSettings = {
  enabled: false,
  endpoint: '',
  username: '',
  password: '',
  remotePath: '/ChatBeauty/backup.json',
  autoSync: false,
};
