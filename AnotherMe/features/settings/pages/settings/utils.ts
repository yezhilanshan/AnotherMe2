import type { ProviderId } from '@/lib/types/provider';

export function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export function saveToStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function loadWithLegacyKey<T>(key: string, legacyKey: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  const hasPrimary = window.localStorage.getItem(key);
  if (hasPrimary) return loadFromStorage<T>(key, fallback);
  const hasLegacy = window.localStorage.getItem(legacyKey);
  if (hasLegacy) return loadFromStorage<T>(legacyKey, fallback);
  return fallback;
}

export function maskApiKey(apiKey: string) {
  if (!apiKey) return '未填写';
  if (apiKey.length <= 8) return '已填写';
  return `${apiKey.slice(0, 4)}********${apiKey.slice(-4)}`;
}

export function inferProviderIdFromConnection(providerId: ProviderId, baseUrl: string): ProviderId {
  if (providerId === 'openai' && /dashscope|aliyun|aliyuncs|qwen/i.test(baseUrl)) {
    return 'qwen' as ProviderId;
  }
  return providerId;
}

export function isQwenConnection(providerId: ProviderId, baseUrl: string) {
  return providerId === 'qwen' || /dashscope|aliyun|aliyuncs|qwen/i.test(baseUrl);
}

export function resolveDefaultVisionModel(
  providerId: ProviderId,
  baseUrl: string,
  models: Array<{ id: string; capabilities?: { vision?: boolean } }>,
  fallbackModelId: string,
) {
  if (isQwenConnection(providerId, baseUrl)) return 'qwen3-vl-plus';
  return models.find((model) => model.capabilities?.vision)?.id || fallbackModelId;
}

export function resolveDefaultOcrModel(
  providerId: ProviderId,
  baseUrl: string,
  fallbackVisionModelId: string,
) {
  if (isQwenConnection(providerId, baseUrl)) return 'qwen-vl-ocr-latest';
  return fallbackVisionModelId;
}
