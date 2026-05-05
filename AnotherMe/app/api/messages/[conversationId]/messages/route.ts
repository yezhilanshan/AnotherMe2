import { NextRequest } from 'next/server';
import {
  createGatewayMessage,
  isAnotherMe2GatewayError,
  listGatewayMessages,
} from '@/lib/server/anotherme2-gateway';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolveRequestUserId } from '@/lib/auth/request-user';
import { AuthError } from '@/lib/auth/types';

export const runtime = 'nodejs';

const FALLBACK_CONVERSATION_ID = 'local-system-assistant';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return apiError('INVALID_REQUEST', 400, 'Missing conversation id');
    }

    const limit = Number(request.nextUrl.searchParams.get('limit') || '100');
    const beforeSeqRaw = request.nextUrl.searchParams.get('beforeSeq');
    const beforeSeq = beforeSeqRaw ? Number(beforeSeqRaw) : undefined;
    const userId = await resolveRequestUserId(request, request.nextUrl.searchParams.get('userId'));

    try {
      const messages = await listGatewayMessages({
        conversationId,
        userId,
        limit: Number.isFinite(limit) ? limit : 100,
        beforeSeq: typeof beforeSeq === 'number' && Number.isFinite(beforeSeq) ? beforeSeq : undefined,
      });
      return apiSuccess({ messages });
    } catch (error) {
      if (!isAnotherMe2GatewayError(error)) {
        throw error;
      }
      if (conversationId !== FALLBACK_CONVERSATION_ID) {
        return apiSuccess({ messages: [], degraded: true, warning: error.message });
      }
      return apiSuccess({
        messages: [
          {
            message_id: 'local-system-welcome',
            conversation_id: FALLBACK_CONVERSATION_ID,
            seq: 1,
            sender_id: 'system-assistant',
            message_type: 'text',
            content: '消息网关尚未连接。页面可以浏览，但实时消息需要先配置 AnotherMe2 网关。',
            reply_to_message_id: null,
            status: 'sent',
            source_type: 'system',
            source_ref_id: null,
            recalled_flag: false,
            deleted_flag: false,
            created_at: new Date().toISOString(),
            attachments: [],
          },
        ],
        degraded: true,
        warning: error.message,
      });
    }
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to list messages',
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    const { conversationId } = await context.params;
    if (!conversationId) {
      return apiError('INVALID_REQUEST', 400, 'Missing conversation id');
    }

    const body = (await request.json()) as {
      senderId?: string;
      content?: string;
      messageType?: string;
      replyToMessageId?: string;
      status?: string;
      sourceType?: string;
      sourceRefId?: string;
      attachments?: Array<{
        file_url: string;
        file_name?: string;
        file_size?: number;
        mime_type?: string;
        object_key?: string;
      }>;
    };

    const requestUserId = await resolveRequestUserId(request);
    const senderId = (body.senderId || '').trim();
    const content = (body.content || '').trim();
    if (!senderId || !content) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'senderId and content are required');
    }
    if (senderId !== requestUserId && senderId !== 'system-assistant') {
      return apiError('INVALID_REQUEST', 403, 'senderId does not match current user');
    }

    const message = await createGatewayMessage({
      conversationId,
      senderId,
      content,
      messageType: body.messageType || 'text',
      replyToMessageId: body.replyToMessageId,
      status: body.status,
      sourceType: body.sourceType,
      sourceRefId: body.sourceRefId,
      attachments: body.attachments,
    });

    return apiSuccess({ message }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return apiError('INVALID_REQUEST', error.status, error.message, error.code);
    }
    if (isAnotherMe2GatewayError(error)) {
      return apiError('UPSTREAM_ERROR', error.status, error.message);
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to create message',
    );
  }
}
