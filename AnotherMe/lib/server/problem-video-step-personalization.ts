import {
  updateLearningContext,
  type LearningContext,
  type StandardSolutionStepSnapshot,
  type StepExpansionStrategy,
  type StepPersonalizationSnapshot,
  type StepRiskLevel,
  type TeachingDecisionSnapshot,
} from '@/lib/types/learning-context';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function roundMastery(value: number): number {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function unique(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function buildStep(
  index: number,
  title: string,
  description: string,
  knowledgePointIds: string[],
  abilityTags: string[],
): StandardSolutionStepSnapshot {
  return {
    id: `step-${index}`,
    title,
    description,
    knowledgePointIds: unique(knowledgePointIds),
    abilityTags: unique(abilityTags),
  };
}

function inferStandardSteps(
  problemText: string,
  teachingDecisions: TeachingDecisionSnapshot[],
): StandardSolutionStepSnapshot[] {
  const text = problemText.trim().toLowerCase();
  const decisionPoints = teachingDecisions.map((decision) => decision.knowledgePointId);

  if (/(勾股|直角|rt△|right\s*triangle)/i.test(text)) {
    return [
      buildStep(1, '识别直角结构', '从题图和题干中确认直角、斜边与已知边。', ['直角三角形', ...decisionPoints], ['读图', '条件提取']),
      buildStep(2, '建立勾股关系', '选择正确的两条直角边和斜边，写出平方关系。', ['勾股定理', '直角三角形'], ['建模', '公式选择']),
      buildStep(3, '代入并计算', '代入已知长度，完成平方、开方或等式变形。', ['勾股定理', '整式运算'], ['计算', '代数变形']),
      buildStep(4, '回代检验答案', '检查边长正值、单位和题目要求是否一致。', ['题意分析'], ['验证', '表达']),
    ];
  }

  if (/(相似|比例|对应边|similar)/i.test(text)) {
    return [
      buildStep(1, '定位对应元素', '识别对应角、对应边和可用的相似条件。', ['相似三角形', '三角形基础', ...decisionPoints], ['读图', '对应关系']),
      buildStep(2, '证明或使用相似', '说明三角形相似的判定依据。', ['相似三角形'], ['证明', '条件组织']),
      buildStep(3, '列比例式', '按照对应关系列出比例式或方程。', ['相似三角形', '一次方程'], ['建模', '比例推理']),
      buildStep(4, '求解并检验', '解出未知量并检查对应关系是否一致。', ['一次方程'], ['计算', '验证']),
    ];
  }

  if (/(方程|求\s*x|解\s*x|equation)/i.test(text)) {
    return [
      buildStep(1, '整理已知条件', '把题干信息转成未知量和等量关系。', ['一次方程', ...decisionPoints], ['建模', '条件提取']),
      buildStep(2, '列出方程', '根据等量关系建立方程。', ['一次方程'], ['建模', '符号表达']),
      buildStep(3, '等价变形求解', '执行移项、合并同类项和系数化一。', ['一次方程', '整式运算'], ['计算', '代数变形']),
      buildStep(4, '代回验证', '将结果代回原条件，确认答案有效。', ['题意分析'], ['验证', '表达']),
    ];
  }

  return [
    buildStep(1, '审题与提取条件', '明确已知、未知和目标结论。', decisionPoints.length ? decisionPoints : ['题意分析'], ['读题', '条件提取']),
    buildStep(2, '选择解题方法', '根据知识点选择公式、定理或模型。', decisionPoints.length ? decisionPoints : ['方法选择'], ['策略选择', '建模']),
    buildStep(3, '执行推理计算', '按方法完成推理、计算或证明。', decisionPoints.length ? decisionPoints : ['核心计算'], ['推理', '计算']),
    buildStep(4, '整理答案与反思', '核对答案，指出关键易错点或变式方向。', ['题意分析'], ['验证', '迁移']),
  ];
}

function actionRaisesRisk(action: TeachingDecisionSnapshot['action']): boolean {
  return action === 'reteach' || action === 'worked_example';
}

function decideRisk(
  mastery: number,
  matchedDecisions: TeachingDecisionSnapshot[],
): StepRiskLevel {
  if (mastery < 0.45 || matchedDecisions.some((decision) => decision.action === 'reteach')) {
    return 'high';
  }
  if (mastery < 0.7 || matchedDecisions.some((decision) => actionRaisesRisk(decision.action))) {
    return 'medium';
  }
  return 'low';
}

function strategyForRisk(
  riskLevel: StepRiskLevel,
  mastery: number,
  overallMode: StepPersonalizationSnapshot['overallMode'],
): StepExpansionStrategy {
  if (riskLevel === 'high') return 'full_scaffold';
  if (riskLevel === 'medium') return 'guided_hint';
  if (overallMode === 'advanced' && mastery >= 0.84) return 'skip_or_challenge';
  return 'concise_bridge';
}

function reasonForStep(
  step: StandardSolutionStepSnapshot,
  riskLevel: StepRiskLevel,
  mastery: number,
  matchedDecisions: TeachingDecisionSnapshot[],
): string {
  const points = matchedDecisions.map((decision) => `${decision.knowledgePointId} ${(decision.mastery * 100).toFixed(0)}%`);
  const base = points.length
    ? `关联知识点掌握度：${points.join('、')}`
    : `未命中具体 BKT 知识点，使用整体估计 ${(mastery * 100).toFixed(0)}%`;
  if (riskLevel === 'high') {
    return `${base}。${step.title} 需要展开为慢速示范和易错提醒。`;
  }
  if (riskLevel === 'medium') {
    return `${base}。${step.title} 需要保留关键提示和检查点。`;
  }
  return `${base}。${step.title} 可简洁讲解，并在结尾引导变式或迁移。`;
}

export function buildProblemVideoStepPersonalization(
  context: LearningContext,
  problemText: string,
): StepPersonalizationSnapshot {
  const teachingDecisions = context.knowledgeTracing?.teachingDecisions || [];
  const standardSteps = inferStandardSteps(problemText, teachingDecisions);
  const masteryByPoint = new Map(teachingDecisions.map((decision) => [decision.knowledgePointId, clamp01(decision.mastery)]));
  const fallbackMastery = teachingDecisions.length
    ? teachingDecisions.reduce((sum, decision) => sum + clamp01(decision.mastery), 0) / teachingDecisions.length
    : 0.5;

  const overallMastery = roundMastery(fallbackMastery);
  const overallMode: StepPersonalizationSnapshot['overallMode'] =
    overallMastery < 0.55 ? 'remedial' : overallMastery >= 0.82 ? 'advanced' : 'standard';

  const stepDecisions = standardSteps.map((step) => {
    const matchedDecisions = teachingDecisions.filter((decision) => step.knowledgePointIds.includes(decision.knowledgePointId));
    const matchedScores = step.knowledgePointIds
      .map((point) => masteryByPoint.get(point))
      .filter((value): value is number => typeof value === 'number');
    const mastery = matchedScores.length
      ? matchedScores.reduce((sum, value) => sum + value, 0) / matchedScores.length
      : fallbackMastery;
    const roundedMastery = roundMastery(mastery);
    const riskLevel = decideRisk(roundedMastery, matchedDecisions);
    const expansionStrategy = strategyForRisk(riskLevel, roundedMastery, overallMode);

    return {
      stepId: step.id,
      mastery: roundedMastery,
      riskLevel,
      expansionStrategy,
      needsExpansion: riskLevel !== 'low',
      likelyStuck: riskLevel === 'high',
      reason: reasonForStep(step, riskLevel, roundedMastery, matchedDecisions),
    };
  });

  const stuckStepIds = stepDecisions
    .filter((decision) => decision.likelyStuck)
    .map((decision) => decision.stepId);
  const weakKnowledgePointIds = unique(teachingDecisions
    .filter((decision) => decision.mastery < 0.7 || actionRaisesRisk(decision.action))
    .map((decision) => decision.knowledgePointId));
  const highRiskStepIds = stepDecisions
    .filter((decision) => decision.riskLevel === 'high')
    .map((decision) => decision.stepId);

  return {
    problemText: problemText.trim() || null,
    generatedAt: new Date().toISOString(),
    source: 'heuristic_kt_v1',
    overallMode,
    standardSteps,
    stepDecisions,
    stuckStepIds,
    summary: {
      weakKnowledgePointIds,
      highRiskStepIds,
      overallMastery,
      instruction: highRiskStepIds.length
        ? '高风险步骤需要展开讲解；低风险步骤保持简洁并引导迁移。'
        : '当前未预测明显卡点，保持标准节奏并在已掌握步骤加入变式引导。',
    },
  };
}

export function withProblemVideoStepPersonalization(
  context: LearningContext,
  problemText: string,
): LearningContext {
  return updateLearningContext(context, {
    stepPersonalization: buildProblemVideoStepPersonalization(context, problemText),
  });
}
