export interface RecentVideoItem {
  id: string;
  title: string;
  date: string;
  duration: string;
  videoUrl?: string;
  status: 'succeeded' | 'failed';
  subject?: '数学';
  createdAt?: string;
}

const STORAGE_KEY = 'anotherme:dashboard:recent-problem-videos:v1';
const LATEST_LOCAL_VIDEO_URL = '/videos/final_from_template_with_audio_custom_raw.mp4';
const LATEST_LOCAL_VIDEO_TITLE = '菱形折叠坐标法讲解（最新）';
const LATEST_LOCAL_VIDEO_ID = 'latest-local-problem-video';

export function formatProblemVideoDuration(durationSec?: number) {
  if (!durationSec || durationSec <= 0) return '--';
  const total = Math.round(durationSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatProblemVideoDateLabel(date: Date) {
  const now = new Date();
  const sameDay =
    now.getFullYear() === date.getFullYear() &&
    now.getMonth() === date.getMonth() &&
    now.getDate() === date.getDate();
  if (sameDay) {
    return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function buildLatestLocalVideoItem(): RecentVideoItem {
  return {
    id: LATEST_LOCAL_VIDEO_ID,
    title: LATEST_LOCAL_VIDEO_TITLE,
    date: formatProblemVideoDateLabel(new Date()),
    duration: '01:54',
    videoUrl: LATEST_LOCAL_VIDEO_URL,
    status: 'succeeded',
    subject: '数学',
    createdAt: new Date().toISOString(),
  };
}

export function readRecentProblemVideos(): RecentVideoItem[] {
  const latestVideo = buildLatestLocalVideoItem();
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [latestVideo];
    const parsed = JSON.parse(raw) as RecentVideoItem[];
    if (!Array.isArray(parsed)) return [latestVideo];
    const normalized = parsed.map((item) => ({
      ...item,
      subject: '数学' as const,
      createdAt: item.createdAt || new Date().toISOString(),
    }));
    const withoutDuplicate = normalized.filter(
      (item) => item.id !== LATEST_LOCAL_VIDEO_ID && item.videoUrl !== LATEST_LOCAL_VIDEO_URL,
    );
    return [latestVideo, ...withoutDuplicate].slice(0, 12);
  } catch {
    return [latestVideo];
  }
}

export function saveRecentProblemVideos(items: RecentVideoItem[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 12)));
}
