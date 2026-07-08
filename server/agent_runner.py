"""
agent_runner.py - Agent 运行器（agentscope 1.x 版本）

功能说明：
- 创建和配置 agentscope 1.x 的 ReActAgent 实例
- 运行 Agent 并返回流式消息，**将全量累积文本转为增量 delta**
- 支持多种模型和配置

设计说明：
- 使用 agentscope 1.x ReActAgent + OpenAIChatModel
- 使用 Toolkit.register_tool_function 注册自定义工具
- 使用 stream_printing_messages 获取流式输出
- 【关键】stream_printing_messages 每次返回的是累积全量文本，
  本模块负责计算增量 delta，让下游 agui_adapter 只做纯协议转换

环境变量：
- ANTHROPIC_AUTH_TOKEN: API 密钥
- ANTHROPIC_BASE_URL: API 基础 URL
- ANTHROPIC_MODEL: 模型名称
"""

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

logger = logging.getLogger(__name__)

# 默认配置
# API Key 必须从环境变量读取，避免泄露到代码仓库
DEFAULT_BASE_URL = os.getenv(
    "ANTHROPIC_BASE_URL",
    "https://opencode.ai/zen/go/v1",
)
DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "kimi-k2.6")


def _get_api_key() -> str:
    """从环境变量读取 API Key，未设置时给出明确提示。"""
    key = os.getenv("ANTHROPIC_AUTH_TOKEN")
    if not key:
        raise ValueError(
            "缺少环境变量 ANTHROPIC_AUTH_TOKEN。\n"
            "请在运行前设置：export ANTHROPIC_AUTH_TOKEN='your-api-key'\n"
            "或者创建 .env 文件并配置该变量。"
        )
    return key

# wttr.in 天气服务地址（免费、无需 API Key）
WTTR_URL = os.getenv("WTTR_URL", "https://wttr.in")


