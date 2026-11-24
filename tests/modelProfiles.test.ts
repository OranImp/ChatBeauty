import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_MODEL_PROFILE_RULES,
  BUILTIN_REASONING_PROFILES,
  coerceReasoningEffort,
  parseModelProfileRulesJson,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import {
  deepMergePayload,
  inferModelCapabilities,
  parseHttpHeadersJson,
  resolveEffectiveParams,
} from '@/services/llm/adapters/shared';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';
import type { ModelDefinition } from '@/types/chat';

describe('modelProfiles & parameter merging', () => {
  it('auto-detects reasoning series across 2026 frontier OpenAI, Gemini, Anthropic, DeepSeek, Grok, and hybrid models', () => {
    expect(resolveModelReasoningProfile({ modelId: 'gpt-4o' }).profile.id).toBe('none');
    expect(resolveModelReasoningProfile({ modelId: 'o3' }).profile.id).toBe('openai-o-series');
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5' }).profile.id).toBe('openai-gpt5');
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5.2' }).profile.id).toBe(
      'openai-gpt5-xhigh'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5.4' }).profile.id).toBe(
      'openai-gpt5-xhigh'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5.3-codex' }).profile.id).toBe(
      'openai-gpt5-xhigh'
    );
    expect(resolveModelReasoningProfile({ modelId: 'openai/gpt-5.2' }).profile.id).toBe(
      'openai-gpt5-xhigh'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gpt-6.2-astra' }).profile.id).toBe(
      'openai-gpt6-astra'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gpt-6.2-sol' }).profile.id).toBe(
      'openai-gpt6-sol'
    );
    expect(resolveModelReasoningProfile({ modelId: 'openai/gpt-6-luna' }).profile.id).toBe(
      'openai-gpt6-sol'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-2.0-flash' }).profile.id).toBe('none');
    expect(resolveModelReasoningProfile({ modelId: 'gemini-2.5-pro' }).profile.id).toBe(
      'gemini-2.5-pro'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-2.5-flash' }).profile.id).toBe(
      'gemini-2.5-flash'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-3-pro' }).profile.id).toBe(
      'gemini-3-pro'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-3.1-pro-preview' }).profile.id).toBe(
      'gemini-3-pro'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-3-flash' }).profile.id).toBe(
      'gemini-3-flash'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-3.8-flash' }).profile.id).toBe(
      'gemini-4-fast'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-4-hydrogen' }).profile.id).toBe(
      'gemini-4-fast'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-4-carbon' }).profile.id).toBe(
      'gemini-4-flagship'
    );
    expect(resolveModelReasoningProfile({ modelId: 'gemini-4-neon' }).profile.id).toBe(
      'gemini-4-flagship'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-3-5-haiku-20241022' }).profile.id).toBe(
      'none'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-sonnet-4-20250514' }).profile.id).toBe(
      'claude-extended'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-haiku-4-5-20251001' }).profile.id).toBe(
      'claude-extended'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-opus-4-6' }).profile.id).toBe(
      'claude-adaptive-46'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-sonnet-4-6' }).profile.id).toBe(
      'claude-adaptive-46'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-opus-4-7' }).profile.id).toBe(
      'claude-adaptive-5'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-opus-4-8' }).profile.id).toBe(
      'claude-adaptive-5'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-opus-5-5' }).profile.id).toBe(
      'claude-adaptive-5'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-sonnet-5-5' }).profile.id).toBe(
      'claude-adaptive-5'
    );
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-chat' }).profile.id).toBe('none');
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-reasoner' }).profile.id).toBe(
      'deepseek-fixed'
    );
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-v4-pro' }).profile.id).toBe(
      'deepseek-v4'
    );
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-flash' }).profile.id).toBe(
      'deepseek-v4'
    );
    expect(resolveModelReasoningProfile({ modelId: 'qwen3-235b-a22b' }).profile.id).toBe(
      'compat-toggle'
    );
    expect(resolveModelReasoningProfile({ modelId: 'qwen3.8-max' }).profile.id).toBe(
      'compat-toggle'
    );
    expect(resolveModelReasoningProfile({ modelId: 'glm-4.5' }).profile.id).toBe('compat-toggle');
    expect(resolveModelReasoningProfile({ modelId: 'glm-5' }).profile.id).toBe('compat-toggle');
    expect(
      resolveModelReasoningProfile({ modelId: 'doubao-seed-2-1-pro-260915' }).profile.id
    ).toBe('compat-toggle');
    expect(resolveModelReasoningProfile({ modelId: 'kimi-k3.1-pro' }).profile.id).toBe(
      'deepseek-fixed'
    );
    expect(resolveModelReasoningProfile({ modelId: 'grok-3-mini' }).profile.id).toBe('grok-mini');
    expect(resolveModelReasoningProfile({ modelId: 'grok-4.7' }).profile.id).toBe('grok-4');
    expect(resolveModelReasoningProfile({ modelId: 'grok-4.1-fast-non-reasoning' }).profile.id).toBe(
      'none'
    );
  });

  it('respects precedence: model override > customRules > remoteRules > builtin', () => {
    const modelDef: ModelDefinition = {
      id: 'custom-gpt',
      name: 'custom-gpt',
      capabilities: { chat: true },
      params: { reasoningProfileId: 'claude-extended' },
    };

    const customRules = [{ pattern: '^custom-gpt$', profileId: 'openai-gpt5-xhigh' }];
    const remoteRules = [{ pattern: '^custom-gpt$', profileId: 'gemini-2.5-pro' }];

    const byOverride = resolveModelReasoningProfile({
      modelId: 'custom-gpt',
      modelDef,
      customRules,
      remoteRules,
    });
    expect(byOverride.source).toBe('model-override');
    expect(byOverride.profile.id).toBe('claude-extended');

    const byCustom = resolveModelReasoningProfile({
      modelId: 'custom-gpt',
      customRules,
      remoteRules,
    });
    expect(byCustom.source).toBe('custom-rule');
    expect(byCustom.profile.id).toBe('openai-gpt5-xhigh');

    const byRemote = resolveModelReasoningProfile({
      modelId: 'custom-gpt',
      remoteRules,
    });
    expect(byRemote.source).toBe('remote-rule');
    expect(byRemote.profile.id).toBe('gemini-2.5-pro');
  });

  it('coerces reasoning effort intelligently when switching between incompatible families', () => {
    expect(coerceReasoningEffort('xhigh', BUILTIN_REASONING_PROFILES['claude-extended'])).toBe(
      'max'
    );
    expect(coerceReasoningEffort('xhigh', BUILTIN_REASONING_PROFILES['openai-o-series'])).toBe(
      'high'
    );
    expect(coerceReasoningEffort('max', BUILTIN_REASONING_PROFILES['openai-gpt5-xhigh'])).toBe(
      'xhigh'
    );
    expect(coerceReasoningEffort('minimal', BUILTIN_REASONING_PROFILES['openai-o-series'])).toBe(
      'low'
    );
    expect(coerceReasoningEffort('off', BUILTIN_REASONING_PROFILES['openai-o-series'])).toBe('low');
    expect(coerceReasoningEffort('off', BUILTIN_REASONING_PROFILES['gemini-2.5-pro'])).toBe('auto');
    expect(coerceReasoningEffort(undefined, BUILTIN_REASONING_PROFILES['gemini-3-pro'])).toBe(
      'high'
    );
    expect(coerceReasoningEffort('off', BUILTIN_REASONING_PROFILES['openai-gpt6-astra'])).toBe(
      'low'
    );
    expect(coerceReasoningEffort('minimal', BUILTIN_REASONING_PROFILES['gemini-4-flagship'])).toBe(
      'low'
    );
    expect(coerceReasoningEffort('xhigh', BUILTIN_REASONING_PROFILES['claude-adaptive-5'])).toBe(
      'xhigh'
    );
    expect(coerceReasoningEffort('medium', BUILTIN_REASONING_PROFILES['deepseek-v4'])).toBe('high');
  });

  it('keeps public/model-profiles.json in exact sync with BUILTIN_MODEL_PROFILE_RULES and infers 2026 vision capabilities', () => {
    const manifestPath = path.resolve(process.cwd(), 'public/model-profiles.json');
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const parsed = parseModelProfileRulesJson(raw);

    expect(parsed).toHaveLength(BUILTIN_MODEL_PROFILE_RULES.length);
    for (let i = 0; i < BUILTIN_MODEL_PROFILE_RULES.length; i++) {
      expect(parsed[i].pattern).toBe(BUILTIN_MODEL_PROFILE_RULES[i].pattern);
      expect(parsed[i].profileId).toBe(BUILTIN_MODEL_PROFILE_RULES[i].profileId);
    }

    expect(inferModelCapabilities('gpt-6.2-astra').vision).toBe(true);
    expect(inferModelCapabilities('claude-sonnet-5-5').vision).toBe(true);
    expect(inferModelCapabilities('deepseek-flash').vision).toBe(true);
    expect(inferModelCapabilities('deepseek-v4-pro').vision).toBe(false);
    expect(inferModelCapabilities('gemini-4-carbon').reasoning).toBe(true);
    expect(inferModelCapabilities('grok-4.1-fast-non-reasoning').reasoning).toBe(false);
    expect(resolveModelReasoningProfile({ modelId: 'gemini-2.0-flash-thinking-exp' }).profile.id).toBe(
      'none'
    );
    expect(parseHttpHeadersJson('{"X-Custom": "abc"}')).toEqual({ 'X-Custom': 'abc' });
    expect(() => parseHttpHeadersJson('["not-object"]')).toThrow();
    expect(() => parseHttpHeadersJson('123')).toThrow();
    expect(() => parseHttpHeadersJson('{"X-Num": 42}')).toThrow();
  });

  it('validates custom rule JSON and rejects malformed regex or unknown profile IDs', () => {
    const valid = parseModelProfileRulesJson(
      JSON.stringify({
        rules: [{ pattern: '^my-model', profileId: 'gemini-3-flash', note: 'relay' }],
      })
    );
    expect(valid).toHaveLength(1);
    expect(valid[0].profileId).toBe('gemini-3-flash');

    expect(() =>
      parseModelProfileRulesJson('[{"pattern": "[unclosed", "profileId": "openai-o-series"}]')
    ).toThrow();
    expect(() =>
      parseModelProfileRulesJson('[{"pattern": "^ok", "profileId": "unknown-family"}]')
    ).toThrow();
  });

  it('deep merges extraBody payloads safely while filtering prototype pollution keys', () => {
    const base = {
      model: 'gemini-2.5-pro',
      generationConfig: { temperature: 0.7, thinkingConfig: { thinkingBudget: 8192 } },
    };
    const maliciousExtra = JSON.parse(
      '{"generationConfig":{"thinkingConfig":{"thinkingBudget":16384},"stopSequences":["STOP"]},"__proto__":{"polluted":true},"custom_flag":true}'
    ) as Record<string, unknown>;

    const merged = deepMergePayload(base, maliciousExtra);
    expect((merged as Record<string, unknown>).custom_flag).toBe(true);
    expect(
      ((merged.generationConfig as Record<string, unknown>).thinkingConfig as Record<string, unknown>)
        .thinkingBudget
    ).toBe(16384);
    expect((merged.generationConfig as Record<string, unknown>).stopSequences).toEqual(['STOP']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('layers global, model, and conversation params while respecting enabledParams', () => {
    const resolved = resolveEffectiveParams(
      {
        ...DEFAULT_GENERATION_SETTINGS,
        temperature: 0.8,
        presencePenalty: 0.5,
        enabledParams: {
          temperature: true,
          topP: false,
          maxTokens: true,
          presencePenalty: false,
          frequencyPenalty: false,
        },
        extraBody: { nested: { a: 1, b: 2 } },
      },
      { temperature: 0.4, seed: 7, extraBody: { nested: { b: 20 } } },
      { temperature: 0.2, maxTokens: 4096, extraBody: { nested: { c: 30 } } }
    );

    expect(resolved.temperature).toBe(0.2);
    expect(resolved.topP).toBeUndefined();
    expect(resolved.presencePenalty).toBeUndefined();
    expect(resolved.maxTokens).toBe(4096);
    expect(resolved.seed).toBe(7);
    expect(resolved.extraBody).toEqual({ nested: { a: 1, b: 20, c: 30 } });
  });

  it('guards profile lookups against Object.prototype keys (__proto__, toString, constructor)', () => {
    for (const badId of ['__proto__', 'toString', 'constructor']) {
      const res = resolveModelReasoningProfile({
        modelId: 'plain-unknown-model',
        modelDef: {
          id: 'plain-unknown-model',
          name: 'plain',
          capabilities: { chat: true },
          params: { reasoningProfileId: badId },
        },
        customRules: [{ pattern: '.*', profileId: badId }],
      });
      expect(res.profile.id).toBe('none');
      expect(() =>
        parseModelProfileRulesJson(JSON.stringify([{ pattern: '^ok', profileId: badId }]))
      ).toThrow();
    }
  });
});
