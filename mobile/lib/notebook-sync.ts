import { WEB_URL, WEB_TUNNEL_HEADERS, USER_ID } from "./config";
import type { StudyNote } from "./study-notes";

const NOTEBOOK_ID = "default";
const SYNC_TIMEOUT = 8000;

interface SyncResult {
  ok: boolean;
  message: string;
}

/**
 * 将移动端笔记同步到 Web 端 notebook 系统。
 * 非阻塞：失败不影响移动端正常使用。
 */
export async function syncNoteToServer(note: StudyNote): Promise<SyncResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNC_TIMEOUT);

    // 将移动端笔记映射为 Web 端 notebook record 格式
    const body: Record<string, unknown> = {
      id: note.id,
      type: "manual",
      title: note.title,
      content: [
        `## 每日摘要`,
        note.dailySummary,
        "",
        `## 考前复习`,
        note.examReview,
        "",
        `## 知识点卡片`,
        ...note.cards.map(
          (card, i) =>
            `### ${i + 1}. ${card.title}\n${card.summary}\n` +
            (card.keyPoints.length
              ? `- 要点：${card.keyPoints.join("；")}\n`
              : "") +
            (card.formulas.length
              ? `- 公式：${card.formulas.join("；")}\n`
              : ""),
        ),
      ].join("\n"),
      summary: note.dailySummary,
      output: note.rawOutput,
      tags: note.cards
        .flatMap((card) => card.linkedKnowledgePoints)
        .slice(0, 10),
      subject: "综合",
      source: "mobile-notes",
      metadata: {
        imageUris: note.imageUris,
        imageUri: note.imageUri,
        manualText: note.manualText,
        cardCount: note.cards.length,
        bookId: note.bookId,
        bookTitle: note.bookTitle,
        bookStatus: note.bookStatus,
        syncedFrom: "mobile",
        syncedAt: new Date().toISOString(),
      },
    };

    const res = await fetch(
      `${WEB_URL}/api/notebooks/${NOTEBOOK_ID}/records?userId=${USER_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...WEB_TUNNEL_HEADERS,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    clearTimeout(timeoutId);

    if (res.ok) {
      return { ok: true, message: "同步成功" };
    }
    return { ok: false, message: `服务器返回 ${res.status}` };
  } catch (error) {
    // React Native (Hermes) 没有 DOMException；AbortError 是普通 Error，name 为 'AbortError'
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, message: "同步超时" };
    }
    return {
      ok: false,
      message: error instanceof Error ? error.message : "同步失败",
    };
  }
}

/**
 * 批量同步历史笔记（后台静默执行）
 */
export async function syncNotesToServer(
  notes: StudyNote[],
): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  for (const note of notes) {
    const result = await syncNoteToServer(note);
    if (result.ok) synced++;
    else failed++;
  }

  return { synced, failed };
}
