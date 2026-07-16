import { describe, expect, it } from 'vitest';
import { parseTutorResponseBlocks } from '@/features/ai-tutor/components/chat/tutor-response-blocks';

describe('tutor response block parser', () => {
  it('keeps regular markdown as a single markdown block', () => {
    const blocks = parseTutorResponseBlocks('先观察题目。\n\n- 已知条件\n- 要求结论');

    expect(blocks).toEqual([
      {
        type: 'markdown',
        content: '先观察题目。\n\n- 已知条件\n- 要求结论',
      },
    ]);
  });

  it('turns teaching headings into semantic blocks', () => {
    const blocks = parseTutorResponseBlocks(`我们先拆开看。

## 提示
先找不变量。

## 知识点
- 等式两边同时加减同一个量
- 合并同类项

## 错因分析
容易把符号带错。`);

    expect(blocks.map((block) => block.type)).toEqual([
      'markdown',
      'hint',
      'knowledge_card',
      'mistake',
    ]);
    expect(blocks[1]).toMatchObject({ title: '提示', content: '先找不变量。' });
  });

  it('accepts future structured block payloads', () => {
    const blocks = parseTutorResponseBlocks(`{
      "blocks": [
        { "type": "markdown", "content": "先别急着算。" },
        { "type": "quiz", "question": "第一步应该做什么？", "options": ["移项", "通分"], "answer": "移项" },
        { "type": "learning_state", "mastered": ["移项"], "weak": ["符号处理"], "nextSuggestion": "再做一道含负数的题。" }
      ]
    }`);

    expect(blocks.map((block) => block.type)).toEqual(['markdown', 'quiz', 'learning_state']);
    expect(blocks[1]).toMatchObject({
      type: 'quiz',
      content: expect.stringContaining('第一步应该做什么？'),
    });
    expect(blocks[2]).toMatchObject({
      type: 'learning_state',
      content: expect.stringContaining('符号处理'),
    });
  });
});
