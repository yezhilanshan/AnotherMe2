/**
 * AI导师工具类型定义
 * 定义六个可勾选的工具：brainstorm、rag、web_search、code_execution、reason、paper_search
 */

export type TutorToolName =
  | 'brainstorm'
  | 'rag'
  | 'web_search'
  | 'code_execution'
  | 'reason'
  | 'paper_search';

/** 学生学段，用于自适应工具描述和提示词语气 */
export type StudentLevel = 'junior_high' | 'senior_high' | 'college';

/**
 * RAG 数据源
 */
export interface RAGDataSource {
  /** 笔记列表 */
  notes?: Array<{
    id: string;
    title: string;
    content: string;
    tags: string[];
    subject: string;
    source: string;
    createdAt: number;
  }>;
  /** ClassroomBook 列表 */
  classroomBooks?: Array<{
    id: string;
    title: string;
    blocks: Array<{
      title: string;
      content: string;
      type: string;
    }>;
  }>;
  /** 当前舞台信息 */
  currentStage?: {
    title?: string;
    description?: string;
    scenes?: Array<{
      title?: string;
      content?: string;
    }>;
  };
}

export interface TutorToolConfig {
  /** 知识库ID（用于RAG） */
  knowledgeBase?: string;
  /** RAG 数据源（JSON序列化后传递） */
  ragDataSource?: RAGDataSource;
  /** 用户ID（用于服务端获取 ClassroomBook） */
  userId?: string;
  /** RAG 最大结果数 */
  maxRAGResults?: number;
  /** 是否启用 LlamaIndex 向量检索（依赖可选） */
  useLlamaIndex?: boolean;
  /** 论文搜索最大结果数 */
  maxPaperResults?: number;
  /** 联网搜索最大结果数 */
  maxWebResults?: number;
  /** Tavily API Key（可选，优先于服务端配置） */
  tavilyApiKey?: string;
  /** 代码执行超时时间（秒） */
  codeTimeoutSec?: number;
}

export interface TutorToolState {
  /** 已启用的工具列表 */
  enabledTools: TutorToolName[];
  /** 工具配置 */
  config: TutorToolConfig;
  /**
   * P2: 是否使用 Agentic Pipeline 模式
   * - true: 使用 thinking -> acting -> observing -> responding 四阶段，模型按需选择工具
   * - false: 预执行所有启用的工具（legacy 模式）
   * @default false (保持向后兼容)
   */
  useAgenticPipeline?: boolean;
}

export interface TutorToolDefinition {
  id: TutorToolName;
  label: string;
  description: string;
  icon: string;
}

export const TUTOR_TOOLS: TutorToolDefinition[] = [
  {
    id: 'brainstorm',
    label: '头脑风暴',
    description: 'AI辅助发散思考，生成创意点子',
    icon: 'Lightbulb',
  },
  {
    id: 'rag',
    label: '知识库',
    description: '检索课堂笔记和学习资料',
    icon: 'BookOpen',
  },
  {
    id: 'web_search',
    label: '联网搜索',
    description: '搜索互联网获取最新信息',
    icon: 'Globe',
  },
  {
    id: 'code_execution',
    label: '代码执行',
    description: '运行Python代码进行计算或验证',
    icon: 'Code',
  },
  {
    id: 'reason',
    label: '深度推理',
    description: 'AI进行多步骤深度分析',
    icon: 'Brain',
  },
  {
    id: 'paper_search',
    label: '论文检索',
    description: '搜索arXiv学术论文',
    icon: 'FileText',
  },
];

/**
 * 学段自适应的工具描述映射。
 * 对初中生使用更友好的名称和定位，让 LLM 感知到工具的受众。
 */
export const STUDENT_LEVEL_TOOL_DESCRIPTIONS: Record<
  StudentLevel,
  Record<TutorToolName, { label: string; llmDescription: string }>
> = {
  college: {
    brainstorm: { label: '头脑风暴', llmDescription: '头脑风暴 — 发散思考，生成创意点子' },
    rag: { label: '知识库', llmDescription: '知识库检索 — 从本地知识库中检索相关信息和资料' },
    web_search: { label: '联网搜索', llmDescription: '联网搜索 — 搜索互联网获取最新信息和资料' },
    code_execution: {
      label: '代码执行',
      llmDescription: '代码执行 — 运行Python代码进行计算或验证',
    },
    reason: { label: '深度推理', llmDescription: '深度推理 — 对复杂问题进行多步骤深度分析和推理' },
    paper_search: { label: '论文检索', llmDescription: '论文检索 — 搜索arXiv学术论文获取前沿研究' },
  },
  senior_high: {
    brainstorm: { label: '头脑风暴', llmDescription: '头脑风暴 — 帮你打开思路，生成解题灵感' },
    rag: { label: '知识库', llmDescription: '知识库检索 — 查找你的课堂笔记和教材内容' },
    web_search: { label: '联网搜索', llmDescription: '联网搜索 — 从网上查找资料和解释' },
    code_execution: {
      label: '代码/计算',
      llmDescription: '代码/计算 — 运行代码进行计算、画图或验证公式',
    },
    reason: {
      label: '分步推理',
      llmDescription: '分步推理 — 一步一步分析问题，展示完整的思考过程',
    },
    paper_search: {
      label: '资料搜索',
      llmDescription: '资料搜索 — 搜索科普文章和学习资料（非学术论文）',
    },
  },
  junior_high: {
    brainstorm: {
      label: '思路发散 💡',
      llmDescription: '思路发散 — 帮你想想有哪些可能的解法或创意，像头脑风暴一样',
    },
    rag: { label: '我的笔记 📒', llmDescription: '我的笔记 — 从你的课堂笔记和教材里找相关内容' },
    web_search: { label: '网上查查 🌐', llmDescription: '网上查查 — 从网上找简单易懂的解释和例子' },
    code_execution: {
      label: '数学验算 🧮',
      llmDescription:
        '数学验算 — 帮你算一算、画个图、验证一下答案对不对。用的是Python，但不需要你会编程',
    },
    reason: {
      label: '分步思考 🧠',
      llmDescription:
        '分步思考 — 一步一步分析问题，像老师板书一样把思考过程写清楚。你可以看到完整的推理链',
    },
    paper_search: {
      label: '百科搜索 📚',
      llmDescription:
        '百科搜索 — 搜索百科知识和趣味科普，帮你理解概念。不是论文！是给中学生看的科普内容',
    },
  },
};
