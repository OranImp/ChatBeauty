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

export interface ProviderBrandPreset {
  id: string;
  name: string;
  badge: string;
  category: 'global' | 'cn' | 'aggregator' | 'local';
  protocol: ProtocolType;
  baseUrl: string;
  backupBaseUrls?: string[];
  defaultModel: string;
  description: string;
  apiKeyPlaceholder?: string;
  apiKeyOptional?: boolean;
  suggestedModels: ModelDefinition[];
}

export const PROVIDER_BRAND_PRESETS: ProviderBrandPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI 官方',
    badge: 'OpenAI',
    category: 'global',
    protocol: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-6.2-sol',
    description: '原生 Responses 接口，支持 GPT-6.2 / GPT-5.4 / o3 推理 Effort',
    apiKeyPlaceholder: 'sk-proj-...',
    suggestedModels: [
      toModelDefinition('gpt-6.2-astra', 'GPT-6.2 Astra'),
      toModelDefinition('gpt-6.2-sol', 'GPT-6.2 Sol'),
      toModelDefinition('gpt-6-luna', 'GPT-6 Luna'),
      toModelDefinition('gpt-5.4', 'GPT-5.4'),
      toModelDefinition('gpt-5.4-mini', 'GPT-5.4 Mini'),
      toModelDefinition('o3', 'o3'),
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    badge: 'Claude',
    category: 'global',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5',
    description: 'Claude Messages 接口，支持自适应思考与扩展 Thinking',
    apiKeyPlaceholder: 'sk-ant-...',
    suggestedModels: [
      toModelDefinition('claude-opus-5-5', 'Claude Opus 5.5'),
      toModelDefinition('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
      toModelDefinition('claude-opus-4-8', 'Claude Opus 4.8'),
      toModelDefinition('claude-opus-4-7', 'Claude Opus 4.7'),
      toModelDefinition('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
      toModelDefinition('claude-haiku-4-5-20251001', 'Claude Haiku 4.5'),
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Gemini',
    category: 'global',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-4-neon',
    description: 'Google 原生流式与多模态 Thinking 接口',
    apiKeyPlaceholder: 'AIza...',
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
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    badge: 'DeepSeek',
    category: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-v4-pro',
    description: '深度求索官方 OpenAI 兼容接口，支持 V4 推理与 Flash 极速模式',
    apiKeyPlaceholder: 'sk-...',
    suggestedModels: [
      toModelDefinition('deepseek-v4-pro', 'DeepSeek V4 Pro'),
      toModelDefinition('deepseek-flash', 'DeepSeek V4.1 Flash'),
      toModelDefinition('deepseek-reasoner', 'DeepSeek R1 / Reasoner'),
      toModelDefinition('deepseek-chat', 'DeepSeek Chat'),
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter 聚合',
    badge: 'Aggregator',
    category: 'aggregator',
    protocol: 'openai-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-6.2-sol',
    description: '单一 Key 路由全球百家模型，支持中转兜底与推理参数透传',
    apiKeyPlaceholder: 'sk-or-v1-...',
    suggestedModels: [
      toModelDefinition('openai/gpt-6.2-sol', 'OpenAI GPT-6.2 Sol'),
      toModelDefinition('anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5'),
      toModelDefinition('google/gemini-4-neon', 'Gemini 4 Neon'),
      toModelDefinition('deepseek/deepseek-v4-pro', 'DeepSeek V4 Pro'),
    ],
  },
  {
    id: 'qwen',
    name: '通义千问 DashScope',
    badge: 'Qwen',
    category: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    description: '阿里云百炼 OpenAI 兼容模式，支持 Qwen3.8 / Qwen3.5 系列',
    apiKeyPlaceholder: 'sk-...',
    suggestedModels: [
      toModelDefinition('qwen3.8-max', 'Qwen3.8 Max'),
      toModelDefinition('qwen3.5-plus', 'Qwen3.5 Plus'),
      toModelDefinition('qwen3-coder-plus', 'Qwen3 Coder Plus'),
      toModelDefinition('qwq-plus', 'QwQ Plus'),
    ],
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    badge: 'Zhipu',
    category: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5',
    description: '智谱 AI 开放平台兼容接口，支持 GLM-5 旗舰与长上下文推理',
    apiKeyPlaceholder: 'api-key.secret',
    suggestedModels: [
      toModelDefinition('glm-5', 'GLM-5'),
      toModelDefinition('glm-4.6', 'GLM-4.6'),
      toModelDefinition('glm-z1-air', 'GLM-Z1 Air'),
    ],
  },
  {
    id: 'kimi',
    name: 'Moonshot Kimi',
    badge: 'Kimi',
    category: 'cn',
    protocol: 'openai-chat',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3.1-pro',
    description: '月之暗面 Kimi K3 系列长文本与深度推理接口',
    apiKeyPlaceholder: 'sk-...',
    suggestedModels: [
      toModelDefinition('kimi-k3.1-pro', 'Kimi K3.1 Pro'),
      toModelDefinition('kimi-k2-thinking', 'Kimi K2 Thinking'),
      toModelDefinition('moonshot-v1-auto', 'Moonshot V1 Auto'),
    ],
  },
  {
    id: 'grok',
    name: 'xAI Grok',
    badge: 'xAI',
    category: 'global',
    protocol: 'openai-chat',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4.7',
    description: 'xAI 官方兼容接口，支持 Grok 4.7 与多模态推理',
    apiKeyPlaceholder: 'xai-...',
    suggestedModels: [
      toModelDefinition('grok-4.7', 'Grok 4.7'),
      toModelDefinition('grok-4', 'Grok 4'),
      toModelDefinition('grok-3-mini-beta', 'Grok 3 Mini'),
    ],
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    badge: 'Cloud',
    category: 'aggregator',
    protocol: 'openai-chat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Pro',
    description: '国内高速开源模型推理云，兼容 DeepSeek / Qwen 全系列',
    apiKeyPlaceholder: 'sk-...',
    suggestedModels: [
      toModelDefinition('deepseek-ai/DeepSeek-V4-Pro', 'DeepSeek V4 Pro'),
      toModelDefinition('Qwen/Qwen3-235B-A22B', 'Qwen3 235B'),
      toModelDefinition('zai-org/GLM-5', 'GLM-5'),
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama 本地模型',
    badge: 'Local',
    category: 'local',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen3:14b',
    description: '本地运行离线开源模型，免 API Key 直接连接本机端口',
    apiKeyPlaceholder: '可留空（默认 ollama）',
    apiKeyOptional: true,
    suggestedModels: [
      toModelDefinition('qwen3:14b', 'Qwen3 14B'),
      toModelDefinition('deepseek-r1:14b', 'DeepSeek-R1 14B'),
      toModelDefinition('gemma3:12b', 'Gemma 3 12B'),
      toModelDefinition('llama4:scout', 'Llama 4 Scout'),
    ],
  },
];
