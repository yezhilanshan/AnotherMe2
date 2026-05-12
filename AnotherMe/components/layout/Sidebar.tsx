'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  BookOpen,
  Camera,
  NotebookPen,
  Settings,
  LogOut,
  GraduationCap,
  BarChart2,
  Headphones,
  MessageSquare,
  Library,
  Stethoscope,
  BookText,
} from 'lucide-react';
import Image from 'next/image';
import { useAuth } from '@/features/auth/components/auth-provider';
import { useMemo, useState } from 'react';

const navItems: Array<{
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}> = [
  { name: '学习概览', href: '/', icon: LayoutDashboard },
  { name: '活书引擎', href: '/live-book', icon: BookText },
  { name: '创建课堂', href: '/create-class', icon: BookOpen },
  { name: '我的课程', href: '/classes', icon: Library },
  { name: '拍题答疑', href: '/photo-to-video', icon: Camera },
  { name: '笔记本', href: '/notebook', icon: NotebookPen },
  { name: '诊断练习', href: '/diagnostic', icon: Stethoscope },
  { name: 'AI 导师', href: '/ai-tutor', icon: Headphones },
  { name: '消息中心', href: '/messages', icon: MessageSquare },
  { name: '数据统计', href: '/statistics', icon: BarChart2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  const avatarSeed = useMemo(() => {
    if (user?.id) return user.id;
    return 'user';
  }, [user?.id]);

  const displayName = user?.displayName || '访客';
  const email = user?.email || '';

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/login');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col h-mobile-screen sticky top-0 border-r border-gray-200/50 dark:border-slate-800">
      <div className="h-24 flex items-center px-8">
        <div className="flex items-center gap-3 text-gray-900 dark:text-gray-100">
          <div className="h-8 w-8 bg-black dark:bg-white rounded-lg flex items-center justify-center text-white dark:text-slate-900">
            <GraduationCap className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-wider uppercase">镜我</span>
        </div>
      </div>

      <div className="flex-1 py-4 px-6 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group',
                isActive
                  ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium shadow-md'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100'
              )}
            >
              <div className="flex items-center gap-4">
                <item.icon
                  className={cn(
                    'h-5 w-5 transition-colors',
                    isActive
                      ? 'text-white dark:text-slate-900'
                      : 'text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200'
                  )}
                />
                <span className="text-sm">{item.name}</span>
              </div>
              {item.badge && (
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#88DBCB] text-teal-900 rounded-md">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        <div className="mt-8 flex flex-col gap-1">
          <Link
            href="/settings"
            className={cn(
              'flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group',
              pathname === '/settings'
                ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium shadow-md'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100'
            )}
          >
            <div className="flex items-center gap-4">
              <Settings
                className={cn(
                  'h-5 w-5 transition-colors',
                  pathname === '/settings'
                    ? 'text-white dark:text-slate-900'
                    : 'text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200'
                )}
              />
              <span className="text-sm">系统设置</span>
            </div>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex items-center gap-4 px-4 py-3 w-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 transition-colors group text-sm disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <LogOut className="h-5 w-5 text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200" />
            <span>{loggingOut ? '退出中...' : '退出登录'}</span>
          </button>
        </div>
      </div>

      <div className="p-8 flex flex-col items-center justify-center text-center">
        <div className="h-12 w-12 rounded-full overflow-hidden mb-3 bg-gray-200">
          <Image
            src={`https://picsum.photos/seed/${encodeURIComponent(avatarSeed)}/100/100`}
            alt="User"
            width={48}
            height={48}
            loading="eager"
            referrerPolicy="no-referrer"
          />
        </div>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {loading ? '加载中...' : displayName}
        </p>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
          {loading ? '' : email}
        </p>
      </div>
    </aside>
  );
}
