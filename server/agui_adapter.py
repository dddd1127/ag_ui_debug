"""
agui_adapter.py - AG-UI 协议 ↔ agentscope 1.x 消息转换器

功能说明：
- 实现 agentscope 1.x Msg → AG-UI 事件流的**纯协议转换**
- 保留 AG-UI 请求解析（RunAgentInput 验证）
- 提供 SSE 序列化工具

设计原则：
- 本模块是纯粹的协议转换层，不做任何增量计算
- 输入的 Msg 中文本内容已经是增量 delta（由 agent_runner 负责全量→增量）
- TextBlock.text 直接作为 TEXT_MESSAGE_CONTENT 的 delta 输出

核心转换逻辑：
  agentscope 1.x 消息（增量）      →  AG-UI 事件
  ─────────────────────────────────────────────────────────
  首条消息                          →  RUN_STARTED
  Msg 含 TextBlock                  →  TEXT_MESSAGE_START / CONTENT / END
  Msg 含 ToolCallBlock              →  TOOL_CALL_START / ARGS / END
  Msg 含 ToolResultBlock            →  TOOL_CALL_RESULT
  流结束                            →  RUN_FINISHED
"""

import json
import logging
from typing import List
from uuid import uuid4

# AG-UI 协议事件类型
from ag_ui.core.events import (
    Event as AGUIEvent,
    RunStartedEvent,
    RunFinishedEvent,
    RunErrorEvent,
    TextMessageStartEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    ToolCallStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
)

# agentscope 1.x 消息类型
from agentscope.message import Msg, TextBlock, ToolUseBlock, ToolResultBlock

logger = logging.getLogger(__name__)


class AGUIEventTracker:
    """
    AG-UI 事件追踪器

    追踪消息状态，确保正确生成事件序列：
    - RUN_STARTED 只发一次
    - TEXT_MESSAGE_START/END 配对
    - RUN_FINISHED 只发一次

    注意：不做增量计算，增量 delta 由 agent_runner 层保证
    """

    def __init__(self, thread_id: str, run_id: str):
        self.thread_id = thread_id
        self.run_id = run_id
        self._run_started = False
        self._run_finished = False
        # message_id → 是否已发 START
        self._text_started: set = set()
        # message_id → 是否已发 END
        self._text_completed: set = set()
        # 当前正在流式输出的 message_id
        self._current_message_id: str = ""
        # 当前正在流式输出的 tool_call_id
        self._current_tool_call_id: str = ""

    def _new_message_id(self) -> str:
        return f"msg_{uuid4().hex[:8]}"

    def _new_tool_call_id(self) -> str:
        return f"call_{uuid4().hex[:8]}"


def msg_to_agui_events(
    msg: Msg,
    is_last: bool,
    tracker: AGUIEventTracker,
) -> List[AGUIEvent]:
    """
    将 agentscope 1.x 的 Msg 转换为 AG-UI 事件列表

    本函数是纯协议转换：
    - TextBlock.text 直接作为 TEXT_MESSAGE_CONTENT 的 delta
    - 不做任何增量计算（增量由 agent_runner 保证）

    参数：
    - msg: agentscope 1.x 消息对象（文本内容已是增量 delta）
    - is_last: 是否为该消息的最后一块
    - tracker: AG-UI 事件追踪器

    返回：
    - AG-UI 事件列表
    """
    events: List[AGUIEvent] = []

    # 确保 RUN_STARTED 先发
    if not tracker._run_started:
        tracker._run_started = True
        events.append(
            RunStartedEvent(
                thread_id=tracker.thread_id,
                run_id=tracker.run_id,
            )
        )

    # 处理 content 可能是 list 或单对象的情况
    content_blocks = msg.content if isinstance(msg.content, list) else [msg.content]

    for block in content_blocks:
        block_type = block.get('type') if isinstance(block, dict) else None

        if block_type == 'text':
            events.extend(
                _convert_text_block(block, is_last, tracker)
            )

        elif block_type == 'tool_use':
            events.extend(
                _convert_tool_call_block(block, tracker)
            )

        elif block_type == 'tool_result':
            events.extend(
                _convert_tool_result_block(block, tracker)
            )

        elif isinstance(block, str):
            # 纯字符串内容当作文本 delta
            if not tracker._current_message_id:
                tracker._current_message_id = tracker._new_message_id()

            msg_id = tracker._current_message_id

            if msg_id not in tracker._text_started:
                tracker._text_started.add(msg_id)
                events.append(TextMessageStartEvent(message_id=msg_id, role="assistant"))

            if block:
                events.append(TextMessageContentEvent(message_id=msg_id, delta=block))

            if is_last and msg_id not in tracker._text_completed:
                tracker._text_completed.add(msg_id)
                events.append(TextMessageEndEvent(message_id=msg_id))
                tracker._current_message_id = ""

    return events


