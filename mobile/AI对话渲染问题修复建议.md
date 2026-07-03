你的组件设计**功能覆盖很全**，但从商业级移动端 AI 聊天的角度看，当前结构有几个明显风险：

> **输出能力太丰富，但渲染协议、流式路径、最终路径、结构化组件之间的边界可能不够清晰。**\
> 这会导致 React Native 的 JS 线程压力很大，也容易出现卡死、闪退、渲染异常、维护困难。

下面按严重程度分析。

***

# 1. `ChatBubble` 很可能变成“超级调度器”

你现在的核心是：

```
ChatBubble
→ 判断 Message 类型
→ 决定流式文本 / Markdown / 结构化组件 / Live Book Block / 工具 / 来源 / 可视化

```

这在早期很方便，但后期会有一个问题：

```
ChatBubble 既判断数据类型
又判断消息状态
又判断渲染器
又处理 fallback
又处理 answerSteps / answerBlocks / answerComponents
又处理 streaming / final

```

这样会让 `ChatBubble.tsx` 逐渐变成一个“总控文件”，后续任何新能力都要改它。

更合理的结构是：

```
ChatBubble
├── MessageBubbleShell
└── MessageContentRenderer
    ├── StreamingContentRenderer
    ├── FinalContentRenderer
    ├── StructuredContentRenderer
    ├── ToolContentRenderer
    └── ErrorFallbackRenderer

```

也就是说，`ChatBubble` 只负责：

```
用户/助手方向
头像/气泡外壳
loading/error 状态
把 message 交给内容渲染器

```

不要让它直接知道所有组件细节。

***

# 2. 输出协议太多：`answerSteps`、`answerComponents`、`answerBlocks`、Live Book blocks 重叠

你现在有这些结构化输出：

```
AnswerStepsRenderer
AnswerComponentsRenderer
AnswerBlocksRenderer
TutorStepRenderer
BlockRenderer
Live Book blocks
MarkdownRenderer

```

这里最大的问题是：**后端到底应该返回哪一种格式？**

比如一个“分步讲解”可以被表示成：

```
answerSteps
TutorStepRenderer 的 steps
Live Book 的 SectionBlock + TextBlock
Markdown 的有序列表
AnswerBlocksRenderer

```

这会导致同一个教学内容有很多种表达方式。

后期问题会很明显：

```
后端不知道该返回哪种格式
前端要兼容越来越多历史格式
同一类内容有多个 renderer
样式不统一
bug 很难定位

```

建议你统一成一个主协议，比如：

```
type MessageContent =
  | { type: "markdown"; text: string }
  | { type: "blocks"; blocks: TutorBlock[] }
  | { type: "tool_result"; tool: ToolCallData }
  | { type: "sources"; sources: Source[] }
  | { type: "visualization"; data: VisualizeData };

```

然后把 `answerSteps`、`answerComponents`、`answerBlocks` 逐步收敛为一种：

```
blocks

```

最终后端尽量只返回：

```
普通问答：markdown
教学结构化回答：blocks
工具调用结果：tool_result
引用来源：sources
可视化结果：visualization

```

不要长期保留太多并行协议。

***

# 3. 流式渲染路径太复杂，容易压爆 JS 线程

你现在有：

```
StreamingMathRenderer
StreamingPlainTextRenderer
MarkdownRenderer
FinalMarkdownRenderer
MathBlockRenderer
InlineMathRenderer

```

这说明你已经把“流式输出”和“最终输出”分开了，这个方向是对的。

但风险在于：

```
流式过程中同时处理普通文本 + 行内数学 + 块级数学

```

这很容易变重。

尤其流式输出时，内容是不完整的。例如：

```
设函数 $f(x)=

```

或者：

```
$$
\frac{

```

数学公式还没闭合，渲染器就要不断判断当前状态。每来一个 chunk 都解析一次，会非常耗 JS 线程。

建议改成三级策略：

```
生成中：
优先 StreamingPlainTextRenderer

检测到稳定数学片段：
只渲染已经闭合的 $...$ 或 $$...$$

生成完成：
交给 FinalMarkdownRenderer + MathBlockRenderer

```

也就是说，流式阶段不要追求完美数学渲染。移动端最重要的是：

```
不卡
不中断
不闪退

```

而不是每个 token 刚出来就精确排版。

***

# 4. MarkdownRenderer 可能是性能核心瓶颈

你的 AI 导师输出包含：

```
标题
段落
列表
代码块
表格
数学公式
结构化 block
引用
工具结果
图片
WebView
动画
图表

```

其中最危险的是：

```
MarkdownRenderer
StreamingMathRenderer
CodeBlock
Table
MathBlock
WebViewBlock
AnimationBlock
ConceptGraphBlock

```

这些都可能很重。

尤其不要这样：

```
<MarkdownRenderer content={streamingText} />

```

更合理的是：

```
流式中：纯文本 / 轻量数学
结束后：MarkdownRenderer
复杂块：懒加载

```

建议给内容分层：

