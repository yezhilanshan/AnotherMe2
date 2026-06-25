# 图标重新设计总结

## 概述

将所有 emoji 和特殊字符替换为专业的 Ionicons 图标，提升视觉一致性和专业感。

## 修改的组件

### 1. MarkdownRenderer.tsx - 教学语义块图标

| 类型 | 原图标 | 新图标 | 颜色 |
|------|--------|--------|------|
| `hint` (提示) | `bulb-outline` | `bulb` | `#D97706` |
| `steps` (步骤) | `list-outline` | `footsteps` | `#0369A1` |
| `knowledge` (知识点) | `library-outline` | `school` | `#1D4ED8` |
| `mistake` (错因分析) | `alert-circle-outline` | `warning` | `#B91C1C` |
| `quiz` (小测) | `help-circle-outline` | `clipboard` | `#6D28D9` |
| `learning` (学习状态) | `stats-chart-outline` | `trending-up` | `#047857` |
| `next` (下一步) | `navigate-outline` | `arrow-forward-circle` | `#0E7490` |

**复制按钮图标：**
- 原：`✓ 已复制` / `复制` (文本)
- 新：`checkmark-circle` / `copy-outline` (Ionicons)

### 2. config.ts - 能力选择器图标

| 能力 | 原图标 | 新图标 | 说明 |
|------|--------|--------|------|
| `auto` (智能导师) | `sparkles` | `compass` | 更符合"引导"语义 |
| `chat` (聊天) | `chatbubbles` | `chatbubbles` | 保持不变 |
| `deep_solve` (深度解题) | `flash` | `bulb` | 更符合"思考"语义 |
| `deep_question` (练习生成) | `book` | `document-text` | 更符合"题目"语义 |
| `deep_research` (深度研究) | `search` | `telescope` | 更符合"探索"语义 |
| `math_animator` (数学动画) | `sparkles` | `videocam` | 更符合"视频"语义 |
| `visualize` (可视化) | `bar-chart` | `bar-chart` | 保持不变 |

### 3. FeedbackButtons.tsx - 反馈按钮图标

- 原：`👍` / `👎` (emoji)
- 新：`thumbs-up-outline` / `thumbs-up` / `thumbs-down-outline` / `thumbs-down` (Ionicons)
- 颜色：激活时绿色/红色，默认灰色

### 4. ModelSelector.tsx - 模型选择器图标

- 原：`✓` (文本)
- 新：`checkmark-circle` (Ionicons, 蓝色)

### 5. DiagnosticProbe.tsx - 诊断测验图标

**难度显示：**
- 原：`★☆` (特殊字符)
- 新：`star` / `star-outline` (Ionicons)
- 颜色：填充星 `#E65100`，空星 `#FFCC80`

**复选框：**
- 原：`☑` / `☐` (特殊字符)
- 新：`checkbox` / `square-outline` (Ionicons)
- 颜色：根据状态变化（选中蓝色，正确绿色，错误红色）

### 6. explore.tsx - API 测试状态图标

- 原：`✓ 成功` / `✕ 失败` / `⏳ 测试中` (特殊字符)
- 新：`checkmark-circle` / `close-circle` / `hourglass` (Ionicons)
- 颜色：成功绿色，错误红色，测试中黄色

## 设计原则

1. **语义一致性**：选择与功能语义匹配的图标
2. **视觉层次**：使用 outline/solid 变体表示状态
3. **颜色系统**：保持与现有设计系统一致
4. **专业感**：避免使用 emoji，使用专业图标库

## 图标库

所有图标来自 [@expo/vector-icons](https://icons.expo.fyi/) 的 Ionicons 集合，共 700+ 图标可用。

## 后续优化建议

1. 考虑添加图标动画（如加载状态）
2. 为无障碍访问添加 accessibilityLabel
3. 统一图标尺寸规范（14px/16px/18px/24px）
4. 考虑深色模式适配
