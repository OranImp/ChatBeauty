import { describe, expect, it } from 'vitest';
import {
  BUILTIN_REASONING_PROFILES,
  coerceReasoningEffort,
  parseModelProfileRulesJson,
  resolveModelReasoningProfile,
} from '@/services/llm/modelProfiles';
import {
  deepMergePayload,
  resolveEffectiveParams,
} from '@/services/llm/adapters/shared';
import { DEFAULT_GENERATION_SETTINGS } from '@/types/settings';
import type { ModelDefinition } from '@/types/chat';

describe('modelProfiles & parameter merging', () => {
  it('auto-detects reasoning series across OpenAI, Gemini, Anthropic, DeepSeek, and hybrid models', () => {
    expect(resolveModelReasoningProfile({ modelId: 'gpt-4o' }).profile.id).toBe('none');
    expect(resolveModelReasoningProfile({ modelId: 'o3' }).profile.id).toBe('openai-o-series');
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5' }).profile.id).toBe('openai-gpt5');
    expect(resolveModelReasoningProfile({ modelId: 'gpt-5.2' }).profile.id).toBe(
      'openai-gpt5-xhigh'
    );
    expect(resolveModelReasoningProfile({ modelId: 'openai/gpt-5.2' }).profile.id).toBe(
      'openai-gpt5-xhigh'
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
    expect(resolveModelReasoningProfile({ modelId: 'gemini-3-flash' }).profile.id).toBe(
      'gemini-3-flash'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-3-5-haiku-20241022' }).profile.id).toBe(
      'none'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-sonnet-4-20250514' }).profile.id).toBe(
      'claude-extended'
    );
    expect(resolveModelReasoningProfile({ modelId: 'claude-opus-4-6' }).profile.id).toBe(
      'claude-extended'
    );
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-chat' }).profile.id).toBe('none');
    expect(resolveModelReasoningProfile({ modelId: 'deepseek-reasoner' }).profile.id).toBe(
      'deepseek-fixed'
    );
    expect(resolveModelReasoningProfile({ modelId: 'qwen3-235b-a22b' }).profile.id).toBe(
      'compat-toggle'
    );
    expect(resolveModelReasoningProfile({ modelId: 'glm-4.5' }).profile.id).toBe('compat-toggle');
    expect(resolveModelReasoningProfile({ modelId: 'grok-3-mini' }).profile.id).toBe('grok-mini');
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
});
