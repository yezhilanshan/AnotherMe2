import { callLLM } from '@/lib/ai/llm';
import { createLogger } from '@/lib/logger';
import type { NotebookNoteType } from './storage';

const log = createLogger('Notebook:Summarize');

// 摘要提示词模板（参考 AnotherMe）
const SUMMARY_PROMPT_TEMPLATE = `请为以下笔记内容生成一个简洁的摘要（不超过100字）。

笔记类型：{type}
笔记标题：{title}

笔记内容：
{content}

请生成一个简洁明了的中文摘要，突出核心要点：`;

const SUMMARY_PROMPT_TEMPLATE_EN = `Please generate a concise summary (max 100 words) for the following note.

Note type: {type}
Note title: {title}

Note content:
{content}

Please generate a clear and concise summary highlighting the key points:`;

export interface SummarizeOptions {
  title: string;
  content: string;
  type: NotebookNoteType;
  language?: 'zh' | 'en' | 'auto';
  maxLength?: number;
}

/**
 * 为笔记内容生成 AI 摘要
 * 参考 AnotherMe 的 summarize_agent.py
 */
export async function generateNoteSummary(options: SummarizeOptions): Promise<string> {
  const { title, content, type, language = 'auto', maxLength = 100 } = options;

  try {
    // 检测语言
    const isChinese = language === 'zh' || (language === 'auto' && /[\u4e00-\u9fa5]/.test(title + content));

    // 截取内容（避免过长）
    const truncatedContent = content.length > 2000 ? content.slice(0, 2000) + '...' : content;

    const prompt = isChinese
      ? SUMMARY_PROMPT_TEMPLATE
          .replace('{type}', getTypeLabel(type))
          .replace('{title}', title)
          .replace('{content}', truncatedContent)
      : SUMMARY_PROMPT_TEMPLATE_EN
          .replace('{type}', type)
          .replace('{title}', title)
          .replace('{content}', truncatedContent);

    log.info(`Generating summary for note: ${title}`);

    const result = await callLLM(
      {
        model: process.env.NOTEBOOK_SUMMARY_MODEL || 'gpt-4o-mini',
        prompt,
        maxOutputTokens: 150,
        temperature: 0.3,
      },
      'notebook-summary',
      { retries: 1 },
    );

    let summary = result.text.trim();

    // 限制长度
    if (summary.length > maxLength) {
      summary = summary.slice(0, maxLength) + '...';
    }

    log.info(`Summary generated: ${summary.slice(0, 50)}...`);
    return summary;
  } catch (error) {
    log.error('Failed to generate summary:', error);
    // 失败时返回空字符串，不阻塞主流程
    return '';
  }
}

/**
 * 批量生成摘要
 */
export async function batchGenerateSummaries(
  notes: Array<{ id: string; title: string; content: string; type: NotebookNoteType }>,
  onProgress?: (completed: number, total: number) => void
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const total = notes.length;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    try {
      const summary = await generateNoteSummary({
        title: note.title,
        content: note.content,
        type: note.type,
      });
      results.set(note.id, summary);
      onProgress?.(i + 1, total);
    } catch (error) {
      log.error(`Failed to generate summary for note ${note.id}:`, error);
      results.set(note.id, '');
    }
  }

  return results;
}

function getTypeLabel(type: NotebookNoteType): string {
  const labels: Record<NotebookNoteType, string> = {
    manual: '手动笔记',
    chat: '聊天记录',
    solve: '解题记录',
    research: '研究记录',
    classroom: '课堂笔记',
    quiz: '测验记录',
  };
  return labels[type] || '笔记';
}

/**
 * 为聊天内容生成标题
 * 参考 AnotherMe 的 auto_title 功能
 */
export async function generateChatNoteTitle(messages: Array<{ role: string; content: string }>): Promise<string> {
  try {
    const userMessages = messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');

    if (!userMessages.trim()) {
      return `对话记录 ${new Date().toLocaleDateString('zh-CN')}`;
    }

    const prompt = `请为以下对话生成一个简短的标题（不超过20字），直接返回标题文本：

对话内容：
${userMessages.slice(0, 500)}`;

    const result = await callLLM(
      {
        model: process.env.NOTEBOOK_SUMMARY_MODEL || 'gpt-4o-mini',
        prompt,
        maxOutputTokens: 50,
        temperature: 0.3,
      },
      'notebook-chat-title',
      { retries: 1 },
    );

    const title = result.text.trim().replace(/["""''']/g, '');
    return title || `对话记录 ${new Date().toLocaleDateString('zh-CN')}`;
  } catch (error) {
    log.error('Failed to generate chat title:', error);
    return `对话记录 ${new Date().toLocaleDateString('zh-CN')}`;
  }
}