def _convert_text_block(
    block: TextBlock,
    is_last: bool,
    tracker: AGUIEventTracker,
) -> List[AGUIEvent]:
    """将 TextBlock 转换为 AG-UI 文本消息事件

    纯协议转换：block.text 已经是增量 delta，直接输出。
    """
    events: List[AGUIEvent] = []
    text = block.get("text", "")

    # 如果没有当前 message_id，创建一个新的
    if not tracker._current_message_id:
        tracker._current_message_id = tracker._new_message_id()

    msg_id = tracker._current_message_id

    # 发 START（如果还没发）
    if msg_id not in tracker._text_started:
        tracker._text_started.add(msg_id)
        events.append(
            TextMessageStartEvent(message_id=msg_id, role="assistant")
        )

    # 发 CONTENT（直接用 delta，增量由 agent_runner 保证）
    if text:
        events.append(
            TextMessageContentEvent(message_id=msg_id, delta=text)
        )

    # 发 END（is_last=True 表示这条流式消息结束了）
    if is_last and msg_id not in tracker._text_completed:
        tracker._text_completed.add(msg_id)
        events.append(
            TextMessageEndEvent(message_id=msg_id)
        )
        tracker._current_message_id = ""

    return events


def _convert_tool_call_block(
    block: ToolUseBlock,
    tracker: AGUIEventTracker,
) -> List[AGUIEvent]:
    """将 ToolCallBlock 转换为 AG-UI 工具调用事件"""
    events: List[AGUIEvent] = []

    tool_call_id = block.get("id") or tracker._new_tool_call_id()
    tool_call_name = block.get("name", "")
    arguments = block.get("input", {})

    # 先结束当前文本消息（如果有未关闭的）
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        tracker._text_completed.add(tracker._current_message_id)
        events.append(
            TextMessageEndEvent(message_id=tracker._current_message_id)
        )
        tracker._current_message_id = ""

    # TOOL_CALL_START
    events.append(
        ToolCallStartEvent(
            tool_call_id=tool_call_id,
            tool_call_name=tool_call_name,
        )
    )

    # TOOL_CALL_ARGS
    args_str = json.dumps(arguments, ensure_ascii=False) if isinstance(arguments, dict) else str(arguments)
    events.append(
        ToolCallArgsEvent(
            tool_call_id=tool_call_id,
            delta=args_str,
        )
    )

    # TOOL_CALL_END
    events.append(
        ToolCallEndEvent(tool_call_id=tool_call_id)
    )

    tracker._current_tool_call_id = tool_call_id
    return events


def _convert_tool_result_block(
    block: ToolResultBlock,
    tracker: AGUIEventTracker,
) -> List[AGUIEvent]:
    """将 ToolResultBlock 转换为 AG-UI 工具结果事件"""
    events: List[AGUIEvent] = []

    tool_call_id = block.get("id") or tracker._current_tool_call_id or tracker._new_tool_call_id()
    output = block.get("output", "")

    # 修复 P16: ToolResultBlock.output 可能是 TextBlock 列表（agentscope 1.x ToolResponse），
    # 需要提取为字符串以满足 AG-UI ToolCallResultEvent.content 的要求。
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

    # 如果有未关闭的文本消息，先关闭
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        tracker._text_completed.add(tracker._current_message_id)
        events.append(
            TextMessageEndEvent(message_id=tracker._current_message_id)
        )
        tracker._current_message_id = ""

    events.append(
        ToolCallResultEvent(
            message_id=f"msg_tool_{uuid4().hex[:8]}",
            tool_call_id=tool_call_id,
            content=output,
            role="tool",
        )
    )

    return events


def build_run_finished_event(
    tracker: AGUIEventTracker,
    result: str = "",
) -> List[AGUIEvent]:
    """
    构建运行结束事件（如果尚未发送）
    """
    events: List[AGUIEvent] = []

    # 关闭未结束的文本消息
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        tracker._text_completed.add(tracker._current_message_id)
        events.append(
            TextMessageEndEvent(message_id=tracker._current_message_id)
        )
        tracker._current_message_id = ""

    if not tracker._run_finished:
        tracker._run_finished = True
        events.append(
            RunFinishedEvent(
                thread_id=tracker.thread_id,
                run_id=tracker.run_id,
                result=result or None,
            )
        )
    return events


def build_run_error_event(
    tracker: AGUIEventTracker,
    message: str,
    code: str = "",
) -> List[AGUIEvent]:
    """
    构建运行错误事件
    """
    events: List[AGUIEvent] = []

    # 关闭未结束的文本消息
    if tracker._current_message_id and tracker._current_message_id not in tracker._text_completed:
        tracker._text_completed.add(tracker._current_message_id)
        events.append(
            TextMessageEndEvent(message_id=tracker._current_message_id)
        )
        tracker._current_message_id = ""

    events.append(
        RunErrorEvent(
            run_id=tracker.run_id,
            message=message,
            code=code or "unknown_error",
        )
    )
    return events


def serialize_agui_event(event: AGUIEvent) -> str:
    """
    将 AG-UI 事件序列化为 SSE 数据格式

    参数：
    - event: AG-UI 事件

    返回：
    - SSE 格式字符串（data: {json}\\n\\n）
    """
    data = event.model_dump(
        mode="json",
        exclude_none=True,
        by_alias=True,
    )
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
