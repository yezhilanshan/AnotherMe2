export interface AnotherMe2UploadResponse {
  object_key: string;
  url: string;
  size: number;
  content_type: string;
}

export interface AnotherMe2JobSummary {
  job_id: string;
  job_type: string;
  status: string;
  progress: number;
  step: string;
  error_code?: string | null;
  error_message?: string | null;
  result?: Record<string, unknown> | null;
}

export interface AnotherMe2ProblemVideoResult {
  video_url?: string;
  duration_sec?: number;
  script_steps_count?: number;
  debug_bundle_url?: string | null;
  learner_memory_records?: number;
  learner_memory_events?: number;
}

export interface GatewayConversationSummary {
  conversation_id: string;
  type: string;
  name: string;
  creator_id: string;
  last_message_id?: string | null;
  last_message_time?: string | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
}

export interface GatewayAttachment {
  attachment_id: string;
  file_url: string;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  object_key?: string | null;
}

export interface GatewayMessage {
  message_id: string;
  conversation_id: string;
  seq: number;
  sender_id: string;
  message_type: string;
  content: string;
  reply_to_message_id?: string | null;
  status: string;
  source_type: string;
  source_ref_id?: string | null;
  recalled_flag: boolean;
  deleted_flag: boolean;
  created_at: string;
  attachments: GatewayAttachment[];
}

export interface GatewayConversationMember {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  mute_flag: boolean;
  unread_count: number;
  last_read_message_id?: string | null;
  last_read_seq: number;
}

export interface GatewayRemoveConversationMemberResult {
  conversation_id: string;
  member_user_id: string;
  removed: boolean;
}

export interface GatewayAIChatSession {
  session_id: string;
  user_id: string;
  title: string;
  source: string;
  subject?: string | null;
  linked_classroom_id?: string | null;
  linked_conversation_id?: string | null;
  archived_flag: boolean;
  created_at: string;
  updated_at: string;
}

export interface GatewayAIChatMessage {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type: string;
  model_name?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  latency_ms?: number | null;
  request_id?: string | null;
  parent_message_id?: string | null;
  created_at: string;
}

export interface GatewayAIMessageFeedback {
  feedback_id: string;
  message_id: string;
  user_id: string;
  rating: 'like' | 'dislike';
  feedback_text?: string | null;
  created_at: string;
}

export interface LearningRecordExtractResult {
  session_id: string;
  user_id: string;
  records_created: number;
  subjects: string[];
  knowledge_points: string[];
  extract_version: string;
  latest_user_message_id?: string;
  message_count?: number;
}

export interface GatewayLearningRecord {
  record_id: string;
  user_id: string;
  session_id: string;
  message_id?: string | null;
  subject?: string | null;
  knowledge_point?: string | null;
  question_type?: string | null;
  difficulty?: string | null;
  solved_flag: boolean;
  confusion_flag: boolean;
  extract_version: string;
  created_at: string;
}

export interface GatewayAbilityScore {
  metric: string;
  value: number;
  full_mark: number;
}

export interface GatewayLearningStats {
  records_total: number;
  records_14d: number;
  active_days_14: number;
  confusion_records: number;
  solved_records: number;
  top_subjects: string[];
  top_knowledge_points: string[];
  total_weight: number;
}

export interface GatewayStudentProfile {
  user_id: string;
  weak_subjects: string[];
  weak_knowledge_points: string[];
  recent_focus?: string | null;
  ability_scores: GatewayAbilityScore[];
  learning_stats: GatewayLearningStats;
  updated_at?: string | null;
  computed_at: string;
  profile_source: string;
}

export interface GatewayLearningEvent {
  event_id: string;
  user_id: string;
  event_type: string;
  session_id?: string | null;
  classroom_id?: string | null;
  scene_id?: string | null;
  block_id?: string | null;
  knowledge_points?: string[] | null;
  payload?: Record<string, unknown> | null;
  weight: number;
  created_at: string;
}

export interface GatewayKnowledgePoint {
  id: string;
  subject?: string | null;
  name: string;
  description?: string | null;
  parent_id?: string | null;
  prerequisites: string[];
  difficulty?: string | null;
  created_at: string;
}

export interface GatewayStudentKnowledgeState {
  user_id: string;
  knowledge_point_id: string;
  p_mastery: number;
  p_learn: number;
  p_guess: number;
  p_slip: number;
  attempts: number;
  correct_attempts: number;
  last_updated_at?: string | null;
}

export interface GatewayTeachingDecision {
  target_knowledge_point_id: string;
  mastery: number;
  action: string;
  reason: string;
}

export interface GatewayQuizAnswerResult {
  knowledge_point_id: string;
  prior_mastery: number;
  posterior_mastery: number;
  attempts: number;
  correct_attempts: number;
}

export interface GatewayStudentKnowledgeContext {
  context_text: string;
}

export interface GatewayDiagnosticProbe {
  probe_id: string;
  knowledge_point_id: string;
  question: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  difficulty: string;
  probe_type: string;
  hints: string[];
  teaching_action: string;
  reason: string;
}
