import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveWebSearchApiKey, resolveWebSearchBaseUrl } from '@/lib/server/provider-config';
import { validateUrlForSSRF } from '@/lib/server/ssrf-guard';
import { searchWithTavily } from '@/lib/web-search/tavily';

const log = createLogger('VerifyWebSearch');

export async function POST(req: NextRequest) {
  let providerId: string | undefined;
  try {
    const body = await req.json();
    providerId = body.providerId;
    const { apiKey, baseUrl } = body as {
      providerId?: string;
      apiKey?: string;
      baseUrl?: string;
      modelId?: string;
    };

    if (!providerId) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Provider ID is required');
    }

    if (baseUrl && process.env.NODE_ENV === 'production') {
      const ssrfError = validateUrlForSSRF(baseUrl);
      if (ssrfError) {
        return apiError('INVALID_URL', 403, ssrfError);
      }
    }

    const resolvedApiKey = resolveWebSearchApiKey(apiKey);
    if (!resolvedApiKey) {
      return apiError('MISSING_API_KEY', 400, 'No API key configured');
    }

    const resolvedBaseUrl = resolveWebSearchBaseUrl(baseUrl);
    await searchWithTavily({
      query: 'ping',
      apiKey: resolvedApiKey,
      baseUrl: resolvedBaseUrl,
      maxResults: 1,
    });

    return apiSuccess({ message: 'Connection successful' });
  } catch (error) {
    log.error(`Web search verification failed [provider=${providerId ?? 'unknown'}]:`, error);
    const message = error instanceof Error ? error.message : 'Connection failed';
    return apiError('INTERNAL_ERROR', 500, message);
  }
}
