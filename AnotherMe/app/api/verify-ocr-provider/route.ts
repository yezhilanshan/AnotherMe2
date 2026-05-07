import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';

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
  model: string
): Promise<{ ok: boolean; message: string }> {
  try {
    // For standard providers, we use the existing verify-model endpoint logic
    const resp = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/verify-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        baseUrl,
        model,
        providerType: 'openai',
        requiresApiKey: true,
      }),
    });

    const payload = await resp.json() as { success?: boolean; error?: string; message?: string };

    if (!resp.ok || !payload.success) {
      return { ok: false, message: payload.error || payload.message || '连接测试失败' };
    }

    return { ok: true, message: '连接成功' };
  } catch (error) {
    log.error(`OCR provider verification failed [provider="${providerId}"]:`, error);
    return {
      ok: false,
      message: error instanceof Error ? error.message : '连接测试失败',
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { providerId, apiKey, baseUrl, model } = body;

    if (!providerId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Provider ID is required');
    }

    // Handle MinerU specially
    if (providerId === 'mineru') {
      const result = await verifyMinerU(baseUrl || 'http://localhost:8080');
      if (result.ok) {
        return apiSuccess({ message: result.message });
      } else {
        return apiError('VERIFICATION_FAILED', 400, result.message);
      }
    }

    // For other providers, use standard verification
    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    const result = await verifyStandardProvider(providerId, apiKey || '', baseUrl || '', model);
    if (result.ok) {
      return apiSuccess({ message: result.message });
    } else {
      return apiError('VERIFICATION_FAILED', 400, result.message);
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
