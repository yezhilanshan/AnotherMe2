# AnotherMe Mobile - 技术可行性验证

这是 AnotherMe 移动端的技术可行性验证项目，用于验证 React Native + Expo 能否成功对接 Python Gateway API 和 SSE 流式对话。

## 快速开始

### 1. 安装依赖

```bash
cd mobile
npm install
```

### 2. 启动 Gateway，可选启动 Web/BFF

活书移动端的书籍列表、创建、阅读等核心 API 直接访问 Python Gateway。真机测试时需要让手机能访问 Gateway：

```bash
cd ../AnotherMe/anotherme2_engine
conda run -n AnotherMe-V2 python run_gateway.py
```

如果活书页面中有动画、图片等通过 Web/BFF 代理的资源，再启动 Web 端：

```bash
cd ../AnotherMe
pnpm dev:web
```

`pnpm dev:web` 会让 Next.js 监听 `0.0.0.0:3000`。如果手机仍访问不到，请检查 Windows 防火墙是否允许 Node.js/3000 端口。

默认情况下，移动端会从 Expo dev server 自动推导电脑局域网 IP，并访问：

```text
Web/BFF: http://<电脑局域网IP>:3000
Gateway: http://<电脑局域网IP>:8083
```

如果自动检测不准，使用 Expo 公共环境变量覆盖，不需要改源码：

```bash
set EXPO_PUBLIC_DEV_SERVER_HOST=192.168.x.x
set EXPO_PUBLIC_WEB_URL=http://192.168.x.x:3000
set EXPO_PUBLIC_GATEWAY_URL=http://192.168.x.x:8083
npm start
```

`EXPO_PUBLIC_GATEWAY_OVERRIDE_URL` 和 `EXPO_PUBLIC_WEB_OVERRIDE_URL` 仍然兼容，但推荐使用上面的 `EXPO_PUBLIC_GATEWAY_URL` / `EXPO_PUBLIC_WEB_URL`，它们也和构建脚本保持一致。

在手机无法和电脑处于同一网络时，可以把 Web/BFF 暴露为隧道地址并设置：

```bash
set EXPO_PUBLIC_WEB_URL=https://your-web-tunnel.loca.lt
```

### 3. 运行应用

```bash
# 启动 Expo 开发服务器
npm start

# 或者直接在模拟器上运行
npm run android  # Android
npm run ios      # iOS
```

### 4. 使用 Expo Go 测试

1. 在手机上安装 Expo Go 应用
2. 扫描终端中显示的二维码
3. 应用会自动加载

## 功能说明

### API 测试页面

- 测试 Gateway REST API 连接
- 验证 `/healthz`、`/v1/capabilities`、`/v1/jobs` 端点

### AI 对话页面

- 测试 SSE 流式对话
- 支持三种 SSE 方案自动降级：
  1. `react-native-sse`（推荐）
  2. `fetch ReadableStream`（备选）
  3. `WebSocket`（最后手段）

## 项目结构

```
mobile/
├── App.tsx                 # 应用入口
├── lib/
│   ├── config.ts          # 配置文件
│   ├── api.ts             # REST API 客户端
│   ├── streaming.ts       # SSE 流式对话客户端
│   └── store.ts           # Zustand 状态管理
├── components/
│   ├── MainScreen.tsx     # 主界面（标签切换）
│   ├── ChatScreen.tsx     # 聊天界面
│   ├── ChatBubble.tsx     # 聊天气泡组件
│   ├── ChatInput.tsx      # 输入框组件
│   └── ApiTestScreen.tsx  # API 测试界面
└── package.json
```

## 技术栈

- **框架**: React Native + Expo SDK
- **状态管理**: Zustand
- **SSE**: react-native-sse / fetch ReadableStream / WebSocket
- **语言**: TypeScript

## Gateway API 格式

### SSE 流式对话端点

```
POST /v1/ai/chat
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "你好" }],
  "model": "gpt-4o",
  "api_key": "",
  "capability": "chat",
  "user_id": "mobile-test",
  "request_id": "mobile-xxx",
  "streaming": true
}
```

### SSE 事件格式

```typescript
// Agent 开始
{ type: 'agent_start', data: { messageId, agentId, agentName } }

// 思考中
{ type: 'thinking', data: { stage, agentId, reasoning } }

// 文字增量
{ type: 'text_delta', data: { content, messageId } }

// 完成
{ type: 'done', data: { totalActions, totalAgents, agentHadContent } }

// 错误
{ type: 'error', data: { message } }
```

## 验证清单

- [ ] Expo 项目创建成功
- [ ] 能调用 Gateway REST API
- [ ] SSE 流式对话正常工作
- [ ] 流式文字实时渲染
- [ ] 真机测试网络切换

## 下一步

技术可行性验证通过后，可以继续：

1. 接入 Supabase Auth 认证系统
2. 使用 OpenAPI 自动生成 TypeScript 客户端
3. 开发完整功能（课程、消息、知识追踪等）
4. 性能优化和生产发布

详细计划参考：`AnotherMe/doc/AnotherMe_Mobile_Upgrade_Plan.md`
