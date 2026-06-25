import {
  BookOpen,
  Brain,
  Calculator,
  Code2,
  Database,
  FileSearch,
  Globe,
  Lightbulb,
  MessageSquare,
  Microscope,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { CapabilityDef, CapabilityId, ToolDef, TutorToolName } from './types';

export const CAPABILITIES: CapabilityDef[] = [
  { id: 'auto', label: '智能导师', description: '苏格拉底式启发教学', icon: Sparkles },
  { id: '', label: '聊天', description: '灵活对话，可使用多种工具', icon: MessageSquare },
  { id: 'deep_solve', label: '深度解题', description: '多步骤推理与问题解决', icon: Zap },
  { id: 'quiz_practice', label: '练习生成', description: '自动验证的题目生成', icon: BookOpen },
  { id: 'deep_research', label: '深度研究', description: '多智能体综合研究', icon: Microscope },
  { id: 'math_animator', label: '数学动画', description: '生成数学视频或分镜图', icon: Sparkles },
  { id: 'visualize', label: '可视化', description: '生成SVG、图表或Mermaid图形', icon: Zap },
];

// 空状态建议卡片
export const SUGGESTION_CARDS = [
  {
    icon: Calculator,
    title: '解题',
    description: '逐步解答数学问题',
    prompt: '帮我解这道数学题，请给出详细步骤',
  },
  {
    icon: BookOpen,
    title: '概念讲解',
    description: '深入理解任何知识点',
    prompt: '用简单的话解释量子力学',
  },
  {
    icon: Code2,
    title: '代码辅助',
    description: '生成和调试代码',
    prompt: '写一个 Python 函数来排序列表',
  },
  {
    icon: Microscope,
    title: '深度研究',
    description: '多维度综合分析',
    prompt: '研究人工智能的最新发展',
  },
  {
    icon: Sparkles,
    title: '可视化',
    description: '生成图表和示意图',
    prompt: '创建一个机器学习流程图',
  },
  {
    icon: Lightbulb,
    title: '头脑风暴',
    description: '激发创意灵感',
    prompt: '为科学项目头脑风暴一些创意',
  },
];

// 快速提示
export const QUICK_PROMPTS = [
  '解释光合作用',
  '帮我写一篇作文',
  '解这个方程：2x + 5 = 15',
  '气候变化的原因是什么？',
  '神经网络是如何工作的？',
];

export const CHAT_TOOLS: ToolDef[] = [
  { id: 'brainstorm', label: '头脑风暴', description: '生成发散性想法和角度', icon: Lightbulb },
  { id: 'rag', label: '知识检索', description: '从学习笔记和知识库中检索', icon: Database },
  { id: 'web_search', label: '网络搜索', description: '搜索最新的网络信息', icon: Globe },
  { id: 'code_execution', label: '代码执行', description: '运行代码进行计算或验证', icon: Code2 },
  { id: 'reason', label: '深度推理', description: '进行更深层次的多步推理', icon: Brain },
  { id: 'paper_search', label: '论文搜索', description: '搜索学术论文', icon: FileSearch },
];

export const TOOL_CONFIG_BY_CAPABILITY: Record<
  CapabilityId,
  { allowedTools: TutorToolName[]; defaultTools: TutorToolName[] }
> = {
  '': {
    allowedTools: ['brainstorm', 'rag', 'web_search', 'code_execution', 'reason', 'paper_search'],
    defaultTools: [],
  },
  auto: {
    allowedTools: ['brainstorm', 'rag', 'web_search', 'code_execution', 'reason', 'paper_search'],
    defaultTools: ['rag', 'web_search', 'code_execution', 'reason'],
  },
  deep_solve: {
    allowedTools: ['rag', 'web_search', 'code_execution', 'reason'],
    defaultTools: ['rag', 'web_search', 'code_execution', 'reason'],
  },
  quiz_practice: {
    allowedTools: ['rag', 'web_search', 'code_execution'],
    defaultTools: ['rag', 'web_search', 'code_execution'],
  },
  deep_research: {
    allowedTools: [],
    defaultTools: [],
  },
  math_animator: {
    allowedTools: [],
    defaultTools: [],
  },
  visualize: {
    allowedTools: [],
    defaultTools: [],
  },
};

export const STORAGE_KEY = 'anotherme:ai-tutor:sessions:v1';
export const LEGACY_STORAGE_KEY = 'openmaic:ai-tutor:sessions:v1';
export const MAX_SESSIONS = 40;

// AI_TUTOR_DETAILED_SYSTEM_PROMPT 已移除：AI Tutor 完全使用 AnotherMe 封装的 agentic pipeline 能力，
// 不再从前端注入额外提示词，以免干扰 AnotherMe 原生的 thinking/acting/observing/responding 流程。
export const AI_TUTOR_DETAILED_SYSTEM_PROMPT = '';
