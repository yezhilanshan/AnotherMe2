## Mobile 组件审查报告 — 优化进度更新

对 mobile 文件夹下所有组件和核心模块的全面代码审查，共发现 **11 个 HIGH**、**10+ 个 MEDIUM**、**8 个 LOW** 级别的问题。

---

### 一、HIGH 级别问题（11/11 已修复 ✅）

| # | 问题 | 文件 | 状态 | 修复方式 |
|---|------|------|------|----------|
| 1 | Clipboard API 已废弃 | `ChatBubble.tsx` | ✅ | 已改用 `expo-clipboard` 动态 require，带 `@react-native-clipboard/clipboard` 降级 |
| 2 | WebView ref 使用普通变量 | `WebPreview.tsx` | ✅ | 已改为 `useRef<WebView>(null)` |
| 3 | 流式中每次 token 触发全量解析 | `MarkdownRenderer.tsx` | ✅ | 已添加 80ms 防抖机制，流式结束后立即刷新 |
| 4 | `persistProgress` 依赖过宽 | `book-reader.tsx` | ✅ | 已改用 ref 模式 + 500ms 防抖写入，避免每次答题都触发存储 |
| 5 | `renderBlock` 未做 memo | `book-reader.tsx` | ✅ | 已提取 `QuizBlockView` 为独立 `React.memo` 组件，quiz 交互不再导致整页重渲染 |
| 6 | 模块级共享可变状态 | `chatSlice.ts` | ✅ | `abortController`/`pendingContent` 等已移入 `createChatSlice` 闭包内 |
| 7 | 50ms flush 无防重入保护 | `chatSlice.ts` | ✅ | 添加 `flushInProgress` 守卫，防止 `set()` 执行期间的重入调用 |
| 8 | base64 编码大文件内存风险 | `ChatInput.tsx` | ✅ | 添加 `MAX_IMAGE_SIZE(15MB)` / `MAX_FILE_SIZE(10MB)` 检查及用户提示 |
| 9 | setTimeout 未清理 | `ChatBubble.tsx` / `MarkdownRenderer.tsx` | ✅ | 均存入 `useRef` 并在 `useEffect` cleanup 中清除 |
| 10 | FlatList 误用 | `diagnostic.tsx` / `knowledge.tsx` | ✅ | probes tab 和 knowledge 页面改用 `ScrollView`；states tab 保留 FlatList（使用正确） |
| 11 | AbortSignal.any 降级逻辑有误 | `streaming.ts` | ✅ | 降级时手动组合双信号，通过 `addEventListener("abort", ..., { once: true })` 确保超时和取消均生效 |

---

### 二、MEDIUM 级别问题（4/10 已修复）

#### 已修复 ✅

| 问题 | 文件 | 修复方式 |
|------|------|----------|
| 4 个组件缺少 `React.memo` | `FeedbackButtons`、`CapabilitySelector`、`KnowledgeStateCard`、`ChatInput` | 均已包裹 `React.memo` |
| `CapabilitySelector` 动画未清理 | `CapabilitySelector.tsx` | `useEffect` return 中调用 `animation.stop()` |
| `knowledge.tsx` 加载时无法返回 | `knowledge.tsx` | loading 状态保留 header 导航栏，用户可随时返回 |
| `editMessage` 丢失上下文 | `chatSlice.ts` | 重新发送时补传原消息的 `capability` 和 `attachments` |

#### 未修复（待处理）

| 问题 | 文件 | 说明 |
|------|------|------|
| `ModelSelector` 内联 ItemSeparatorComponent | `ModelSelector.tsx` | 每次渲染创建新组件引用，建议提取为静态组件 |
| 麦克风按钮无功能 | `ChatInput.tsx` | placeholder 写着"按住说话"但按钮无 `onPress`，需实现或移除 |
| 图片/文件选择无 loading 指示器 | `ChatInput.tsx` | 异步操作可能耗时数秒，建议添加 ActivityIndicator |
| Toast 无动画 | `ChatBubble.tsx` | "复制成功"突然出现/消失，建议加淡入淡出过渡 |
| SVG/HTML 渲染存在 XSS 风险 | `VisualizePreview.tsx` | SVG 和 HTML 路径未转义，需统一使用 `escapeHtml` |
| CDN 脚本无完整性校验 | `VisualizePreview.tsx` | jsdelivr CDN 无 SRI hash，建议添加 integrity 属性 |

---

### 三、LOW 级别问题（1/8 已修复）

#### 已修复 ✅

| 问题 | 文件 | 修复方式 |
|------|------|----------|
| `getTeachingSuggestion` O(n) 线性查找 | `diagnostic.tsx` | 转为 `Map<string, string>` 做 O(1) 查询，用 `useMemo` 缓存 |

#### 未修复（待处理）

| 问题 | 文件 | 说明 |
|------|------|------|
| 展开/折叠无动画 | `ToolCallBlock`、`SourcesBlock` | 内容弹出/消失突兀，建议参照 `ReasoningBlock` 添加弹性过渡 |
| 深色模式缺失 | 全局 | 所有组件使用硬编码浅色主题值，无 `useColorScheme` 支持 |
| 时间显示死代码 | `ChatBubble.tsx` | `timeStr` 被计算但从未渲染，建议移除或显示 |
| `ModelSelector` 缺少供应商颜色 | `ModelSelector.tsx` | "通义千问" provider 指示灯显示灰色 |
| `KnowledgeStateCard` 进度条无动画 | `KnowledgeStateCard.tsx` | mastery 变化时宽度直接跳变，建议加 `Animated` |
| `FeedbackButtons` 无触觉反馈 | `FeedbackButtons.tsx` | 点赞/踩无 haptic 振动 |
| `streaming.ts` 重试无随机抖动 | `streaming.ts` | 指数退避可能导致惊群效应，建议加 jitter |

---

### 四、修复统计

- **HIGH**: 11/11 已修复 (100%)
- **MEDIUM**: 4/10 已修复 (40%)
- **LOW**: 1/8 已修复 (12.5%)
- **总计**: 16/29 已修复 (55%)

### 五、建议后续处理顺序

1. **VisualizePreview XSS 防护** — 安全优先级最高
2. **CDN 脚本完整性校验** — 安全相关
3. **图片/文件选择 loading 指示器** — UX 影响较大
4. **Toast 淡入淡出动画** — 体验打磨
5. **深色模式支持** — 全局性改造，建议单独规划
