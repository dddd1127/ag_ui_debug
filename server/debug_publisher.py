"""
debug_publisher.py - 调试信息发布模块

功能说明：
- 封装统一的调试信息推送函数
- 在 AG-UI 端点的关键步骤中调用
- 提供类型化的推送函数

推送类型：
1. publish_request_raw: 推送原始请求
2. publish_request_transform: 推送请求转换
3. publish_agent_event: 推送 Agent 内部事件
4. publish_response_transform: 推送响应转换

使用示例：
    from debug_publisher import DebugPublisher
    
    publisher = DebugPublisher()
    
    # 在收到请求时
    await publisher.publish_request_raw(agui_input)
    
    # 在转换后
    await publisher.publish_request_transform(agui_input, agent_request)
    
    # 在 Agent 运行时
    await publisher.publish_agent_event(event)
    
    # 在响应转换后
    await publisher.publish_response_transform(agent_event, agui_events)
"""

from debug_ws import push_debug_info


class DebugPublisher:
    """
    调试信息发布器
    
    封装所有调试信息的推送逻辑
    
    说明：
    - 每个方法都是异步的
    - 如果 WebSocket 未连接，推送会被静默丢弃
    - 所有数据自动添加时间戳
    """
    
    async def publish_request_raw(self, agui_input: dict) -> None:
        """
        推送原始客户端请求
        
        参数：
        - agui_input: AG-UI 请求数据（RunAgentInput）
        
        说明：
        - 在收到前端请求时调用
        - 展示在调试面板左栏
        """
        run_id = agui_input.get("runId", "")
        thread_id = agui_input.get("threadId", "")
        await push_debug_info("client_request", {
            "runId": run_id,
            "threadId": thread_id,
            "request": agui_input,
        })
    
    async def publish_request_transform(
        self,
        agui_input: dict,
        agent_request: dict,
        description: str = "",
    ) -> None:
        """
        推送请求转换信息
        
        参数：
        - agui_input: AG-UI 原始请求
        - agent_request: 转换后的 Agent 请求
        - description: 转换说明（可选）
        
        说明：
        - 在请求转换完成后调用
        - 展示在调试面板中栏
        - 展示 AG-UI → Agent 的字段映射
        """
        run_id = agui_input.get("runId", "")
        thread_id = agui_input.get("threadId", "")
        await push_debug_info("agui_transform", {
            "runId": run_id,
            "threadId": thread_id,
            "direction": "request",
            "input": agui_input,
            "output": agent_request,
            "description": description or "AG-UI 请求 → Agent 请求",
        })
    
    async def publish_response_transform(
        self,
        agent_event: dict,
        agui_events: list,
        run_id: str = "",
        thread_id: str = "",
        description: str = "",
        field_mappings: list = None,
    ) -> None:
        """
        推送响应转换信息
        
        参数：
        - agent_event: Agent 原始事件
        - agui_events: 转换后的 AG-UI 事件列表
        - run_id: 运行 ID（可选）
        - thread_id: 会话 ID（可选）
        - description: 转换说明（可选）
        - field_mappings: 字段映射信息（可选）
        
        说明：
        - 在响应转换完成后调用
        - 展示在调试面板中栏
        - 展示 Agent → AG-UI 的事件转换
        """
        # 将 field_mappings 附加到 agent_event 中，方便前端提取
        input_data = dict(agent_event)
        if field_mappings:
            input_data["field_mappings"] = field_mappings
        
        await push_debug_info("agui_transform", {
            "runId": run_id,
            "threadId": thread_id,
            "direction": "response",
            "input": input_data,
            "output": agui_events,
            "description": description or "Agent 事件 → AG-UI 事件",
        })
    
    async def publish_agent_event(
        self,
        event_type: str,
        event_data: dict,
        run_id: str = "",
        thread_id: str = "",
        status: str = "",
    ) -> None:
        """
        推送 Agent 内部事件
        
        参数：
        - event_type: 事件类型（如 "Content", "Message", "BaseResponse"）
        - event_data: 事件数据
        - run_id: 运行 ID（可选）
        - thread_id: 会话 ID（可选）
        - status: 运行状态（可选）
        
        说明：
        - 在 Agent 运行过程中调用
        - 展示在调试面板右栏
        - 包含完整的 Agent 原始事件数据
        """
        await push_debug_info("agent_event", {
            "runId": run_id,
            "threadId": thread_id,
            "eventType": event_type,
            "event": event_data,
            "status": status,
        })


# 全局单例
# 方便在任何地方直接导入使用
publisher = DebugPublisher()
