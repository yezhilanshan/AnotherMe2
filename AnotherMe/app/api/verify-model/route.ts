import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveModel } from '@/lib/server/resolve-model';
import {
  testProviderConnectivity,
  parseGenerationError,
} from '@/lib/server/connectivity-test';
import { PROVIDERS } from '@/lib/ai/providers';

const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  let model: string | undefined;
  try {
    const body = await req.json();
    const { apiKey, baseUrl, providerType, requiresApiKey } = body;
    model = body.model;

    if (!model) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
    }

    // Parse model string to get provider info
    const { providerId: parsedProviderId } = (() => {
      const colonIndex = model.indexOf(':');
      if (colonIndex > 0) {
        return { providerId: model.slice(0, colonIndex) };
      }
      return { providerId: 'openai' };
    })();

    // Resolve API key and base URL
    const provider = PROVIDERS[parsedProviderId as keyof typeof PROVIDERS];
    const effectiveProviderType = providerType || provider?.type || 'openai';
    const effectiveBaseUrl = baseUrl || provider?.defaultBaseUrl || '';

    // Step 1: Try lightweight /models endpoint first (no tokens consumed)
    if (apiKey || !requiresApiKey) {
      const connectivityResult = await testProviderConnectivity({
        providerType: effectiveProviderType,
        providerId: parsedProviderId,
        apiKey: apiKey || '',
        baseUrl: effectiveBaseUrl,
      });

      if (connectivityResult.ok) {
        return apiSuccess({
          message: 'Connection successful',
          response: connectivityResult.message,
        });
      }

      // If /models endpoint returned auth error, don't fall through — key is invalid
      if (
        connectivityResult.message.includes('API key is invalid') ||
        connectivityResult.message.includes('rate limit')
      ) {
        return apiError('MODEL_VERIFICATION_FAILED', 401, connectivityResult.message);
      }

      // For other errors (e.g., 404 — endpoint not supported), fall through to generateText
      log.info(
        `[${parsedProviderId}] /models endpoint failed (${connectivityResult.message}), falling back to generateText`,
      );
    }

    // Step 2: Fallback — send a minimal generateText request
    let languageModel;
    try {
      const result = resolveModel({
        modelString: model,
        apiKey: apiKey || '',
        baseUrl: baseUrl || undefined,
        providerType,
        requiresApiKey,
      });
      languageModel = result.model;
    } catch (error) {
      return apiError(
        'INVALID_REQUEST',
        401,
        error instanceof Error ? error.message : String(error),
      );
    }

    let text: string;
    try {
      const result = await generateText({
        model: languageModel,
        messages: [{ role: 'user' as const, content: 'Say "OK" if you can hear me.' }],
      });
      text = result.text;
    } catch (genError) {
      log.error(`Model verification generateText failed [model="${model ?? 'unknown'}"]:`, genError);
      const { message, statusCode } = parseGenerationError(genError);
      return apiError('MODEL_VERIFICATION_FAILED', statusCode, message);
    }

    return apiSuccess({
      message: 'Connection successful',
      response: text,
    });
  } catch (error) {
    log.error(`Model verification failed [model="${model ?? 'unknown'}"]:`, error);

    let errorMessage = 'Connection failed';
    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return apiError('INTERNAL_ERROR', 500, errorMessage);
  }
}
