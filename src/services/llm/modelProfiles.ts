import type {
  ModelDefinition,
  ProtocolType,
  ReasoningEffort,
} from '@/types/chat';
import type {
  ModelProfileRule,
  ModelReasoningProfile,
} from '@/types/settings';

export const BUILTIN_REASONING_PROFILES: Record<string, ModelReasoningProfile> = {
  none: {
    id: 'none',
    familyName: '标准对话（无思考调节）',
    strategy: 'none',
    levels: [],
    defaultLevel: 'off',
    supportsSamplingWhenThinking: true,
  },
  'openai-o-series': {
    id: 'openai-o-series',
    familyName: 'OpenAI o1 / o3 / o4 系列',
    strategy: 'openai-effort',
    levels: [
      { value: 'low', label: '低', desc: '轻量推理，响应更快 (reasoning_effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理深度与延迟 (reasoning_effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度复杂推理 (reasoning_effort: high)', apiValue: 'high' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: false,
  },
  'openai-gpt5': {
    id: 'openai-gpt5',
    familyName: 'OpenAI GPT-5 系列',
    strategy: 'openai-effort',
    levels: [
      { value: 'minimal', label: '极低', desc: '极简思考，接近即时输出 (effort: minimal)', apiValue: 'minimal' },
      { value: 'low', label: '低', desc: '快速推理 (effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡默认深度 (effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深入多步推导 (effort: high)', apiValue: 'high' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: false,
  },
  'openai-gpt5-xhigh': {
    id: 'openai-gpt5-xhigh',
    familyName: 'OpenAI GPT-5.1 ~ 5.4 / Codex 系列',
    strategy: 'openai-effort',
    levels: [
      { value: 'off', label: '关闭', desc: '关闭推理思考链 (effort: none)', apiValue: 'none' },
      { value: 'minimal', label: '极低', desc: '极轻量快速思考 (effort: minimal)', apiValue: 'minimal' },
      { value: 'low', label: '低', desc: '轻量推理 (effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理与响应 (effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度复杂推导 (effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '最高推理预算与深度 (effort: xhigh)', apiValue: 'xhigh' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: false,
  },
  'openai-gpt6-astra': {
    id: 'openai-gpt6-astra',
    familyName: 'OpenAI GPT-6 Astra（旗舰全深度推理）',
    strategy: 'openai-effort',
    levels: [
      { value: 'low', label: '低', desc: '轻量推理，兼顾响应速度 (effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡默认推理深度 (effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度复杂推导与编程 (effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '重型架构与科学研究级推理 (effort: xhigh)', apiValue: 'xhigh' },
      { value: 'max', label: '最大', desc: '极限前沿全预算思考 (effort: max)', apiValue: 'max' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: false,
  },
  'openai-gpt6-sol': {
    id: 'openai-gpt6-sol',
    familyName: 'OpenAI GPT-6 Sol / Luna（7 档自适应推理）',
    strategy: 'openai-effort',
    levels: [
      { value: 'off', label: '关闭', desc: '关闭推理思考链 (effort: none)', apiValue: 'none' },
      { value: 'minimal', label: '极低', desc: '极速轻推理 (effort: minimal)', apiValue: 'minimal' },
      { value: 'low', label: '低', desc: '轻量推理 (effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡默认深度 (effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度复杂推理 (effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '重型复杂推演 (effort: xhigh)', apiValue: 'xhigh' },
      { value: 'max', label: '最大', desc: '全预算上限推理 (effort: max)', apiValue: 'max' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: false,
  },
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    familyName: 'Gemini 2.5 Pro（预算思考）',
    strategy: 'gemini-budget',
    levels: [
      { value: 'auto', label: '动态', desc: '由模型自适应分配思考预算 (budget: -1)', budgetTokens: -1 },
      { value: 'low', label: '低', desc: '适度思考 (budget: 2048 tokens)', budgetTokens: 2048 },
      { value: 'medium', label: '中', desc: '均衡深度推导 (budget: 8192 tokens)', budgetTokens: 8192 },
      { value: 'high', label: '高', desc: '深度推演与校验 (budget: 16384 tokens)', budgetTokens: 16384 },
      { value: 'max', label: '最大', desc: '全额度思考预算 (budget: 24576 tokens)', budgetTokens: 24576 },
    ],
    defaultLevel: 'auto',
    supportsSamplingWhenThinking: true,
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    familyName: 'Gemini 2.5 Flash / Lite（可关闭预算思考）',
    strategy: 'gemini-budget',
    levels: [
      { value: 'off', label: '关闭', desc: '零思考直出结果 (budget: 0)', budgetTokens: 0 },
      { value: 'auto', label: '动态', desc: '由模型自适应分配预算 (budget: -1)', budgetTokens: -1 },
      { value: 'low', label: '低', desc: '轻量思考 (budget: 2048 tokens)', budgetTokens: 2048 },
      { value: 'medium', label: '中', desc: '均衡思考 (budget: 8192 tokens)', budgetTokens: 8192 },
      { value: 'high', label: '高', desc: '深度思考 (budget: 16384 tokens)', budgetTokens: 16384 },
      { value: 'max', label: '最大', desc: '上限思考预算 (budget: 24576 tokens)', budgetTokens: 24576 },
    ],
    defaultLevel: 'auto',
    supportsSamplingWhenThinking: true,
  },
  'gemini-3-pro': {
    id: 'gemini-3-pro',
    familyName: 'Gemini 3 / 3.1 Pro（档位思考）',
    strategy: 'gemini-level',
    levels: [
      { value: 'low', label: '低', desc: '快速逻辑推理 (thinkingLevel: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡分析与推理 (thinkingLevel: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度学术与复杂推理 (thinkingLevel: high)', apiValue: 'high' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: true,
  },
  'gemini-3-flash': {
    id: 'gemini-3-flash',
    familyName: 'Gemini 3 / 3.1 Flash（档位思考）',
    strategy: 'gemini-level',
    levels: [
      { value: 'minimal', label: '极低', desc: '极低思考耗时 (thinkingLevel: minimal)', apiValue: 'minimal' },
      { value: 'low', label: '低', desc: '轻量推理 (thinkingLevel: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理 (thinkingLevel: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度推理 (thinkingLevel: high)', apiValue: 'high' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: true,
  },
  'gemini-4-flagship': {
    id: 'gemini-4-flagship',
    familyName: 'Gemini 4 Carbon / Neon / Argon（档位思考）',
    strategy: 'gemini-level',
    levels: [
      { value: 'low', label: '低', desc: '低延迟轻推理 (thinkingLevel: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理与响应 (thinkingLevel: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度逻辑与代码推导 (thinkingLevel: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '最高强度复杂推演 (thinkingLevel: xhigh)', apiValue: 'xhigh' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: true,
  },
  'gemini-4-fast': {
    id: 'gemini-4-fast',
    familyName: 'Gemini 4 Hydrogen / 3.8 Flash（全档位思考）',
    strategy: 'gemini-level',
    levels: [
      { value: 'minimal', label: '极低', desc: '近似关闭思考，极速响应 (thinkingLevel: minimal)', apiValue: 'minimal' },
      { value: 'low', label: '低', desc: '轻量快速推理 (thinkingLevel: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡日常推导 (thinkingLevel: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度推理与编程 (thinkingLevel: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '超深研究与复杂验证 (thinkingLevel: xhigh)', apiValue: 'xhigh' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: true,
  },
  'claude-adaptive-5': {
    id: 'claude-adaptive-5',
    familyName: 'Claude 4.7 / 4.8 / 5.5 自适应思考',
    strategy: 'anthropic-adaptive',
    levels: [
      { value: 'off', label: '关闭', desc: '不发送 thinking 与 output_config（关闭思考）' },
      { value: 'low', label: '低', desc: '自适应轻量思考 (output_config.effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '自适应均衡思考 (output_config.effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '自适应深度思考 (output_config.effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '自适应极高深度推演 (output_config.effort: xhigh)', apiValue: 'xhigh' },
      { value: 'max', label: '最大', desc: '自适应全资源极限思考 (output_config.effort: max)', apiValue: 'max' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: false,
    supportsSamplingWhenOff: false,
  },
  'claude-adaptive-46': {
    id: 'claude-adaptive-46',
    familyName: 'Claude 4.6 自适应思考',
    strategy: 'anthropic-adaptive',
    levels: [
      { value: 'off', label: '关闭', desc: '关闭自适应思考（启用温度采样）' },
      { value: 'low', label: '低', desc: '自适应轻量思考 (output_config.effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '自适应均衡思考 (output_config.effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '自适应深度思考 (output_config.effort: high)', apiValue: 'high' },
      { value: 'max', label: '最大', desc: '自适应最高强度思考 (output_config.effort: max)', apiValue: 'max' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: false,
    supportsSamplingWhenOff: true,
  },
  'claude-extended': {
    id: 'claude-extended',
    familyName: 'Claude 3.7 / 4.0 ~ 4.5 扩展思考',
    strategy: 'anthropic-budget',
    levels: [
      { value: 'off', label: '关闭', desc: '标准直出模式（启用温度与 Top-P）', budgetTokens: 0 },
      { value: 'low', label: '低', desc: '轻量思考 (budget_tokens: 2048)', budgetTokens: 2048 },
      { value: 'medium', label: '中', desc: '均衡深度思考 (budget_tokens: 8192)', budgetTokens: 8192 },
      { value: 'high', label: '高', desc: '深入多步推理 (budget_tokens: 16384)', budgetTokens: 16384 },
      { value: 'max', label: '最大', desc: '上限扩展思考 (budget_tokens: 32768)', budgetTokens: 32768 },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: false,
  },
  'deepseek-v4': {
    id: 'deepseek-v4',
    familyName: 'DeepSeek V4 / V4.1（统一思考切换）',
    strategy: 'deepseek-v4',
    levels: [
      { value: 'off', label: '关闭', desc: '关闭思考模式 (thinking: disabled)', apiValue: 'none' },
      { value: 'low', label: '低', desc: '轻推理模式 (thinking: enabled, effort: low)', apiValue: 'low' },
      { value: 'high', label: '高', desc: '深度推理模式 (thinking: enabled, effort: high)', apiValue: 'high' },
      { value: 'max', label: '最大', desc: '极限深度推演 (thinking: enabled, effort: max)', apiValue: 'max' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: true,
  },
  'deepseek-fixed': {
    id: 'deepseek-fixed',
    familyName: 'DeepSeek R1 / QwQ / Kimi K3（原生强制推理）',
    strategy: 'fixed',
    levels: [
      { value: 'auto', label: '内置', desc: '模型原生强制开启思维链输出，自动解析思考块' },
    ],
    defaultLevel: 'auto',
    supportsSamplingWhenThinking: true,
  },
  'grok-4': {
    id: 'grok-4',
    familyName: 'xAI Grok 4 / 4.7 系列（可调推理）',
    strategy: 'openai-effort',
    levels: [
      { value: 'low', label: '低', desc: '轻量推理 (reasoning_effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理 (reasoning_effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度复杂推理 (reasoning_effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '最高深度自检推理 (reasoning_effort: xhigh)', apiValue: 'xhigh' },
    ],
    defaultLevel: 'high',
    supportsSamplingWhenThinking: true,
  },
  'compat-toggle': {
    id: 'compat-toggle',
    familyName: '混合思考模型（Qwen3.5/3.8 · GLM-5 · Doubao Seed 2）',
    strategy: 'toggle-effort',
    levels: [
      { value: 'off', label: '关闭', desc: '快速标准输出，关闭思考链', apiValue: 'off' },
      { value: 'low', label: '低', desc: '轻量推理 (reasoning_effort: low)', apiValue: 'low' },
      { value: 'medium', label: '中', desc: '均衡推理 (reasoning_effort: medium)', apiValue: 'medium' },
      { value: 'high', label: '高', desc: '深度推理 (reasoning_effort: high)', apiValue: 'high' },
      { value: 'xhigh', label: '极高', desc: '深层多步验证推理 (reasoning_effort: xhigh)', apiValue: 'xhigh' },
    ],
    defaultLevel: 'medium',
    supportsSamplingWhenThinking: true,
  },
  'grok-mini': {
    id: 'grok-mini',
    familyName: 'xAI Grok 3 Mini（双档推理）',
    strategy: 'openai-effort',
    levels: [
      { value: 'low', label: '低', desc: '快速轻推理 (reasoning_effort: low)', apiValue: 'low' },
      { value: 'high', label: '高', desc: '深度推理 (reasoning_effort: high)', apiValue: 'high' },
    ],
    defaultLevel: 'low',
    supportsSamplingWhenThinking: true,
  },
};

export const BUILTIN_MODEL_PROFILE_RULES: ModelProfileRule[] = [
  { pattern: '^gpt-6(\\.\\d+)?[-._]?astra', profileId: 'openai-gpt6-astra', note: 'OpenAI GPT-6 Astra flagship (low..max)' },
  { pattern: '^gpt-6($|[-._])', profileId: 'openai-gpt6-sol', note: 'OpenAI GPT-6 Sol / Luna (none..max)' },
  { pattern: '^gpt-5[._-]([1-9]|pro)|^gpt-5\\.[1-9]|^o3-pro', profileId: 'openai-gpt5-xhigh', note: 'GPT-5.1 ~ 5.4 / Codex & o3-pro' },
  { pattern: '^gpt-5($|[-._])', profileId: 'openai-gpt5', note: 'GPT-5 base family' },
  { pattern: '^o[134]($|[-._])', profileId: 'openai-o-series', note: 'OpenAI o1 / o3 / o4' },
  { pattern: '^gemini-4[-._]?(hydrogen|flash)|^gemini-3\\.[5-9][-._]?flash', profileId: 'gemini-4-fast', note: 'Gemini 4 Hydrogen & 3.8 Flash' },
  { pattern: '^gemini-4($|[-._])', profileId: 'gemini-4-flagship', note: 'Gemini 4 Carbon / Neon / Argon' },
  { pattern: '^gemini-3(\\.\\d+)?-.*flash', profileId: 'gemini-3-flash', note: 'Gemini 3 / 3.1 Flash' },
  { pattern: '^gemini-3(\\.\\d+)?', profileId: 'gemini-3-pro', note: 'Gemini 3 / 3.1 Pro' },
  { pattern: '^gemini-2\\.5-pro', profileId: 'gemini-2.5-pro', note: 'Gemini 2.5 Pro' },
  { pattern: '^gemini-2\\.5', profileId: 'gemini-2.5-flash', note: 'Gemini 2.5 Flash / Lite' },
  { pattern: '^claude-(opus|sonnet|haiku)-5|^claude-5|^claude-(opus|sonnet)-4[-.]([789])', profileId: 'claude-adaptive-5', note: 'Claude 4.7+ & 5.5 Adaptive Thinking' },
  { pattern: '^claude-(opus|sonnet)-4[-.]6', profileId: 'claude-adaptive-46', note: 'Claude 4.6 Adaptive Thinking' },
  { pattern: '^claude-(3[-.]7|sonnet-4|opus-4|haiku-4[-.]5|4[-.]?[0-5])', profileId: 'claude-extended', note: 'Claude 3.7 / 4.0 ~ 4.5 Extended Thinking' },
  { pattern: '^(deepseek-v4|deepseek-flash)', profileId: 'deepseek-v4', note: 'DeepSeek V4 / V4.1 unified thinking' },
  { pattern: 'grok-4[\\w.-]*non-reasoning', profileId: 'none', note: 'xAI Grok 4 Non-Reasoning' },
  { pattern: '^grok-4($|[-._])', profileId: 'grok-4', note: 'xAI Grok 4 / 4.7 tunable reasoning' },
  { pattern: 'grok-3-mini', profileId: 'grok-mini', note: 'xAI Grok 3 Mini' },
  { pattern: '(deepseek-reasoner|deepseek-r1|\\bqwq\\b|kimi-k3|^k3(\\.\\d+)?($|[-._]))', profileId: 'deepseek-fixed', note: 'Built-in fixed reasoning models' },
  { pattern: '^(gpt-4|gpt-3\\.5|gemini-2\\.0|gemini-1\\.5|claude-3-5-haiku|claude-3-5-sonnet|deepseek-chat|deepseek-v3$)', profileId: 'none', note: 'Non-reasoning legacy chat models' },
  { pattern: '(qwen3|glm-4\\.[5-9]|glm-5|doubao-seed|kimi-k2\\.5|kimi-k2-thinking|thinking)', profileId: 'compat-toggle', note: 'Hybrid toggle thinking models' },
];

export type ProfileMatchSource =
  | 'model-override'
  | 'custom-rule'
  | 'remote-rule'
  | 'builtin'
  | 'fallback';

function hasOwnProfile(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_REASONING_PROFILES, id);
}

export function getReasoningProfileById(id: string): ModelReasoningProfile | undefined {
  return hasOwnProfile(id) ? BUILTIN_REASONING_PROFILES[id] : undefined;
}

export function listAllReasoningProfiles(): ModelReasoningProfile[] {
  return Object.values(BUILTIN_REASONING_PROFILES);
}

function matchRuleList(
  rules: ModelProfileRule[] | undefined,
  rawLower: string,
  strippedLower: string,
  protocol?: ProtocolType
): ModelReasoningProfile | undefined {
  if (!rules || rules.length === 0) return undefined;
  for (const rule of rules) {
    if (rule.protocols && protocol && !rule.protocols.includes(protocol)) {
      continue;
    }
    const profile = getReasoningProfileById(rule.profileId);
    if (!profile) continue;
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(rawLower) || (strippedLower && re.test(strippedLower))) {
        return profile;
      }
    } catch {
      // Ignore malformed user regex cleanly
    }
  }
  return undefined;
}

export function resolveModelReasoningProfile(options: {
  modelId: string;
  protocol?: ProtocolType;
  modelDef?: ModelDefinition;
  customRules?: ModelProfileRule[];
  remoteRules?: ModelProfileRule[];
}): { profile: ModelReasoningProfile; source: ProfileMatchSource } {
  const overrideId = options.modelDef?.params?.reasoningProfileId;
  const overrideProfile = overrideId ? getReasoningProfileById(overrideId) : undefined;
  if (overrideProfile) {
    return {
      profile: overrideProfile,
      source: 'model-override',
    };
  }

  const rawLower = (options.modelId || '').trim().toLowerCase();
  const slashIdx = rawLower.lastIndexOf('/');
  const strippedLower = slashIdx >= 0 ? rawLower.slice(slashIdx + 1) : rawLower;

  if (rawLower) {
    const customHit = matchRuleList(options.customRules, rawLower, strippedLower, options.protocol);
    if (customHit) return { profile: customHit, source: 'custom-rule' };

    const remoteHit = matchRuleList(options.remoteRules, rawLower, strippedLower, options.protocol);
    if (remoteHit) return { profile: remoteHit, source: 'remote-rule' };

    const builtinHit = matchRuleList(
      BUILTIN_MODEL_PROFILE_RULES,
      rawLower,
      strippedLower,
      options.protocol
    );
    if (builtinHit) return { profile: builtinHit, source: 'builtin' };
  }

  return {
    profile: BUILTIN_REASONING_PROFILES.none,
    source: 'fallback',
  };
}

const EFFORT_FALLBACK_ORDER: Record<ReasoningEffort, ReasoningEffort[]> = {
  xhigh: ['xhigh', 'max', 'high', 'medium', 'auto', 'low', 'minimal', 'off'],
  max: ['max', 'xhigh', 'high', 'medium', 'auto', 'low', 'minimal', 'off'],
  high: ['high', 'max', 'xhigh', 'medium', 'auto', 'low', 'minimal', 'off'],
  medium: ['medium', 'auto', 'high', 'low', 'minimal', 'max', 'xhigh', 'off'],
  auto: ['auto', 'medium', 'low', 'high', 'minimal', 'off'],
  low: ['low', 'minimal', 'medium', 'auto', 'high', 'off'],
  minimal: ['minimal', 'low', 'off', 'auto', 'medium'],
  off: ['off', 'minimal', 'auto', 'low', 'medium'],
};

/**
 * Intelligently maps the user's current effort level onto a valid option supported
 * by the target model's reasoning profile, falling back to `profile.defaultLevel`.
 */
export function coerceReasoningEffort(
  current: ReasoningEffort | undefined,
  profile: ModelReasoningProfile
): ReasoningEffort {
  if (profile.levels.length === 0) {
    return profile.defaultLevel;
  }
  const available = new Set(profile.levels.map((l) => l.value));
  if (!current) {
    return available.has(profile.defaultLevel)
      ? profile.defaultLevel
      : profile.levels[0].value;
  }
  if (available.has(current)) {
    return current;
  }
  const candidates = EFFORT_FALLBACK_ORDER[current] ?? [];
  for (const cand of candidates) {
    if (available.has(cand)) return cand;
  }
  return available.has(profile.defaultLevel)
    ? profile.defaultLevel
    : profile.levels[0].value;
}

export function parseModelProfileRulesJson(raw: string): ModelProfileRule[] {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rules?: unknown }).rules)
      ? (parsed as { rules: unknown[] }).rules
      : null;

  if (!list) {
    throw new Error('规则库 JSON 必须为规则数组或包含 "rules" 数组的对象');
  }

  const valid: ModelProfileRule[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`第 ${i + 1} 条规则格式无效`);
    }
    const r = item as Record<string, unknown>;
    if (typeof r.pattern !== 'string' || !r.pattern.trim()) {
      throw new Error(`第 ${i + 1} 条规则缺少有效的正则 pattern`);
    }
    try {
      new RegExp(r.pattern, 'i');
    } catch {
      throw new Error(`第 ${i + 1} 条规则的正则表达式语法无效: ${r.pattern}`);
    }
    if (typeof r.profileId !== 'string' || !hasOwnProfile(r.profileId)) {
      throw new Error(`第 ${i + 1} 条规则引用了未知的思考系列 profileId: ${String(r.profileId)}`);
    }
    const protocols = Array.isArray(r.protocols)
      ? (r.protocols.filter(
          (p): p is ProtocolType =>
            p === 'openai-chat' ||
            p === 'openai-responses' ||
            p === 'gemini' ||
            p === 'anthropic'
        ) as ProtocolType[])
      : undefined;
    valid.push({
      pattern: r.pattern.trim(),
      profileId: r.profileId,
      ...(protocols && protocols.length > 0 ? { protocols } : {}),
      ...(typeof r.note === 'string' && r.note.trim() ? { note: r.note.trim() } : {}),
    });
  }
  return valid;
}
