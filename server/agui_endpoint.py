"""
agui_endpoint.py - AG-UI 协议端点实现

功能说明：
- 实现 POST /ag-ui 端点
- 接收 AG-UI RunAgentInput 请求
- 使用 agentscope 1.x ReActAgent + stream_printing_messages 获取事件流
- 将事件转换为 AG-UI 事件并返回 SSE

数据流：
    前端 → POST /ag-ui (RunAgentInput JSON)
       ↓
    1. 推送调试：原始请求
       ↓
    2. 将 AG-UI 消息转为 agentscope Msg 列表
       ↓
    3. 推送调试：请求转换
       ↓
    4. 创建 Agent 并运行流式推理
       ↓
    5. 将 Msg 转为 AG-UI 事件（含正确的增量 delta）
       ↓
    6. 基于 AG-UI 事件推送调试：Agent 内部事件 + 响应转换
       ↓
    SSE 流 → 前端
"""

import json
import logging
import os
from typing import AsyncGenerator
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

# AG-UI 协议类型
from ag_ui.core.types import RunAgentInput

# 转换器
from agui_adapter import (
    AGUIEventTracker,
    msg_to_agui_events,
    serialize_agui_event,
    build_run_finished_event,
    build_run_error_event,
)

# Agent 运行器：Mock 模式无需真实 API Key
if os.environ.get("MOCK_AGENT", "").lower() in ("1", "true", "yes"):
    from mock_agent_runner import create_mock_agent as create_agent
    from mock_agent_runner import run_mock_agent_stream as run_agent_stream
else:
    from agent_runner import create_agent, run_agent_stream
from agent_runner import convert_agui_messages_to_msgs

# 调试发布
from debug_publisher import publisher

logger = logging.getLogger(__name__)

# 创建路由
agui_router = APIRouter()

# SSE 响应头（不包含 Content-Type，由 StreamingResponse 的 media_type 设置）
SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _map_agui_to_debug_event(agui_event) -> dict | None:
    """
    将 AG-UI 事件映射为 AgentInfoView 可识别的调试事件

    映射规则：
    ┌──────────────────────────────┬─────────────────────────────┐
    │ AG-UI 事件                    │ 调试事件类型（AgentInfoView）│
    ├──────────────────────────────┼─────────────────────────────┤
    │ TextMessageStartEvent        │ （跳过）                     │
    │ TextMessageContentEvent      │ TextBlockDeltaEvent          │
    │ TextMessageEndEvent          │ TextBlockEndEvent            │
    │ ToolCallStartEvent           │ ToolCallStartEvent           │
    │ ToolCallArgsEvent            │ ToolCallDeltaEvent           │
    │ ToolCallEndEvent             │ （跳过）                     │
    │ ToolCallResultEvent          │ ToolResultEndEvent           │
    │ RunStartedEvent              │ （由 ReplyStartEvent 替代）  │
    │ RunFinishedEvent             │ （由 ReplyEndEvent 替代）    │
    └──────────────────────────────┴─────────────────────────────┘

    返回：
    - dict: {"eventType": ..., "eventData": ...} 或 None（跳过的事件）
    """
    event_type = agui_event.type if hasattr(agui_event, 'type') else None
    event_id = str(uuid4())

    if event_type == 'TEXT_MESSAGE_CONTENT':
        return {
            "eventType": "TextBlockDeltaEvent",
            "eventData": {
                "id": event_id,
                "delta": agui_event.delta if hasattr(agui_event, 'delta') else "",
                "block_id": agui_event.message_id if hasattr(agui_event, 'message_id') else "",
            },
        }

    elif event_type == 'TEXT_MESSAGE_END':
        return {
            "eventType": "TextBlockEndEvent",
            "eventData": {
                "id": event_id,
                "block_id": agui_event.message_id if hasattr(agui_event, 'message_id') else "",
            },
        }

    elif event_type == 'TOOL_CALL_START':
        return {
            "eventType": "ToolCallStartEvent",
            "eventData": {
                "id": event_id,
                "tool_call_name": agui_event.tool_call_name if hasattr(agui_event, 'tool_call_name') else "",
                "tool_call_id": agui_event.tool_call_id if hasattr(agui_event, 'tool_call_id') else "",
            },
        }

    elif event_type == 'TOOL_CALL_ARGS':
        return {
            "eventType": "ToolCallDeltaEvent",
            "eventData": {
                "id": event_id,
                "delta": agui_event.delta if hasattr(agui_event, 'delta') else "",
                "tool_call_id": agui_event.tool_call_id if hasattr(agui_event, 'tool_call_id') else "",
            },
        }

    elif event_type == 'TOOL_CALL_RESULT':
        return {
            "eventType": "ToolResultEndEvent",
            "eventData": {
                "id": event_id,
                "output": agui_event.content if hasattr(agui_event, 'content') else "",
                "tool_call_id": agui_event.tool_call_id if hasattr(agui_event, 'tool_call_id') else "",
            },
        }

    # 跳过的事件：RUN_STARTED, RUN_FINISHED, TEXT_MESSAGE_START, TOOL_CALL_END
    return None


