export type TutorSemanticBlockType =
  | 'hint'
  | 'steps'
  | 'knowledge_card'
  | 'mistake'
  | 'quiz'
  | 'learning_state';

export type TutorResponseBlock =
  | {
      type: 'markdown';
      content: string;
    }
  | {
      type: TutorSemanticBlockType;
      title: string;
      content: string;
    };

const HEADING_MATCHERS: Array<{
  type: TutorSemanticBlockType;
  title: string;
  pattern: RegExp;
}> = [
  { type: 'hint', title: '提示', pattern: /(提示|启发|hint|socratic)/i },
  { type: 'steps', title: '步骤', pattern: /(步骤|解题过程|推导过程|step|plan)/i },
  {
    type: 'knowledge_card',
    title: '知识点',
    pattern: /(知识点|知识卡片|概念|公式|knowledge|concept)/i,
  },
  { type: 'mistake', title: '错因分析', pattern: /(错因|易错|误区|mistake|pitfall)/i },
  { type: 'quiz', title: '小测', pattern: /(小测|练习|自测|quiz|check)/i },
  {
    type: 'learning_state',
    title: '学习状态',
    pattern: /(学习状态|掌握情况|下一步|learning state|progress)/i,
  },
];

function classifyHeading(rawTitle: string) {
  const normalized = rawTitle
    .replace(/^[\s#>*-]+/, '')
    .replace(/^\d+[.、)]\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/[：:]\s*$/, '')
    .trim();

  const match = HEADING_MATCHERS.find((item) => item.pattern.test(normalized));
  if (!match) return null;

  return {
    type: match.type,
    title: normalized || match.title,
  };
}

function normalizeBlockContent(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? `- ${item}` : `- ${String(item)}`))
      .join('\n')
      .trim();
  }
  if (value == null) return '';
  return String(value).trim();
}

function normalizeStructuredBlock(rawBlock: unknown): TutorResponseBlock | null {
  if (!rawBlock || typeof rawBlock !== 'object') return null;
  const block = rawBlock as Record<string, unknown>;
  const rawType = typeof block.type === 'string' ? block.type : '';
  const type = rawType === 'knowledge' ? 'knowledge_card' : rawType;

  if (type === 'markdown' || type === 'text') {
    const content = normalizeBlockContent(block.content ?? block.text);
    return content ? { type: 'markdown', content } : null;
  }

  if (!HEADING_MATCHERS.some((item) => item.type === type)) return null;

  const semanticType = type as TutorSemanticBlockType;
  const defaultTitle = HEADING_MATCHERS.find((item) => item.type === semanticType)?.title || '内容';
  const title =
    typeof block.title === 'string' && block.title.trim() ? block.title.trim() : defaultTitle;

  const contentParts: string[] = [];
  const content = normalizeBlockContent(block.content ?? block.text);
  if (content) contentParts.push(content);

  if (semanticType === 'knowledge_card') {
    const points = normalizeBlockContent(block.points);
    if (points) contentParts.push(points);
  }

  if (semanticType === 'learning_state') {
    const mastered = normalizeBlockContent(block.mastered);
    const weak = normalizeBlockContent(block.weak);
    const nextSuggestion = normalizeBlockContent(block.nextSuggestion ?? block.next);
    if (mastered) contentParts.push(`**已掌握**\n${mastered}`);
    if (weak) contentParts.push(`**需要加强**\n${weak}`);
    if (nextSuggestion) contentParts.push(`**下一步**\n${nextSuggestion}`);
  }

  if (semanticType === 'quiz') {
    const question = normalizeBlockContent(block.question);
    const options = normalizeBlockContent(block.options);
    const answer = normalizeBlockContent(block.answer);
    if (question) contentParts.push(`**题目**\n${question}`);
    if (options) contentParts.push(`**选项**\n${options}`);
    if (answer) contentParts.push(`**参考答案**\n${answer}`);
  }

  const finalContent = contentParts.filter(Boolean).join('\n\n').trim();
  return finalContent ? { type: semanticType, title, content: finalContent } : null;
}

function parseStructuredPayload(content: string): TutorResponseBlock[] | null {
  const candidates: string[] = [];
  const trimmed = content.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  const fencedRegex = /```(?:json|anotherme-blocks)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencedRegex.exec(content)) !== null) {
    candidates.push(match[1].trim());
  }

  for (const candidate of candidates) {
    try {
      const payload = JSON.parse(candidate) as unknown;
      const rawBlocks = Array.isArray(payload)
        ? payload
        : payload &&
            typeof payload === 'object' &&
            Array.isArray((payload as Record<string, unknown>).blocks)
          ? ((payload as Record<string, unknown>).blocks as unknown[])
          : null;

      if (!rawBlocks) continue;
      const blocks = rawBlocks
        .map(normalizeStructuredBlock)
        .filter((block): block is TutorResponseBlock => Boolean(block));
      if (blocks.length > 0 && blocks.some((block) => block.type !== 'markdown')) {
        return blocks;
      }
    } catch {
      // Ignore non-JSON code fences; they should stay as Markdown/code blocks.
    }
  }

  return null;
}

function parseMarkdownSections(content: string): TutorResponseBlock[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: TutorResponseBlock[] = [];
  let current: TutorResponseBlock = { type: 'markdown', content: '' };
  let recognizedCount = 0;

  const flush = () => {
    const trimmed = current.content.trim();
    if (!trimmed) return;
    blocks.push({ ...current, content: trimmed });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^(#{2,4})\s+(.+?)\s*$/);
    const labelMatch = line.match(/^\s*(?:\*\*)?([^：:]{2,18})(?:\*\*)?[：:]\s*$/);
    const classified = headingMatch
      ? classifyHeading(headingMatch[2])
      : labelMatch
        ? classifyHeading(labelMatch[1])
        : null;

    if (classified) {
      flush();
      current = {
        type: classified.type,
        title: classified.title,
        content: '',
      };
      recognizedCount += 1;
      continue;
    }

    current.content += current.content ? `\n${line}` : line;
  }

  flush();

  if (recognizedCount === 0) {
    return [{ type: 'markdown', content: normalized.trim() }];
  }

  return blocks.length ? blocks : [{ type: 'markdown', content: normalized.trim() }];
}

export function parseTutorResponseBlocks(content: string): TutorResponseBlock[] {
  if (!content.trim()) return [];
  return parseStructuredPayload(content) ?? parseMarkdownSections(content);
}
