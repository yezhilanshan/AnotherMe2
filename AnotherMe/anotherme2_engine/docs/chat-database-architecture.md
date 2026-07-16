# 聊天数据库架构

## 双数据库设计

本系统使用两个独立的数据库来存储不同类型的消息数据，各自服务于不同的业务场景。

### 1. Tutor Engine SQLite (`data/user/chat_history.db`)

**用途**: AI 辅导对话（用户 ↔ AI）

**存储内容**:
- `sessions` — AI 对话会话（标题、摘要、偏好设置）
- `messages` — AI 对话消息（角色、内容、能力、事件流）
- `turns` — 对话轮次（能力、状态、错误信息）
- `turn_events` — 轮次事件流（类型、来源、阶段、内容）
- `notebook_entries` — 错题本条目（题目、答案、掌握状态）
- `notebook_categories` / `notebook_entry_categories` — 错题本分类

**访问模式**: 通过 `SQLiteSessionStore` 类，所有操作通过 `asyncio.Lock` 保证线程安全。

**管理方**: Tutor Engine 独立管理，不依赖 API Gateway。

### 2. API Gateway PostgreSQL/SQLite

**用途**: 人工消息系统（用户 ↔ 用户）

**存储内容**:
- `conversations` — 对话（类型、名称、创建者、元数据）
- `conversation_members` — 对话成员（加入时间、未读数、最后已读位置）
- `messages` — 消息（序号、发送者、类型、内容、来源引用）
- `message_attachments` — 消息附件（文件URL、大小、类型）
- `ai_chat_sessions` / `ai_chat_messages` — AI 聊天会话（网关侧的 AI 对话记录）
- `ai_message_feedback` — AI 消息反馈

**访问模式**: 通过 SQLAlchemy ORM，使用 `session_scope()` 事务管理。

**管理方**: API Gateway 统一管理。

## 数据链接机制

两个数据库通过以下方式关联：

### 消息来源引用

`messages.source_type` 和 `messages.source_ref_id` 字段用于标记消息来源：

| source_type | 含义 | source_ref_id |
|-------------|------|---------------|
| `manual` | 用户手动发送 | null |
| `ai_tutor` | AI 辅导生成 | Tutor Engine 的 message_id |
| `classroom` | 课堂生成 | 课堂 ID |
| `problem_video` | 题目视频 | 作业 ID |

### 对话元数据

`conversations.metadata_json` 字段存储关联信息：

```json
{
  "tutor_session_id": "unified_1234567890_abc12345",
  "linked_stage_id": "stage-xyz",
  "source": "ai_tutor"
}
```

## 为什么不用单一数据库？

1. **职责不同**: Tutor Engine 是独立的微服务，可以脱离 API Gateway 运行
2. **访问模式不同**: Tutor Engine 需要高频的轮次事件写入；API Gateway 需要复杂的对话成员管理和未读计数
3. **部署灵活性**: Tutor Engine 可以独立扩展，不受 Gateway 数据库负载影响
4. **数据生命周期不同**: Tutor Engine 的轮次事件是临时数据；对话消息是持久数据

## 查询跨库数据

当需要同时获取 AI 对话和人工消息时：

1. 从 API Gateway 查询 `conversations` 获取对话列表
2. 检查 `metadata_json.tutor_session_id` 是否存在
3. 如果存在，用该 ID 从 Tutor Engine 查询 AI 对话详情
4. 合并结果返回给客户端
