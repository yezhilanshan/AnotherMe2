'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Clock3,
  FlaskConical,
  HelpCircle,
  Layers3,
  Loader2,
  PlayCircle,
  Presentation,
  Search,
  Sparkles,
} from 'lucide-react';

interface ClassroomSummary {
  id: string;
  title: string;
  createdAt: string;
  scenesCount: number;
  sceneTypes?: Array<'slide' | 'quiz' | 'interactive' | 'pbl' | 'live_book_page'>;
}

interface ClassroomListResponse {
  success: boolean;
  classrooms?: ClassroomSummary[];
  error?: string;
}

function formatDate(dateText: string) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString();
}

const sceneTypeMeta = {
  slide: { label: '课件', icon: BookOpen },
  quiz: { label: '测验', icon: HelpCircle },
  interactive: { label: '互动实验', icon: FlaskConical },
  pbl: { label: '项目探究', icon: Sparkles },
  live_book_page: { label: '活书', icon: BookOpen },
};

export default function InteractiveClassPage() {
  const router = useRouter();

  const [classrooms, setClassrooms] = useState<ClassroomSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const response = await fetch('/api/classroom?limit=50', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as ClassroomListResponse;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || '加载课堂失败。');
        }

        const list = payload.classrooms || [];
        if (cancelled) return;

        setClassrooms(list);

        let queryClassroomId = '';
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          queryClassroomId = params.get('classroomId') || '';
        }

        const resolvedId =
          list.find((item) => item.id === queryClassroomId)?.id || list[0]?.id || queryClassroomId;

        if (resolvedId) {
          setSelectedId(resolvedId);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorText(error instanceof Error ? error.message : '互动课堂加载失败。');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedClassroom = useMemo(() => {
    return classrooms.find((room) => room.id === selectedId) || null;
  }, [classrooms, selectedId]);

  const filteredClassrooms = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return classrooms;
    return classrooms.filter((room) => {
      const typeText = (room.sceneTypes || [])
        .map((type) => sceneTypeMeta[type]?.label || type)
        .join(' ');
      return `${room.title} ${room.id} ${typeText}`.toLowerCase().includes(keyword);
    });
  }, [classrooms, query]);

  const featuredClassroom = selectedClassroom || filteredClassrooms[0] || classrooms[0] || null;

  const handleLaunch = () => {
    const target = selectedClassroom || featuredClassroom;
    if (!target) return;
    router.push(`/classroom/${encodeURIComponent(target.id)}`);
  };

  if (loading) {
    return (
      <div className="h-[50vh] flex items-center justify-center text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        正在加载互动课堂...
      </div>
    );
  }

  if (errorText) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3">{errorText}</div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6">
      <section className="grid gap-5 lg:grid-cols-[1.15fr,0.85fr]">
        <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/80 shadow-[0_24px_80px_rgba(48,35,20,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
          <div className="grid min-h-[320px] gap-0 md:grid-cols-[1fr,300px]">
            <div className="flex flex-col justify-between p-6 md:p-8">
              <div>
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                  <Presentation className="h-3.5 w-3.5" />
                  最近课堂
                </div>
                <h1 className="max-w-2xl text-3xl font-black tracking-tight text-gray-950 dark:text-gray-50 md:text-5xl">
                  {featuredClassroom?.title || '互动课堂'}
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-7 text-gray-600 dark:text-gray-300">
                  从课程库继续上课，课件、测验、互动实验和 AI 圆桌讨论会一起进入课堂播放台。
                </p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleLaunch}
                  disabled={!featuredClassroom}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-gray-950 px-5 text-sm font-semibold text-white shadow-lg shadow-gray-950/15 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
                >
                  <PlayCircle className="h-4 w-4" />
                  继续上课
                  <ArrowRight className="h-4 w-4" />
                </button>
                {featuredClassroom && (
                  <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                    <span className="inline-flex items-center gap-1.5">
                      <Layers3 className="h-3.5 w-3.5" />
                      {featuredClassroom.scenesCount} 个场景
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      {formatDate(featuredClassroom.createdAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="relative hidden border-l border-gray-200/60 bg-[linear-gradient(160deg,#fff7ed,#f4f7ff)] p-5 dark:border-white/10 dark:bg-[linear-gradient(160deg,#1f2937,#111827)] md:block">
              <div className="absolute inset-5 rounded-2xl border border-white/80 bg-white/55 shadow-inner dark:border-white/10 dark:bg-white/5" />
              <div className="relative flex h-full flex-col justify-between">
                <div className="space-y-3">
                  {(featuredClassroom?.sceneTypes || ['slide', 'interactive', 'quiz']).map(
                    (type, index) => {
                      const meta = sceneTypeMeta[type] || sceneTypeMeta.slide;
                      const Icon = meta.icon;
                      return (
                        <div
                          key={`${type}-${index}`}
                          className="flex items-center gap-3 rounded-2xl border border-white/70 bg-white/80 p-3 shadow-sm dark:border-white/10 dark:bg-slate-900/80"
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-950 text-white dark:bg-white dark:text-gray-950">
                            <Icon className="h-4 w-4" />
                          </span>
                          <div>
                            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {meta.label}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              第 {index + 1} 类学习活动
                            </div>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
                <div className="rounded-2xl bg-gray-950 p-4 text-white shadow-xl dark:bg-white dark:text-gray-950">
                  <div className="text-[11px] font-bold uppercase tracking-widest opacity-60">
                    Classroom ID
                  </div>
                  <div className="mt-2 break-all font-mono text-xs">
                    {featuredClassroom?.id || '-'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/70 bg-white/75 p-5 shadow-[0_24px_80px_rgba(48,35,20,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-gray-950 dark:text-gray-50">课程库</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {classrooms.length} 个已生成课堂
              </p>
            </div>
            <div className="relative w-44 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索课堂"
                className="h-10 w-full rounded-full border border-gray-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-gray-400 dark:border-white/10 dark:bg-slate-900"
              />
            </div>
          </div>

          <div className="mt-5 grid max-h-[268px] gap-3 overflow-y-auto pr-1">
            {filteredClassrooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
                没有匹配的课堂。
              </div>
            ) : (
              filteredClassrooms.slice(0, 8).map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedId(room.id)}
                  className={`group flex items-center gap-3 rounded-2xl border p-3 text-left transition ${
                    (selectedId || featuredClassroom?.id) === room.id
                      ? 'border-gray-950 bg-gray-950 text-white shadow-lg shadow-gray-950/10 dark:border-white dark:bg-white dark:text-gray-950'
                      : 'border-gray-200 bg-white/70 hover:border-gray-300 hover:bg-white dark:border-white/10 dark:bg-slate-900/70 dark:hover:bg-slate-900'
                  }`}
                >
                  <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-100 to-sky-100 text-gray-800 ring-1 ring-black/5 dark:from-amber-500/20 dark:to-sky-500/20 dark:text-gray-100">
                    <BookOpen className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold">{room.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs opacity-70">
                      <span>{room.scenesCount} 场景</span>
                      <span>{formatDate(room.createdAt)}</span>
                    </span>
                  </span>
                  <ArrowRight className="h-4 w-4 opacity-40 transition group-hover:translate-x-0.5 group-hover:opacity-80" />
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {['画布优先', 'AI 圆桌', '实时笔记', '互动实验'].map((label, index) => (
          <div
            key={label}
            className="rounded-2xl border border-white/70 bg-white/65 p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/60"
          >
            <div className="text-xs font-bold text-gray-500 dark:text-gray-400">0{index + 1}</div>
            <div className="mt-2 text-sm font-black text-gray-950 dark:text-gray-50">{label}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
