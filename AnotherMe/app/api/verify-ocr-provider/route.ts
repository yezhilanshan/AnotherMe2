import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';

const log = createLogger('Verify OCR Provider');

interface MinerUHealthResponse {
  status: string;
  version?: string;
}

async function verifyMinerU(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    // Try to connect to MinerU health endpoint
    const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return { ok: false, message: `MinerU 服务返回错误: ${response.status}` };
    }

    const data = await response.json() as MinerUHealthResponse;
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

async function verifyStandardProvider(
  providerId: string,
  apiKey: string,
  baseUrl: string,
  model: string,
  providerType?: string,
  requiresApiKey?: boolean,
): Promise<{ ok: boolean; message: string }> {
  try {
    // Directly resolve model and send a test message (avoids server-side fetch to relative URL)
    let languageModel;
    try {
      const result = resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
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
      messages: [{ role: 'user', content: 'Say "OK" if you can hear me.' }],
    });

    if (text.trim()) {
      return { ok: true, message: '连接成功' };
    }
    return { ok: false, message: '模型返回空响应' };
  } catch (error) {
    log.error(`OCR provider verification failed [provider="${providerId}"]:`, error);
    const msg = error instanceof Error ? error.message : '连接测试失败';
    if (msg.includes('401') || msg.includes('Unauthorized')) {
      return { ok: false, message: 'API key 无效或已过期' };
    }
    if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
      return { ok: false, message: '无法连接到 API 服务器，请检查 Base URL' };
    }
    return { ok: false, message: msg };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { providerId, apiKey, baseUrl, model, providerType, requiresApiKey } = body;

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

    const result = await verifyStandardProvider(providerId, apiKey || '', baseUrl || '', model, providerType, requiresApiKey);
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