```
Level 1：Text / Plain Markdown
Level 2：Code / Table / Math
Level 3：Figure / Animation / WebView / ConceptGraph

```

Level 3 的组件不要一上来就渲染，应该：

```
进入屏幕附近再渲染
用户点击展开再渲染
失败时 fallback

```

***

# 5. Live Book Block 太丰富，但缺少“渲染预算”概念

你现在的 Live Book block 很多：

```
TextBlock
CalloutBlock
SectionBlock
CodeBlock
TimelineBlock
FlashCardsBlock
UserNoteBlock
QuizBlock
FigureBlock
InteractiveBlock
AnimationBlock
DeepDiveBlock
ConceptGraphBlock
WebViewBlock

```

这很强，但也很危险。

因为 AI 一次回答里理论上可以塞很多 block：

```
一个 Section
一个 Timeline
三个 FlashCards
一个 Quiz
一个 ConceptGraph
一个 Animation
一个 WebView

```

这对移动端来说太重。

你需要设置渲染预算，例如：

```
一条消息默认最多直接渲染 3 个重型 block
Animation / WebView / ConceptGraph 默认折叠
图片懒加载
长代码折叠
长表格折叠
Quiz 可展开
DeepDive 默认折叠

```

否则 AI 一旦生成复杂内容，JS 线程和内存都会被拖垮。

***

# 6. `ReasoningBlock` 设计要谨慎

你写的是：

```
ReasoningBlock.tsx — 展示 AI 的推理/思考过程

```

这里建议改名和定位。

不要把它设计成展示“完整思维过程”。更适合做成：

```
ReasoningSummaryBlock
SolutionTraceBlock
ThinkingStatusBlock
StepExplanationBlock

```

展示内容应该是：

```
我正在分析题目类型
我会先找已知条件
我会尝试列方程
我得到的关键步骤是……

```

不要展示模型内部完整推理链。对于 AI 导师产品来说，用户需要的是**可验证的解题步骤和教学解释**，不是模型内部隐藏思考。

更好的命名是：

```
SolutionProcessBlock

```

或者：

```
ReasoningSummaryBlock

```

***

# 7. `ToolCallBlock`、`SourcesBlock`、`WebPreview` 不应该和普通正文混在一个渲染层级

工具调用、来源、网页预览属于“辅助信息”，不是正文内容。

如果它们和 Markdown / blocks 混在一起，会导致消息结构复杂。

建议一条 assistant message 分成几个区域：

```
AssistantMessage
├── MainContent        主回答
├── Attachments        图片/图表/动画/文件
├── Sources            引用来源
├── ToolTrace          工具调用状态，可折叠
├── Feedback           点赞/点踩
└── Debug              仅开发环境显示

```

这样更清晰。

尤其 `ToolCallBlock` 建议默认折叠：

```
正在搜索资料...
已完成网页读取
已生成图表

```

不要默认展示大量工具输入输出。否则对学生用户很干扰，也会增加渲染压力。

***

# 8. 缺少统一的 `MessageContent AST`

你现在看起来是“组件很多”，但真正应该有一个核心中间层：

```
后端原始输出
→ normalize
→ MessageContent AST
→ renderer registry
→ React Native components

```

也就是不要让每个组件直接适配后端返回数据。

推荐结构：

```
messageNormalizer.ts
blockSchema.ts
rendererRegistry.ts
MessageContentRenderer.tsx

```

例如：

```
type ContentNode =
  | { type: "paragraph"; text: string }
  | { type: "markdown"; text: string }
  | { type: "math_inline"; latex: string }
  | { type: "math_block"; latex: string }
  | { type: "code"; language?: string; code: string }
  | { type: "callout"; variant: "hint" | "warning" | "success"; children: ContentNode[] }
  | { type: "quiz"; question: string; options: string[] }
  | { type: "figure"; uri: string; caption?: string }
  | { type: "sources"; sources: Source[] };

```

然后所有后端格式都先转成这个统一结构。

这样你以后新增组件，不需要改所有地方。

***

# 9. 错误边界只有一个可能不够

你有：

```
RenderDebugBoundary.tsx

```

这是好事。

但建议不是只在最外层包一个，而是对重型 block 单独包：

```
MessageBubble
├── MarkdownBoundary
├── MathBoundary
├── WebViewBoundary
├── AnimationBoundary
├── VisualizationBoundary
└── ToolBoundary

```

因为一个公式渲染失败，不应该导致整条消息挂掉。

理想效果是：

```
公式渲染失败 → 显示 LaTeX 原文
图表渲染失败 → 显示“图表加载失败”
WebView 失败 → 显示链接卡片
动画失败 → 显示静态预览图

```

***

# 10. 你现在最大的问题不是“组件太多”，而是“缺少主次”

你的输出系统现在很像：

```
AI 导师什么都能输出

```

但移动端商业产品需要的是：

```
80% 情况稳定渲染
15% 情况增强展示
5% 情况高级交互

```

建议你把组件分成三层：

