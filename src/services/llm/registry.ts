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
    placeholderModel: 'gpt-4o',
    description: '兼容 OpenAI、DeepSeek、OpenRouter、SiliconFlow、Ollama 及绝大多数中转站',
    suggestedModels: [
      toModelDefinition('gpt-4o', 'GPT-4o'),
      toModelDefinition('gpt-4.1', 'GPT-4.1'),
      toModelDefinition('deepseek-chat', 'DeepSeek Chat'),
      toModelDefinition('deepseek-reasoner', 'DeepSeek R1 (Reasoner)'),
    ],
  },
  'openai-responses': {
    protocol: 'openai-responses',
    label: 'OpenAI Responses API (/responses)',
    shortLabel: 'Responses',
    defaultName: 'OpenAI Responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    placeholderModel: 'gpt-5',
    description: 'OpenAI 新一代 Responses 接口，原生支持推理摘要与 Effort 调节',
    suggestedModels: [
      toModelDefinition('gpt-5', 'GPT-5'),
      toModelDefinition('o3', 'o3'),
      toModelDefinition('o4-mini', 'o4-mini'),
      toModelDefinition('gpt-4.1', 'GPT-4.1'),
    ],
  },
  gemini: {
    protocol: 'gemini',
    label: 'Google Gemini API (streamGenerateContent)',
    shortLabel: 'Gemini',
    defaultName: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    placeholderModel: 'gemini-2.5-pro',
    description: '原生支持 Gemini Thinking 思考过程与高上下文多模态拓展',
    suggestedModels: [
      toModelDefinition('gemini-2.5-pro', 'Gemini 2.5 Pro'),
      toModelDefinition('gemini-2.5-flash', 'Gemini 2.5 Flash'),
      toModelDefinition('gemini-2.0-flash', 'Gemini 2.0 Flash'),
    ],
  },
  anthropic: {
    protocol: 'anthropic',
    label: 'Anthropic Messages API (/v1/messages)',
    shortLabel: 'Anthropic',
    defaultName: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    placeholderModel: 'claude-sonnet-4-20250514',
    description: '原生支持 Claude Extended Thinking 深度思考块与精确流式输出',
    suggestedModels: [
      toModelDefinition('claude-sonnet-4-20250514', 'Claude Sonnet 4'),
      toModelDefinition('claude-3-7-sonnet-20250219', 'Claude 3.7 Sonnet'),
      toModelDefinition('claude-3-5-haiku-20241022', 'Claude 3.5 Haiku'),
    ],
  },
};
