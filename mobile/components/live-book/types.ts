/**
 * Live Book shared types — mirrors web-side lib/live-book/types.ts.
 * Block type aligns with mobile/lib/types.ts for interop.
 */

/** Block type compatible with both live-book and global types */
export interface Block {
  id: string;
  type: string;
  title?: string;
  status: string;
  content: string;
  bridge_text?: string;
  payload?: Record<string, unknown>;
  params?: Record<string, unknown>;
  error?: string;
  metadata?: Record<string, unknown>;
  source_anchors?: Array<{ kind: string; ref: string; snippet: string }>;
  created_at?: number;
  updated_at?: number;
}

export type BlockType =
  | "text"
  | "callout"
  | "quiz"
  | "user_note"
  | "figure"
  | "interactive"
  | "animation"
  | "code"
  | "timeline"
  | "flash_cards"
  | "deep_dive"
  | "section"
  | "concept_graph";

export interface Page {
  id: string;
  book_id: string;
  chapter_id: string;
  title: string;
  learning_objectives: string[];
  content_type: string;
  status: string;
  order: number;
  blocks: Block[];
  links: Array<{ target_page_id: string; relation: string; label: string }>;
  parent_page_id: string;
  error: string;
  created_at: number;
  updated_at: number;
}

export interface Chapter {
  id: string;
  title: string;
  learning_objectives: string[];
  content_type: string;
  page_ids: string[];
  summary: string;
  order: number;
}

export interface Spine {
  book_id: string;
  chapters: Chapter[];
  version: number;
  updated_at: number;
}

export interface Book {
  id: string;
  title: string;
  description: string;
  status: string;
  language: string;
  page_count: number;
  chapter_count: number;
  created_at: number;
  updated_at: number;
}

export interface BookDetail {
  book: Book;
  spine: Spine | null;
  pages: Page[];
}

/** Quiz question shape for QuizBlock */
export interface QuizQuestion {
  question_id?: string;
  question?: string;
  question_type?: string;
  options?: Record<string, string> | null;
  correct_answer?: string;
  explanation?: string;
  difficulty?: string;
}
