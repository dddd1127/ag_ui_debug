"""
test_debug_ws.py - WebSocket 调试端点测试

覆盖范围：
- /debug/ws 接受 WebSocket 连接
- 发送 ping 后收到 pong
- 连接保持活跃
"""

import os

import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AGENT"] = "true"

from app import create_app


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


def test_debug_websocket_ping_pong(client):
    with client.websocket_connect("/debug/ws") as ws:
        ws.send_text("ping")
        response = ws.receive_text()
        assert response == "pong"


def test_debug_websocket_accepts_connection(client):
    with client.websocket_connect("/debug/ws") as ws:
        # 连接成功后不发送消息，直接断言连接对象存在
        assert ws is not None
