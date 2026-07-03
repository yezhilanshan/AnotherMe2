/**
 * Lightweight client-side knowledge point extraction from text.
 * Mirrors the backend _extract_knowledge_points logic in chat_service.py.
 * Used to populate knowledge_points in learning events so BKT can update.
 */

const KNOWLEDGE_KEYWORDS: readonly string[] = [
  // 数学 - 函数
  "二次函数",
  "一次函数",
  "反比例函数",
  "指数函数",
  "对数函数",
  "三角函数",
  "函数图像",
  "函数单调性",
  // 数学 - 方程与不等式
  "一元二次方程",
  "方程",
  "不等式",
  "线性方程组",
  // 数学 - 几何
  "几何",
  "三角形",
  "直角三角形",
  "相似三角形",
  "全等三角形",
  "勾股定理",
  "圆",
  "圆与扇形",
  "平行四边形",
  // 数学 - 微积分
  "导数",
  "极限",
  "积分",
  // 数学 - 其他
  "概率",
  "概率统计",
  "排列组合",
  "数列",
  "向量",
  "矩阵",
  // 物理
  "牛顿定律",
  "力学",
  "电路",
  "电磁感应",
  "光的折射",
  "动能定理",
  "动量",
  "万有引力",
  // 化学
  "化学反应",
  "氧化还原",
  "电解质",
  "有机化学",
  // 英语
  "语法",
  "时态",
  "从句",
  "虚拟语气",
];

// Regex fallback: matches terms like "XX函数", "XX方程", "XX定理", "XX公式"
const DOMAIN_TERM_RE =
  /([一-龥A-Za-z0-9]{2,16}(?:函数|方程|定理|法则|模型|公式|定律|不等式|变换|级数))/g;

/**
 * Extract knowledge point identifiers from Chinese text.
 * Returns matched keywords (deduplicated, ordered by first occurrence).
 * Returns empty array if nothing matches — no fallback snippets.
 */
export function extractKnowledgePointsFromText(text: string): string[] {
  if (!text) return [];

  const hits: string[] = [];
  const seen = new Set<string>();

  // 1. Exact keyword match
  for (const keyword of KNOWLEDGE_KEYWORDS) {
    if (text.includes(keyword) && !seen.has(keyword)) {
      seen.add(keyword);
      hits.push(keyword);
    }
  }
  if (hits.length > 0) return hits;

  // 2. Regex fallback for compound domain terms
  const regexMatches = text.match(DOMAIN_TERM_RE);
  if (regexMatches) {
    for (const m of regexMatches) {
      if (!seen.has(m)) {
        seen.add(m);
        hits.push(m);
      }
      if (hits.length >= 3) break;
    }
  }

  return hits;
}
