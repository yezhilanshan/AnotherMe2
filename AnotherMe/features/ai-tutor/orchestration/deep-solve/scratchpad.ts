import type { TutorToolName } from '../../types/tutor-tools';

export interface SolvePlan {
  analysis: string;
  steps: string[];
}

export interface ReActEntry {
  stepIndex: number;
  round: number;
  thought: string;
  action: TutorToolName;
  observation: string;
  success: boolean;
}

export class DeepSolveScratchpad {
  private plan: SolvePlan | null = null;
  private entries: ReActEntry[] = [];

  setPlan(plan: SolvePlan): void {
    this.plan = plan;
  }

  addEntry(entry: ReActEntry): void {
    this.entries.push(entry);
  }

  getEntries(): ReActEntry[] {
    return [...this.entries];
  }

  buildToolContext(maxChars = 6_000): string {
    const sections: string[] = [];

    if (this.plan) {
      sections.push(`## Plan\n${this.plan.analysis}`);
      if (this.plan.steps.length > 0) {
        sections.push(this.plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n'));
      }
    }

    if (this.entries.length > 0) {
      sections.push(
        `## ReAct Scratchpad\n${this.entries
          .map(
            (entry) =>
              `Round ${entry.round + 1}, Step ${entry.stepIndex + 1}\nThought: ${entry.thought}\nAction: ${entry.action}\nObservation: ${entry.observation.slice(0, 800)}\nStatus: ${entry.success ? 'success' : 'failed'}`,
          )
          .join('\n\n')}`,
      );
    }

    const text = sections.join('\n\n').trim();
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
  }

  formatSourcesMarkdown(): string {
    const successful = this.entries.filter((entry) => entry.success && entry.observation.trim());
    if (!successful.length) return '';

    return [
      '## 工具与来源',
      ...successful.map(
        (entry, index) =>
          `${index + 1}. ${entry.action}: ${entry.observation.replace(/\s+/g, ' ').trim().slice(0, 220)}`,
      ),
    ].join('\n');
  }
}

export function parseSolvePlan(text: string): SolvePlan {
  const numbered = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+[.)、]\s+/.test(line))
    .map((line) => line.replace(/^\d+[.)、]\s+/, '').trim())
    .filter(Boolean);

  return {
    analysis: text.trim() || 'No explicit plan generated.',
    steps: numbered.length ? numbered.slice(0, 8) : ['分析题意', '执行必要工具', '整合推理并作答'],
  };
}
