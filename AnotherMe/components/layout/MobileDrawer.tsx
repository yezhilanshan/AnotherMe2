'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils/cn';
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
  Menu,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth/components/auth-provider';

const navItems: Array<{
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
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

export function MobileDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { logout } = useAuth();

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-14 bg-[#F3F2EE] dark:bg-slate-950 border-b border-gray-200/50 dark:border-slate-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-gray-900 dark:text-gray-100">
          <div className="h-7 w-7 bg-black dark:bg-white rounded-lg flex items-center justify-center text-white dark:text-slate-900">
            <GraduationCap className="h-4 w-4" />
          </div>
          <span className="text-base font-bold tracking-wider uppercase">镜我</span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-800 transition-colors"
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5 text-gray-900 dark:text-gray-100" />
        </button>
      </div>

      {/* Drawer Overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer Panel */}
      <div
        className={cn(
          'md:hidden fixed top-0 right-0 bottom-0 z-50 w-[280px] bg-white dark:bg-slate-950 shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Drawer Header */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-gray-200/50 dark:border-slate-800">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">菜单</span>
          <button
            onClick={() => setOpen(false)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭菜单"
          >
            <X className="h-5 w-5 text-gray-900 dark:text-gray-100" />
          </button>
        </div>

        {/* Drawer Nav Items */}
        <div className="flex-1 overflow-auto py-3 px-3 flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                  isActive
                    ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium'
                    : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-900'
                )}
              >
                <item.icon
                  className={cn(
                    'h-5 w-5',
                    isActive
                      ? 'text-white dark:text-slate-900'
                      : 'text-gray-400 dark:text-slate-500'
                  )}
                />
                <span className="text-sm">{item.name}</span>
              </Link>
            );
          })}

          <div className="mt-4 pt-4 border-t border-gray-200/50 dark:border-slate-800 flex flex-col gap-1">
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200',
                pathname === '/settings'
                  ? 'bg-black dark:bg-white text-white dark:text-slate-900 font-medium'
                  : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-900'
              )}
            >
              <Settings
                className={cn(
                  'h-5 w-5',
                  pathname === '/settings'
                    ? 'text-white dark:text-slate-900'
                    : 'text-gray-400 dark:text-slate-500'
                )}
              />
              <span className="text-sm">系统设置</span>
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className="flex items-center gap-3 px-3 py-2.5 w-full text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-900 transition-colors text-sm rounded-xl"
            >
              <LogOut className="h-5 w-5 text-gray-400 dark:text-slate-500" />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
