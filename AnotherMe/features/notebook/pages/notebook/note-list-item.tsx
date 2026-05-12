import { CheckSquare, Clock, Pin, Square, Star, Tag } from 'lucide-react';
import type { NotebookNote } from '@/lib/notebook/storage';
import { cn } from '@/lib/utils';
import type { ThemeOption } from './types';
import { formatRelativeTime, getNotePreview, getSubjectColor } from './utils';

interface NoteListItemProps {
  note: NotebookNote;
  isActive: boolean;
  theme: ThemeOption;
  onClick: () => void;
  onPin: (e?: React.MouseEvent) => void;
  onFavorite: (e?: React.MouseEvent) => void;
  isBatchMode?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
}

export function NoteListItem({
  note,
  isActive,
  theme,
  onClick,
  onPin,
  onFavorite,
  isBatchMode = false,
  isSelected = false,
  onSelect,
}: NoteListItemProps) {
  const preview = getNotePreview(note.content);
  const timeText = formatRelativeTime(note.updatedAt);
  const subjectColor = getSubjectColor(note.subject);

  return (
    <div
      className={cn(
        'group w-full rounded-xl border p-3 transition-all duration-200 relative',
        isActive
          ? theme.id === 'night'
            ? 'bg-[#263245] border-[#3a506e] shadow-sm'
            : 'bg-white border-[#c8bdb0] shadow-sm'
          : isSelected
            ? theme.id === 'night'
              ? 'bg-[#263245]/50 border-[#3a506e]/50'
              : 'bg-[#f5f2ed] border-[#c8bdb0]/50'
            : theme.id === 'night'
              ? 'border-transparent hover:bg-[#232d3c] hover:border-[#334156]'
              : 'border-transparent hover:bg-[#f5f2ed] hover:border-[#ddd6cb]',
      )}
    >
      {isBatchMode && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className="absolute left-2 top-1/2 z-10 -translate-y-1/2"
        >
          {isSelected ? (
            <CheckSquare
              className={cn('h-4 w-4', theme.id === 'night' ? 'text-[#5a7aaa]' : 'text-[#655e54]')}
            />
          ) : (
            <Square
              className={cn('h-4 w-4', theme.id === 'night' ? 'text-[#5a6d85]' : 'text-[#a0988c]')}
            />
          )}
        </button>
      )}

      <button
        type="button"
        onClick={isBatchMode ? onSelect : onClick}
        className={cn('w-full text-left', isBatchMode && 'pl-6')}
      >
        {note.isPinned && (
          <div className="absolute -top-1 -right-1">
            <Pin className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
          </div>
        )}

        <div className="flex items-start justify-between gap-2 mb-1.5">
          <h3
            className={cn(
              'text-[13px] font-semibold leading-tight truncate flex-1',
              isActive
                ? theme.id === 'night'
                  ? 'text-[#edf3ff]'
                  : 'text-[#1f1c18]'
                : theme.id === 'night'
                  ? 'text-[#c8d4e6]'
                  : 'text-[#3c342b]',
            )}
          >
            {note.title || '未命名文稿'}
          </h3>
          <div className="flex items-center gap-1">
            {note.isFavorite && <Star className="h-3 w-3 fill-amber-500 text-amber-500" />}
            <span
              className={cn(
                'shrink-0 inline-flex items-center px-1.5 py-px rounded text-[10px] font-medium',
                subjectColor,
              )}
            >
              {note.subject}
            </span>
          </div>
        </div>

        <p
          className={cn(
            'text-[11px] leading-relaxed truncate mb-2',
            theme.id === 'night' ? 'text-[#8ea2c2]' : 'text-[#8a8075]',
          )}
        >
          {preview}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3 opacity-50" />
            <span
              className={cn(
                'text-[10px]',
                theme.id === 'night' ? 'text-[#6b7d9a]' : 'text-[#a0988c]',
              )}
            >
              {timeText}
            </span>
          </div>

          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={onPin}
              className={cn(
                'p-1 rounded transition-colors',
                theme.id === 'night'
                  ? 'hover:bg-[#3a475b] text-[#8ea2c2]'
                  : 'hover:bg-[#e8e4dd] text-[#6b645a]',
              )}
              title={note.isPinned ? '取消置顶' : '置顶'}
            >
              <Pin className={cn('h-3 w-3', note.isPinned && 'fill-amber-500 text-amber-500')} />
            </button>
            <button
              type="button"
              onClick={onFavorite}
              className={cn(
                'p-1 rounded transition-colors',
                theme.id === 'night'
                  ? 'hover:bg-[#3a475b] text-[#8ea2c2]'
                  : 'hover:bg-[#e8e4dd] text-[#6b645a]',
              )}
              title={note.isFavorite ? '取消收藏' : '收藏'}
            >
              <Star className={cn('h-3 w-3', note.isFavorite && 'fill-amber-500 text-amber-500')} />
            </button>
          </div>

          {note.tags.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              <Tag className="h-3 w-3 opacity-40" />
              <span
                className={cn(
                  'text-[10px] truncate max-w-[60px]',
                  theme.id === 'night' ? 'text-[#6b7d9a]' : 'text-[#a0988c]',
                )}
              >
                {note.tags.slice(0, 2).join(', ')}
                {note.tags.length > 2 && ` +${note.tags.length - 2}`}
              </span>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}
