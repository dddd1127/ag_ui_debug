"""
test_agui_adapter.py - AG-UI 协议转换单元测试

覆盖范围：
1. AG-UI 消息 → agentscope Msg 的字段映射（角色、内容）
2. agentscope Msg → AG-UI 事件的转换（文本、工具调用、工具结果）
3. 事件追踪器的状态管理（RUN_STARTED 只发一次等）
"""

import pytest

from agentscope.message import Msg

from agui_adapter import (
    AGUIEventTracker,
    msg_to_agui_events,
)
from agent_runner import convert_agui_messages_to_msgs


class SimpleAguiMessage:
    """简化版 AG-UI 消息对象，用于测试 convert_agui_messages_to_msgs"""

    def __init__(self, role: str, content: str, tool_calls=None, tool_call_id=""):
        self.role = role
        self.content = content
        self.tool_calls = tool_calls or []
        self.tool_call_id = tool_call_id


# ───────────────────────────────────────────────────────────────
# convert_agui_messages_to_msgs 测试
# ───────────────────────────────────────────────────────────────


def test_user_message_conversion():
    agui_msgs = [SimpleAguiMessage(role="user", content="你好")]
    msgs = convert_agui_messages_to_msgs(agui_msgs)

    assert len(msgs) == 1
    assert msgs[0].role == "user"
    assert msgs[0].name == "user"
    assert msgs[0].content[0].get("text") == "你好"


def test_assistant_message_conversion():
    agui_msgs = [SimpleAguiMessage(role="assistant", content="我是 Friday")]
    msgs = convert_agui_messages_to_msgs(agui_msgs)

    assert len(msgs) == 1
    assert msgs[0].role == "assistant"
    assert msgs[0].name == "Friday"
    assert msgs[0].content[0].get("text") == "我是 Friday"


def test_system_message_conversion():
    agui_msgs = [SimpleAguiMessage(role="system", content="你是一个助手")]
    msgs = convert_agui_messages_to_msgs(agui_msgs)

    assert len(msgs) == 1
    assert msgs[0].role == "system"
    assert msgs[0].content[0].get("text") == "你是一个助手"


def test_developer_message_maps_to_system():
    agui_msgs = [SimpleAguiMessage(role="developer", content="开发提示")]
    msgs = convert_agui_messages_to_msgs(agui_msgs)

    assert len(msgs) == 1
    assert msgs[0].role == "system"


def test_tool_message_conversion():
    agui_msgs = [SimpleAguiMessage(role="tool", content="工具结果", tool_call_id="call_1")]
    msgs = convert_agui_messages_to_msgs(agui_msgs)

    assert len(msgs) == 1
    assert msgs[0].role == "assistant"
    assert msgs[0].content[0].get("type") == "tool_result"
    assert msgs[0].content[0].get("id") == "call_1"


# ───────────────────────────────────────────────────────────────
# msg_to_agui_events 测试
# ───────────────────────────────────────────────────────────────


def test_run_started_event_first():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")
    msg = Msg(name="Friday", role="assistant", content=[{"type": "text", "text": "hi"}])

    events = msg_to_agui_events(msg, is_last=False, tracker=tracker)
    event_types = [e.type for e in events]

    assert "RUN_STARTED" in event_types
    assert event_types.index("RUN_STARTED") == 0


def test_text_message_event_sequence():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")

    # 第一个 delta：START + CONTENT
    msg1 = Msg(name="Friday", role="assistant", content=[{"type": "text", "text": "北"}])
    events1 = msg_to_agui_events(msg1, is_last=False, tracker=tracker)
    types1 = [e.type for e in events1]
    assert "TEXT_MESSAGE_START" in types1
    assert "TEXT_MESSAGE_CONTENT" in types1
    assert "TEXT_MESSAGE_END" not in types1

    # 中间 delta：只有 CONTENT
    msg2 = Msg(name="Friday", role="assistant", content=[{"type": "text", "text": "京"}])
    events2 = msg_to_agui_events(msg2, is_last=False, tracker=tracker)
    types2 = [e.type for e in events2]
    assert types2 == ["TEXT_MESSAGE_CONTENT"]

    # 最后 delta：CONTENT + END
    msg3 = Msg(name="Friday", role="assistant", content=[{"type": "text", "text": "。"}])
    events3 = msg_to_agui_events(msg3, is_last=True, tracker=tracker)
    types3 = [e.type for e in events3]
    assert "TEXT_MESSAGE_CONTENT" in types3
    assert "TEXT_MESSAGE_END" in types3


def test_tool_call_event_sequence():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")
    msg = Msg(
        name="Friday",
        role="assistant",
        content=[{
            "type": "tool_use",
            "id": "call_1",
            "name": "get_weather",
            "input": {"location": "北京"},
        }],
    )

    events = msg_to_agui_events(msg, is_last=False, tracker=tracker)
    event_types = [e.type for e in events]

    assert "TOOL_CALL_START" in event_types
    assert "TOOL_CALL_ARGS" in event_types
    assert "TOOL_CALL_END" in event_types


def test_tool_call_result_event():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")
    msg = Msg(
        name="tool",
        role="assistant",
        content=[{
            "type": "tool_result",
            "id": "call_1",
            "output": "25°C 晴朗",
        }],
    )

    events = msg_to_agui_events(msg, is_last=False, tracker=tracker)
    event_types = [e.type for e in events]

    assert "TOOL_CALL_RESULT" in event_types


def test_run_started_only_once():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")

    msg = Msg(name="Friday", role="assistant", content=[{"type": "text", "text": "hi"}])
    events1 = msg_to_agui_events(msg, is_last=False, tracker=tracker)
    events2 = msg_to_agui_events(msg, is_last=False, tracker=tracker)

    started_count_1 = sum(1 for e in events1 if e.type == "RUN_STARTED")
    started_count_2 = sum(1 for e in events2 if e.type == "RUN_STARTED")

    assert started_count_1 == 1
    assert started_count_2 == 0


def test_tool_call_args_contain_json():
    tracker = AGUIEventTracker(thread_id="t1", run_id="r1")
    msg = Msg(
        name="Friday",
        role="assistant",
        content=[{
            "type": "tool_use",
            "id": "call_1",
            "name": "get_weather",
            "input": {"location": "北京"},
        }],
    )

    events = msg_to_agui_events(msg, is_last=False, tracker=tracker)
    args_event = next(e for e in events if e.type == "TOOL_CALL_ARGS")

    assert "北京" in args_event.delta
