import { NextRequest } from 'next/server';
import { handleCreateProblemVideoPost } from '@/features/problem-video/server/services/create-job';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return handleCreateProblemVideoPost(request);
}
