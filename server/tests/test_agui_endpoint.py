"""
test_agui_endpoint.py - /ag-ui SSE 端点集成测试

覆盖范围：
- POST /ag-ui 返回 SSE 流
- 响应包含 RUN_STARTED、TEXT_MESSAGE_CONTENT、TOOL_CALL_*、RUN_FINISHED
- 文本内容按 delta 分段推送
"""

import json
import os

import pytest
from fastapi.testclient import TestClient

os.environ["MOCK_AGENT"] = "true"

from app import create_app


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


def _parse_sse_events(response_text: str) -> list[dict]:
    """解析 SSE 响应文本为事件列表"""
    events = []
    for line in response_text.splitlines():
        if line.startswith("data: "):
            payload = line[6:].strip()
            if payload:
                try:
                    events.append(json.loads(payload))
                except json.JSONDecodeError:
                    pass
    return events


def _build_request(messages, thread_id="t1", run_id="r1"):
    return {
        "threadId": thread_id,
        "runId": run_id,
        "messages": messages,
        "tools": [],
        "context": [],
        "forwardedProps": {},
        "state": None,
    }


def test_ag_ui_endpoint_returns_sse(client):
    response = client.post(
        "/ag-ui",
        json=_build_request([{"id": "m1", "role": "user", "content": "北京天气"}]),
    )

    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]


def test_ag_ui_stream_contains_run_started_and_finished(client):
    response = client.post(
        "/ag-ui",
        json=_build_request([{"id": "m1", "role": "user", "content": "北京天气"}]),
    )

    events = _parse_sse_events(response.text)
    event_types = [e.get("type") for e in events]

    assert "RUN_STARTED" in event_types
    assert "RUN_FINISHED" in event_types


def test_ag_ui_stream_text_deltas_are_segmented(client):
    response = client.post(
        "/ag-ui",
        json=_build_request([{"id": "m1", "role": "user", "content": "北京天气"}]),
    )

    events = _parse_sse_events(response.text)
    deltas = [
        e.get("delta")
        for e in events
        if e.get("type") == "TEXT_MESSAGE_CONTENT"
    ]

    assert "北京" in deltas
    assert "今天" in deltas
    assert "天气" in deltas


def test_ag_ui_stream_contains_tool_call_sequence(client):
    response = client.post(
        "/ag-ui",
        json=_build_request([{"id": "m1", "role": "user", "content": "北京天气"}]),
    )

    events = _parse_sse_events(response.text)
    event_types = [e.get("type") for e in events]

    assert "TOOL_CALL_START" in event_types
    assert "TOOL_CALL_ARGS" in event_types
    assert "TOOL_CALL_END" in event_types
    assert "TOOL_CALL_RESULT" in event_types


def test_ag_ui_stream_invalid_request_returns_400(client):
    response = client.post(
        "/ag-ui",
        json={
            "runId": "r1",
            "messages": [{"id": "m1", "role": "user", "content": "hi"}],
        },
    )

    assert response.status_code == 400
