'use client';

import { useEffect, useRef } from 'react';

export interface MobileMenuItem {
  readonly text: string;
  readonly icon?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly handler?: () => void;
}

export interface MobileMenuGroup {
  readonly title?: string;
  readonly items: MobileMenuItem[];
}

interface MobileContextMenuProps {
  readonly visible: boolean;
  readonly groups: MobileMenuGroup[];
  readonly onClose: () => void;
}

/**
 * MobileContextMenu - ActionSheet-style bottom panel for mobile context menu.
 *
 * Provides touch-friendly operations: copy, paste, delete, align, layer order, lock.
 * Slides up from the bottom with a smooth animation.
 */
export function MobileContextMenu({ visible, groups, onClose }: MobileContextMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Close on escape key (for testing on desktop)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && visible) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, onClose]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className="mobile-context-menu fixed inset-0 z-50 flex items-end justify-center"
      onClick={handleBackdropClick}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)' }}
    >
      <div
        ref={panelRef}
        className="mobile-context-menu-panel w-full max-w-lg rounded-t-2xl bg-white shadow-2xl"
        style={{
          animation: 'slideUp 0.25s ease-out',
          maxHeight: '70vh',
          overflowY: 'auto',
          paddingBottom: 'env(safe-area-inset-bottom, 16px)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag indicator */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Menu groups */}
        {groups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.title && (
              <div className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wider">
                {group.title}
              </div>
            )}
            <div className="px-2 py-1">
              {group.items.map((item, itemIndex) => (
                <button
                  key={itemIndex}
                  className={`w-full flex items-center justify-between px-4 py-3 text-base rounded-lg transition-colors ${
                    item.disabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : item.danger
                        ? 'text-red-500 active:bg-red-50'
                        : 'text-gray-700 active:bg-gray-100'
                  }`}
                  disabled={item.disabled}
                  onClick={() => {
                    item.handler?.();
                    onClose();
                  }}
                >
                  <span className="flex items-center gap-3">
                    {item.icon && <span className="text-lg w-6 text-center">{item.icon}</span>}
                    {item.text}
                  </span>
                </button>
              ))}
            </div>
            {groupIndex < groups.length - 1 && (
              <div className="mx-4 border-t border-gray-100" />
            )}
          </div>
        ))}

        {/* Cancel button */}
        <div className="px-2 pt-1 pb-2">
          <button
            className="w-full py-3 text-base font-medium text-gray-500 rounded-lg active:bg-gray-100 transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Inline keyframe animation */}
      <style>{`
        @keyframes slideUp {
          from {
            transform: translateY(100%);
          }
          to {
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
