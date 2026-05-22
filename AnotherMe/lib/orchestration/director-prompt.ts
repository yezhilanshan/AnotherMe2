/**
 * Director Prompt Builder
 *
 * Constructs the system prompt for the director agent that decides
 * which agent should respond next in a multi-agent conversation.
 */

import type { AgentConfig } from '@/lib/orchestration/registry/types';
import { createLogger } from '@/lib/logger';
import { extractLastHumanMessage, type OpenAIMessage } from './prompt-builder';

const log = createLogger('DirectorPrompt');

/**
 * A single whiteboard action performed by an agent, recorded in the ledger.
 */
export interface WhiteboardActionRecord {
  actionName:
    | 'wb_draw_text'
    | 'wb_draw_shape'
    | 'wb_draw_chart'
    | 'wb_draw_latex'
    | 'wb_draw_table'
    | 'wb_draw_line'
    | 'wb_clear'
    | 'wb_delete'
    | 'wb_open'
    | 'wb_close';
  agentId: string;
  agentName: string;
  params: Record<string, unknown>;
}

/**
 * Summary of an agent's turn in the current round
 */
export interface AgentTurnSummary {
  agentId: string;
  agentName: string;
  contentPreview: string;
  actionCount: number;
  whiteboardActions: WhiteboardActionRecord[];
}

/**
 * Build the system prompt for the director agent
 *
 * @param agents - Available agent configurations
 * @param conversationSummary - Condensed summary of recent conversation
 * @param agentResponses - Agents that have already responded this round
 * @param turnCount - Current turn number in this round
 */
