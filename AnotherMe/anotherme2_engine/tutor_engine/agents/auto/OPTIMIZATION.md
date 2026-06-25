# Auto Pipeline 优化指南

## 性能优化选项

### 1. 跳过 ANALYZING 阶段（节省 1-2 秒）

```python
config_overrides = {
    "skip_analyzing": True  # 默认已启用
}
```

**效果**: 跳过"我理解了你的意图"这个纯 UI 反馈的 LLM 调用。

### 2. 跳过 SYNTHESIZING 阶段（节省 2-3 秒）

```python
config_overrides = {
    "skip_synthesizing": True  # 默认已启用
}
```

**效果**: 当工具调用已产生结果时，跳过最终综合的 LLM 调用。

### 3. 并行工具调用（节省 2-5 秒）

```python
config_overrides = {
    "parallel_tool_calls": True  # 默认已启用
}
```

**效果**: 当路由器返回多个工具调用时，同时执行而非串行等待。

### 4. 减少迭代次数

```python
config_overrides = {
    "max_iterations": 3  # 默认从 4 降到 3
}
```

**效果**: 减少"思考-行动-观察"循环次数。

### 5. 使用更快的路由器模型

```python
config_overrides = {
    "router_model": "gpt-4o-mini"  # 使用更快的模型
}
```

**效果**: 路由决策使用更小更快的模型，主模型用于子能力执行。

## 完整优化配置示例

```python
# 最快配置（牺牲一些智能程度）
config_overrides = {
    "skip_analyzing": True,
    "skip_synthesizing": True,
    "parallel_tool_calls": True,
    "max_iterations": 1,
    "router_model": "gpt-4o-mini"
}

# 平衡配置（推荐）
config_overrides = {
    "skip_analyzing": True,
    "skip_synthesizing": True,
    "parallel_tool_calls": True,
    "max_iterations": 2,
    "router_model": ""  # 使用主模型
}

# 完整配置（最智能）
config_overrides = {
    "skip_analyzing": False,
    "skip_synthesizing": False,
    "parallel_tool_calls": True,
    "max_iterations": 4,
    "router_model": ""
}
```

## 性能对比

| 配置 | 典型延迟 | 场景 |
|------|----------|------|
| 默认（优化后） | 3-8 秒 | 简单查询 |
| 最快配置 | 2-5 秒 | 简单查询 |
| 完整配置 | 8-15 秒 | 复杂多步任务 |

## 前端调用示例

```typescript
// 移动端调用
const response = await streamGatewayChat({
  capability: "auto",
  config: {
    skip_analyzing: true,
    skip_synthesizing: true,
    parallel_tool_calls: true,
    max_iterations: 2,
    router_model: "gpt-4o-mini"
  }
});
```

## 注意事项

1. **router_model** 必须是当前 API 支持的模型
2. **skip_synthesizing** 可能导致最终回答较短
3. **max_iterations=1** 可能错过多步任务的最佳路由
4. 建议先用"平衡配置"测试，再根据需求调整
