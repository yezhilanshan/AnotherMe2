import { getCurrentModelConfig } from '@/lib/utils/model-config';
import type { FormState } from './types';

export const initialForm: FormState = {
  topic: '',
  language: 'zh-CN',
  targetLevel: '',
};

export function getLiveBookHeaders(): HeadersInit {
  const config = getCurrentModelConfig();
  return {
    'Content-Type': 'application/json',
    'x-model': config.modelString || '',
    'x-api-key': config.apiKey || '',
    'x-base-url': config.baseUrl || '',
    'x-provider-type': config.providerType || '',
    'x-requires-api-key': String(config.requiresApiKey ?? false),
  };
}

export async function parseApi<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { success?: boolean; error?: string } & T;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || '请求失败');
  }
  return payload;
}