async def generate_agui_stream(
    run_agent_input: RunAgentInput,
    tracker: AGUIEventTracker | None = None,
) -> AsyncGenerator[str, None]:
    """
    生成 AG-UI 事件流

    流程：
    1. 接收 AG-UI 请求，推送调试原始请求
    2. 创建 Agent 和事件追踪器
    3. 运行 Agent，获取 agentscope 1.x 流式 Msg
    4. 先将 Msg 转为 AG-UI 事件（计算正确的增量 delta）
    5. 基于 AG-UI 事件推送调试信息（确保增量内容正确）
    6. 序列化并返回 SSE 数据
    7. 确保 RUN_FINISHED 事件
    """
    thread_id = run_agent_input.thread_id
    run_id = run_agent_input.run_id

    # 创建事件追踪器（如果外部未传入）
    if tracker is None:
        tracker = AGUIEventTracker(
            thread_id=thread_id,
            run_id=run_id,
        )

    try:
        # 1. 推送调试信息：原始请求
        await publisher.publish_request_raw(
            run_agent_input.model_dump(by_alias=True)
        )

        # 2. 将 AG-UI 消息转换为 agentscope Msg 列表
        msgs = convert_agui_messages_to_msgs(run_agent_input.messages)

        # 序列化转换后的消息供调试展示
        serialized_msgs = []
        for msg in msgs:
            try:
                if hasattr(msg, "to_dict"):
                    serialized_msgs.append(msg.to_dict())
                else:
                    serialized_msgs.append({"name": getattr(msg, "name", ""), "role": getattr(msg, "role", ""), "content": str(getattr(msg, "content", msg))})
            except Exception:
                serialized_msgs.append({"data": str(msg)})

        # 推送调试信息：请求转换
        field_mappings = [
            {"from": "threadId", "to": "thread_id", "value": thread_id},
            {"from": "runId", "to": "run_id", "value": run_id},
            {"from": "messages", "to": "messages", "value": f"{len(run_agent_input.messages)} 条消息"},
        ]
        if run_agent_input.tools:
            field_mappings.append({"from": "tools", "to": "tools", "value": f"{len(run_agent_input.tools)} 个工具"})

        await publisher.publish_request_transform(
            agui_input=run_agent_input.model_dump(by_alias=True),
            agent_request={
                "thread_id": thread_id,
                "run_id": run_id,
                "messages": serialized_msgs,
                "field_mappings": field_mappings,
                "description": "AG-UI 请求 → agentscope 1.x Agent 请求",
            },
        )

        # 3. 创建 Agent
        agent = create_agent()

        # 4. 推送调试信息：Agent 开始（ReplyStartEvent）
        await publisher.publish_agent_event(
            event_type="ReplyStartEvent",
            event_data={
                "id": str(uuid4()),
                "name": "Friday",
                "session_id": thread_id,
                "input": {
                    "messages": serialized_msgs,
                },
            },
            run_id=run_id,
            thread_id=thread_id,
        )

        # 5. 运行 Agent 并获取流式消息
        async for msg, is_last in run_agent_stream(agent, msgs):
            msg_type = type(msg).__name__
            print(f"DEBUG agui_endpoint: received msg_type={msg_type}, is_last={is_last}")

            # 5a. 【关键】先转换为 AG-UI 事件，获得正确的增量 delta
            agui_events = msg_to_agui_events(msg, is_last, tracker)

            # 修复 P2/P6: 空事件时跳过调试推送和 SSE 输出，避免 "无对应" 误报
            if not agui_events:
                continue

            # 5b. 基于 AG-UI 事件推送调试信息：Agent 内部事件
            #     这样 delta 就是真正的增量，不是累积全量
            for agui_event in agui_events:
                debug_mapping = _map_agui_to_debug_event(agui_event)
                if debug_mapping:
                    await publisher.publish_agent_event(
                        event_type=debug_mapping["eventType"],
                        event_data=debug_mapping["eventData"],
                        run_id=run_id,
                        thread_id=thread_id,
                    )

            # 5c. 推送调试信息：响应转换
            #     input 使用 AG-UI 事件中提取的增量信息（而非原始 Msg 全量文本）
            agui_types = []
            response_field_mappings = []
            if agui_events:
                for agui_event in agui_events:
                    if hasattr(agui_event, 'type'):
                        agui_types.append(agui_event.type)

                first_type = agui_types[0] if agui_types else ""
                response_field_mappings.append(
                    {"from": "msg_type", "to": "type", "value": f"{msg_type} → {first_type}"}
                )
            else:
                response_field_mappings.append(
                    {"from": "msg_type", "to": "无", "value": f"{msg_type} 无 AG-UI 对应事件"}
                )

            description = f"{msg_type} → {', '.join(agui_types)}" if agui_types else f"{msg_type} → 无 AG-UI 对应事件"

            # 构建 input：使用 AG-UI 事件数据（含正确增量），而非原始 Msg 全量
            agui_events_data = [
                e.model_dump(mode="json", exclude_none=True, by_alias=True)
                for e in agui_events
            ]

            # 提取增量摘要作为 input 描述
            input_summary = _extract_input_summary(agui_events)

            await publisher.publish_response_transform(
                agent_event=input_summary,
                agui_events=agui_events_data,
                run_id=run_id,
                thread_id=thread_id,
                description=description,
                field_mappings=response_field_mappings,
            )

            # 5d. 序列化并返回 SSE 数据
            for agui_event in agui_events:
                yield serialize_agui_event(agui_event)

        # 6. 推送调试信息：Agent 结束（ReplyEndEvent）
        await publisher.publish_agent_event(
            event_type="ReplyEndEvent",
            event_data={
                "id": str(uuid4()),
                "session_id": thread_id,
                "reply_id": run_id,
                "output_summary": {
                    "thread_id": thread_id,
                    "run_id": run_id,
                    "status": "completed",
                },
            },
            run_id=run_id,
            thread_id=thread_id,
        )

        # 7. 确保 RUN_FINISHED
        finish_events = build_run_finished_event(tracker)
        for event in finish_events:
            yield serialize_agui_event(event)

    except Exception as e:
        # 错误处理
        error_msg = f"Agent 运行异常: {str(e)}"
        print(error_msg)
        import traceback
        traceback.print_exc()

        # 推送错误事件
        error_events = build_run_error_event(
            tracker,
            message=error_msg,
            code="agent_runtime_error",
        )
        for event in error_events:
            yield serialize_agui_event(event)

        # 确保 RUN_FINISHED
        finish_events = build_run_finished_event(tracker)
        for event in finish_events:
            yield serialize_agui_event(event)


