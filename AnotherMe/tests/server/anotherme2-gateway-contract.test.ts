import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const fetchMock = vi.fn() as Mock;

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('anotherme2 gateway client contract', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('ANOTHERME2_GATEWAY_BASE_URL', 'http://gateway.test/');
    vi.stubEnv('ANOTHERME2_GATEWAY_TOKEN', 'gateway-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('keeps the legacy barrel exports wired to the domain modules', async () => {
    const legacy = await import('@/lib/server/anotherme2-gateway');
    const problemVideo = await import('@/lib/server/anotherme2-gateway/problem-video');
    const messages = await import('@/lib/server/anotherme2-gateway/messages');
    const ai = await import('@/lib/server/anotherme2-gateway/ai');
    const learning = await import('@/lib/server/anotherme2-gateway/learning');

    expect(legacy.createAnotherMe2ProblemVideoJob).toBe(
      problemVideo.createAnotherMe2ProblemVideoJob,
    );
    expect(legacy.listGatewayConversations).toBe(messages.listGatewayConversations);
    expect(legacy.createGatewayAIMessageFeedback).toBe(ai.createGatewayAIMessageFeedback);
    expect(legacy.getGatewayStudentKnowledgeStates).toBe(learning.getGatewayStudentKnowledgeStates);
  });

  it('maps problem-video job creation to the gateway job contract', async () => {
    const { createAnotherMe2ProblemVideoJob } =
      await import('@/lib/server/anotherme2-gateway/problem-video');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        job_id: 'job_1',
        job_type: 'problem_video_generate',
        status: 'queued',
        progress: 0,
        step: 'queued',
      }),
    );

    await createAnotherMe2ProblemVideoJob({
      imageObjectKey: 'uploads/problem.png',
      problemText: '证明三角形全等',
      userId: 'student-1',
      learnerSessionId: 'session-1',
      learnerLookbackDays: 30,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway.test/v1/jobs',
      expect.objectContaining({
        method: 'POST',
        cache: 'no-store',
      }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer gateway-token');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      job_type: 'problem_video_generate',
      user_id: 'student-1',
      payload: {
        image_object_key: 'uploads/problem.png',
        problem_text: '证明三角形全等',
        output_profile: '1080p',
        learner_user_id: 'student-1',
        learner_session_id: 'session-1',
        learner_lookback_days: 30,
      },
    });
  });

  it('maps message and AI endpoints without changing field names', async () => {
    const { listGatewayMessages } = await import('@/lib/server/anotherme2-gateway/messages');
    const { createGatewayAIMessageFeedback } = await import('@/lib/server/anotherme2-gateway/ai');
    fetchMock.mockResolvedValueOnce(jsonResponse([])).mockResolvedValueOnce(
      jsonResponse({
        feedback_id: 'feedback-1',
        message_id: 'message-1',
        user_id: 'student-1',
        rating: 'like',
        created_at: '2026-05-11T00:00:00',
      }),
    );

    await listGatewayMessages({
      conversationId: 'conversation-1',
      userId: 'student-1',
      limit: 20,
      beforeSeq: 9,
    });
    await createGatewayAIMessageFeedback({
      messageId: 'message-1',
      userId: 'student-1',
      rating: 'like',
      feedbackText: 'helpful',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://gateway.test/v1/messages/conversation-1/messages?user_id=student-1&limit=20&before_seq=9',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://gateway.test/v1/ai/messages/message-1/feedback',
    );
    const feedbackBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(feedbackBody).toEqual({
      user_id: 'student-1',
      rating: 'like',
      feedback_text: 'helpful',
    });
  });

  it('maps student knowledge endpoints with repeated knowledge point ids', async () => {
    const { getGatewayStudentKnowledgeStates } =
      await import('@/lib/server/anotherme2-gateway/learning');
    fetchMock.mockResolvedValueOnce(jsonResponse([]));

    await getGatewayStudentKnowledgeStates({
      userId: 'student/id',
      knowledgePointIds: ['kp-1', 'kp-2'],
      minMastery: 0.4,
      limit: 10,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://gateway.test/v1/users/student%2Fid/knowledge-states?knowledge_point_ids=kp-1&knowledge_point_ids=kp-2&min_mastery=0.4&limit=10',
    );
  });
});
