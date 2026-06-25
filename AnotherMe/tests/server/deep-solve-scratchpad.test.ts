import { describe, expect, it } from 'vitest';
import { DeepSolveScratchpad, parseSolvePlan } from '@/features/ai-tutor/orchestration/deep-solve/scratchpad';

describe('deep solve scratchpad', () => {
  it('parses numbered plan steps and formats ReAct context', () => {
    const plan = parseSolvePlan(`## 分析\n这是一个几何问题。\n\n1. 找已知条件\n2. 构造辅助线\n3. 证明相似`);
    const scratchpad = new DeepSolveScratchpad();

    scratchpad.setPlan(plan);
    scratchpad.addEntry({
      stepIndex: 1,
      round: 0,
      thought: 'Need relevant notes.',
      action: 'rag',
      observation: '辅助线通常用于构造相似三角形。',
      success: true,
    });

    const context = scratchpad.buildToolContext();
    const sources = scratchpad.formatSourcesMarkdown();

    expect(plan.steps).toEqual(['找已知条件', '构造辅助线', '证明相似']);
    expect(context).toContain('ReAct Scratchpad');
    expect(context).toContain('rag');
    expect(sources).toContain('工具与来源');
  });
});