export function buildDirectorPrompt(
  agents: AgentConfig[],
  conversationSummary: string,
  agentResponses: AgentTurnSummary[],
  turnCount: number,
  discussionContext?: { topic: string; prompt?: string } | null,
  triggerAgentId?: string | null,
  whiteboardLedger?: WhiteboardActionRecord[],
  userProfile?: { nickname?: string; bio?: string },
  whiteboardOpen?: boolean,
  openAIMessages?: OpenAIMessage[],
  userReactions?: import('@/lib/types/chat').UserReaction[],
): string {
  const agentList = agents
    .map((a) => `- id: "${a.id}", name: "${a.name}", role: ${a.role}, priority: ${a.priority}`)
    .join('\n');

  const respondedList =
    agentResponses.length > 0
      ? agentResponses
          .map((r) => {
            const wbSummary = summarizeAgentWhiteboardActions(r.whiteboardActions);
            const wbPart = wbSummary ? ` | Whiteboard: ${wbSummary}` : '';
            return `- ${r.agentName} (${r.agentId}): "${r.contentPreview}" [${r.actionCount} actions${wbPart}]`;
          })
          .join('\n')
      : 'None yet.';

  const isDiscussion = !!discussionContext;
  const openStudentQuestionSection = buildOpenStudentQuestionSection(openAIMessages);

  const discussionSection = isDiscussion
    ? `\n# Discussion Mode
Topic: "${discussionContext!.topic}"${discussionContext!.prompt ? `\nPrompt: "${discussionContext!.prompt}"` : ''}${triggerAgentId ? `\nInitiator: "${triggerAgentId}"` : ''}
This is a student-initiated discussion, not a Q&A session.\n`
    : '';

  const rule1 = isDiscussion
    ? `1. The discussion initiator${triggerAgentId ? ` ("${triggerAgentId}")` : ''} should speak first to kick off the topic. Then the teacher responds to guide the discussion. After that, other students may add their perspectives.`
    : "1. The teacher (role: teacher, highest priority) should usually speak first to address the user's question or topic.";

  // Build whiteboard state section for director awareness
  const whiteboardSection = buildWhiteboardStateForDirector(whiteboardLedger);

  // Build student profile section for director awareness
  const studentProfileSection =
    userProfile?.nickname || userProfile?.bio
      ? `
# Student Profile
Student name: ${userProfile.nickname || 'Unknown'}
${userProfile.bio ? `Background: ${userProfile.bio}` : ''}
`
      : '';

  return `You are the Director of a multi-agent classroom. Your job is to decide which agent should speak next based on the conversation context.

# Available Agents
${agentList}

# Agents Who Already Spoke This Round
${respondedList}

# Conversation Context
${conversationSummary}
${openStudentQuestionSection}${discussionSection}${whiteboardSection}${studentProfileSection}${buildUserReactionsSection(userReactions)}
# Rules
${rule1}
2. After the teacher, consider whether a student agent would add value (ask a follow-up question, crack a joke, take notes, offer a different perspective).
3. Do NOT repeat an agent who already spoke this round unless absolutely necessary.
4. If the conversation seems complete (question answered, topic covered), output END.
5. Current turn: ${turnCount + 1}. Consider conversation length — don't let discussions drag on unnecessarily.
6. Prefer brevity — 1-2 agents responding is usually enough. Don't force every agent to speak.
7. You can output {"next_agent":"USER"} to cue the user to speak. Use this when a student asks the user a direct question or when the topic naturally calls for user input.
8. Consider whiteboard state when routing: if the whiteboard is already crowded, avoid dispatching agents that are likely to add more whiteboard content unless they would clear or organize it.
9. Whiteboard is currently ${whiteboardOpen ? 'OPEN (slide canvas is hidden — spotlight/laser will not work)' : 'CLOSED (slide canvas is visible)'}. When the whiteboard is open, do not expect spotlight or laser actions to have visible effect.

# Routing Quality (CRITICAL)
- ROLE DIVERSITY: Do NOT dispatch two agents of the same role consecutively. After a teacher speaks, the next should be a student or assistant — not another teacher-like response. After an assistant rephrases, dispatch a student who asks a question, not another assistant who also rephrases.
- CONTENT DEDUP: Read the "Agents Who Already Spoke" previews carefully. If an agent already explained a concept thoroughly, do NOT dispatch another agent to explain the same concept. Instead, dispatch an agent who will ASK a question, CHALLENGE an assumption, CONNECT to another topic, or TAKE NOTES.
- DISCUSSION PROGRESSION: The next agent should RESPOND to the last speaker, not start a new topic. Good: teacher explains → student asks about the explanation → teacher clarifies → student gives an example. Bad: teacher explains → student starts unrelated question → teacher re-explains from scratch.
- GREETING RULE: If any agent has already greeted the students, no subsequent agent should greet again. Check the previews for greetings.

# Output Format
You MUST first output your reasoning inside <thinking> tags, then output a JSON decision.

<thinking>
- Summarize what the last speaker said
- Identify which agents haven't spoken yet and what value they could add
- Check for unanswered student questions or unresolved topics
- Decide: which agent should speak next, or USER, or END
</thinking>
{"next_agent":"<agent_id>"}
or
{"next_agent":"USER"}
or
{"next_agent":"END"}

IMPORTANT: Always include the <thinking> block before the JSON. The JSON must be the last line.`;
}

export function buildOpenStudentQuestionSection(messages?: OpenAIMessage[]): string {
  const lastHumanMessage = messages ? extractLastHumanMessage(messages) : null;
  if (!lastHumanMessage) return '';

  return `
# Latest Student Message Still Needing Attention
${lastHumanMessage}

Do not output END if this message asks a question, challenges an explanation, or requests clarification and no later human message resolves it.
`;
}

/**
 * Build a user reactions section for the director prompt.
 * Shows recent user feedback so the Director can adjust strategy.
 */
