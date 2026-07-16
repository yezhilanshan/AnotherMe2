/**
 * RAG 数据收集 Hook
 * 收集笔记、ClassroomBook、当前舞台等本地数据源
 */

import { useEffect, useState } from 'react';
import { readNotebookNotes } from '@/lib/notebook/storage';
import { useStageStore } from '@/lib/store';
import type { RAGDataSource } from '@/lib/types/tutor-tools';

/**
 * 收集 RAG 所需的所有本地数据
 * 注意：这个函数在客户端运行，访问 localStorage
 */
function collectCurrentStage(): RAGDataSource['currentStage'] {
  const stageState = useStageStore.getState();
  return stageState.stage
    ? {
        title: stageState.stage.name,
        description: stageState.stage.description,
        scenes: stageState.scenes.map((scene) => ({
          title: scene.title,
          content:
            typeof scene.content === 'object'
              ? JSON.stringify(scene.content).slice(0, 200)
              : String(scene.content || '').slice(0, 200),
        })),
      }
    : undefined;
}

export async function collectRAGDataSource(): Promise<RAGDataSource> {
  // 1. 收集笔记（从 IndexedDB）
  const notes = (await readNotebookNotes()).map((note) => ({
    id: note.id,
    title: note.title,
    content: note.content,
    tags: note.tags,
    subject: note.subject,
    source: note.source,
    createdAt: note.createdAt,
  }));

  // 注意：ClassroomBook 存储在服务器端，这里不收集
  // 如果需要，可以通过额外的 API 调用获取

  return {
    notes,
    currentStage: collectCurrentStage(),
  };
}

/**
 * React Hook: 使用 RAG 数据
 * 自动收集并缓存数据
 */
export function useRAGDataSource(): RAGDataSource {
  const [dataSource, setDataSource] = useState<RAGDataSource>(() => ({
    notes: [],
    currentStage: collectCurrentStage(),
  }));

  useEffect(() => {
    let active = true;
    void collectRAGDataSource().then((next) => {
      if (active) setDataSource(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return dataSource;
}
