"""
mock_agent_runner.py - Mock Agent 运行器

功能说明：
- 当设置环境变量 MOCK_AGENT=true 时，替代真实的 agentscope Agent
- 返回确定性的 agentscope Msg 流，无需外部 API Key 即可演示完整流程
- 输出的事件流覆盖：文本增量、工具调用开始/参数/结束、工具调用结果

用途：
- 本地开发调试
- 面试演示
- CI 测试（无需真实模型调用）
"""

import asyncio
from typing import AsyncGenerator

from agentscope.message import Msg


async def run_mock_agent_stream(
    agent: dict,
    msgs: list,
    timeout: float = 120.0,
) -> AsyncGenerator[tuple[Msg, bool], None]:
    """
    模拟 Agent 运行并返回增量流式消息

    参数：
    - agent: Mock Agent 对象（由 create_mock_agent 返回，忽略）
    - msgs: agentscope Msg 列表（用于从用户输入中提取城市）
    - timeout: 保留参数以兼容 run_agent_stream 签名

    返回：
    - 异步生成器，生成 (Msg, is_last) 元组
    """
    # 从用户输入中提取 location（如果包含天气相关关键词）
    location = "北京"
    for msg in msgs:
        content = msg.content
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text = block.get("text", "")
                    if "上海" in text:
                        location = "上海"
                    elif "北京" in text:
                        location = "北京"
        elif isinstance(content, str):
            if "上海" in content:
                location = "上海"
            elif "北京" in content:
                location = "北京"

    # 模拟文本流式输出
    text_deltas = [location, "今天", "天气", "晴朗", "。"]
    for i, delta in enumerate(text_deltas):
        is_last = i == len(text_deltas) - 1
        yield Msg(
            name="Friday",
            role="assistant",
            content=[{"type": "text", "text": delta}],
        ), is_last
        await asyncio.sleep(0.02)

    # 模拟工具调用
    tool_call_id = "call_weather_1"
    yield Msg(
        name="Friday",
        role="assistant",
        content=[{
            "type": "tool_use",
            "id": tool_call_id,
            "name": "get_weather",
            "input": {"location": location},
        }],
    ), False
    await asyncio.sleep(0.02)

    # 模拟工具调用结果
    yield Msg(
        name="tool",
        role="assistant",
        content=[{
            "type": "tool_result",
            "id": tool_call_id,
            "output": f"{location}: 25°C，晴朗，湿度 45%",
        }],
    ), False


def create_mock_agent(*args, **kwargs) -> dict:
    """
    模拟 create_agent 函数，返回一个标记对象

    参数和返回值仅用于兼容 create_agent 签名
    """
    return {"mock": True}
