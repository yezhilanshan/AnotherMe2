import { describe, expect, it, vi } from 'vitest';
import { generateSceneActions, generateSceneContent } from '@/lib/generation/scene-generator';
import type { SceneOutline } from '@/lib/types/generation';
import type { GeneratedSlideContent } from '@/lib/types/generation';

const slideOutline: SceneOutline = {
  id: 'scene_1',
  type: 'slide',
  title: 'Retry Test',
  description: 'Validate retry handling.',
  keyPoints: ['first point'],
  order: 1,
  language: 'zh-CN',
};

describe('scene generator retry handling', () => {
  it('retries slide content when the first response is not valid JSON', async () => {
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(
        JSON.stringify({
          elements: [
            {
              type: 'text',
              left: 10,
              top: 20,
              width: 300,
              height: 80,
              content: 'Recovered content',
            },
          ],
          remark: 'ok',
        }),
      );

    const content = await generateSceneContent(slideOutline, aiCall);

    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(content && 'elements' in content ? content.elements : []).toHaveLength(1);
    expect(content && 'remark' in content ? content.remark : undefined).toBe('ok');
  });

  it('retries action generation before falling back to defaults', async () => {
    const content: GeneratedSlideContent = {
      elements: [
        {
          id: 'text_1',
          type: 'text',
          left: 10,
          top: 20,
          width: 300,
          height: 80,
          rotate: 0,
          content: 'Slide content',
          defaultFontName: 'Microsoft YaHei',
          defaultColor: '#333333',
        },
      ],
      remark: 'ok',
    };
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce('[]')
      .mockResolvedValueOnce(JSON.stringify([{ type: 'text', content: 'Recovered narration' }]));

    const actions = await generateSceneActions(slideOutline, content, aiCall);

    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'speech', text: 'Recovered narration' }),
      ]),
    );
  });
});
