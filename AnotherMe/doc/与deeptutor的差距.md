基于对 DeepTutor 和 AnotherMe 两套系统的详细对比分析，以下是六个功能在最终展示效果上存在的差距：

全局性差距
1. 教室路径缺少 Markdown 渲染 ✅ 已修复
chat-session.tsx 中的 MessageBubble 已使用 MarkdownRenderer 渲染助手消息，支持代码高亮、LaTeX 数学渲染、表格/列表格式化等。PBL 教室路径使用 Streamdown 库渲染。

2. 两级 Markdown 渲染缺失 ⚠️ 部分解决
AnotherMe 的 MarkdownRenderer 已有内容检测启发式（detectMathContent、detectCodeContent），条件加载 remarkMath/rehypeKatex 插件。虽然不是严格的 Simple/Rich 两级架构，但实现了按需加载插件的效果。

3. 引用链接系统缺失 ✅ 已实现
linkifyCitations 已集成到 ResearchContentWithCitations 组件中，将 [web-1]、[rag-1] 等引用转为可点击链接，平滑滚动到 #references 区域。

逐功能差距
1. 聊天 (Chat)
差距	DeepTutor	AnotherMe 状态
模型思考展示	<think> 标签解析器 + ModelThinkingCard	✅ 已实现：think-segments.ts 解析器 + ModelThinkingCard 折叠卡片
"立即回答"按钮	流式过程中可点击跳过推理	❌ 未实现（需要后端配合中断机制）
附件展示	图片缩略图 + 文件 chip	✅ 已实现：EnhancedChatMessage 中 ImageViewer + 文件 chip
工具调用面板	CallTracePanel：ReAct 循环展示	✅ 已实现：按轮次分组的 Thought→Tool→Observe 展示
2. 深度解题 (Deep Solve)
差距	DeepTutor	AnotherMe 状态
阶段可视化	有步骤进度展示	✅ 已实现：DeepSolveStages 展示 planning/reasoning/writing 三阶段（修复了数据路径不匹配问题）
工具追踪	完整的 ReAct 循环展示	✅ 已实现：CallTracePanel 按轮次分组
3. 练习生成 (Quiz Practice)
差距	DeepTutor	AnotherMe 状态
交互式答题	可点击选项卡片作答	✅ 已实现：QuizViewer radio-button 样式选项卡片
评分反馈	提交后显示正确/错误	✅ 已实现：绿色/红色高亮 + CheckCircle/XCircle 图标
重试功能	有 "Retry" 按钮	✅ 已实现：handleRetry 重置作答状态
题目导航	圆点导航 + 进度条 + 上/下一题	✅ 已实现：圆点导航 + 可视化进度条 + 上/下一题按钮
笔记集成	每题可收藏	✅ 已实现：Bookmark/BookmarkCheck 收藏按钮
追问对话	QuestionFollowupPanel	✅ 已实现：QuestionFollowupPanel 组件
结果记录	recordQuizResults	✅ 已实现：提交时调用 /api/students/{userId}/quiz-answers
题目渲染	MarkdownRenderer 渲染	✅ 已实现：题目/选项/解析均使用 MarkdownRenderer
4. 深度研究 (Deep Research)
差距	DeepTutor	AnotherMe 状态
大纲编辑器	ResearchOutlineEditor	✅ 已实现：支持增删改子主题
研究阶段面板	ResearchStagePanel	✅ 已实现：四阶段可视化
引用展示	引用链接化 + #references	✅ 已实现：linkifyCitations + ResearchContentWithCitations
模式选择 UI	notes/report/comparison/learning_path	✅ 已实现：Composer 区域模式选择芯片
5. 数学动画 (Math Animator)
差距	DeepTutor	AnotherMe 状态
图片全屏查看	点击弹出全屏 overlay	✅ 已实现
渲染审查警告	visual_review 警告卡片	✅ 已实现
元数据徽章	质量等级、重试次数、耗时	✅ 已实现
6. 可视化 (Visualization)
差距	DeepTutor	AnotherMe 状态
全屏模式	Escape 关闭，黑色模糊背景	✅ 已实现
HTML iframe 增强	KaTeX 注入 + 新标签打开	✅ 已实现
渲染类型标签	"Chart.js · bar" 等标签	✅ 已实现
代码展示一致性	Show Code + Copy Code	✅ 已实现
