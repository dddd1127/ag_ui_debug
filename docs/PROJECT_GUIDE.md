# AG-UI 协议调试器 —— 完整源码导读

> 目标：读完这份文档后，你能逐行理解 `ag_ui_debug` 的代码、数据流和协议转换逻辑，达到可以在面试中深入讲解的程度。

---

## 一、项目定位

`ag_ui_debug` 是一个**独立的 AG-UI 协议实现与可视化调试系统**：

- **后端**：FastAPI + Python，实现 AG-UI 协议的 `/ag-ui` SSE 端点
- **Agent 层**：接入 agentscope 1.x 的 `ReActAgent`，驱动真实 Agent 运行
- **协议层**：完成两套转换
  - 请求：`RunAgentInput`（AG-UI 格式）→ `AgentRequest`（agentscope 格式）
  - 响应：`Agent Event`（agentscope 格式）→ `AG-UI Event`（SSE 流式格式）
- **调试层**：通过 WebSocket `/debug/ws` 把协议转换过程实时推送到前端
- **前端**：React + Vite，三栏调试面板可视化整个流程
- **Mock 模式**：`MOCK_AGENT=true` 时不依赖外部 LLM API，直接返回确定性事件流

核心学习价值：理解 **SSE 流式协议、Agent 事件模型、前后端协议转换、WebSocket 实时调试**。

---

## 二、目录结构速览

```
ag_ui_debug/
├── server/                      # 后端
│   ├── main.py                 # 入口：启动 Uvicorn
│   ├── app.py                  # FastAPI 应用工厂 + 路由注册
│   ├── agui_endpoint.py        # POST /ag-ui 核心端点
│   ├── agui_adapter.py         # AG-UI ↔ agentscope 协议转换
│   ├── agent_runner.py         # 创建并运行 ReActAgent
│   ├── mock_agent_runner.py    # Mock Agent（无 API Key 演示）
│   ├── debug_ws.py             # WebSocket 调试端点
│   ├── debug_publisher.py      # 调试信息统一封装
│   ├── requirements.txt        # Python 依赖
│   └── tests/                  # 测试
│       ├── test_agui_adapter.py
│       ├── test_agui_endpoint.py
│       └── test_debug_ws.py
├── web/                         # 前端
│   ├── src/
│   │   ├── main.tsx            # React 挂载点
│   │   ├── App.tsx             # 根组件：上下分栏
│   │   ├── hooks/
│   │   │   ├── useAguiSSE.ts   # AG-UI SSE 通信 Hook
│   │   │   └── useDebugWS.ts   # WebSocket 调试 Hook
│   │   ├── components/
│   │   │   ├── ChatPanel/      # 聊天区域
│   │   │   └── DebugPanel/     # 三栏调试面板
│   │   └── utils/
│   │       └── aguiClient.ts   # 可选的 AG-UI 客户端工具
│   ├── package.json
│   └── vite.config.ts          # Vite + 代理配置
├── Dockerfile                   # Docker 构建
├── docker-compose.yml           # 一键启动
├── .github/workflows/test.yml   # CI
└── README.md
```

---

## 三、后端源码逐行解读

### 3.1 `server/main.py` —— 程序入口

```python
import sys
import os

# 把当前目录加入 Python 路径，确保 import agent_runner 等模块不报错
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from app import create_app

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=os.getenv("HOST", "127.0.0.1"),    # Docker 中设为 0.0.0.0
        port=int(os.getenv("PORT", "8090")),
        reload=False,
    )
```

- 这里做的是最基础的 ASGI 启动
- `create_app()` 返回 FastAPI 实例
- `HOST`/`PORT` 环境变量让 Docker 可以灵活配置监听地址

---

### 3.2 `server/app.py` —— FastAPI 应用工厂

```python
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from agui_endpoint import agui_router
from debug_ws import debug_router
```

- 导入两个路由模块：`agui_router`（HTTP/SSE）和 `debug_router`（WebSocket）
- `StaticFiles` 用于 Docker 生产环境直接提供前端构建产物

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("AG-UI 调试服务正在启动...")
    yield
    print("AG-UI 调试服务正在关闭...")
```

- FastAPI 的 lifespan 钩子，启动和关闭时打印日志
- 如果有数据库连接、线程池等需要在这里初始化和清理

```python
def create_app() -> FastAPI:
    app = FastAPI(
        title="AG-UI 协议调试服务",
        description="独立的 AG-UI 协议实现",
        version="1.0.0",
        lifespan=lifespan,
    )
```

- 应用工厂模式：每次调用 `create_app()` 生成新的 FastAPI 实例
- 方便测试（`TestClient(create_app())`）

```python
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",    # Vite 开发服务器
            "http://127.0.0.1:5173",
            "http://localhost:8090",
            "http://127.0.0.1:8090",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
```

- CORS 中间件：允许前端开发服务器跨域访问
- 生产环境 Docker 中前后端同源（都是 8090），CORS 不关键

```python
    app.include_router(agui_router)
    app.include_router(debug_router)

    @app.get("/health")
    async def health_check(): ...

    @app.get("/agent/config")
    async def agent_config(): ...

    if os.environ.get("SERVE_STATIC", "").lower() in ("1", "true", "yes"):
        static_dir = Path(__file__).parent.parent / "web" / "dist"
        if static_dir.exists():
            app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app
```

- 先注册 API 路由，再注册静态文件
- **关键顺序**：静态文件 `mount("/", ...)` 必须放在最后，作为 fallback
  - 否则 `/health`、`/ag-ui` 会被静态文件中间件拦截
- `html=True` 让未匹配路径返回 `index.html`（SPA 行为）

---

### 3.3 `server/agent_runner.py` —— Agent 创建与运行

这是核心文件之一，负责：
1. 创建 agentscope 1.x 的 `ReActAgent`
2. 运行 Agent 并产出**增量 delta** 消息流

#### 3.3.1 配置与环境变量

```python
import os
import asyncio
import logging
from typing import AsyncGenerator

import requests