function buildUserReactionsSection(
  reactions?: import('@/lib/types/chat').UserReaction[],
): string {
  if (!reactions || reactions.length === 0) return '';

  const recent = reactions.slice(-5);
  const lines = recent.map((r) => {
    switch (r.type) {
      case 'confused':
        return '- Student is CONFUSED — does not understand';
      case 'too_fast':
        return '- Student says pace is TOO FAST';
      case 'agree':
        return '- Student AGREES with the discussion';
      case 'want_example':
        return '- Student wants a concrete EXAMPLE';
      case 'boring':
        return '- Student finds it BORING — needs a change';
      default:
        return `- Student reaction: ${r.type}`;
    }
  });

  return `
# Student Reactions (IMPORTANT — adjust your strategy)
${lines.join('\n')}
Guidance: If confused → slow down, simplify, give examples. If too fast → fewer agents, shorter responses. If wants example → dispatch an agent to illustrate. If boring → change perspective or approach.
`;
}

/**
 * Build a summary prompt for the teacher agent to generate a structured
 * discussion summary before the session ends.
 */
export function buildSummaryPrompt(
  agentResponses: AgentTurnSummary[],
  discussionContext?: { topic: string; prompt?: string } | null,
  whiteboardLedger?: WhiteboardActionRecord[],
): string {
  const discussionReview =
    agentResponses.length > 0
      ? agentResponses
          .map((r) => {
            const wbSummary = summarizeAgentWhiteboardActions(r.whiteboardActions);
            const wbPart = wbSummary ? ` [Whiteboard: ${wbSummary}]` : '';
            return `- ${r.agentName} (${r.agentId}): "${r.contentPreview}"${wbPart}`;
          })
          .join('\n')
      : 'No agents spoke yet.';

  const topicSection = discussionContext
    ? `\nDiscussion Topic: "${discussionContext.topic}"${discussionContext.prompt ? `\nGuiding Prompt: "${discussionContext.prompt}"` : ''}`
    : '';

  const whiteboardSection =
    whiteboardLedger && whiteboardLedger.length > 0
      ? `\nWhiteboard Content:\n${buildWhiteboardContentSummary(whiteboardLedger)}`
      : '';

  return `You are the teacher in a multi-agent classroom. The discussion is about to end. Your job is to provide a structured summary of what was covered.

# Discussion Content
${discussionReview}${topicSection}${whiteboardSection}

# Your Task
Generate a concise summary of this discussion. Structure your response as follows:
1. Key Takeaways — the most important points covered (2-5 bullet points)
2. Unanswered Questions — any student questions or topics that weren't fully addressed
3. Next Steps — what the student should study or practice next

Keep the summary concise and student-friendly. Write in the same language as the discussion.
Do NOT use actions (whiteboard, spotlight, etc.) — only produce text.`;
}

/**
 * Build a text summary of whiteboard content from the ledger.
 */
function buildWhiteboardContentSummary(ledger: WhiteboardActionRecord[]): string {
  const parts: string[] = [];
  for (const record of ledger) {
    switch (record.actionName) {
      case 'wb_draw_text':
        parts.push(`- Text: "${String(record.params.content || '').slice(0, 50)}"`);
        break;
      case 'wb_draw_latex':
        parts.push(`- Formula: "${String(record.params.latex || '').slice(0, 50)}"`);
        break;
      case 'wb_draw_chart':
        parts.push(`- Chart: ${record.params.chartType || 'bar'} chart`);
        break;
      case 'wb_draw_table':
        parts.push(`- Table: ${(record.params.data as unknown[][])?.length || 0} rows`);
        break;
      case 'wb_clear':
        parts.push('- Whiteboard was cleared');
        break;
    }
  }
  return parts.length > 0 ? parts.join('\n') : 'No significant content.';
}

/**
 * Summarize a single agent's whiteboard actions into a compact description.
 */
