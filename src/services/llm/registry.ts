import type { ModelDefinition, ProtocolType } from '@/types/chat';
import type { LLMProviderAdapter } from '@/types/provider';
import { OpenAIChatAdapter } from './adapters/openaiChat';
import { OpenAIResponsesAdapter } from './adapters/openaiResponses';
import { GeminiAdapter } from './adapters/gemini';
import { AnthropicAdapter } from './adapters/anthropic';
import { toModelDefinition } from './adapters/shared';

const adapters: Record<ProtocolType, LLMProviderAdapter> = {
  'openai-chat': new OpenAIChatAdapter(),
  'openai-responses': new OpenAIResponsesAdapter(),
  gemini: new GeminiAdapter(),
  anthropic: new AnthropicAdapter(),
};

export function getProviderAdapter(protocol: ProtocolType): LLMProviderAdapter {
  return adapters[protocol];
}

export interface ProtocolTemplate {
  protocol: ProtocolType;
  label: string;
  shortLabel: string;
  defaultName: string;
  defaultBaseUrl: string;
  placeholderModel: string;
  description: string;
  suggestedModels: ModelDefinition[];
}

export const PROTOCOL_TEMPLATES: Record<ProtocolType, ProtocolTemplate> = {
  'openai-chat': {
    protocol: 'openai-chat',
    label: 'OpenAI Chat Completions (/chat/completions)',
    shortLabel: 'OpenAI Chat',
    defaultName: 'OpenAI / 兼容接口',
    defaultBaseUrl: 'https://api.openai.com/v1',
    placeholderModel: 'gpt-6.2-sol',
    description: '兼容 OpenAI、DeepSeek、OpenRouter、SiliconFlow、Ollama 及绝大多数中转站',
    suggestedModels: [
      toModelDefinition('gpt-6.2-astra', 'GPT-6.2 Astra'),
      toModelDefinition('gpt-6.2-sol', 'GPT-6.2 Sol'),
      toModelDefinition('gpt-6-luna', 'GPT-6 Luna'),
      toModelDefinition('gpt-5.4', 'GPT-5.4'),
      toModelDefinition('deepseek-v4-pro', 'DeepSeek V4 Pro'),
      toModelDefinition('deepseek-flash', 'DeepSeek V4.1 Flash'),
      toModelDefinition('qwen3.8-max', 'Qwen3.8 Max'),
      toModelDefinition('qwen3.5-plus', 'Qwen3.5 Plus'),
      toModelDefinition('glm-5', 'GLM-5'),
      toModelDefinition('kimi-k3.1-pro', 'Kimi K3.1 Pro'),
      toModelDefinition('grok-4.7', 'Grok 4.7'),
    ],
  },
  'openai-responses': {
    protocol: 'openai-responses',
    label: 'OpenAI Responses API (/responses)',
    shortLabel: 'Responses',
    defaultName: 'OpenAI Responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    placeholderModel: 'gpt-6.2-sol',
    description: 'OpenAI 新一代 Responses 接口，原生支持推理摘要与 Effort 调节',
    suggestedModels: [
      toModelDefinition('gpt-6.2-astra', 'GPT-6.2 Astra'),
      toModelDefinition('gpt-6.2-sol', 'GPT-6.2 Sol'),
      toModelDefinition('gpt-6-luna', 'GPT-6 Luna'),
      toModelDefinition('gpt-5.4', 'GPT-5.4'),
      toModelDefinition('gpt-5.4-mini', 'GPT-5.4 Mini'),
      toModelDefinition('gpt-5.3-codex', 'GPT-5.3 Codex'),
      toModelDefinition('o3', 'o3'),
    ],
  },
  gemini: {
    protocol: 'gemini',
    label: 'Google Gemini API (streamGenerateContent)',
    shortLabel: 'Gemini',
    defaultName: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    placeholderModel: 'gemini-4-neon',
    description: '原生支持 Gemini Thinking 思考过程与高上下文多模态拓展',
    suggestedModels: [
      toModelDefinition('gemini-4-carbon', 'Gemini 4 Carbon'),
      toModelDefinition('gemini-4-neon', 'Gemini 4 Neon'),
      toModelDefinition('gemini-4-hydrogen', 'Gemini 4 Hydrogen'),
      toModelDefinition('gemini-4-argon', 'Gemini 4 Argon'),
      toModelDefinition('gemini-3.8-flash', 'Gemini 3.8 Flash'),
      toModelDefinition('gemini-3.1-pro-preview', 'Gemini 3.1 Pro'),
      toModelDefinition('gemini-2.5-pro', 'Gemini 2.5 Pro'),
    ],
  },
  anthropic: {
    protocol: 'anthropic',
    label: 'Anthropic Messages API (/v1/messages)',
    shortLabel: 'Anthropic',
    defaultName: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    placeholderModel: 'claude-sonnet-5-5',
    description: '原生支持 Claude 自适应/扩展思考与精确流式输出',
    suggestedModels: [
      toModelDefinition('claude-opus-5-5', 'Claude Opus 5.5'),
      toModelDefinition('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
      toModelDefinition('claude-opus-4-8', 'Claude Opus 4.8'),
      toModelDefinition('claude-opus-4-7', 'Claude Opus 4.7'),
      toModelDefinition('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
      toModelDefinition('claude-haiku-4-5-20251001', 'Claude Haiku 4.5'),
    ],
  },
};