from agentscope.agent import ReActAgent
from agentscope.model import OpenAIChatModel
from agentscope.tool import Toolkit, ToolResponse
from agentscope.formatter import DashScopeChatFormatter
from agentscope.message import Msg, TextBlock, ToolResultBlock, ToolUseBlock
from agentscope.pipeline import stream_printing_messages
```

- `ReActAgent`：会思考的 Agent，能根据 prompt 决定调用工具
- `OpenAIChatModel`：agentscope 的 OpenAI 兼容模型封装
- `Toolkit`：工具注册器
- `stream_printing_messages`：agentscope 的流式输出生成器
- `Msg` / `TextBlock` / `ToolUseBlock` / `ToolResultBlock`：agentscope 内部消息类型

```python
DEFAULT_BASE_URL = os.getenv("ANTHROPIC_BASE_URL", "https://opencode.ai/zen/go/v1")
DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "kimi-k2.6")

WTTR_URL = os.getenv("WTTR_URL", "https://wttr.in")
```

- base URL 和 model 有默认值，指向 OpenCode AI 的 kimi-k2.6
- API Key 不再硬编码，必须从环境变量读取

```python
def _get_api_key() -> str:
    key = os.getenv("ANTHROPIC_AUTH_TOKEN")
    if not key:
        raise ValueError("缺少环境变量 ANTHROPIC_AUTH_TOKEN...")
    return key
