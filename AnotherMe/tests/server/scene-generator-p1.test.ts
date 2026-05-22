import { describe, expect, it } from 'vitest';
import { extractHtml, formatQuestionsForPrompt } from '@/lib/generation/scene-generator';
import type { QuizQuestion } from '@/lib/types/stage';

describe('scene generator P1 hardening', () => {
  it('extracts HTML from an unterminated fenced response', () => {
    const html = extractHtml('```html\n<html><body><h1>Demo</h1></body>');

    expect(html).toBe('<html><body><h1>Demo</h1></body>');
  });

  it('extracts started HTML documents even when the closing html tag is missing', () => {
    const html = extractHtml('prefix\n<!DOCTYPE html><html><body>partial');

    expect(html).toBe('<!DOCTYPE html><html><body>partial');
  });

  it('formats malformed string quiz options without [object Object]', () => {
    const question = {
      id: 'q1',
      type: 'single',
      question: 'Choose one',
      options: ['Alpha', { value: 'B', label: 'Beta' }],
    } as unknown as QuizQuestion;

    expect(formatQuestionsForPrompt([question])).toContain('Options: A. Alpha, B. Beta');
    expect(formatQuestionsForPrompt([question])).not.toContain('[object Object]');
  });
});
