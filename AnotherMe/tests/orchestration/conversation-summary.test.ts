import { describe, expect, it } from 'vitest';
import {
  extractLastHumanMessage,
  summarizeConversation,
  type OpenAIMessage,
} from '@/lib/orchestration/prompt-builder';
import { buildOpenStudentQuestionSection } from '@/lib/orchestration/director-prompt';

describe('conversation summary attribution', () => {
  it('distinguishes agent-prefixed user messages from human student messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'assistant', content: 'Teacher answer' },
      { role: 'user', content: '[Xiao Ming]: I agree with the teacher.' },
      { role: 'user', content: 'But is this still true in 3D?' },
    ];

    expect(summarizeConversation(messages)).toContain('[Agent: Xiao Ming] I agree');
    expect(summarizeConversation(messages)).toContain(
      '[Student (Human)] But is this still true in 3D?',
    );
  });

  it('extracts the last human message while skipping agent turns encoded as user messages', () => {
    const messages: OpenAIMessage[] = [
      { role: 'user', content: 'Can you explain symmetry?' },
      { role: 'user', content: '[Xiao Ming]: I think it means mirrored parts.' },
      { role: 'assistant', content: 'Here is an explanation.' },
    ];

    expect(extractLastHumanMessage(messages)).toBe('Can you explain symmetry?');
  });

  it('adds an anti-END section when a latest human message is present', () => {
    const section = buildOpenStudentQuestionSection([
      { role: 'user', content: '[Agent A]: Looks solved.' },
      { role: 'user', content: 'Wait, why does the sign change?' },
    ]);

    expect(section).toContain('Latest Student Message Still Needing Attention');
    expect(section).toContain('Wait, why does the sign change?');
    expect(section).toContain('Do not output END');
  });
});