## 第一层：必须极稳

```
ChatBubble
MessageBubbleShell
StreamingPlainTextRenderer
FinalMarkdownRenderer
MarkdownRenderer
SafeImage
SourcesBlock
FeedbackButtons

```

这些必须稳定、轻量、可恢复。

## 第二层：教学增强

```
TutorStepRenderer
QuizBlock
CalloutBlock
FlashCardsBlock
TimelineBlock
CodeBlock
MathBlockRenderer
InlineMathRenderer

```

这些可以展示，但要注意折叠、懒加载、错误兜底。

## 第三层：重型能力

```
ConceptGraphBlock
AnimationBlock
InteractiveBlock
WebViewBlock
MathAnimatorPreview
VisualizePreview
WebPreview
ToolCallBlock

```

这些默认不要直接全部渲染，应该按需展开。

***

# 11. 我认为你当前最可能导致卡死/闪退的点

按风险排序：

风险

严重程度

原因

流式时实时数学/Markdown 渲染

高

每个 chunk 都解析，JS 线程压力大

ChatBubble 调度过重

高

每次消息更新可能触发复杂判断和重渲染

输出协议过多

高

answerSteps / components / blocks / markdown 互相重叠

Live Book block 过重

高

WebView、动画、概念图、交互组件都很吃资源

缺少渲染预算

高

一条消息可能渲染太多重组件

MarkdownRenderer 功能过全

中高

表格、代码、数学都容易造成长文本卡顿

Tool/Reasoning 默认展示

中

干扰主内容，也增加渲染负担

错误边界粒度不够

中

一个子组件异常可能拖垮整条消息

组件命名职责部分重叠

中

长期维护成本高

SafeImage 还不够

中

图片还需要缓存、懒加载、尺寸限制

***

# 12. 我建议你重构成这个结构

比较稳的结构是：

```
mobile/components/chat/
├── ChatBubble.tsx
├── MessageBubbleShell.tsx
├── MessageContentRenderer.tsx
├── StreamingMessageRenderer.tsx
├── FinalMessageRenderer.tsx
├── MessageErrorBoundary.tsx

mobile/components/renderers/
├── MarkdownRenderer.tsx
├── MathRenderer.tsx
├── CodeRenderer.tsx
├── PlainTextRenderer.tsx

mobile/components/blocks/
├── BlockRenderer.tsx
├── TextBlock.tsx
├── CalloutBlock.tsx
├── QuizBlock.tsx
├── FigureBlock.tsx
├── CodeBlock.tsx
├── TimelineBlock.tsx
├── FlashCardsBlock.tsx

mobile/components/heavy-blocks/
├── AnimationBlock.tsx
├── ConceptGraphBlock.tsx
├── WebViewBlock.tsx
├── InteractiveBlock.tsx
├── VisualizePreview.tsx
├── MathAnimatorPreview.tsx

mobile/components/message-meta/
├── SourcesBlock.tsx
├── ToolCallBlock.tsx
├── FeedbackButtons.tsx
├── ReasoningSummaryBlock.tsx

mobile/components/schema/
├── messageTypes.ts
├── blockTypes.ts
├── normalizeMessage.ts
├── rendererRegistry.ts

```

关键是增加这几个文件：

```
MessageContentRenderer.tsx
normalizeMessage.ts
rendererRegistry.ts
blockTypes.ts

```

这几个是你从“组件堆叠”走向“工程化渲染系统”的关键。

***

# 13. 最优先改的 5 件事

第一，**把流式输出和最终输出完全分开**：

```
streaming → PlainText / lightweight math
final → Markdown / blocks / math / code

```

第二，**把** **`ChatBubble`** **瘦身**：

```
ChatBubble 只做外壳
MessageContentRenderer 负责内容分发

```

第三，**统一结构化输出协议**：

```
逐步减少 answerSteps / answerComponents / answerBlocks 并存
统一到 blocks

```

第四，**给重型组件加折叠和懒加载**：

```
WebViewBlock
AnimationBlock
ConceptGraphBlock
InteractiveBlock
VisualizePreview
MathAnimatorPreview

```

第五，**给每个重型 renderer 单独加错误兜底**：

```
Math 失败 → LaTeX 原文
Markdown 失败 → PlainText
WebView 失败 → 链接卡片
Animation 失败 → 静态预览

```

***

# 总结

你现在的输出组件体系已经很丰富，说明产品野心很大。但目前最大隐患是：

```
渲染能力太多
协议入口太多
ChatBubble 调度太重
流式阶段做了太多复杂渲染
重型 block 缺少懒加载和渲染预算

```

商业级移动端 AI 导师更应该追求：

```
流式阶段轻
最终渲染稳
结构协议统一
重组件按需加载
错误局部兜底
ChatBubble 保持简单

```

最核心的一句话：

> **不要让 AI 的每一次 token 输出都触发一次完整的教学内容渲染系统。流式输出只负责“看见字在出来”，最终输出才负责“漂亮、结构化、富媒体”。**

