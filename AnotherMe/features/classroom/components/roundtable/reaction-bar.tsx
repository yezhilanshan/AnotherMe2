'use client';

import { useCallback } from 'react';
import type { UserReaction } from '@/lib/types/chat';

interface ReactionBarProps {
  onReaction: (type: UserReaction['type']) => void;
  disabled?: boolean;
}

const REACTIONS: Array<{ type: UserReaction['type']; label: string; icon: string }> = [
  { type: 'confused', label: '听不懂', icon: '?' },
  { type: 'too_fast', label: '太快了', icon: '>>' },
  { type: 'agree', label: '认同', icon: '+' },
  { type: 'want_example', label: '举个例子', icon: 'E' },
  { type: 'boring', label: '太无聊', icon: '...' },
];

export function ReactionBar({ onReaction, disabled }: ReactionBarProps) {
  const handleClick = useCallback(
    (type: UserReaction['type']) => {
      if (!disabled) {
        onReaction(type);
      }
    },
    [onReaction, disabled],
  );

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        padding: '6px 10px',
        borderRadius: '20px',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        alignItems: 'center',
      }}
    >
      {REACTIONS.map((r) => (
        <button
          key={r.type}
          onClick={() => handleClick(r.type)}
          disabled={disabled}
          title={r.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: '4px 8px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            background: 'rgba(255, 255, 255, 0.1)',
            color: '#fff',
            fontSize: '12px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.5 : 1,
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            if (!disabled) {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.25)';
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255, 255, 255, 0.1)';
          }}
        >
          <span style={{ fontWeight: 600 }}>{r.icon}</span>
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );
}
