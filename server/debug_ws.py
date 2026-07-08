"""
debug_ws.py - WebSocket 调试推送端点

功能说明：
- 提供 WebSocket 端点 /debug/ws
- 管理所有 WebSocket 连接
- 提供统一的调试信息推送接口

设计说明：
- 使用 FastAPI 原生 WebSocket 支持
- 维护一个全局连接列表
- 提供异步推送函数供其他模块调用

数据格式：
所有调试消息使用统一的 JSON 格式：
{
  "type": "client_request" | "agui_transform" | "agent_event",
  "timestamp": 1718000000000,
  "data": { ... }
}
"""

import time
from typing import List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

# 创建路由
debug_router = APIRouter()

# 全局 WebSocket 连接列表
# 存储所有活跃的 WebSocket 连接
_connections: List[WebSocket] = []


@debug_router.websocket("/debug/ws")
async def debug_websocket(websocket: WebSocket):
    """
    WebSocket 调试端点
    
    功能：
    - 接受 WebSocket 连接
    - 将连接添加到全局列表
    - 等待客户端消息（保持连接活跃）
    - 断开时从列表移除
    
    说明：
    - 前端连接 ws://localhost:8090/debug/ws
    - 连接后自动接收调试信息推送
    - 不需要前端主动发送消息
    """
    await websocket.accept()
    _connections.append(websocket)
    
    print(f"WebSocket 调试客户端已连接，当前连接数: {len(_connections)}")
    
    try:
        # 保持连接活跃
        while True:
            # 接收前端消息（可用于心跳检测或控制命令）
            try:
                data = await websocket.receive_text()
                # 简单的心跳响应
                if data == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                print("WebSocket 调试客户端已断开")
                break
            except Exception as e:
                print(f"WebSocket 接收错误: {e}")
                break
    except Exception as e:
        print(f"WebSocket 错误: {e}")
    finally:
        # 断开时从列表移除
        if websocket in _connections:
            _connections.remove(websocket)
        print(f"WebSocket 调试客户端已移除，当前连接数: {len(_connections)}")


async def push_debug_info(type: str, data: dict) -> None:
    """
    推送调试信息到所有 WebSocket 客户端
    
    参数：
    - type: 调试信息类型
      - "client_request": 客户端原始请求
      - "agui_transform": 协议转换过程
      - "agent_event": Agent 内部事件
    - data: 调试数据内容
    
    说明：
    - 异步函数，可以在任何异步上下文中调用
    - 如果连接列表为空，不会报错
    - 如果某个客户端断开，不会影响其他客户端
    
    使用示例：
    ```python
    await push_debug_info("client_request", {
        "request": agui_input.model_dump()
    })
    ```
    """
    if not _connections:
        return
    
    message = {
        "type": type,
        "timestamp": int(time.time() * 1000),
        "data": data,
    }
    
    # 向所有连接推送
    # 使用列表副本防止迭代过程中修改列表
    disconnected = []
    for ws in _connections[:]:
        try:
            await ws.send_json(message)
        except Exception as e:
            # 如果发送失败，标记为已断开
            print(f"WebSocket 推送失败: {e}")
            disconnected.append(ws)
    
    # 清理已断开的连接
    for ws in disconnected:
        if ws in _connections:
            _connections.remove(ws)
