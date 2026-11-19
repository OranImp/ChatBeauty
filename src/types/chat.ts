export type ProtocolType = 'openai-chat' | 'openai-responses' | 'gemini' | 'anthropic';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string; durationMs?: number }
  | { type: 'image'; mimeType: string; dataUrl?: string; url?: string; alt?: string }
  | { type: 'audio'; mimeType: string; dataUrl?: string; transcript?: string; durationSec?: number }
  | { type: 'file'; name: string; mimeType: string; size?: number; dataUrl?: string };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export type MessageStatus = 'streaming' | 'done' | 'error' | 'aborted';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  parts: ContentPart[];
  createdAt: number;
  updatedAt: number;
  modelId?: string;
  providerId?: string;
  protocol?: ProtocolType;
  usage?: TokenUsage;
  error?: string;
  status: MessageStatus;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  providerId?: string;
  modelId?: string;
  systemPromptPresetId?: string;
  customSystemPrompt?: string;
  enableRenderPrompt?: boolean;
  isDemo?: boolean;
}

export interface ModelCapabilities {
  chat: boolean;
  reasoning?: boolean;
  vision?: boolean;
  imageGen?: boolean;
  speechIn?: boolean;
  speechOut?: boolean;
}

export interface ModelDefinition {
  id: string;
  name: string;
  capabilities: ModelCapabilities;
  contextLength?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  protocol: ProtocolType;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  models: ModelDefinition[];
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}
