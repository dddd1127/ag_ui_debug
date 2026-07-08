/**
 * README.md
 * 
 * AG-UI 协议调试器后端服务
 * 
 * 项目概述
 * ========
 * 
 * 独立的 AG-UI 协议兼容服务，基于 FastAPI 实现，不依赖 AgentApp 框架。
 * 
 * 核心功能：
 * 1. 实现 AG-UI 协议端点（POST /ag-ui）
 * 2. 驱动 agentscope 的 Agent 运行
 * 3. 提供 WebSocket 调试信息推送（WS /debug/ws）
 * 4. 完整的协议转换可视化（AG-UI ↔ Agent）
 * 
 * 技术栈
 * ======
 * 
 * - FastAPI: Web 框架
 * - Uvicorn: ASGI 服务器
 * - Pydantic: 数据模型
 * - agentscope: Agent 框架
 * - ag-ui-protocol: AG-UI 协议包
 * - fakeredis: 模拟 Redis（用于 session）
 * 
 * 项目结构
 * ========
 * 
 * ```
 * ag_ui_debug/server/
 * ├── main.py              # 入口文件
 * ├── app.py               # FastAPI 应用构建
 * ├── agui_endpoint.py     # POST /ag-ui 端点（核心）
 * ├── agui_adapter.py      # AG-UI ↔ Agent 转换器（核心）
 * ├── agent_runner.py      # Agent 创建和运行
 * ├── debug_ws.py          # WebSocket 调试端点
 * ├── debug_publisher.py    # 调试信息发布
 * ├── requirements.txt     # 依赖声明
 * └── README.md            # 本文档
 * ```
 * 
 * 核心文件说明
 * ==========
 * 
 * ### main.py
 * 入口文件，启动 Uvicorn 服务器。
 * 自动将 agentscope-runtime 的 src 目录添加到 Python 路径。
 * 
 * ### app.py
 * FastAPI 应用构建器：
 * - 创建 FastAPI 实例
 * - 配置 CORS
 * - 注册所有路由
 * - 管理生命周期
 * 
 * ### agui_endpoint.py
 * AG-UI 协议端点实现：
 * - POST /ag-ui: 接收 RunAgentInput，返回 SSE 流
 * - GET /ag-ui: 端点信息
 * - generate_agui_stream(): 生成 SSE 事件流
 * 
 * ### agui_adapter.py
 * 协议转换器（核心）：
 * - convert_agui_messages_to_agent_messages(): AG-UI 消息 → Agent 消息
 * - convert_agui_tools_to_agent_tools(): AG-UI 工具 → Agent 工具
 * - agui_request_to_agent_request(): RunAgentInput → AgentRequest
 * - agent_event_to_agui_events(): Agent 事件 → AG-UI 事件
 * - AGUIEventTracker: 事件追踪器
 * 
 * ### agent_runner.py
 * Agent 运行器：
 * - create_agent(): 创建 Agent 实例（含 get_weather 工具）
 * - run_agent_stream(): 运行 Agent 并返回事件流
 * - get_agent_config(): 获取配置信息
 * - get_weather(): 实时天气查询（调用 wttr.in API）
 * - convert_agui_messages_to_msgs(): AG-UI 消息 → agentscope Msg 转换
 * 
 * ### debug_ws.py
 * WebSocket 调试端点：
 * - /debug/ws: WebSocket 连接
 * - push_debug_info(): 推送调试信息到所有客户端
 * 
 * ### debug_publisher.py
 * 调试信息发布器：
 * - publish_request_raw(): 推送原始请求
 * - publish_request_transform(): 推送请求转换
 * - publish_response_transform(): 推送响应转换
 * - publish_agent_event(): 推送 Agent 事件
 * 
 * 安装依赖
 * ========
 * 
 * 方式一：使用 agentscope-runtime 的虚拟环境（推荐）
 * ```bash
 * cd /path/to/agentscope-runtime-main
 * source .venv/bin/activate
 * cd ag_ui_debug/server
 * python main.py
 * ```
 * 
 * 方式二：独立安装
 * ```bash
 * pip install -r requirements.txt
 * python main.py
 * ```
 * 
 * 启动方式
 * ========
 * 
 * ### 开发模式（自动重载）
 * ```bash
 * python main.py
 * ```
 * 
 * 或：
 * ```bash
 * uvicorn main:app --host 127.0.0.1 --port 8090 --reload
 * ```
 * 
 * ### 生产模式
 * ```bash
 * uvicorn main:app --host 127.0.0.1 --port 8090 --workers 4
 * ```
 * 
 * 服务启动后：
 * - HTTP API: http://127.0.0.1:8090
 * - AG-UI 端点: http://127.0.0.1:8090/ag-ui
 * - WebSocket 调试: ws://127.0.0.1:8090/debug/ws
 * - 健康检查: http://127.0.0.1:8090/health
 * - API 文档: http://127.0.0.1:8090/docs (Swagger UI)
 * 
 * 环境变量
 * ========
 *
 * | 变量名 | 默认值 | 说明 |
 * |--------|--------|------|
 * | ANTHROPIC_AUTH_TOKEN | 内置密钥 | Anthropic 兼容 API 密钥 |
 * | ANTHROPIC_BASE_URL | Volcengine | API 基础 URL |
 * | ANTHROPIC_MODEL | GLM-5.1 | 模型名称 |
 * | WTTR_URL | https://wttr.in | 天气服务地址（wttr.in 免费 API，无需 Key） |
 * 
 * 配置方式：
 * ```bash
 * export ANTHROPIC_AUTH_TOKEN="your-api-key"
 * export ANTHROPIC_BASE_URL="https://api.example.com"
 * export ANTHROPIC_MODEL="gpt-4"
 * ```
 * 
 * 协议转换流程
 * ============
 * 
 * ### 请求转换
 * 
 * ```
 * AG-UI RunAgentInput          AgentRequest
 * ├─ threadId                  → session_id
 * ├─ runId                     → id
 * ├─ messages[]                → input[]
 * │   ├─ role: "user"         → role: Role.USER
 * │   ├─ role: "assistant"    → role: Role.ASSISTANT
 * │   ├─ role: "system"       → role: Role.SYSTEM
 * │   ├─ role: "developer"    → role: Role.SYSTEM
 * │   ├─ role: "tool"         → role: Role.TOOL
 * │   └─ tool_calls           → FUNCTION_CALL
 * ├─ tools[]                   → tools[]
 * │   ├─ name                  → function.name
 * │   ├─ description           → function.description
 * │   └─ parameters            → function.parameters
 * ├─ forwardedProps            → user_id (提取)
 * └─ state                     → state
 * ```
 * 
 * ### 响应转换
 * 
 * ```
 * Agent 事件                    AG-UI 事件
 * ├─ Content(TextContent)      → TEXT_MESSAGE_CONTENT
 * ├─ Content(DataContent)      → TOOL_CALL_START
 * │                              TOOL_CALL_ARGS
 * │                              TOOL_CALL_END
 * │                              TOOL_CALL_RESULT
 * ├─ Message(completed)        → TEXT_MESSAGE_END
 * ├─ BaseResponse(completed)    → RUN_FINISHED
 * └─ BaseResponse(failed)      → RUN_ERROR
 * ```
 * 
 * 调试信息推送
 * ============
 * 
 * WebSocket 推送三种调试信息：
 * 
 * | 类型 | 内容 | 前端展示位置 |
 * |------|------|-------------|
 * | client_request | 原始请求 JSON | 左栏 |
 * | agui_transform | 协议转换过程 | 中栏 |
 * | agent_event | Agent 内部事件 | 右栏 |
 * 
 * 数据格式：
 * ```json
 * {
 *   "type": "client_request",
 *   "timestamp": 1718000000000,
 *   "data": {
 *     "request": { ... }
 *   }
 * }
 * ```
 * 
 * 与前端交互
 * ==========
 * 
 * ### AG-UI 协议通信
 * 
 * ```
 * 前端 → POST /ag-ui
 *   Body: RunAgentInput JSON
 *   
 * 后端 → SSE 流式响应
 *   data: {"type":"RUN_STARTED",...}
 *   data: {"type":"TEXT_MESSAGE_CONTENT",...}
 *   data: {"type":"RUN_FINISHED",...}
 * ```
 * 
 * ### 调试信息推送
 * 
 * ```
 * 前端 → WebSocket /debug/ws
 *   
 * 后端 → 推送调试消息
 *   {"type":"client_request","data":{"request":{...}}}
 *   {"type":"agui_transform","data":{"direction":"request",...}}
 *   {"type":"agent_event","data":{"eventType":"Content",...}}
 * ```
 * 
 * 测试
 * ====
 * 
 * ### 使用 curl 测试
 * 
 * 测试健康检查：
 * ```bash
 * curl http://127.0.0.1:8090/health
 * ```
 * 
 * 测试 AG-UI 端点信息：
 * ```bash
 * curl http://127.0.0.1:8090/ag-ui
 * ```
 * 
 * 测试 AG-UI 请求：
 * ```bash
 * curl -X POST http://127.0.0.1:8090/ag-ui \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "threadId": "thread_test",
 *     "runId": "run_test",
 *     "messages": [
 *       {
 *         "id": "msg_1",
 *         "role": "user",
 *         "content": "你好"
 *       }
 *     ],
 *     "tools": [],
 *     "context": [],
 *     "forwardedProps": {}
 *   }'
 * ```
 * 
 * 测试 WebSocket：
 * ```bash
 * wscat -c ws://127.0.0.1:8090/debug/ws
 * ```
 * 
 * ### 使用 Python 测试
 * 
 * ```python
 * import requests
 * 
 * response = requests.post(
 *     "http://127.0.0.1:8090/ag-ui",
 *     json={
 *         "threadId": "thread_test",
 *         "runId": "run_test",
 *         "messages": [
 *             {"id": "msg_1", "role": "user", "content": "你好"}
 *         ],
 *         "tools": [],
 *         "context": [],
 *         "forwardedProps": {}
 *     },
 *     stream=True
 * )
 * 
 * for line in response.iter_lines():
 *     if line:
 *         print(line.decode())
 * ```
 * 
 * 扩展建议
 * ========
 * 
 * ### 1. 添加更多模型支持
 * 
 * 当前支持 Anthropic 兼容 API，可以扩展支持：
 * - OpenAI API
 * - DashScope
 * - 本地模型（Ollama、vLLM）
 * 
 * ### 2. 添加更多工具
 *
 * 当前已注册工具：
 * - get_weather（实时天气查询）—— 调用 wttr.in 免费 API，支持中英文城市名
 *
 * 可以继续添加：
 * - search_web（网络搜索）
 * - calculator（计算器）
 * - execute_python_code（代码执行）
 * 
 * ### 3. 添加 Session 持久化
 * 
 * 当前使用 InMemoryMemory，可以添加：
 * - Redis Session（持久化存储）
 * - 多用户支持
 * - 对话历史管理
 * 
 * ### 4. 添加更多 AG-UI 事件
 * 
 * 当前支持：
 * - TEXT_MESSAGE_CONTENT
 * - TOOL_CALL_START/ARGS/END/RESULT
 * - RUN_STARTED/FINISHED/ERROR
 * 
 * 可以扩展：
 * - REASONING_START/END
 * - STATE_SNAPSHOT/DELTA
 * - MESSAGES_SNAPSHOT
 * 
 * 注意事项
 * ========
 * 
 * 1. API 密钥安全
 *    - 生产环境应使用环境变量配置
 *    - 不要在代码中硬编码密钥
 *    - 定期轮换密钥
 * 
 * 2. 并发控制
 *    - 当前没有并发控制
 *    - 生产环境应添加信号量或队列
 *    - 防止同时运行多个 Agent 导致资源耗尽
 * 
 * 3. 错误处理
 *    - 当前有基本的错误处理
 *    - 生产环境应添加更完善的日志和监控
 *    - 使用 Sentry 等错误追踪服务
 * 
 * 4. 性能优化
 *    - 当前是单进程
 *    - 生产环境应使用多进程或多线程
 *    - 使用 Redis 缓存
 * 
 * 许可证
 * ======
 * 
 * 本项目与 agentscope-runtime 项目使用相同许可证。
 * 
 * 开发说明
 * ========
 * 
 * ### 代码规范
 * 
 * - 所有文件使用中文注释
 * - 关键函数必须包含 JSDoc/Docstring 注释
 * - 类型定义使用 Pydantic 模型
 * - 异步函数使用 async/await
 * 
 * ### 调试技巧
 * 
 * 1. 查看日志输出
 * 2. 使用 /docs 端点查看 Swagger UI
 * 3. 使用 WebSocket 客户端查看调试信息
 * 4. 使用 curl 或 Python 测试 API
 * 
 * ### 常见问题
 * 
 * Q: 启动时报 "No module named 'agentscope_runtime'"
 * A: 确保将 agentscope-runtime 的 src 目录添加到 Python 路径
 * 
 * Q: 启动时报 "No module named 'ag_ui'"
 * A: 确保安装了 ag-ui-protocol 包
 * 
 * Q: SSE 响应为空
 * A: 检查 Agent 配置和 API 密钥是否正确
 * 
 * Q: WebSocket 连接失败
 * A: 检查端口是否被占用，防火墙是否放行
 * 
 * Q: 前端无法连接到后端
 * A: 检查 CORS 配置和代理配置
 * 
 * 启动顺序
 * ========
 * 
 * 1. 启动后端
 *    ```bash
 *    cd ag_ui_debug/server
 *    python main.py
 *    ```
 * 
 * 2. 启动前端
 *    ```bash
 *    cd ag_ui_debug/web
 *    npm run dev
 *    ```
 * 
 * 3. 访问前端
 *    打开浏览器访问 http://localhost:5173
 * 
 * 4. 发送消息
 *    在前端聊天界面输入消息，查看调试面板
 * 
 * 版本历史
 * ========
 *
 * ### v1.1.0
 * - get_weather 工具升级为真实网络查询（wttr.in API）
 * - 支持中英文城市名，返回温度、湿度、风速等详细信息
 * - 新增超时、网络断开、城市名错误等异常处理
 * - 新增 WTTR_URL 环境变量
 *
 * ### v1.0.0
 * - 初始版本
 * - 实现 AG-UI 协议端点
 * - 实现 WebSocket 调试推送
 * - 实现基本协议转换
 * - 支持 Anthropic 兼容 API
 * 
 * 联系
 * ====
 * 
 * 如有问题或建议，请参考 agentscope-runtime 项目的贡献指南。
 * 
 * 感谢使用！
 * 
 * 
 * 
