import type {
  CustomModelParams,
  Message,
  ModelDefinition,
  ProviderConfig,
  TokenUsage,
} from './chat';
import type { GenerationSettings, ModelReasoningProfile } from './settings';

export interface ChatStreamRequest {
  provider: ProviderConfig;
  modelId: string;
  systemPrompt: string;
  messages: Message[];
  generation: GenerationSettings;
  modelParams?: CustomModelParams;
  conversationParams?: CustomModelParams;
  reasoningProfile?: ModelReasoningProfile;
}

export interface ChatStreamCallbacks {
  onTextDelta: (delta: string) => void;
  onReasoningDelta: (delta: string) => void;
  onUsage?: (usage: TokenUsage) => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Reserved multimodal capability contracts so image generation,
 * vision, STT, and TTS can be implemented without refactoring core layers.
 */
export interface ImageGenRequest {
  provider: ProviderConfig;
  modelId: string;
  prompt: string;
  size?: string;
  n?: number;
}

export interface ImageGenResult {
  images: Array<{ mimeType: string; dataUrl?: string; url?: string; revisedPrompt?: string }>;
}

export interface AudioTranscribeRequest {
  provider: ProviderConfig;
  modelId: string;
  audioDataUrl: string;
  mimeType: string;
  language?: string;
}

export interface AudioTranscribeResult {
  text: string;
  language?: string;
}

export interface SpeechSynthesizeRequest {
  provider: ProviderConfig;
  modelId: string;
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'opus';
}

export interface SpeechSynthesizeResult {
  mimeType: string;
  dataUrl: string;
}

export interface LLMProviderAdapter {
  readonly protocol: ProviderConfig['protocol'];
  chatStream(
    req: ChatStreamRequest,
    callbacks: ChatStreamCallbacks,
    signal: AbortSignal
  ): Promise<void>;
  listModels?(provider: ProviderConfig, signal?: AbortSignal): Promise<ModelDefinition[]>;
  generateImage?(req: ImageGenRequest, signal?: AbortSignal): Promise<ImageGenResult>;
  transcribeAudio?(req: AudioTranscribeRequest, signal?: AbortSignal): Promise<AudioTranscribeResult>;
  synthesizeSpeech?(
    req: SpeechSynthesizeRequest,
    signal?: AbortSignal
  ): Promise<SpeechSynthesizeResult>;
}