```

- 如果未设置 API Key，给出明确错误提示
- Mock 模式下不会走到这里

#### 3.3.2 天气工具 `get_weather`

```python
def get_weather(location: str) -> str:
    """查询指定城市的实时天气信息..."""
    params = {"format": "j1", "lang": "zh"}
    resp = requests.get(
        f"{WTTR_URL}/{location}",
        params=params,
        headers={"Accept-Language": "zh-CN,zh;q=0.9"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    ...
    return ToolResponse(content=[TextBlock(type="text", text=result)])
```

- 调用免费的 wttr.in API 查询天气
- 返回 `ToolResponse`，其中包含 `TextBlock` 列表
- Agent 看到工具返回后，会继续生成回复

#### 3.3.3 `create_agent()` 创建 Agent

```python
def create_agent(
    model_name: str = DEFAULT_MODEL,
    api_key: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
) -> ReActAgent:
    toolkit = Toolkit()
    toolkit.register_tool_function(get_weather)

    model = OpenAIChatModel(
        model_name=model_name,
        api_key=api_key or _get_api_key(),
        stream=True,
        client_kwargs={"base_url": base_url},
    )

    agent = ReActAgent(
        name="Friday",
        sys_prompt=(
            "你是一个名叫 Friday 的智能助手。你可以使用工具来帮助用户。\n"
            "当用户询问任何城市的天气信息时，你必须调用 get_weather 工具..."
        ),
        model=model,
        formatter=DashScopeChatFormatter(),
        toolkit=toolkit,
        max_iters=10,
    )
    agent.set_console_output_enabled(enabled=False)
    return agent
```

逐行含义：
1. `Toolkit()`：创建空工具包
2. `register_tool_function(get_weather)`：把天气函数注册为 Agent 可调用的工具
3. `OpenAIChatModel(...)`：创建模型实例
   - `stream=True`：开启流式输出
   - `client_kwargs={"base_url": ...}`：指向兼容 OpenAI 的第三方 API
4. `ReActAgent(...)`：创建 ReAct 循环 Agent
   - `sys_prompt`：系统提示，告诉 Agent 什么时候调用工具
   - `formatter=DashScopeChatFormatter()`：对话格式化器
   - `max_iters=10`：最多 10 轮思考/工具调用，防止死循环
5. `set_console_output_enabled(False)`：禁用 agentscope 默认控制台打印

#### 3.3.4 `convert_agui_messages_to_msgs()` —— 请求协议转换

```python
def convert_agui_messages_to_msgs(agui_messages: list) -> list:
    msgs = []
    for agui_msg in agui_messages:
        role = agui_msg.role

        if role in ("system", "developer"):
            # system/developer 都映射为 agentscope system 角色
            content = agui_msg.content or ""
            msgs.append(Msg(
                name="system", role="system",
                content=[TextBlock(type="text", text=content)],
            ))

        elif role == "user":
            # 处理 content 可能是字符串或列表的情况
            content = agui_msg.content
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = []
                for item in content:
                    if hasattr(item, "text") and item.text:
                        parts.append(item.text)
                    elif hasattr(item, "data") and item.data:
                        parts.append(f"[binary content: ...]")
                    elif isinstance(item, str):
                        parts.append(item)
                text = " ".join(parts) if parts else ""
            else:
                text = str(content)

            msgs.append(Msg(
                name="user", role="user",
                content=[TextBlock(type="text", text=text)],
            ))

        elif role == "assistant":
            # 处理 assistant 的文本内容和 tool_calls
            content_text = agui_msg.content or ""
            blocks = []
            if content_text:
                blocks.append(TextBlock(type="text", text=content_text))
            if hasattr(agui_msg, "tool_calls") and agui_msg.tool_calls:
                for tool_call in agui_msg.tool_calls:
                    func = tool_call.function
                    blocks.append(ToolUseBlock(
                        type="tool_use",
                        id=tool_call.id or f"call_{len(msgs)}",
                        name=func.name or "",
                        input=json.loads(func.arguments or "{}"),
                    ))
            if blocks:
                msgs.append(Msg(name="Friday", role="assistant", content=blocks))

        elif role == "tool":
            # tool 结果映射为 ToolResultBlock
            tool_call_id = getattr(agui_msg, "tool_call_id", "")
            content_text = agui_msg.content or ""
            msgs.append(Msg(
                name="tool", role="assistant",
                content=[ToolResultBlock(
                    type="tool_result",
                    id=tool_call_id or f"result_{len(msgs)}",
                    name="tool",
                    output=content_text,
                )],
            ))

    return msgs
```

**数据流意义**：
- 输入：AG-UI 格式的 `messages`，每个消息有 `role` 和 `content`
- 输出：agentscope 的 `Msg` 列表
- 关键映射：
  - `system` / `developer` → `role="system"`
  - `user` → `role="user"`
  - `assistant` → `role="assistant"`，`tool_calls` 转成 `ToolUseBlock`
  - `tool` → `role="assistant"`，`content` 转成 `ToolResultBlock`

这就是 **RunAgentInput → AgentRequest** 中消息部分的具体实现。

#### 3.3.5 `run_agent_stream()` —— 运行 Agent 并计算增量

这是项目中最复杂的函数之一。

```python
async def run_agent_stream(
    agent: ReActAgent,
    msgs: list,
    timeout: float = 120.0,
) -> AsyncGenerator[tuple, None]:
```

- 输入：Agent 实例 + agentscope Msg 列表
- 输出：异步生成器，产生 `(delta_msg, is_last)` 元组
- `timeout`：防止 API 无响应时永远挂起

```python
    sent_text_len_map: dict[str, int] = {}
    msg_count = 0

    stream = stream_printing_messages(
        agents=[agent],
        coroutine_task=agent(msgs),
    )
```

- `stream_printing_messages` 是 agentscope 提供的流式输出包装器
- 它每次返回的 `Msg` 中的文本是**累积全量**（不是增量）
- `sent_text_len_map` 用来记录每个消息 id 已经发送了多少字符

```python
    try:
        while True:
            try:
                raw_msg, last = await asyncio.wait_for(
                    stream.__anext__(),
                    timeout=timeout,
                )
            except StopAsyncIteration:
                break

            msg_count += 1
            msg_id = getattr(raw_msg, "invocation_id", None) or getattr(raw_msg, "id", "")
            if not msg_id:
                msg_id = f"_fallback_{id(raw_msg)}_{len(sent_text_len_map)}"

            delta_msg = _compute_delta_msg(raw_msg, msg_id, last, sent_text_len_map)
            yield delta_msg, last

    except asyncio.TimeoutError:
        logger.warning(f"Agent 运行超时 ({timeout}s)")
        yield Msg(...), True
```

- `asyncio.wait_for` 包装每次取流，超时则中断
- `raw_msg`：agentscope 返回的原始累积消息
- `last`：布尔值，表示这条消息是否是一个流的最后一块
- `_compute_delta_msg`：把累积全量转成增量
- 超时后 yield 一个空消息并 `is_last=True`，让下游正常收尾

#### 3.3.6 `_compute_delta_msg()` —— 全量转增量

```python
def _compute_delta_msg(
    raw_msg: Msg,
    msg_id: str,
    is_last: bool,
    sent_text_len_map: dict[str, int],
) -> Msg:
    content = raw_msg.content

    if not isinstance(content, list):
        if isinstance(content, str):
            sent_len = sent_text_len_map.get(msg_id, 0)
            delta = content[sent_len:]      # 只取新增部分
            sent_text_len_map[msg_id] = len(content)
            if is_last:
                sent_text_len_map.pop(msg_id, None)
            ...
```

**核心逻辑**：
- agentscope 返回的 `content` 是累积文本，比如 `"北"`、`"北京"`、`"北京今天"`
- 用 `sent_text_len_map` 记录上一次发到了哪里
- `delta = content[sent_len:]` 计算出新增部分
- 把增量包装成新的 `Msg` 返回

对于 `TextBlock` 列表的情况也是同理：

```python
for block in content:
    if block_type == "text":
        full_text = block.get("text", "")
        sent_len = sent_text_len_map.get(msg_id, 0)
        delta = full_text[sent_len:]
        sent_text_len_map[msg_id] = len(full_text)
        if delta or is_last:
            new_blocks.append(TextBlock(type="text", text=delta))
```

**为什么必须做这个转换？**
- AG-UI 协议要求 `TEXT_MESSAGE_CONTENT` 的 `delta` 是增量
- 如果直接发累积文本，前端会重复显示
- 所以 `agent_runner` 负责全量→增量，`agui_adapter` 只做纯协议格式转换

---

### 3.4 `server/agui_adapter.py` —— 纯协议转换层

这是项目另一个核心文件，职责非常单一：**把已经是增量的 agentscope Msg 转成 AG-UI 事件**。

#### 3.4.1 `AGUIEventTracker`

```python
class AGUIEventTracker:
    def __init__(self, thread_id: str, run_id: str):
        self.thread_id = thread_id
        self.run_id = run_id
        self._run_started = False
        self._run_finished = False
        self._text_started: set = set()
        self._text_completed: set = set()
        self._current_message_id: str = ""
        self._current_tool_call_id: str = ""
```

- 追踪一个 run 生命周期内的状态
- `_run_started` / `_run_finished`：保证 RUN_STARTED / RUN_FINISHED 只发一次
- `_text_started` / `_text_completed`：保证每个 message 有 START/END 配对
- `_current_message_id`：当前正在流式输出的文本消息 id
- `_current_tool_call_id`：当前工具调用 id，用于结果匹配

#### 3.4.2 `msg_to_agui_events()` —— 主转换函数

```python
def msg_to_agui_events(msg: Msg, is_last: bool, tracker: AGUIEventTracker) -> List[AGUIEvent]:
    events: List[AGUIEvent] = []

    # 1. RUN_STARTED 只发一次
    if not tracker._run_started:
        tracker._run_started = True
        events.append(RunStartedEvent(thread_id=tracker.thread_id, run_id=tracker.run_id))

    # 2. content 统一成列表处理
    content_blocks = msg.content if isinstance(msg.content, list) else [msg.content]

    for block in content_blocks:
        block_type = block.get('type') if isinstance(block, dict) else None

        if block_type == 'text':
            events.extend(_convert_text_block(block, is_last, tracker))
        elif block_type == 'tool_use':
            events.extend(_convert_tool_call_block(block, tracker))
        elif block_type == 'tool_result':
            events.extend(_convert_tool_result_block(block, tracker))
        elif isinstance(block, str):
            # 兼容纯字符串 content
            ...

    return events
```

**输入输出**：
- 输入：`Msg`（来自 `agent_runner`，文本已是增量）
- 输出：`List[AGUIEvent]`

**事件序列示例**：

假设 Agent 说了 "北京今天天气晴朗"，分 5 次返回增量：

| 第几次 | msg.content | is_last | 输出事件 |
|---|---|---|---|
| 1 | `[{"type":"text","text":"北京"}]` | False | RUN_STARTED + TEXT_MESSAGE_START + TEXT_MESSAGE_CONTENT(delta="北京") |
| 2 | `[{"type":"text","text":"今天"}]` | False | TEXT_MESSAGE_CONTENT(delta="今天") |
| 3 | `[{"type":"text","text":"天气"}]` | False | TEXT_MESSAGE_CONTENT(delta="天气") |
| 4 | `[{"type":"text","text":"晴朗"}]` | False | TEXT_MESSAGE_CONTENT(delta="晴朗") |
| 5 | `[{"type":"text","text":"。"}]` | True | TEXT_MESSAGE_CONTENT(delta="。") + TEXT_MESSAGE_END |

#### 3.4.3 `_convert_text_block()`

```python
def _convert_text_block(block, is_last, tracker):
    events = []
    text = block.get("text", "")

    if not tracker._current_message_id:
        tracker._current_message_id = tracker._new_message_id()

    msg_id = tracker._current_message_id

    if msg_id not in tracker._text_started:
        tracker._text_started.add(msg_id)
        events.append(TextMessageStartEvent(message_id=msg_id, role="assistant"))

    if text:
        events.append(TextMessageContentEvent(message_id=msg_id, delta=text))

    if is_last and msg_id not in tracker._text_completed:
        tracker._text_completed.add(msg_id)
        events.append(TextMessageEndEvent(message_id=msg_id))
        tracker._current_message_id = ""

    return events
```

- 每条新的流式文本消息有唯一的 `message_id`
- 只有第一次发 `TEXT_MESSAGE_START`
- `is_last=True` 时发 `TEXT_MESSAGE_END` 并清空当前消息 id

#### 3.4.4 `_convert_tool_call_block()`

```python
def _convert_tool_call_block(block, tracker):
    events = []
    tool_call_id = block.get("id") or tracker._new_tool_call_id()
    tool_call_name = block.get("name", "")
    arguments = block.get("input", {})

    # 如果前面还有未关闭的文本消息，先关闭它
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        events.append(TextMessageEndEvent(message_id=tracker._current_message_id))
        tracker._current_message_id = ""

    events.append(ToolCallStartEvent(tool_call_id=tool_call_id, tool_call_name=tool_call_name))
    events.append(ToolCallArgsEvent(tool_call_id=tool_call_id, delta=json.dumps(arguments)))
    events.append(ToolCallEndEvent(tool_call_id=tool_call_id))

    tracker._current_tool_call_id = tool_call_id
    return events
```

- 工具调用前如果有未结束的文本，先发 `TEXT_MESSAGE_END`
- 然后连续发：`TOOL_CALL_START` → `TOOL_CALL_ARGS` → `TOOL_CALL_END`
- `arguments` 是 dict，序列化成 JSON 字符串作为 delta

#### 3.4.5 `_convert_tool_result_block()`

```python
def _convert_tool_result_block(block, tracker):
    events = []
    tool_call_id = block.get("id") or tracker._current_tool_call_id
    output = block.get("output", "")

    # output 可能是 TextBlock 列表，需要提取成字符串
    if isinstance(output, list):
        text_parts = []
        for item in output:
            if isinstance(item, dict) and item.get("type") == "text":
                text_parts.append(item.get("text", ""))
            elif hasattr(item, "text"):
                text_parts.append(item.text)
        output = "".join(text_parts)
    elif not isinstance(output, str):
        output = str(output)

    events.append(ToolCallResultEvent(
        message_id=f"msg_tool_{uuid4().hex[:8]}",
        tool_call_id=tool_call_id,
        content=output,
        role="tool",
    ))
    return events
```

- 工具返回的结果转成 `TOOL_CALL_RESULT`
- `tool_call_id` 要和前面的 `TOOL_CALL_START` 对应

#### 3.4.6 `build_run_finished_event()` / `build_run_error_event()`

```python
def build_run_finished_event(tracker, result: str = ""):
    events = []
    # 先关闭未结束的文本消息
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        events.append(TextMessageEndEvent(message_id=tracker._current_message_id))
        tracker._current_message_id = ""

    if not tracker._run_finished:
        tracker._run_finished = True
        events.append(RunFinishedEvent(thread_id=tracker.thread_id, run_id=tracker.run_id))
    return events
```

- Agent 流结束后，`agui_endpoint` 调用这个函数补 `RUN_FINISHED`
- 如果有未关闭的文本消息，先补 `TEXT_MESSAGE_END`

```python
def serialize_agui_event(event: AGUIEvent) -> str:
    data = event.model_dump(mode="json", exclude_none=True, by_alias=True)
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
```

- 把 Pydantic 模型序列化为 JSON
- `by_alias=True`：字段名用 camelCase（如 `toolCallId` 而不是 `tool_call_id`）
- 包装成 SSE 格式：`data: {...}\n\n`

---

### 3.5 `server/agui_endpoint.py` —— `/ag-ui` 端点

这是前后端交互的核心入口。

#### 3.5.1 顶部导入

```python
import json
import logging
import os
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from ag_ui.core.types import RunAgentInput
from agui_adapter import (
    AGUIEventTracker,
    msg_to_agui_events,
    serialize_agui_event,
    build_run_finished_event,
    build_run_error_event,
)
from agent_runner import convert_agui_messages_to_msgs

# Mock 模式切换
if os.environ.get("MOCK_AGENT", "").lower() in ("1", "true", "yes"):
    from mock_agent_runner import create_mock_agent as create_agent
    from mock_agent_runner import run_mock_agent_stream as run_agent_stream
else:
    from agent_runner import create_agent, run_agent_stream

from debug_publisher import publisher
```

- `RunAgentInput`：AG-UI 协议的标准请求类型，来自 `ag-ui-protocol` 包
- `AGUIEventTracker` 等：协议转换函数
- `convert_agui_messages_to_msgs`：请求转换
- `create_agent` / `run_agent_stream`：Agent 创建与运行
- **Mock 模式**：通过 `MOCK_AGENT` 环境变量切换真实 Agent 和 Mock Agent

#### 3.5.2 `generate_agui_stream()` —— 核心生成器

```python
async def generate_agui_stream(
    run_agent_input: RunAgentInput,
    tracker: AGUIEventTracker | None = None,
) -> AsyncGenerator[str, None]:
    thread_id = run_agent_input.thread_id
    run_id = run_agent_input.run_id

    if tracker is None:
        tracker = AGUIEventTracker(thread_id=thread_id, run_id=run_id)
```

- 输入：`RunAgentInput`（已通过 Pydantic 验证）
- 输出：异步生成 SSE 字符串
- 创建 `AGUIEventTracker` 追踪本次 run 的状态

```python
    # 1. 推送调试：原始请求
    await publisher.publish_request_raw(run_agent_input.model_dump(by_alias=True))

    # 2. AG-UI 消息 → agentscope Msg
    msgs = convert_agui_messages_to_msgs(run_agent_input.messages)

    # 3. 推送调试：请求转换
    await publisher.publish_request_transform(
        agui_input=run_agent_input.model_dump(by_alias=True),
        agent_request={"thread_id": thread_id, "run_id": run_id, "messages": serialized_msgs, ...},
    )
```

- 这两步把"原始请求"和"请求转换"通过 WebSocket 推给前端调试面板
- 左栏和中栏的数据来源

```python
    # 4. 创建 Agent
    agent = create_agent()

    # 5. 推送调试：Agent 开始
    await publisher.publish_agent_event(
        event_type="ReplyStartEvent",
        event_data={...},
        run_id=run_id,
        thread_id=thread_id,
    )

    # 6. 运行 Agent 流
    async for msg, is_last in run_agent_stream(agent, msgs):
        agui_events = msg_to_agui_events(msg, is_last, tracker)

        if not agui_events:
            continue

        # 7. 推送调试：Agent 内部事件
        for agui_event in agui_events:
            debug_mapping = _map_agui_to_debug_event(agui_event)
            if debug_mapping:
                await publisher.publish_agent_event(...)

        # 8. 推送调试：响应转换
        await publisher.publish_response_transform(...)

        # 9. 返回 SSE 数据
        for agui_event in agui_events:
            yield serialize_agui_event(agui_event)
```

**完整数据流**：
1. 收到前端 `RunAgentInput`
2. 转 `agentscope Msg`
3. 创建并运行 Agent
4. Agent 返回增量 `Msg`
5. `msg_to_agui_events` 转成 AG-UI 事件
6. 同时做三件事：
   - 推 WebSocket 调试信息（前端三栏面板）
   - 记录响应转换（中栏）
   - yield SSE 给前端聊天界面

```python
    # 10. Agent 结束
    await publisher.publish_agent_event(event_type="ReplyEndEvent", ...)

    # 11. 确保 RUN_FINISHED
    finish_events = build_run_finished_event(tracker)
    for event in finish_events:
        yield serialize_agui_event(event)
```

- 流正常结束后推送 `ReplyEndEvent` 到右栏
- 补发 `RUN_FINISHED` 给 SSE

```python
    except Exception as e:
        error_events = build_run_error_event(tracker, message=error_msg, code="agent_runtime_error")
        for event in error_events:
            yield serialize_agui_event(event)

        finish_events = build_run_finished_event(tracker)
        for event in finish_events:
            yield serialize_agui_event(event)
```

- 任何异常都返回 `RUN_ERROR` + `RUN_FINISHED`，保证前端能正常收尾

#### 3.5.3 `agui_endpoint()` —— POST /ag-ui

```python
@agui_router.post("/ag-ui")
async def agui_endpoint(request: Request):
    body = await request.json()

    if not body.get("threadId") or not body.get("runId"):
        raise HTTPException(status_code=400, detail="缺少必需字段: threadId 或 runId")

    if not body.get("messages") or not isinstance(body.get("messages"), list):
        raise HTTPException(status_code=400, detail="缺少必需字段: messages")

    run_agent_input = RunAgentInput.model_validate(body)
```

- 手动校验必填字段
- `RunAgentInput.model_validate(body)`：用 Pydantic 严格验证 AG-UI 协议格式

```python
    async def streaming_with_cleanup():
        tracker = AGUIEventTracker(thread_id=..., run_id=...)
        try:
            async for chunk in generate_agui_stream(run_agent_input, tracker):
                yield chunk
        except GeneratorExit:
            logger.warning("SSE 生成器被客户端断开")
            raise
        finally:
            if not tracker._run_finished:
                await publisher.publish_agent_event(event_type="ReplyEndEvent", ...)

    return StreamingResponse(
        streaming_with_cleanup(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
```

- `StreamingResponse`：FastAPI 的 SSE 响应
- `SSE_HEADERS` 设置了 `Cache-Control: no-cache`、`Connection: keep-alive`、`X-Accel-Buffering: no`
- `GeneratorExit`：处理客户端中途断开
- `finally`：即使断开也推 `ReplyEndEvent` 到调试面板

---

### 3.6 `server/mock_agent_runner.py` —— Mock Agent

```python
async def run_mock_agent_stream(agent, msgs, timeout=120.0):
    # 从用户输入中提取城市（北京/上海）
    location = "北京"
    for msg in msgs:
        ...

    # 模拟文本流
    text_deltas = [location, "今天", "天气", "晴朗", "。"]
    for i, delta in enumerate(text_deltas):
        is_last = i == len(text_deltas) - 1
        yield Msg(name="Friday", role="assistant",
                  content=[{"type": "text", "text": delta}]), is_last
        await asyncio.sleep(0.02)

    # 模拟工具调用
    yield Msg(..., content=[{"type": "tool_use", ...}]), False

    # 模拟工具结果
    yield Msg(..., content=[{"type": "tool_result", ...}]), False
```

- 签名和真实 `run_agent_stream` 一致，都是 `(agent, msgs, timeout)`
- 产生和真实 Agent 相同结构的 `Msg` 流
- 这样 `agui_endpoint` 不需要知道底层是 Mock 还是真实 Agent

```python
def create_mock_agent(*args, **kwargs) -> dict:
    return {"mock": True}
```

- 返回一个占位对象，Mock 运行时不使用它

---

### 3.7 `server/debug_ws.py` + `server/debug_publisher.py` —— 调试通道

#### `debug_ws.py`

```python
_connections: List[WebSocket] = []

@debug_router.websocket("/debug/ws")
async def debug_websocket(websocket: WebSocket):
    await websocket.accept()
    _connections.append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ...
    finally:
        if websocket in _connections:
            _connections.remove(websocket)
```

- 维护全局 `_connections` 列表
- 前端连接后自动接收调试信息
- 支持 `ping`/`pong` 心跳

```python
async def push_debug_info(type: str, data: dict) -> None:
    if not _connections:
        return

    message = {"type": type, "timestamp": int(time.time() * 1000), "data": data}
    disconnected = []
    for ws in _connections[:]:
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        _connections.remove(ws)
```

- 如果没有前端连接，直接返回
- 向所有连接广播调试消息
- 发送失败的连接会被清理

#### `debug_publisher.py`

对 `push_debug_info` 做了类型化封装：

```python
class DebugPublisher:
    async def publish_request_raw(self, agui_input: dict): ...
    async def publish_request_transform(self, agui_input, agent_request, description): ...
    async def publish_response_transform(self, agent_event, agui_events, ...): ...
    async def publish_agent_event(self, event_type, event_data, ...): ...

publisher = DebugPublisher()
```

- 统一三种调试信息类型：
  - `client_request`：左栏（原始请求 JSON）
  - `agui_transform`：中栏（协议转换过程）
  - `agent_event`：右栏（Agent 内部事件）

---

### 3.8 后端测试文件

#### `tests/test_agui_adapter.py`

测试两个方向的协议转换：
- `convert_agui_messages_to_msgs`：AG-UI 消息 → agentscope Msg
- `msg_to_agui_events`：agentscope Msg → AG-UI 事件

#### `tests/test_agui_endpoint.py`

集成测试：
- `MOCK_AGENT=true` 启动应用
- `TestClient` 调用 `/ag-ui`
- 验证 SSE 响应包含 `RUN_STARTED`、`RUN_FINISHED`、文本 delta、工具调用序列

#### `tests/test_debug_ws.py`

WebSocket 测试：
- 连接 `/debug/ws`
- 发送 `ping`，验证收到 `pong`

---

## 四、前端源码逐行解读

### 4.1 `web/src/main.tsx`

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import App from './App'
import './App.css'

const antdConfig = {
  theme: { token: { colorPrimary: '#1677ff' } },
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider {...antdConfig}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
```

- 标准 React 18 挂载
- `ConfigProvider`：Ant Design 主题配置
- `root` 元素在 `index.html` 中定义

### 4.2 `web/src/App.tsx`

```tsx
import ChatPanel from './components/ChatPanel'
import DebugPanel from './components/DebugPanel'
import SplitPane from './components/SplitPane'
import { useAguiSSE } from './hooks/useAguiSSE'
import { useDebugWS } from './hooks/useDebugWS'

function App() {
  const { messages, sendMessage, isStreaming } = useAguiSSE()
  const { clientRequests, aguiTransforms, agentInfos, connected } = useDebugWS()

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AG-UI 协议调试器</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? '调试服务已连接' : '调试服务未连接'}
        </div>
      </header>

      <SplitPane direction="vertical" defaultRatio={0.6} minSize={200} className="app-main">
        <ChatPanel messages={messages} onSendMessage={sendMessage} isStreaming={isStreaming} />
        <DebugPanel
          clientRequests={clientRequests}
          aguiTransforms={aguiTransforms}
          agentInfos={agentInfos}
        />
      </SplitPane>
    </div>
  )
}
```

- 整体布局：顶部标题栏 + 上下分栏
- 上 60%：`ChatPanel`（聊天）
- 下 40%：`DebugPanel`（三栏调试）
- `useAguiSSE` 提供聊天数据和发送函数
- `useDebugWS` 提供调试数据和连接状态

### 4.3 `web/src/hooks/useAguiSSE.ts`

这是前端最核心的 Hook，负责：
1. 构造 `RunAgentInput` 请求
2. 发送 POST `/ag-ui` 请求
3. 用 `ReadableStream` 读取 SSE 流
4. 把 AG-UI 事件更新到 `messages` 状态

#### 构造请求

```ts
function buildAguiRequest(text: string, threadId: string, history: ChatMessage[]): RunAgentInput {
  const runId = `run_${Date.now()}`

  const messages = history.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }))

  messages.push({
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
  })

  return {
    threadId,
    runId,
    state: null,
    messages,
    tools: [],
    context: [],
    forwardedProps: { userId: 'debug_user', source: 'ag-ui-debug-web' },
  }
}
```

- `threadId` 在一次页面会话中保持不变（`useRef`）
- `runId` 每次发送新消息都重新生成
- `history` 包含之前的对话记录

#### 解析 SSE

```ts
function parseSSELine(line: string): AGUIEvent | null {
  if (!line.startsWith('data: ')) return null
  const jsonStr = line.substring(6).trim()
  if (!jsonStr) return null
  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    console.error('SSE 解析失败:', line, e)
    return null
  }
}
```

- SSE 每行格式：`data: {"type":"TEXT_MESSAGE_CONTENT",...}\n`
- 去掉 `data: ` 前缀后解析 JSON

#### 发送消息与流式处理

```ts
const sendMessage = useCallback((text: string) => {
  // 1. 添加用户消息到列表
  const userMsg: ChatMessage = { id: generateId(), role: 'user', content: text, status: 'sending' }
  setMessages(prev => [...prev, userMsg])
  setIsStreaming(true)

  // 2. 构造 AG-UI 请求
  const request = buildAguiRequest(text, threadIdRef.current, messagesRef.current)

  // 3. 发送 fetch 请求
  fetch('/ag-ui', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  .then(async response => {
    // 4. 创建助手消息占位
    const assistantMsgId = generateId()
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      toolCalls: [],
    }
    setMessages(prev => [...prev, assistantMsg])

    // 5. 读取 SSE 流
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''   // 保留不完整的最后一行

      for (const line of lines) {
        const event = parseSSELine(line.trim())
        if (!event) continue

        // 6. 根据事件类型更新消息状态
        setMessages(prev => {
          const newMessages = [...prev]
          const assistantIndex = newMessages.findIndex(m => m.id === assistantMsgId)
          if (assistantIndex === -1) return prev

          const assistant = { ...newMessages[assistantIndex] }

          switch (event.type) {
            case 'TEXT_MESSAGE_CONTENT':
              assistant.content += event.delta || ''
              break
            case 'TEXT_MESSAGE_END':
              assistant.status = 'completed'
              break
            case 'TOOL_CALL_START':
              assistant.toolCalls!.push({
                id: event.toolCallId || generateId(),
                name: event.toolCallName || '',
                arguments: '',
                status: 'calling',
              })
              break
            case 'TOOL_CALL_ARGS':
              assistant.toolCalls![assistant.toolCalls!.length - 1].arguments += event.delta || ''
              break
            case 'TOOL_CALL_END':
              assistant.toolCalls![assistant.toolCalls!.length - 1].status = 'completed'
              break
            case 'TOOL_CALL_RESULT':
              {
                const tool = assistant.toolCalls?.find(tc => tc.id === event.toolCallId)
                if (tool) {
                  tool.result = event.content || ''
                  tool.status = 'completed'
                }
              }
              break
            case 'RUN_FINISHED':
              assistant.status = 'completed'
              break
            case 'RUN_ERROR':
              assistant.status = 'error'
              assistant.content += `\n[错误: ${event.message || '未知错误'}]`
              break
          }

          newMessages[assistantIndex] = assistant
          return newMessages
        })
      }
    }

    setIsStreaming(false)
  })
  .catch(error => {
    console.error('发送消息失败:', error)
    setIsStreaming(false)
  })
}, [])
```

**核心要点**：
- 用 `response.body.getReader()` 读取流
- `TextDecoder` 把二进制流转成文本
- `buffer` 机制处理跨 chunk 的不完整行
- `setMessages` 内部根据 AG-UI 事件类型更新消息内容、工具调用状态、消息状态

### 4.4 `web/src/hooks/useDebugWS.ts`

WebSocket 调试 Hook：

```ts
export function useDebugWS() {
  const wsRef = useRef<WebSocket | null>(null)
  const [connected, setConnected] = useState(false)
  const [clientRequests, setClientRequests] = useState<ClientRequestItem[]>([])
  const [aguiTransforms, setAguiTransforms] = useState<AguiTransformItem[]>([])
  const [agentInfos, setAgentInfos] = useState<AgentEventItem[]>([])

  const connect = useCallback(() => {
    const ws = new WebSocket('/debug/ws')
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data)
      const debugItem = { id: generateId(), timestamp: ..., type: payload.type, data: payload.data }

      switch (payload.type) {
        case 'client_request':
          setClientRequests(prev => [...prev, debugItem])
          break
        case 'agui_transform':
          setAguiTransforms(prev => [...prev, debugItem])
          break
        case 'agent_event':
          setAgentInfos(prev => [...prev, debugItem])
          break
      }
    }

    ws.onclose = () => {
      setConnected(false)
      // 自动重连（指数退避）
      setTimeout(() => connect(), delay)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => disconnect()
  }, [connect, disconnect])

  return { clientRequests, aguiTransforms, agentInfos, connected, connect, disconnect, clear }
}
```

- 组件挂载时自动连接 `/debug/ws`
- 根据消息类型分发到三个状态
- 断线后自动重连

### 4.5 `web/src/components/DebugPanel/index.tsx`

```tsx
export default function DebugPanel({ clientRequests, aguiTransforms, agentInfos }) {
  return (
    <div className="debug-panel">
      <div className="debug-column">
        <ClientJsonView data={clientRequests} />
      </div>
      <div className="debug-column">
        <AguiTransformView data={aguiTransforms} />
      </div>
      <div className="debug-column">
        <AgentInfoView data={agentInfos} />
      </div>
    </div>
  )
}
```

- 左栏：`ClientJsonView` 展示 `client_request` 类型数据
- 中栏：`AguiTransformView` 展示 `agui_transform` 类型数据
- 右栏：`AgentInfoView` 展示 `agent_event` 类型数据

---

## 五、完整数据流（面试重点）

### 5.1 请求方向

```
┌─────────────┐     POST /ag-ui (JSON)      ┌─────────────────┐
│  前端 React  │ ───────────────────────────▶│  FastAPI /ag-ui │
└─────────────┘                             └─────────────────┘
                                                    │
                                                    ▼
                                         ┌────────────────────┐
                                         │ RunAgentInput 验证  │
                                         │ (Pydantic)         │
                                         └────────────────────┘
                                                    │
                                                    ▼
                                         ┌────────────────────┐
                                         │ convert_agui_      │
                                         │ messages_to_msgs() │
                                         │ AG-UI Msg →        │
                                         │ agentscope Msg     │
                                         └────────────────────┘
                                                    │
                                                    ▼
                                         ┌────────────────────┐
                                         │ create_agent()     │
                                         │ ReActAgent + Model │
                                         └────────────────────┘
                                                    │
                                                    ▼
                                         ┌────────────────────┐
                                         │ run_agent_stream() │
                                         │ 全量 → 增量 delta  │
                                         └────────────────────┘
```

### 5.2 响应方向

```
┌────────────────────┐     Msg (增量)      ┌────────────────────┐
│ run_agent_stream() │ ───────────────────▶│ msg_to_agui_events │
└────────────────────┘                     │ (agui_adapter.py)  │
                                           └────────────────────┘
                                                      │
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                    │   SSE 流        │   │  WebSocket 调试  │   │  WebSocket 调试  │
                    │   /ag-ui        │   │  client_request │   │  agui_transform │
                    └─────────────────┘   └─────────────────┘   └─────────────────┘
                              │                      │                      │
                              ▼                      ▼                      ▼
                    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
                    │  前端 ChatPanel  │   │  左栏：原始请求  │   │  中栏：协议转换  │
                    └─────────────────┘   └─────────────────┘   └─────────────────┘
```

### 5.3 一次完整调用的时序

```
前端                后端                Agent              调试面板
 │                   │                   │                   │
 │── POST /ag-ui ───▶│                   │                   │
 │                   │── publish_request_raw ───────────────▶│ 左栏显示原始请求
 │                   │                   │                   │
 │                   │── convert messages ──▶                │
 │                   │                   │                   │
 │                   │── publish_request_transform ─────────▶│ 中栏显示请求转换
 │                   │                   │                   │
 │                   │── create_agent & run ──▶              │
 │                   │                   │                   │
 │                   │◀──── Msg("北京") ──│                   │
 │                   │                   │                   │
 │                   │── msg_to_agui_events                  │
 │                   │── publish_agent_event ───────────────▶│ 右栏显示 Agent 事件
 │◀── SSE: TEXT_MESSAGE_CONTENT delta="北京" ─────────────────│
 │                   │                   │                   │
 │                   │◀──── Msg("今天") ──│                   │
 │◀── SSE: TEXT_MESSAGE_CONTENT delta="今天" ─────────────────│
 │                   │                   │                   │
 │                   │◀── ToolUseBlock ──│                   │
 │                   │                   │                   │
 │◀── SSE: TOOL_CALL_START/ARGS/END ─────────────────────────│
 │                   │                   │                   │
 │                   │◀── ToolResult ────│                   │
 │◀── SSE: TOOL_CALL_RESULT ─────────────────────────────────│
 │                   │                   │                   │
 │                   │◀──── Msg("。", last=True) ─│          │
 │◀── SSE: TEXT_MESSAGE_CONTENT delta="。" + TEXT_MESSAGE_END │
 │                   │                   │                   │
 │◀── SSE: RUN_FINISHED ─────────────────────────────────────│
```

---

## 六、协议转换详解（面试核心）

### 6.1 RunAgentInput → AgentRequest

| AG-UI 字段 | agentscope 字段 | 转换函数 |
|---|---|---|
| `threadId` | `session_id` / `thread_id` | `agui_endpoint.py` 中直接取值 |
| `runId` | `run_id` / `id` | `agui_endpoint.py` 中直接取值 |
| `messages[].role` | `Msg.role` | `convert_agui_messages_to_msgs` |
| `messages[].content` | `Msg.content = [TextBlock]` | `convert_agui_messages_to_msgs` |
| `system` / `developer` | `role="system"` | `convert_agui_messages_to_msgs` |
| `assistant.tool_calls` | `ToolUseBlock` | `convert_agui_messages_to_msgs` |
| `tool` | `ToolResultBlock` | `convert_agui_messages_to_msgs` |

### 6.2 Agent Event → AG-UI Event

| agentscope 内容 | AG-UI 事件 | 说明 |
|---|---|---|
| 第一条消息 | `RUN_STARTED` | 只发一次 |
| `TextBlock(text="北京")` | `TEXT_MESSAGE_START` + `TEXT_MESSAGE_CONTENT` | 第一次带 START |
| `TextBlock(text="今天")` | `TEXT_MESSAGE_CONTENT` | 中间只有 CONTENT |
| `TextBlock(text="。", is_last=True)` | `TEXT_MESSAGE_CONTENT` + `TEXT_MESSAGE_END` | 最后带 END |
| `ToolUseBlock` | `TOOL_CALL_START` → `TOOL_CALL_ARGS` → `TOOL_CALL_END` | 连续三个事件 |
| `ToolResultBlock` | `TOOL_CALL_RESULT` | 结果事件 |
| 流结束 | `RUN_FINISHED` | 只发一次 |

---

## 七、Mock 模式原理

```python
# agui_endpoint.py
if os.environ.get("MOCK_AGENT", "").lower() in ("1", "true", "yes"):
    from mock_agent_runner import create_mock_agent as create_agent
    from mock_agent_runner import run_mock_agent_stream as run_agent_stream
else:
    from agent_runner import create_agent, run_agent_stream
```

- 通过环境变量在**导入时**决定使用真实 Agent 还是 Mock Agent
- Mock 和真实 Agent 导出相同签名的函数
- 上层 `agui_endpoint` 不需要任何改动

启动方式：

```bash
cd server
MOCK_AGENT=true python main.py
```

Docker 中默认已设置 `MOCK_AGENT=true`。

---

## 八、Docker 构建原理

### `Dockerfile`

1. **Stage 1（node:20-slim）**：构建前端
   - `npm ci`
   - `npm run build`
   - 输出 `dist/` 目录

2. **Stage 2（python:3.11-slim）**：运行后端
   - 安装 Python 依赖
   - 复制后端代码
   - 从 Stage 1 复制 `web/dist`
   - 设置 `MOCK_AGENT=true`、`SERVE_STATIC=true`、`HOST=0.0.0.0`

### `docker-compose.yml`

```yaml
services:
  ag-ui-debug:
    build: .
    ports:
      - "8090:8090"
    environment:
      - MOCK_AGENT=true
      - SERVE_STATIC=true
      - HOST=0.0.0.0
```

- `HOST=0.0.0.0`：让 Uvicorn 监听所有网络接口，Docker 端口映射才能生效
- `SERVE_STATIC=true`：让 FastAPI 把 `web/dist` 作为静态文件提供

---

## 九、CI 流程

`.github/workflows/test.yml`：

```yaml
jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r server/requirements.txt
      - run: pip install pytest
      - run: pytest
        working-directory: server
        env:
          MOCK_AGENT: "true"

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
        working-directory: web
      - run: npm run build
        working-directory: web
```

- 后端：安装依赖 + 跑 pytest（强制 Mock 模式，无需 API Key）
- 前端：安装依赖 + TypeScript 编译 + Vite 构建

---

## 十、面试讲述模板

> `ag_ui_debug` 是我为了深入理解 AG-UI 协议而独立实现的协议栈。后端用 FastAPI 实现了 `/ag-ui` 端点，接收前端的 `RunAgentInput`，通过 `convert_agui_messages_to_msgs` 转成 agentscope 的 Msg 列表，驱动 ReActAgent 运行。Agent 返回的累积全量文本经过 `run_agent_stream` 计算成增量 delta，再经过 `agui_adapter` 转成 AG-UI SSE 事件流返回给前端。为了让协议转换过程可见，我加了一个 WebSocket 调试通道 `/debug/ws` 和三栏 React 调试面板。为了让项目能独立运行，我实现了 `MOCK_AGENT=true` 模式，不依赖外部 LLM API 也能演示完整流程。项目包含 18 个测试、GitHub Actions CI 和 Docker 一键启动。

---

## 十一、你可能需要进一步追问的点

1. **SSE 流式断连处理**：`useAguiSSE` 中如何处理 `reader.read()` 结束后的残余 buffer？
2. **增量计算边界**：如果 agentscope 返回的 `Msg` 没有 `invocation_id`，`agent_runner` 如何兜底？
3. **工具调用嵌套**：如果 Agent 连续调用多个工具，`AGUIEventTracker` 如何管理状态？
4. **CORS 与代理**：开发时为什么需要 Vite 代理 `/ag-ui` 和 `/debug`？
5. **Mock 与真实 Agent 的一致性**：如何保证 Mock 输出的事件序列和真实 Agent 一致？

可以在对应源码位置打断点或加日志，验证自己的理解。
