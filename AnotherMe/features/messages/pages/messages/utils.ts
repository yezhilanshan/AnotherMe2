import type { ChatMessage, ConversationMessage } from './types';

export const ASSISTANT_ID = 'system-assistant';

export function formatTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return '昨天';
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatFullTime(value: string) {
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function mapBackendMessage(
  message: ConversationMessage,
  currentUserId: string,
): ChatMessage {
  const isUser = message.sender_id === currentUserId;
  const isAssistant = message.sender_id === ASSISTANT_ID;
  return {
    id: message.message_id,
    sender: isUser ? '你' : isAssistant ? '系统助手' : message.sender_id.slice(0, 8),
    role: isUser ? 'student' : isAssistant ? 'assistant' : 'peer',
    text: message.content,
    time: formatTime(message.created_at),
    rawTime: message.created_at,
  };
}

export function parseMemberIds(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getInitials(name: string): string {
  if (!name) return '?';
  return name.slice(0, 2).toUpperCase();
}

export function getAvatarColor(id: string): string {
  const colors = ['bg-[#96673a]', 'bg-[#70624d]', 'bg-[#c07f45]', 'bg-[#8e8a7d]', 'bg-[#4d6a5c]'];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
