import { NextRequest } from 'next/server';
import { handleCreatePhotoManimPost } from '@/features/photo-manim/server/services/create-job';

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  return handleCreatePhotoManimPost(request);
}
