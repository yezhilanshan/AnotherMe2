import type { AnotherMe2JobSummary } from './types';
import { DEFAULT_PROBLEM_VIDEO_USER_ID, gatewayFetch } from './core';

export async function createAnotherMe2PhotoManimJob(params: {
  imageObjectKey: string;
  problemText?: string;
}): Promise<AnotherMe2JobSummary> {
  const payload: Record<string, unknown> = {
    image_object_key: params.imageObjectKey,
    output_profile: '1080p',
    model_name: 'qwen3.7-plus',
  };
  if (params.problemText?.trim()) {
    payload.problem_text = params.problemText.trim();
  }

  return gatewayFetch<AnotherMe2JobSummary>('/v1/jobs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      job_type: 'photo_manim_direct',
      user_id: DEFAULT_PROBLEM_VIDEO_USER_ID,
      payload,
    }),
  });
}
