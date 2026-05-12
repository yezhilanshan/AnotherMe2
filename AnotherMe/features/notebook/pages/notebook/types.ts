export interface NoteDraft {
  title: string;
  subject: string;
  tags: string;
  content: string;
}

export interface ThemeOption {
  id: 'paper' | 'academic' | 'night';
  label: string;
  canvasClass: string;
  articleClass: string;
  toneClass: string;
}

export interface HeadingItem {
  level: number;
  text: string;
  slug: string;
}

export interface SlashCommandItem {
  id: string;
  label: string;
  aliases: string[];
  snippet: string;
}
