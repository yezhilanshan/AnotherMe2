import { X } from 'lucide-react';
import { NOTE_TEMPLATES } from '@/lib/notebook/storage';
import { cn } from '@/lib/utils';
import type { ThemeOption } from './types';

interface TemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (templateId: string) => void;
  theme: ThemeOption;
}

export function TemplateSelector({ isOpen, onClose, onSelect, theme }: TemplateSelectorProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-md rounded-2xl border p-6 shadow-xl',
          theme.id === 'night' ? 'bg-[#1a212c] border-[#3a475b]' : 'bg-white border-[#d8d1c6]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className={cn(
              'text-lg font-semibold',
              theme.id === 'night' ? 'text-[#dce6f6]' : 'text-[#3c342b]',
            )}
          >
            选择笔记模板
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'p-1 rounded transition-colors',
              theme.id === 'night'
                ? 'text-[#8ea2c2] hover:bg-[#3a475b]'
                : 'text-[#6b645a] hover:bg-[#e8e4dd]',
            )}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {NOTE_TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border transition-all',
                theme.id === 'night'
                  ? 'border-[#3a475b] hover:border-[#5a7aaa] hover:bg-[#232d3c]'
                  : 'border-[#e8e4dd] hover:border-[#a89b8a] hover:bg-[#f5f2ed]',
              )}
            >
              <span className="text-3xl">{template.icon}</span>
              <span
                className={cn(
                  'text-sm font-medium',
                  theme.id === 'night' ? 'text-[#dce6f6]' : 'text-[#3c342b]',
                )}
              >
                {template.name}
              </span>
            </button>
          ))}
        </div>

        <p
          className={cn(
            'mt-4 text-xs text-center',
            theme.id === 'night' ? 'text-[#6b7d9a]' : 'text-[#8a8075]',
          )}
        >
          选择合适的模板开始记录你的想法
        </p>
      </div>
    </div>
  );
}
