import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

describe('problem-video routes', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    process.env.ANOTHERME2_GATEWAY_BASE_URL = 'http://127.0.0.1:8080';
    delete process.env.ANOTHERME2_GATEWAY_TOKEN;
  });

  afterEach(() => {
    delete process.env.ANOTHERME2_GATEWAY_BASE_URL;
    delete process.env.ANOTHERME2_GATEWAY_TOKEN;
  });

  it('creates an AnotherMe2 problem-video job from an uploaded image', async () => {
    const { POST } = await import('@/app/api/problem-video/route');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          object_key: 'uploads/problem.png',
          url: 'http://127.0.0.1:8080/uploads/problem.png',
          size: 123,
          content_type: 'image/png',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          job_id: 'job_123',
          job_type: 'problem_video_generate',
          status: 'queued',
          progress: 0,
          step: 'queued',
        }),
      });

    const formData = new FormData();
    formData.append('image', new File(['image-bytes'], 'problem.png', { type: 'image/png' }));
    formData.append('problemText', '已知 Rt△ABC，求 AB。');
    formData.append('model', 'qwen:qwen3.5-flash');
    formData.append('visionModel', 'qwen:qwen3-vl-plus');
    formData.append('ocrModel', 'qwen:qwen-vl-ocr-latest');
    formData.append('apiKey', 'openai-key');
    formData.append('baseUrl', 'https://api.openai.com/v1');
    formData.append('visionApiKey', 'dashscope-vision-key');
    formData.append('visionBaseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    formData.append('ocrApiKey', 'dashscope-ocr-key');
    formData.append('ocrBaseUrl', 'https://dashscope.aliyuncs.com/compatible-mode/v1');

    const response = await POST(
      new NextRequest('http://localhost/api/problem-video', {
        method: 'POST',
        body: formData,
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(202);
    expect(json.success).toBe(true);
    expect(json.jobId).toBe('job_123');
    expect(json.pollUrl).toBe('/api/problem-video/job_123');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('http://127.0.0.1:8080/v1/uploads');
    expect(mockFetch.mock.calls[1][0]).toBe('http://127.0.0.1:8080/v1/jobs');
    const createJobBody = JSON.parse(String(mockFetch.mock.calls[1][1]?.body));
    expect(createJobBody.payload.model_name).toBe('qwen:qwen3.5-flash');
    expect(createJobBody.payload.llm_config).toMatchObject({
      model: 'qwen:qwen3.5-flash',
      vision_model: 'qwen:qwen3-vl-plus',
      ocr_model: 'qwen:qwen-vl-ocr-latest',
      api_key: 'openai-key',
      base_url: 'https://api.openai.com/v1',
      vision_api_key: 'dashscope-vision-key',
      vision_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      ocr_api_key: 'dashscope-ocr-key',
      ocr_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('returns a validation error when the image is missing', async () => {
    const { POST } = await import('@/app/api/problem-video/route');

    const response = await POST(
      new NextRequest('http://localhost/api/problem-video', {
        method: 'POST',
        body: new FormData(),
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain('Problem image is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns normalized job status and result payload', async () => {
    const { GET } = await import('@/app/api/problem-video/[jobId]/route');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          job_id: 'job_456',
          job_type: 'problem_video_generate',
          status: 'succeeded',
          progress: 100,
          step: 'completed',
          error_message: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          job_id: 'job_456',
          status: 'succeeded',
          result: {
            video_url: 'http://127.0.0.1:9000/jobs/job_456/problem_video/final.mp4',
            duration_sec: 42.5,
            script_steps_count: 6,
            debug_bundle_url: 'http://127.0.0.1:9000/jobs/job_456/problem_video/debug_bundle.zip',
          },
        }),
      });

    const response = await GET(
      new NextRequest('http://localhost/api/problem-video/job_456'),
      { params: Promise.resolve({ jobId: 'job_456' }) },
    );

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('succeeded');
    expect(json.result).toEqual({
      videoUrl: 'http://127.0.0.1:9000/jobs/job_456/problem_video/final.mp4',
      durationSec: 42.5,
      scriptStepsCount: 6,
      debugBundleUrl: 'http://127.0.0.1:9000/jobs/job_456/problem_video/debug_bundle.zip',
    });
  });

  it('rewrites local filesystem video path to stream endpoint', async () => {
    const { GET } = await import('@/app/api/problem-video/[jobId]/route');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          job_id: 'job_local',
          job_type: 'problem_video_generate',
          status: 'succeeded',
          progress: 100,
          step: 'completed',
          error_message: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          job_id: 'job_local',
          status: 'succeeded',
          result: {
            video_url:
              'D:\\AnotherMe-V3\\AnotherMe\\anotherme2_engine\\gateway_data\\objects\\jobs\\job_local\\problem_video\\final.mp4',
            duration_sec: 12.3,
            script_steps_count: 4,
            debug_bundle_url: null,
          },
        }),
      });

    const response = await GET(
      new NextRequest('http://localhost/api/problem-video/job_local'),
      { params: Promise.resolve({ jobId: 'job_local' }) },
    );

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.result.videoUrl).toBe('/api/problem-video/job_local/result-video');
  });

  it('normalizes job-not-found to failed terminal state for polling', async () => {
    const { GET } = await import('@/app/api/problem-video/[jobId]/route');

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        error_code: 'JOB_NOT_FOUND',
        message: 'Job not found',
      }),
    });

    const response = await GET(
      new NextRequest('http://localhost/api/problem-video/job_missing'),
      { params: Promise.resolve({ jobId: 'job_missing' }) },
    );

    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.status).toBe('failed');
    expect(json.step).toBe('failed');
    expect(json.errorMessage).toContain('任务不存在');
  });
});
