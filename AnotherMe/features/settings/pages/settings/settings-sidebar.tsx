'use client';

import { ChevronRight, Server, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { sectionDescriptions, sectionIcons, sectionLabels } from './constants';
import type { HealthResponse, SettingsSection } from './types';

export function SettingsSidebar({
  activeSection,
  onSectionChange,
  health,
  providerCount,
}: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  health: HealthResponse | null;
  providerCount: number;
}) {
  return (
    <div className="w-full shrink-0 border-b border-border bg-gradient-to-b from-gray-50/80 to-gray-100/50 p-3 dark:from-slate-950 dark:to-slate-900 md:w-80 md:border-b-0 md:border-r md:p-6">
      <div className="mb-2 px-2 md:mb-6">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:mb-4">
          设置分类
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 scroll-touch md:block md:space-y-2 md:overflow-visible md:pb-0">
        {(['profile', 'ai', 'notifications', 'appearance'] as const).map((section, index) => {
          const Icon = sectionIcons[section];
          const active = activeSection === section;
          return (
            <motion.button
              key={section}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              type="button"
              onClick={() => onSectionChange(section)}
              className={cn(
                'flex min-w-[150px] items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-300 group md:w-full md:min-w-0 md:px-4 md:py-3.5',
                active
                  ? 'bg-foreground text-background shadow-lg shadow-gray-900/25 dark:bg-white dark:text-slate-900 dark:shadow-white/10'
                  : 'text-gray-600 hover:bg-muted/50 dark:text-slate-400 dark:hover:bg-slate-800/50 hover:text-gray-900 dark:hover:text-slate-200',
              )}
            >
              <div
                className={cn(
                  'p-2 rounded-xl transition-all duration-300',
                  active
                    ? 'bg-white/20 dark:bg-slate-900/20'
                    : 'bg-muted/50 dark:bg-slate-800/50 group-hover:bg-gray-300/50 dark:group-hover:bg-slate-700/50',
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="font-semibold">{sectionLabels[section]}</div>
                <div
                  className={cn(
                    'hidden text-xs transition-all duration-300 md:block',
                    active
                      ? 'text-white/70 dark:text-slate-700'
                      : 'text-gray-400 dark:text-slate-500',
                  )}
                >
                  {sectionDescriptions[section]}
                </div>
              </div>
              <ChevronRight
                className={cn(
                  'h-4 w-4 transition-all duration-300',
                  active ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2',
                )}
              />
            </motion.button>
          );
        })}
      </div>

      <div className="mt-4 hidden border-t border-gray-200 px-2 pt-6 dark:border-slate-800 md:block">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          系统状态
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Server className="h-3.5 w-3.5" />
              后端状态
            </span>
            <span
              className={cn(
                'flex items-center gap-1.5 font-medium',
                health?.status === 'ok'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-amber-600 dark:text-amber-400',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  health?.status === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-amber-500',
                )}
              />
              {health?.status === 'ok' ? '正常' : '异常'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" />
              模型提供商
            </span>
            <span className="font-medium text-foreground">{providerCount} 个</span>
          </div>
        </div>
      </div>
    </div>
  );
}