function summarizeAgentWhiteboardActions(actions: WhiteboardActionRecord[]): string {
  if (!actions || actions.length === 0) return '';

  const parts: string[] = [];
  for (const a of actions) {
    switch (a.actionName) {
      case 'wb_draw_text': {
        const content = String(a.params.content || '').slice(0, 30);
        parts.push(`drew text "${content}${content.length >= 30 ? '...' : ''}"`);
        break;
      }
      case 'wb_draw_shape':
        parts.push(`drew shape(${a.params.type || 'rectangle'})`);
        break;
      case 'wb_draw_chart': {
        const labels = Array.isArray(a.params.labels)
          ? a.params.labels
          : (a.params.data as Record<string, unknown>)?.labels;
        const chartType = a.params.chartType || a.params.type || 'bar';
        parts.push(
          `drew chart(${chartType}${labels ? `, labels: [${(labels as string[]).slice(0, 4).join(',')}]` : ''})`,
        );
        break;
      }
      case 'wb_draw_latex': {
        const latex = String(a.params.latex || '').slice(0, 30);
        parts.push(`drew formula "${latex}${latex.length >= 30 ? '...' : ''}"`);
        break;
      }
      case 'wb_draw_table': {
        const data = a.params.data as unknown[][] | undefined;
        const rows = data?.length || 0;
        const cols = (data?.[0] as unknown[])?.length || 0;
        parts.push(`drew table(${rows}×${cols})`);
        break;
      }
      case 'wb_draw_line': {
        const pts = a.params.points as string[] | undefined;
        const hasArrow = pts?.includes('arrow') ? ' arrow' : '';
        parts.push(`drew${hasArrow} line`);
        break;
      }
      case 'wb_clear':
        parts.push('CLEARED whiteboard');
        break;
      case 'wb_delete':
        parts.push(`deleted element "${a.params.elementId}"`);
        break;
      case 'wb_open':
      case 'wb_close':
        // Skip open/close from summary — they're structural, not content
        break;
    }
  }
  return parts.join(', ');
}

/**
 * Replay the whiteboard ledger to compute current element count and contributors.
 */
export function summarizeWhiteboardForDirector(ledger: WhiteboardActionRecord[]): {
  elementCount: number;
  contributors: string[];
} {
  let elementCount = 0;
  const contributorSet = new Set<string>();

  for (const record of ledger) {
    if (record.actionName === 'wb_clear') {
      elementCount = 0;
      // Don't reset contributors — they still participated
    } else if (record.actionName === 'wb_delete') {
      elementCount = Math.max(0, elementCount - 1);
    } else if (record.actionName.startsWith('wb_draw_')) {
      elementCount++;
      contributorSet.add(record.agentName);
    }
  }

  return {
    elementCount,
    contributors: Array.from(contributorSet),
  };
}

/**
 * Build the whiteboard state section for the director prompt.
 * Returns empty string if there are no whiteboard actions.
 */
function buildWhiteboardStateForDirector(ledger?: WhiteboardActionRecord[]): string {
  if (!ledger || ledger.length === 0) return '';

  const { elementCount, contributors } = summarizeWhiteboardForDirector(ledger);
  const crowdedWarning =
    elementCount > 5
      ? '\n⚠ The whiteboard is getting crowded. Consider routing to an agent that will organize or clear it rather than adding more.'
      : '';

  return `
# Whiteboard State
Elements on whiteboard: ${elementCount}
Contributors: ${contributors.length > 0 ? contributors.join(', ') : 'none'}${crowdedWarning}
`;
}

/**
 * Parse the director's decision from its response
 *
 * @param content - Raw LLM response content
 * @returns Parsed decision with nextAgentId, shouldEnd flag, and reasoning
 */
export function parseDirectorDecision(content: string): {
  nextAgentId: string | null;
  shouldEnd: boolean;
  reasoning: string;
} {
  // Extract reasoning from <thinking>...</thinking> tags
  const thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/);
  const reasoning = thinkingMatch ? thinkingMatch[1].trim() : '';

  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*?"next_agent"[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const nextAgent = parsed.next_agent;

      if (!nextAgent || nextAgent === 'END') {
        return { nextAgentId: null, shouldEnd: true, reasoning };
      }

      return { nextAgentId: nextAgent, shouldEnd: false, reasoning };
    }
  } catch (_e) {
    log.warn('[Director] Failed to parse decision:', content.slice(0, 200));
  }

  // Default: end the round if we can't parse
  return { nextAgentId: null, shouldEnd: true, reasoning };
}
