import { gatewayFetch } from './core';
import type {
  GatewayConversationMember,
  GatewayConversationSummary,
  GatewayMessage,
  GatewayRemoveConversationMemberResult,
} from './types';

export async function listGatewayConversations(params: {
  userId: string;
  limit?: number;
}): Promise<GatewayConversationSummary[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  return gatewayFetch<GatewayConversationSummary[]>(
    `/v1/messages/conversations?${query.toString()}`,
  );
}

export async function createGatewayConversation(params: {
  userId: string;
  type?: string;
  name: string;
  creatorId?: string;
  memberIds?: string[];
}): Promise<GatewayConversationSummary> {
  return gatewayFetch<GatewayConversationSummary>('/v1/messages/conversations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      type: params.type || 'single',
      name: params.name,
      creator_id: params.creatorId,
      member_ids: params.memberIds || [],
    }),
  });
}

export async function listGatewayConversationMembers(params: {
  conversationId: string;
  userId: string;
}): Promise<GatewayConversationMember[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  return gatewayFetch<GatewayConversationMember[]>(
    `/v1/messages/${params.conversationId}/members?${query.toString()}`,
  );
}

export async function addGatewayConversationMembers(params: {
  conversationId: string;
  operatorUserId: string;
  memberIds: string[];
}): Promise<GatewayConversationMember[]> {
  return gatewayFetch<GatewayConversationMember[]>(
    `/v1/messages/${params.conversationId}/members`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_user_id: params.operatorUserId,
        member_ids: params.memberIds,
      }),
    },
  );
}

export async function removeGatewayConversationMember(params: {
  conversationId: string;
  memberUserId: string;
  operatorUserId: string;
}): Promise<GatewayRemoveConversationMemberResult> {
  const encodedMemberUserId = encodeURIComponent(params.memberUserId);
  return gatewayFetch<GatewayRemoveConversationMemberResult>(
    `/v1/messages/${params.conversationId}/members/${encodedMemberUserId}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_user_id: params.operatorUserId,
      }),
    },
  );
}

export async function deleteGatewayConversation(params: {
  conversationId: string;
  operatorUserId: string;
}): Promise<{ conversation_id: string; deleted: boolean }> {
  return gatewayFetch<{ conversation_id: string; deleted: boolean }>(
    `/v1/messages/conversations/${encodeURIComponent(params.conversationId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operator_user_id: params.operatorUserId,
      }),
    },
  );
}

export async function listGatewayMessages(params: {
  conversationId: string;
  userId: string;
  limit?: number;
  beforeSeq?: number;
}): Promise<GatewayMessage[]> {
  const query = new URLSearchParams({ user_id: params.userId });
  if (typeof params.limit === 'number') {
    query.set('limit', String(params.limit));
  }
  if (typeof params.beforeSeq === 'number') {
    query.set('before_seq', String(params.beforeSeq));
  }
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return gatewayFetch<GatewayMessage[]>(`/v1/messages/${params.conversationId}/messages${suffix}`);
}

export async function createGatewayMessage(params: {
  conversationId: string;
  senderId: string;
  content: string;
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
}): Promise<GatewayMessage> {
  return gatewayFetch<GatewayMessage>(`/v1/messages/${params.conversationId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender_id: params.senderId,
      message_type: params.messageType || 'text',
      content: params.content,
      reply_to_message_id: params.replyToMessageId,
      status: params.status || 'sent',
      source_type: params.sourceType || 'manual',
      source_ref_id: params.sourceRefId,
      attachments: params.attachments || [],
    }),
  });
}

export async function markGatewayConversationRead(params: {
  conversationId: string;
  userId: string;
  lastReadSeq?: number;
}): Promise<{
  conversation_id: string;
  user_id: string;
  last_read_seq: number;
  unread_count: number;
}> {
  return gatewayFetch<{
    conversation_id: string;
    user_id: string;
    last_read_seq: number;
    unread_count: number;
  }>(`/v1/messages/${params.conversationId}/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      last_read_seq: params.lastReadSeq,
    }),
  });
}
