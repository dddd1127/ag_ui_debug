# AG-UI 协议调试器前端

## 项目概述

本项目是一个独立的 AG-UI 协议调试与可视化前端界面，用于：

1. **与大模型交互**：通过 AG-UI 协议发送消息，接收 SSE 流式响应
2. **可视化调试**：展示 AG-UI 协议的完整运行流程，包括：
   - 客户端发送的原始请求 JSON
   - AG-UI 协议与 Agent 内部消息的转换过程
   - Agent 内部运行事件（推理、工具调用、状态变化）

## 技术栈

- **React 18**：UI 框架
- **TypeScript**：类型安全
- **Vite**：构建工具
- **Ant Design 5**：UI 组件库
- **react-markdown**：Markdown 渲染
- **react-json-view**：JSON 可视化

## 项目结构

```
ag_ui_debug/web/
├── package.json              # 项目依赖
├── vite.config.ts            # Vite 配置（含代理）
├── tsconfig.json             # TypeScript 配置
├── index.html                # 入口 HTML
└── src/
    ├── main.tsx              # React 挂载点
    ├── App.tsx               # 根组件（布局控制器）
    ├── App.css               # 全局样式（深色主题）
    ├── hooks/
    │   ├── useAguiSSE.ts     # AG-UI SSE 通信 Hook
    │   └── useDebugWS.ts     # WebSocket 调试连接 Hook
    ├── utils/
    │   ├── aguiClient.ts     # AG-UI 客户端工具
    │   └── jsonFormatter.ts  # JSON 格式化工具
    └── components/
        ├── ChatPanel/          # 聊天界面
        │   ├── index.tsx       # 组装组件
        │   ├── ChatPanel.css   # 样式
        │   ├── MessageList.tsx # 消息列表
        │   ├── MessageInput.tsx# 消息输入
        │   └── types.ts        # 类型定义
        ├── DebugPanel/          # 调试监控面板
        │   ├── index.tsx       # 组装组件（三栏布局）
        │   ├── DebugPanel.css  # 样式
        │   ├── ClientJsonView.tsx    # 左栏：客户端请求
        │   ├── AguiTransformView.tsx # 中栏：协议转换
        │   └── AgentInfoView.tsx     # 右栏：Agent 信息
        └── SplitPane/           # 可调整分栏组件
            ├── index.tsx       # 组件实现
            └── SplitPane.css   # 样式
```

## 安装依赖

```bash
cd ag_ui_debug/web
npm install
```

## 启动开发服务器

```bash
npm run dev
```

服务启动在 `http://localhost:5173`

## 代理配置

`vite.config.ts` 中配置了开发代理：

- `/ag-ui` → `http://localhost:8090`（AG-UI 协议 SSE 端点）
- `/debug` → `ws://localhost:8090`（WebSocket 调试端点）

## 核心功能说明

### 1. ChatPanel（聊天界面）

- **上半部分**：显示聊天消息列表
  - 用户消息（蓝色，右侧对齐）
  - 助手消息（深色，左侧对齐）
  - 支持 Markdown 渲染
  - 流式接收时显示闪烁光标
- **下半部分**：消息输入框
  - 支持 Enter 发送，Shift+Enter 换行
  - 发送时显示加载状态

### 2. DebugPanel（调试监控面板）

- **左栏（客户端请求）**：
  - 展示发送到 `/ag-ui` 的原始 `RunAgentInput` JSON
  - 显示时间戳、threadId、runId、消息数等摘要
  - 支持折叠/展开查看完整 JSON

- **中栏（协议转换）**：
  - 展示请求转换：`RunAgentInput` → `AgentRequest`
  - 展示响应转换：`Agent Event` → `AG-UI Events`
  - 时间线式布局，字段映射高亮

- **右栏（Agent 内部）**：
  - 展示 Agent 原始事件：`Content`/`Message`/`BaseResponse`
  - 工具调用详情：名称、参数、结果
  - 运行状态标签

### 3. 调试信息分类

WebSocket 接收的调试数据分为三类：

| 类型 | 用途 | 展示位置 |
|------|------|---------|
| `client_request` | 原始请求 JSON | 左栏 |
| `agui_transform` | 协议转换过程 | 中栏 |
| `agent_event` | Agent 内部事件 | 右栏 |

每条数据包含：
- `id`：唯一标识
- `timestamp`：时间戳
- `runId`：关联的运行 ID
- `data`：实际数据内容

## 关键设计决策

### 1. 为什么使用独立 WebSocket 推送调试信息？

- **实时性**：AG-UI 的 SSE 响应流已经在 `/ag-ui` 端点上，不能复用同一通道
- **独立性**：调试信息和业务流分离，互不影响
- **简单性**：WebSocket 双向通信，前端可以发送控制命令

### 2. 为什么使用自定义前端而非 `@agentscope-ai/chat`？

- 需要完全控制 UI 布局（上下分区 + 三栏面板）
- 需要直接操作 AG-UI 协议，而非通过封装层
- 需要集成调试信息展示

### 3. 为什么使用深色主题？

- 调试界面通常需要长时间使用
- 深色主题更适合代码和 JSON 展示
- 减少视觉疲劳

## 边界情况处理

| 情况 | 处理方式 |
|------|---------|
| WebSocket 断线 | 自动重连（指数退避），显示断线提示 |
| SSE 流中断 | 标记消息状态为错误，显示错误提示 |
| 大量 JSON 数据 | 最大显示 100 条记录，防止内存溢出 |
| 响应式适配 | 小屏幕下 DebugPanel 三栏变为垂直堆叠 |

## 扩展建议

### 1. 添加更多 AG-UI 事件支持

当前支持：
- `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END`
- `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_RESULT`
- `RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`

可扩展：
- `REASONING_START` / `REASONING_MESSAGE_CONTENT` / `REASONING_END`
- `STATE_SNAPSHOT` / `STATE_DELTA`
- `MESSAGES_SNAPSHOT`

### 2. 添加请求历史记录

- 支持保存和加载历史请求
- 支持导出请求为 JSON 文件

### 3. 添加响应式主题切换

- 支持深色/浅色主题切换
- 支持跟随系统主题

## 与后端的交互

### 1. AG-UI 协议通信

```
前端 → POST /ag-ui
  Body: RunAgentInput JSON
  
后端 → SSE 流式响应
  data: {"type":"RUN_STARTED",...}
  data: {"type":"TEXT_MESSAGE_CONTENT",...}
  data: {"type":"RUN_FINISHED",...}
```

### 2. 调试信息推送

```
前端 → WebSocket /debug/ws
  
后端 → 推送调试消息
  {"type":"client_request","data":{"request":{...}}}
  {"type":"agui_transform","data":{"direction":"request",...}}
  {"type":"agent_event","data":{"eventType":"Content",...}}
```

## 启动方式

### 前端
```bash
cd ag_ui_debug/web
npm install
npm run dev
# 前端启动在 http://localhost:5173
```

### 后端（需配合）
```bash
cd ag_ui_debug/server
python main.py
# 后端启动在 http://localhost:8090
```

## 开发说明

### 代码规范

- 所有文件使用中文注释
- 关键函数必须包含 JSDoc 注释
- 类型定义使用 TypeScript 接口
- 组件使用函数式组件 + Hooks

### 调试技巧

1. 打开浏览器开发者工具（F12）
2. Network 面板查看 `/ag-ui` 请求和 SSE 流
3. WebSocket 面板查看 `/debug/ws` 通信
4. Console 面板查看日志输出


