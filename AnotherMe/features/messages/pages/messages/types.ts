export type ConversationSummary = {
  conversation_id: string;
  type: string;
  name: string;
  creator_id: string;
  last_message_id?: string | null;
  last_message_time?: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  message_id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  message_type: string;
  content: string;
  source_type: string;
  source_ref_id?: string | null;
  created_at: string;
};

export type ConversationMember = {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  mute_flag: boolean;
  unread_count: number;
  last_read_message_id?: string | null;
  last_read_seq: number;
};

export type AIChatSession = {
  session_id: string;
  user_id: string;
  title: string;
};

export type AIChatMessage = {
  message_id: string;
};

export type ChatMessage = {
  id: string;
  sender: string;
  role: 'assistant' | 'student' | 'peer';
  text: string;
  time: string;
  rawTime: string;
};

export type ConversationsResponse = {
  success: boolean;
  conversations?: ConversationSummary[];
  error?: string;
};

export type ConversationResponse = {
  success: boolean;
  conversation?: ConversationSummary;
  error?: string;
};

export type MessagesResponse = {
  success: boolean;
  messages?: ConversationMessage[];
  error?: string;
};

export type MessageResponse = {
  success: boolean;
  message?: ConversationMessage;
  error?: string;
};

export type MembersResponse = {
  success: boolean;
  members?: ConversationMember[];
  error?: string;
};

export type RemoveMemberResponse = {
  success: boolean;
  result?: {
    conversation_id: string;
    member_user_id: string;
    removed: boolean;
  };
  error?: string;
};

export type DeleteConversationResponse = {
  success: boolean;
  result?: {
    conversation_id: string;
    deleted: boolean;
  };
  error?: string;
};

export type AISessionsResponse = {
  success: boolean;
  sessions?: AIChatSession[];
  error?: string;
};

export type AISessionResponse = {
  success: boolean;
  session?: AIChatSession;
  error?: string;
};

export type AIMessageResponse = {
  success: boolean;
  message?: AIChatMessage;
  error?: string;
};

export type SearchResponse = {
  success: boolean;
  answer?: string;
  sources?: Array<{ title: string; url: string }>;
  error?: string;
};

export type WSConfigResponse = {
  success: boolean;
  wsBaseUrl?: string;
  error?: string;
};