def _extract_input_summary(agui_events: list) -> dict:
    """
    从 AG-UI 事件列表中提取增量摘要，作为响应转换的 input

    这样 AguiTransformView 的"输入"区域显示的是增量内容，
    而不是 Msg 的累积全量文本，避免内容重复和混乱。

    参数：
    - agui_events: AG-UI 事件列表

    返回：
    - 摘要字典，包含事件类型和增量数据
    """
    if not agui_events:
        return {"type": "none", "summary": "无对应 AG-UI 事件"}

    # 按事件类型分组提取增量信息
    text_deltas = []
    tool_calls = []
    tool_results = []

    for event in agui_events:
        event_type = event.type if hasattr(event, 'type') else None

        if event_type == 'TEXT_MESSAGE_CONTENT':
            delta = event.delta if hasattr(event, 'delta') else ""
            msg_id = event.message_id if hasattr(event, 'message_id') else ""
            text_deltas.append({"delta": delta, "message_id": msg_id})

        elif event_type == 'TOOL_CALL_START':
            tool_calls.append({
                "tool_call_id": event.tool_call_id if hasattr(event, 'tool_call_id') else "",
                "tool_call_name": event.tool_call_name if hasattr(event, 'tool_call_name') else "",
            })

        elif event_type == 'TOOL_CALL_ARGS':
            if tool_calls:
                tool_calls[-1]["args_delta"] = event.delta if hasattr(event, 'delta') else ""

        elif event_type == 'TOOL_CALL_RESULT':
            tool_results.append({
                "tool_call_id": event.tool_call_id if hasattr(event, 'tool_call_id') else "",
                "content": event.content if hasattr(event, 'content') else "",
            })

    summary = {"event_types": [e.type for e in agui_events if hasattr(e, 'type')]}

    if text_deltas:
        # 拼接所有增量文本（这些已经是真正的增量，不是全量）
        combined_delta = "".join(d["delta"] for d in text_deltas)
        summary["text_delta"] = combined_delta
        summary["text_delta_length"] = len(combined_delta)

    if tool_calls:
        summary["tool_calls"] = tool_calls

    if tool_results:
        summary["tool_results"] = tool_results

    return summary


