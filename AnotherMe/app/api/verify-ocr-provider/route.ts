import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { PROVIDERS } from '@/lib/ai/providers';
import {
  testProviderConnectivity,
  parseGenerationError,
} from '@/lib/server/connectivity-test';

/**
 * Models that don't support standard chat completions and need
 * a lightweight connectivity check instead.
 */
const SPECIALIZED_OCR_MODELS = new Set(['qwen-vl-ocr-latest']);

const log = createLogger('Verify OCR Provider');

interface MinerUHealthResponse {
  status: string;
  version?: string;
}

async function verifyMinerU(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;

    const ssrfError = validateUrlForSSRF(healthUrl);
    if (ssrfError) {
      return { ok: false, message: ssrfError };
    }

    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { ok: false, message: `MinerU 服务返回错误: ${response.status}` };
    }

    const data = (await response.json()) as MinerUHealthResponse;
    return {
      ok: true,
      message: `MinerU 连接成功${data.version ? ` (版本: ${data.version})` : ''}`,
    };
  } catch (error) {
    log.error('MinerU verification failed:', error);
    if (error instanceof Error) {
      if (error.message.includes('ECONNREFUSED')) {
        return { ok: false, message: '无法连接到 MinerU 服务，请检查服务是否已启动' };
      }
      if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
        return { ok: false, message: '连接 MinerU 超时，请检查网络或 Base URL' };
      }
      return { ok: false, message: `连接失败: ${error.message}` };
    }
    return { ok: false, message: '连接 MinerU 失败' };
  }
}

/**
 * Verify specialized OCR models (e.g. qwen-vl-ocr-latest) that don't support
 * standard chat completions. Uses the /v1/models endpoint to check API key validity.
 */
async function verifySpecializedOcrModel(
  providerId: string,
  apiKey: string,
  baseUrl: string,
  _model: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const provider = PROVIDERS[providerId as keyof typeof PROVIDERS];
    const endpoint = (baseUrl || provider?.defaultBaseUrl || '').replace(/\/$/, '');

    if (!endpoint) {
      return { ok: false, message: '无法确定 API 地址，请检查 Base URL' };
    }

    const modelsUrl = `${endpoint}/models`;

    const ssrfError = validateUrlForSSRF(modelsUrl);
    if (ssrfError) {
      return { ok: false, message: ssrfError };
    }

    const response = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      return { ok: true, message: '连接成功' };
    }

    const errorText = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'API key 无效或已过期' };
    }
    return { ok: false, message: `连接失败 (${response.status}): ${errorText.slice(0, 200)}` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : '连接测试失败';
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      return { ok: false, message: '无法连接到 API 服务器，请检查 Base URL' };
    }
    return { ok: false, message: msg };
  }
}

/**
 * Detect the correct provider from the model name.
 * When a user types a model like "qwen-vl-ocr-latest" but has a different
 * provider selected (e.g., "openai"), this auto-detects the right provider.
 */
function detectProviderFromModel(
  model: string,
): { providerId: string; providerType: string; requiresApiKey: boolean } | null {
  for (const [pid, config] of Object.entries(PROVIDERS)) {
    if (config.models.some((m) => m.id === model)) {
      return {
        providerId: pid,
        providerType: config.type,
        requiresApiKey: config.requiresApiKey,
      };
    }
  }
  return null;
}

/**
 * Verify standard OCR provider using lightweight /models endpoint.
 * Falls back to text-only generateText if /models is not supported.
 * No images are sent — API key validation is sufficient.
 */
async function verifyStandardProvider(
  providerId: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  providerType?: string,
  requiresApiKey?: boolean,
): Promise<{ ok: boolean; message: string }> {
  // Resolve provider config
  const provider = PROVIDERS[providerId as keyof typeof PROVIDERS];
  const effectiveProviderType = providerType || provider?.type || 'openai';
  const effectiveBaseUrl = baseUrl || provider?.defaultBaseUrl || '';

  // Step 1: Try lightweight /models endpoint
  const connectivityResult = await testProviderConnectivity({
    providerType: effectiveProviderType,
    providerId,
    apiKey,
    baseUrl: effectiveBaseUrl,
  });

  if (connectivityResult.ok) {
    return { ok: true, message: '连接成功' };
  }

  // If auth failed, report immediately
  if (
    connectivityResult.message.includes('API key is invalid') ||
    connectivityResult.message.includes('rate limit')
  ) {
    return { ok: false, message: 'API key 无效或已过期' };
  }

  // Step 2: Fallback — text-only generateText (no image)
  log.info(
    `[${providerId}] /models endpoint failed for OCR, falling back to generateText`,
  );

  try {
    let languageModel;
    try {
      const result = resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerId: providerId,
        providerType: providerType || 'openai',
        requiresApiKey: requiresApiKey ?? true,
      });
      languageModel = result.model;
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '模型解析失败',
      };
    }

    const { text } = await generateText({
      model: languageModel,
      messages: [{ role: 'user' as const, content: 'Say "OK" if you can hear me.' }],
    });

    if (text.trim()) {
      return { ok: true, message: '连接成功' };
    }
    return { ok: false, message: '模型返回空响应' };
  } catch (error) {
    log.error(`OCR provider verification failed [provider="${providerId}"]:`, error);
    const { message } = parseGenerationError(error);
    return { ok: false, message };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, model } = body;
    let { providerId, baseUrl, providerType, requiresApiKey } = body;

    if (!providerId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Provider ID is required');
    }

    // Handle MinerU specially
    if (providerId === 'mineru') {
      const result = await verifyMinerU(baseUrl || 'http://localhost:8080');
      if (result.ok) {
        return apiSuccess({ message: result.message });
      } else {
        return apiError('MODEL_VERIFICATION_FAILED', 400, result.message);
      }
    }

    // For other providers, use standard verification
    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    // Auto-detect provider from model name when there's a mismatch
    const detected = detectProviderFromModel(model);
    if (detected && detected.providerId !== providerId) {
      log.info(
        `Auto-detected provider "${detected.providerId}" for model "${model}" (was "${providerId}")`,
      );
      providerId = detected.providerId;
      providerType = detected.providerType;
      requiresApiKey = detected.requiresApiKey;
      // Clear stale base URL so resolveModel picks up the detected provider's default
      baseUrl = '';
    }

    // Specialized OCR models don't support chat completions — use connectivity check
    if (SPECIALIZED_OCR_MODELS.has(model)) {
      const result = await verifySpecializedOcrModel(providerId, apiKey || '', baseUrl || '', model);
      if (result.ok) {
        return apiSuccess({ message: result.message });
      } else {
        return apiError('MODEL_VERIFICATION_FAILED', 400, result.message);
      }
    }

    const result = await verifyStandardProvider(
      providerId,
      apiKey || '',
      baseUrl || '',
      model,
      providerType,
      requiresApiKey,
    );
    if (result.ok) {
      return apiSuccess({ message: result.message });
    } else {
      return apiError('MODEL_VERIFICATION_FAILED', 400, result.message);
    }
  } catch (error) {
    log.error('OCR provider verification failed:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