def get_weather(location: str) -> str:
    """查询指定城市的实时天气信息。当用户询问天气、气温、下雨、温度等相关问题时，请调用此工具。

    Args:
        location: 要查询天气的城市名称，如"北京"、"上海"、"Beijing"、"Tokyo"等。
    """
    try:
        params = {
            "format": "j1",
            "lang": "zh",
        }
        resp = requests.get(
            f"{WTTR_URL}/{location}",
            params=params,
            headers={"Accept-Language": "zh-CN,zh;q=0.9"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()

        current = data.get("current_condition", [{}])[0]
        area = data.get("nearest_area", [{}])[0]

        city_name = area.get("areaName", [{}])[0].get("value", location)
        country = area.get("country", [{}])[0].get("value", "")
        temp_c = current.get("temp_C", "N/A")
        feels_like = current.get("FeelsLikeC", "N/A")
        humidity = current.get("humidity", "N/A")
        weather_desc = current.get("lang_zh", [{}])[0].get("value", "")
        if not weather_desc:
            weather_desc = current.get("weatherDesc", [{}])[0].get("value", "N/A")
        wind_speed = current.get("windspeedKmph", "N/A")
        wind_dir = current.get("winddir16Point", "")
        visibility = current.get("visibility", "N/A")
        uv_index = current.get("uvIndex", "N/A")

        result = (
            f"📍 {city_name}, {country}\n"
            f"🌤 天气：{weather_desc}\n"
            f"🌡 温度：{temp_c}°C（体感 {feels_like}°C）\n"
            f"💧 湿度：{humidity}%\n"
            f"🌬 风速：{wind_speed} km/h {wind_dir}\n"
            f"👁 能见度：{visibility} km\n"
            f"☀️ 紫外线指数：{uv_index}"
        )
        return ToolResponse(content=[TextBlock(type="text", text=result)])

    except requests.Timeout:
        return ToolResponse(content=[TextBlock(type="text", text=f"获取 {location} 的天气超时，请稍后重试。")])
    except requests.ConnectionError:
        return ToolResponse(content=[TextBlock(type="text", text=f"无法连接天气服务，请检查网络或稍后重试。")])
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return ToolResponse(content=[TextBlock(type="text", text=f"未找到城市 \"{location}\" 的天气信息，请检查城市名称是否正确。")])
        return ToolResponse(content=[TextBlock(type="text", text=f"获取天气失败：HTTP {e.response.status_code if e.response is not None else 'unknown'}")])
    except Exception as e:
        logger.warning(f"get_weather error for {location}: {e}")
        return ToolResponse(content=[TextBlock(type="text", text=f"获取 {location} 的天气时出错：{e}")])


def create_agent(
    model_name: str = DEFAULT_MODEL,
    api_key: str | None = None,
    base_url: str = DEFAULT_BASE_URL,
) -> ReActAgent:
    """
    创建 ReActAgent 实例（agentscope 1.x）

    参数：
    - model_name: 模型名称
    - api_key: API 密钥，默认从 ANTHROPIC_AUTH_TOKEN 环境变量读取
    - base_url: API 基础 URL

    返回：
    - ReActAgent 实例
    """
    # 创建工具包
    toolkit = Toolkit()
    toolkit.register_tool_function(get_weather)

    # 创建模型（API Key 未传入时从环境变量读取）
    model = OpenAIChatModel(
        model_name=model_name,
        api_key=api_key or _get_api_key(),
        stream=True,
        client_kwargs={"base_url": base_url},
    )

    # 创建 ReActAgent
    agent = ReActAgent(
        name="Friday",
        sys_prompt=(
            "你是一个名叫 Friday 的智能助手。你可以使用工具来帮助用户。\n"
            "当用户询问任何城市的天气信息时，你必须调用 get_weather 工具来获取实时天气数据，"
            "不要自行编造天气信息。\n"
            "对于其他问题，请直接回答。"
        ),
        model=model,
        formatter=DashScopeChatFormatter(),
        toolkit=toolkit,
        max_iters=10,
    )
    agent.set_console_output_enabled(enabled=False)

    return agent


def convert_agui_messages_to_msgs(
    agui_messages: list,
) -> list:
    """
    将 AG-UI 消息列表转换为 agentscope 1.x Msg 列表

    参数：
    - agui_messages: AG-UI 消息列表（来自 RunAgentInput.messages）

    返回：
    - agentscope Msg 列表
    """
    msgs = []

    for agui_msg in agui_messages:
        role = agui_msg.role

        if role in ("system", "developer"):
            content = agui_msg.content or ""
            msgs.append(
                Msg(
                    name="system",
                    role="system",
                    content=[TextBlock(type="text", text=content)],
                )
            )

        elif role == "user":
            content = agui_msg.content
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                parts = []
                for item in content:
                    if hasattr(item, "text") and item.text:
                        parts.append(item.text)
                    elif hasattr(item, "data") and item.data:
                        mime_type = getattr(item, "mime_type", "unknown")
                        parts.append(f"[binary content: {mime_type}]")
                    elif isinstance(item, str):
                        parts.append(item)
                text = " ".join(parts) if parts else ""
            else:
                text = str(content)

            msgs.append(
                Msg(
                    name="user",
                    role="user",
                    content=[TextBlock(type="text", text=text)],
                )
            )

        elif role == "assistant":
            content_text = agui_msg.content or ""
            blocks = []

            if content_text:
                blocks.append(TextBlock(type="text", text=content_text))

            if hasattr(agui_msg, "tool_calls") and agui_msg.tool_calls:
                import json
                for tool_call in agui_msg.tool_calls:
                    func = tool_call.function
                    try:
                        input_data = json.loads(func.arguments or "{}")
                    except (json.JSONDecodeError, TypeError):
                        input_data = {}

                    blocks.append(
                        ToolUseBlock(
                            type="tool_use",
                            id=tool_call.id or f"call_{len(msgs)}",
                            name=func.name or "",
                            input=input_data,
                        )
                    )

            if blocks:
                msgs.append(
                    Msg(
                        name="Friday",
                        role="assistant",
                        content=blocks,
                    )
                )

        elif role == "tool":
            tool_call_id = getattr(agui_msg, "tool_call_id", "")
            content_text = agui_msg.content or ""
            if hasattr(agui_msg, "error") and agui_msg.error:
                content_text = f"error: {agui_msg.error}"

            msgs.append(
                Msg(
                    name="tool",
                    role="assistant",
                    content=[
                        ToolResultBlock(
                            type="tool_result",
                            id=tool_call_id or f"result_{len(msgs)}",
                            name="tool",
                            output=content_text,
                        )
                    ],
                )
            )

    return msgs


async def run_agent_stream(
    agent: ReActAgent,
    msgs: list,
    timeout: float = 120.0,
) -> AsyncGenerator[tuple, None]:
    """
    运行 Agent 并返回增量流式消息

    参数：
    - agent: ReActAgent 实例
    - msgs: agentscope Msg 列表
    - timeout: 超时时间（秒），默认 120 秒

    返回：
    - 异步生成器，生成 (Msg, is_last) 元组
      - Msg 中的文本内容是**增量 delta**（不是全量累积）
      - is_last=True 表示该消息流式输出结束

    说明：
    - stream_printing_messages 返回的 Msg 中文本是累积全量，
      本函数负责将全量转换为增量 delta
    - 对于 ToolUseBlock / ToolResultBlock，不做增量处理，
      直接透传（它们本身就不是流式的）
    - 同一个 msg.id 的多条文本消息属于同一次流式输出，
      用 _sent_text_len 追踪已发送长度来计算增量
    - 修复 R2: 添加超时机制，防止 API 无响应时永远挂起
    """
    logger.info(f"run_agent_stream: msgs count={len(msgs)}, timeout={timeout}s")

    # 追踪每个消息 id 已发送的文本长度
    # key: msg.id (invocation_id), value: 已发送的字符数
    sent_text_len_map: dict[str, int] = {}

    msg_count = 0

    # 修复 R2: 使用 asyncio.wait_for 包装每次 __anext__() 调用，
    # 防止 API 无响应时 async for 循环永远挂起。
    stream = stream_printing_messages(
        agents=[agent],
        coroutine_task=agent(msgs),
    )
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

            # 获取消息标识（同一次流式输出的所有 chunk 共享同一个 invocation_id）
            msg_id = getattr(raw_msg, "invocation_id", None) or getattr(raw_msg, "id", "")
            # 修复 P3: 缺失 invocation_id 时使用 fallback，避免所有消息共享同一个 key
            if not msg_id:
                msg_id = f"_fallback_{id(raw_msg)}_{len(sent_text_len_map)}"
                logger.warning(f"Msg 缺少 invocation_id，使用 fallback: {msg_id}")

            # 计算增量并构建新的 Msg
            delta_msg = _compute_delta_msg(raw_msg, msg_id, last, sent_text_len_map)

            logger.debug(f"run_agent_stream: msg #{msg_count}, id={msg_id}, last={last}")
            yield delta_msg, last

    except asyncio.TimeoutError:
        logger.warning(f"Agent 运行超时 ({timeout}s)")
        # 超时后 yield 一个结束信号，让下游正常关闭并触发 RUN_FINISHED
        yield Msg(
            name="system",
            role="assistant",
            content=[TextBlock(type="text", text="")],
        ), True

    logger.info(f"run_agent_stream: finished, total msgs={msg_count}")


def _compute_delta_msg(
    raw_msg: Msg,
    msg_id: str,
    is_last: bool,
    sent_text_len_map: dict[str, int],
) -> Msg:
    """
    将累积全量 Msg 转为增量 delta Msg

    参数：
    - raw_msg: 原始 Msg（可能包含全量累积文本）
    - msg_id: 消息标识（用于追踪同一次流式输出）
    - is_last: 是否为该消息最后一块
    - sent_text_len_map: 各消息 id 已发送的文本长度映射

    返回：
    - 新的 Msg，其中 TextBlock.text 已替换为增量 delta

    转换规则：
    - TextBlock: text 替换为 delta = text[已发长度:]
    - ToolUseBlock: 直接透传（非流式）
    - ToolResultBlock: 直接透传（非流式）
    - str 内容: 替换为增量 delta
    """
    content = raw_msg.content

    # 非 list 内容直接当字符串处理
    if not isinstance(content, list):
        if isinstance(content, str):
            sent_len = sent_text_len_map.get(msg_id, 0)
            delta = content[sent_len:]
            sent_text_len_map[msg_id] = len(content)
            if is_last:
                sent_text_len_map.pop(msg_id, None)
            # is_last=True 时即使 delta 为空也要保留 TextBlock，
            # 让下游 agui_adapter 能发出 TEXT_MESSAGE_END 事件
            if delta or is_last:
                return Msg(
                    name=raw_msg.name,
                    role=raw_msg.role,
                    content=[TextBlock(type="text", text=delta)],
                    metadata=raw_msg.metadata,
                )
            return Msg(
                name=raw_msg.name,
                role=raw_msg.role,
                content=[],
                metadata=raw_msg.metadata,
            )
        # 非字符串非列表，原样返回
        return raw_msg

    # list 内容，逐块处理
    new_blocks = []
    for block in content:
        block_type = block.get("type") if isinstance(block, dict) else None

        if block_type == "text":
            full_text = block.get("text", "")
            sent_len = sent_text_len_map.get(msg_id, 0)
            delta = full_text[sent_len:]
            sent_text_len_map[msg_id] = len(full_text)
            if is_last:
                sent_text_len_map.pop(msg_id, None)
            # is_last=True 时即使 delta 为空也要保留 TextBlock，
            # 让下游 agui_adapter 能发出 TEXT_MESSAGE_END 事件
            if delta or is_last:
                new_blocks.append(TextBlock(type="text", text=delta))

        elif block_type == "tool_use":
            # ToolUseBlock 非流式，直接透传
            new_blocks.append(block)

        elif block_type == "tool_result":
            # ToolResultBlock 非流式，直接透传
            new_blocks.append(block)

        else:
            # 未知类型，透传
            new_blocks.append(block)

    return Msg(
        name=raw_msg.name,
        role=raw_msg.role,
        content=new_blocks,
        metadata=raw_msg.metadata,
    )


def get_agent_config() -> dict:
    """
    获取当前 Agent 配置

    返回：
    - 配置字典（用于展示）
    """
    api_key = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
    masked_key = api_key[:4] + "****" + api_key[-4:] if len(api_key) > 8 else "未配置"

    return {
        "model": DEFAULT_MODEL,
        "base_url": DEFAULT_BASE_URL,
        "api_key": masked_key,
        "agent_type": "ReActAgent",
        "tools": ["get_weather（实时网络查询）"],
        "framework": "agentscope 1.x",
    }