@agui_router.post("/ag-ui")
async def agui_endpoint(request: Request):
    """
    AG-UI 协议端点

    接收 AG-UI 协议的 RunAgentInput 请求，返回 SSE 流式响应

    请求格式：
    ```json
    {
      "threadId": "thread_xxx",
      "runId": "run_xxx",
      "messages": [
        {"id": "msg_xxx", "role": "user", "content": "你好"}
      ],
      "tools": [],
      "context": [],
      "forwardedProps": {}
    }
    ```

    响应格式：
    - SSE 流（text/event-stream）
    - data: {"type": "RUN_STARTED", ...}
    - data: {"type": "TEXT_MESSAGE_CONTENT", ...}
    - data: {"type": "RUN_FINISHED", ...}
    """
    try:
        # 读取请求体
        body = await request.json()

        # 验证请求
        if not body.get("threadId") or not body.get("runId"):
            raise HTTPException(
                status_code=400,
                detail="缺少必需字段: threadId 或 runId",
            )

        if not body.get("messages") or not isinstance(body.get("messages"), list):
            raise HTTPException(
                status_code=400,
                detail="缺少必需字段: messages（必须是数组）",
            )

        # 构造 RunAgentInput（使用 ag_ui 包验证）
        run_agent_input = RunAgentInput.model_validate(body)

        # 返回 SSE 流式响应
        # 修复 R1: 使用包装器确保生成器清理时推送调试信息
        async def streaming_with_cleanup():
            tracker = AGUIEventTracker(
                thread_id=run_agent_input.thread_id,
                run_id=run_agent_input.run_id,
            )
            try:
                async for chunk in generate_agui_stream(run_agent_input, tracker):
                    yield chunk
            except GeneratorExit:
                # 客户端断开，生成器被放弃
                logger.warning(f"SSE 生成器被客户端断开: thread={run_agent_input.thread_id}, run={run_agent_input.run_id}")
                raise
            finally:
                # 不能 yield（Python 语法限制），但可以通过 WebSocket 推送调试
                if not tracker._run_finished:
                    await publisher.publish_agent_event(
                        event_type="ReplyEndEvent",
                        event_data={
                            "id": str(uuid4()),
                            "session_id": run_agent_input.thread_id,
                            "reply_id": run_agent_input.run_id,
                            "status": "force_completed",
                            "reason": "client_disconnect_or_generator_cleanup",
                        },
                        run_id=run_agent_input.run_id,
                        thread_id=run_agent_input.thread_id,
                    )

        return StreamingResponse(
            streaming_with_cleanup(),
            media_type="text/event-stream",
            headers=SSE_HEADERS,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"请求处理失败: {str(e)}",
        )


@agui_router.get("/ag-ui")
async def agui_endpoint_get():
    """
    AG-UI 协议端点 GET 方法

    用于检查端点是否可用
    """
    return {
        "endpoint": "/ag-ui",
        "method": "POST",
        "description": "AG-UI 协议端点，接收 RunAgentInput 并返回 SSE 流式响应",
        "protocol": "ag-ui",
        "version": "1.0",
    }
