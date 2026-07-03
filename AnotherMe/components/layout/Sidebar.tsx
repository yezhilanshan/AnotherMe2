'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  BookOpen,
  Camera,
  PenLine,
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
  { name: '协作写作', href: '/co-writer', icon: PenLine, badge: 'NEW' },
  { name: '诊断练习', href: '/diagnostic', icon: Stethoscope },
  { name: 'AI 导师', href: '/ai-tutor', icon: Headphones },
  { name: '消息中心', href: '/messages', icon: MessageSquare },
  { name: '数据统计', href: '/statistics', icon: BarChart2 },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
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
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col h-mobile-screen border-r border-gray-200/50 dark:border-slate-800 transition-all duration-300 ease-in-out',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {/* Logo Area — click to toggle sidebar */}
      <button
        type="button"
        onClick={onToggle}
        className="h-24 shrink-0 w-full flex items-center justify-center gap-3 px-4 hover:bg-gray-100/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer overflow-hidden select-none text-gray-900 dark:text-gray-100"
        aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
      >
        <div className="h-8 w-8 shrink-0 bg-black dark:bg-white rounded-lg flex items-center justify-center text-white dark:text-slate-900 transition-transform duration-300">
          <GraduationCap className="h-5 w-5" />
        </div>
        <span
          className={cn(
            'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out text-lg font-bold tracking-wider uppercase',
            collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100',
          )}
          aria-hidden={collapsed}
        >
          镜我
        </span>
      </button>

      {/* Nav Items */}
      <nav className="flex-1 py-4 px-3 flex flex-col gap-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              title={collapsed ? item.name : undefined}
              className={cn(
                'flex items-center rounded-xl transition-all duration-300 ease-in-out group overflow-hidden',
                collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 gap-4',
                isActive
                  ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium shadow-md'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100',
              )}
            >
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-colors duration-300',
                  isActive
                    ? 'text-white dark:text-slate-900'
                    : 'text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200',
                )}
              />
              <span
                className={cn(
                  'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out text-sm flex-1',
                  collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100',
                )}
                aria-hidden={collapsed}
              >
                {item.name}
              </span>
              {item.badge && (
                <span
                  className={cn(
                    'shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-[#88DBCB] text-teal-900 rounded-md transition-all duration-300 ease-in-out',
                    collapsed ? 'w-0 opacity-0 overflow-hidden p-0' : 'w-auto opacity-100',
                  )}
                  aria-hidden={collapsed}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}

        {/* Settings & Logout */}
        <div className="mt-8 flex flex-col gap-1">
          <Link
            href="/settings"
            title={collapsed ? '系统设置' : undefined}
            className={cn(
              'flex items-center rounded-xl transition-all duration-300 ease-in-out group overflow-hidden',
              collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 gap-4',
              pathname === '/settings'
                ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium shadow-md'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100',
            )}
          >
            <Settings
              className={cn(
                'h-5 w-5 shrink-0 transition-colors duration-300',
                pathname === '/settings'
                  ? 'text-white dark:text-slate-900'
                  : 'text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200',
              )}
            />
            <span
              className={cn(
                'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out text-sm',
                collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100',
              )}
              aria-hidden={collapsed}
            >
              系统设置
            </span>
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            title={collapsed ? (loggingOut ? '退出中...' : '退出登录') : undefined}
            className={cn(
              'flex items-center w-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 transition-all duration-300 ease-in-out group text-sm disabled:opacity-60 disabled:cursor-not-allowed rounded-xl overflow-hidden',
              collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3 gap-4',
            )}
          >
            <LogOut className="h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500 group-hover:text-gray-700 dark:group-hover:text-slate-200 transition-colors duration-300" />
            <span
              className={cn(
                'overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out',
                collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100',
              )}
              aria-hidden={collapsed}
            >
              {loggingOut ? '退出中...' : '退出登录'}
            </span>
          </button>
        </div>
      </nav>

      {/* User Profile Footer */}
      <div className="p-4 flex flex-col items-center justify-center text-center shrink-0 overflow-hidden">
        <div className="h-12 w-12 rounded-full overflow-hidden mb-3 bg-gray-200 shrink-0">
          <Image
            src={`https://picsum.photos/seed/${encodeURIComponent(avatarSeed)}/100/100`}
            alt="User"
            width={48}
            height={48}
            loading="eager"
            referrerPolicy="no-referrer"
          />
        </div>
        <div
          className={cn(
            'overflow-hidden transition-all duration-300 ease-in-out',
            collapsed ? 'max-h-0 opacity-0' : 'max-h-20 opacity-100',
          )}
        >
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap">
            {loading ? '加载中...' : displayName}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 whitespace-nowrap">
            {loading ? '' : email}
          </p>
        </div>
      </div>
    </aside>
  );
}
