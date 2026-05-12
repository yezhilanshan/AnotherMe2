import type { ComponentType } from 'react';

export type TutorMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  capability?: CapabilityId;
  feedback?: 'up' | 'down' | null;
  toolTraces?: TutorToolTrace[];
  capabilityResult?: Record<string, unknown>;
  reasoning?: string;
};

export type TutorSession = {
  id: string;
  title: string;
  autoTitle: boolean;
  createdAt: string;
  updatedAt: string;
  messages: TutorMessage[];
};

export type ChatApiEvent = {
  type: string;
  data?: Record<string, unknown>;
};

export type ChatRequestMessage = {
  id: string;
  role: 'user' | 'assistant';
  parts: Array<{ type: 'text'; text: string }>;
};

export type CapabilityId =
  | ''
  | 'deep_solve'
  | 'quiz_practice'
  | 'deep_research'
  | 'math_animator'
  | 'visualize';

export type TutorToolName =
  | 'brainstorm'
  | 'rag'
  | 'web_search'
  | 'code_execution'
  | 'reason'
  | 'paper_search';

export type TutorToolTrace = {
  id: string;
  toolName: TutorToolName;
  status: 'running' | 'success' | 'error';
  startTime: number;
  endTime?: number;
  output?: string;
  error?: string;
};

export type QuizPreviewQuestion = {
  question: string;
  options?: string[];
  answer: string;
  explanation?: string;
  difficulty?: string;
};

export type VisualizePreviewData = {
  format: string;
  content: string;
};

export type MathAnimatorPreviewData = {
  response?: string;
  outputUrl?: string;
  artifacts?: Array<{ type: 'video' | 'image'; url: string; filename?: string; label?: string }>;
  storyboard?: Array<{ frame: number; description: string; code?: string }>;
  manimCode?: string;
  renderError?: string;
};

export interface CapabilityDef {
  id: CapabilityId;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}

export interface ToolDef {
  id: TutorToolName;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}
