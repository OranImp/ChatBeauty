import type { ProviderConfig } from '@/types/chat';
import { getRuntimeEnvironment, simpleRequest } from '@/services/transport/streamHttp';
import { PROTOCOL_TEMPLATES } from './registry';
import { trimBaseUrl } from './adapters/shared';

export interface EndpointBenchmarkResult {
  url: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}

function buildProbeRequest(
  provider: ProviderConfig,
  baseUrl: string
): { probeUrl: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const apiKey = provider.apiKey.trim();

  if (provider.protocol === 'gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
    return { probeUrl: `${baseUrl}/models`, headers };
  }

  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
    if (getRuntimeEnvironment() === 'web') {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    let probeUrl: string;
    if (baseUrl.endsWith('/messages')) {
      probeUrl = baseUrl.replace(/\/messages$/, '/models');
    } else if (baseUrl.endsWith('/models')) {
      probeUrl = baseUrl;
    } else if (baseUrl.endsWith('/v1')) {
      probeUrl = `${baseUrl}/models`;
    } else {
      probeUrl = `${baseUrl}/v1/models`;
    }
    return { probeUrl, headers };
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  let probeUrl: string;
  if (baseUrl.endsWith('/chat/completions')) {
    probeUrl = baseUrl.replace(/\/chat\/completions$/, '/models');
  } else if (baseUrl.endsWith('/responses')) {
    probeUrl = baseUrl.replace(/\/responses$/, '/models');
  } else if (baseUrl.endsWith('/models')) {
    probeUrl = baseUrl;
  } else {
    probeUrl = `${baseUrl}/models`;
  }
  return { probeUrl, headers };
}

/**
 * Benchmarks reachability & round-trip latency (ms) of a provider endpoint or backup URL.
 */
export async function benchmarkProviderEndpoint(
  provider: ProviderConfig,
  overrideBaseUrl?: string
): Promise<EndpointBenchmarkResult> {
  const baseUrl = trimBaseUrl(
    overrideBaseUrl || provider.baseUrl || PROTOCOL_TEMPLATES[provider.protocol].defaultBaseUrl
  );
  const { probeUrl, headers } = buildProbeRequest(provider, baseUrl);
  const mergedHeaders = { ...headers, ...(provider.extraHeaders || {}) };

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
