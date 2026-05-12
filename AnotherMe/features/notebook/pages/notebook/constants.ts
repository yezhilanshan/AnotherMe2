import type { NoteDraft, SlashCommandItem, ThemeOption } from './types';

export const NOTEBOOK_THEME_KEY = 'anotherme:notebook:theme:v1';
export const EMPTY_DRAFT: NoteDraft = { title: '', subject: '综合', tags: '', content: '' };
export const SLASH_COMMANDS: SlashCommandItem[] = [
  { id: 'h1', label: '一级标题', aliases: ['h1', 'title'], snippet: '# 标题' },
  { id: 'h2', label: '二级标题', aliases: ['h2', 'subtitle'], snippet: '## 小节' },
  { id: 'todo', label: '待办列表', aliases: ['todo', 'task'], snippet: '- [ ] 待办事项' },
  { id: 'quote', label: '引用', aliases: ['quote', 'blockquote'], snippet: '> 这里是引用内容' },
  {
    id: 'code',
    label: '代码块',
    aliases: ['code', '```'],
    snippet: '```ts\nconsole.log("hello")\n```',
  },
  {
    id: 'table',
    label: '表格',
    aliases: ['table', 'tbl'],
    snippet: '| 字段 | 说明 |\n| --- | --- |\n| 项目 | 描述 |',
  },
  {
    id: 'math',
    label: '公式块',
    aliases: ['math', 'latex'],
    snippet: '$$\nE = mc^2\n$$',
  },
];

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'paper',
    label: 'Paper',
    canvasClass: 'bg-[#f2f0eb]',
    articleClass: 'text-[#2f2a24]',
    toneClass: 'text-[#6f665c]',
  },
  {
    id: 'academic',
    label: 'Academic',
    canvasClass: 'bg-[#eef1f6]',
    articleClass: 'text-[#27364d]',
    toneClass: 'text-[#5f708c]',
  },
  {
    id: 'night',
    label: 'Night',
    canvasClass: 'bg-[#171c24]',
    articleClass: 'text-[#e5ebf6]',
    toneClass: 'text-[#8ea2c2]',
  },
];
