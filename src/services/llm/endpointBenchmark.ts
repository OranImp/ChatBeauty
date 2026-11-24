import type { ProviderConfig } from '@/types/chat';
import { getRuntimeEnvironment, simpleRequest } from '@/services/transport/streamHttp';
import { PROTOCOL_TEMPLATES } from './registry';
import { buildEffectiveProviderHeaders, toStableSessionId, trimBaseUrl } from './adapters/shared';

export interface EndpointBenchmarkResult {
  url: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}

function buildProbeUrl(provider: ProviderConfig, baseUrl: string): string {
  if (provider.protocol === 'gemini') {
    return baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`;
  }

  if (provider.protocol === 'anthropic') {
    if (baseUrl.endsWith('/messages')) {
      return baseUrl.replace(/\/messages$/, '/models');
    }
    if (baseUrl.endsWith('/models')) {
      return baseUrl;
    }
    if (baseUrl.endsWith('/v1')) {
      return `${baseUrl}/models`;
    }
    return `${baseUrl}/v1/models`;
  }

  if (baseUrl.endsWith('/chat/completions')) {
    return baseUrl.replace(/\/chat\/completions$/, '/models');
  }
  if (baseUrl.endsWith('/responses')) {
    return baseUrl.replace(/\/responses$/, '/models');
  }
  if (baseUrl.endsWith('/models')) {
    return baseUrl;
  }
  return `${baseUrl}/models`;
}

/**
 * Benchmarks reachability & round-trip latency (ms) of a provider endpoint or backup URL.
 */
export async function benchmarkProviderEndpoint(
  provider: ProviderConfig,
  overrideBaseUrl?: string
): Promise<EndpointBenchmarkResult> {
  const baseUrl =
    trimBaseUrl(overrideBaseUrl || '') ||
    trimBaseUrl(provider.baseUrl || '') ||
    PROTOCOL_TEMPLATES[provider.protocol].defaultBaseUrl;
  const probeUrl = buildProbeUrl(provider, baseUrl);
  const mergedHeaders = buildEffectiveProviderHeaders(
    { ...provider, baseUrl },
    {
      includeContentType: false,
      sessionId: toStableSessionId(`bench_${provider.id}`),
      isWebRuntime: getRuntimeEnvironment() === 'web',
    }
  );

  const timeoutMs = 8000;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('测速超时 (8s)'));
      }, timeoutMs);
    });

    const res = await Promise.race([
      simpleRequest({
        url: probeUrl,
        method: 'GET',
        headers: mergedHeaders,
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    const elapsed =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    const latencyMs = Math.max(1, Math.round(elapsed));
    const ok = res.status >= 200 && res.status < 300;
    let error: string | undefined;
    if (res.status === 401 || res.status === 403) {
      error = `认证失败 (HTTP ${res.status})`;
    } else if (res.status >= 400) {
      error = `HTTP ${res.status}`;
    }

    return {
      url: baseUrl,
      ok,
      latencyMs,
      status: res.status,
      error,
    };
  } catch (err) {
    const elapsed =
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    return {
      url: baseUrl,
      ok: false,
      latencyMs: Math.max(1, Math.round(elapsed)),
      error: err instanceof Error ? err.message : '网络不可达',
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
