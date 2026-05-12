'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, ChevronDown, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  listNotebooks,
  createNotebook,
  setActiveNotebookId,
  getActiveNotebookId,
  type Notebook,
} from '@/lib/notebook/storage';

interface NotebookSelectorProps {
  value?: string;
  onChange?: (notebookId: string) => void;
  className?: string;
  showCreate?: boolean;
}

export function NotebookSelector({ value, onChange, className, showCreate = true }: NotebookSelectorProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedId, setSelectedId] = useState<string>(value || getActiveNotebookId() || '');
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newNotebookName, setNewNotebookName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 加载笔记本列表
  useEffect(() => {
    setNotebooks(listNotebooks());
  }, []);

  // 同步外部 value
  useEffect(() => {
    if (value !== undefined) {
      setSelectedId(value);
    }
  }, [value]);

  // 点击外部关闭
  useEffect(() => {
    function handleClickOutside(event: PointerEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const selectedNotebook = notebooks.find((nb) => nb.id === selectedId);

  const handleSelect = (notebookId: string) => {
    setSelectedId(notebookId);
    setActiveNotebookId(notebookId);
    onChange?.(notebookId);
    setIsOpen(false);
  };

  const handleCreateNotebook = () => {
    if (!newNotebookName.trim()) return;
    const notebook = createNotebook(newNotebookName.trim());
    setNotebooks((prev) => [...prev, notebook]);
    handleSelect(notebook.id);
    setShowCreateForm(false);
    setNewNotebookName('');
  };

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* 触发按钮 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-xl border',
          'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
          'text-gray-900 dark:text-gray-100 text-sm',
          'hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/20'
        )}
      >
        {selectedNotebook ? (
          <>
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center"
              style={{ backgroundColor: selectedNotebook.color }}
            >
              <BookOpen className="w-3 h-3 text-white" />
            </div>
            <span className="flex-1 text-left truncate">{selectedNotebook.name}</span>
          </>
        ) : (
          <>
            <BookOpen className="w-4 h-4 text-gray-400" />
            <span className="flex-1 text-left text-gray-500">选择笔记本...</span>
          </>
        )}
        <ChevronDown
          className={cn('w-4 h-4 text-gray-400 transition-transform', isOpen && 'rotate-180')}
        />
      </button>

      {/* 下拉菜单 */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className={cn(
              'absolute z-50 w-full mt-1 py-1 rounded-xl border',
              'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800',
              'shadow-lg max-h-64 overflow-y-auto'
            )}
          >
            {notebooks.map((notebook) => (
              <button
                key={notebook.id}
                onClick={() => handleSelect(notebook.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                  selectedId === notebook.id
                    ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
              >
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                  style={{ backgroundColor: notebook.color }}
                >
                  <BookOpen className="w-3 h-3 text-white" />
                </div>
                <span className="flex-1 text-left truncate">{notebook.name}</span>
                <span className="text-xs text-gray-400">{notebook.recordCount}</span>
                {selectedId === notebook.id && <Check className="w-4 h-4 text-blue-500" />}
              </button>
            ))}

            {/* 创建新笔记本 */}
            {showCreate && (
              <>
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                {showCreateForm ? (
                  <div className="px-3 py-2 space-y-2">
                    <input
                      type="text"
                      value={newNotebookName}
                      onChange={(e) => setNewNotebookName(e.target.value)}
                      placeholder="新笔记本名称..."
                      className={cn(
                        'w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700',
                        'bg-gray-50 dark:bg-gray-900 text-sm',
                        'focus:outline-none focus:ring-2 focus:ring-blue-500/20'
                      )}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateNotebook();
                        if (e.key === 'Escape') {
                          setShowCreateForm(false);
                          setNewNotebookName('');
                        }
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowCreateForm(false);
                          setNewNotebookName('');
                        }}
                        className="flex-1 px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleCreateNotebook}
                        disabled={!newNotebookName.trim()}
                        className="flex-1 px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors"
                      >
                        创建
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-sm',
                      'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700',
                      'transition-colors'
                    )}
                  >
                    <Plus className="w-4 h-4" />
                    创建新笔记本
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}