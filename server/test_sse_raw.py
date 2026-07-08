"""
诊断脚本：使用 TestClient 调用 /ag-ui 并打印原始 SSE 字节。
不经过浏览器/代理，用于确认后端是否确实发出了 RUN_FINISHED。
"""
import json
import sys

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

body = {
    "threadId": "thread_diag_001",
    "runId": "run_diag_001",
    "messages": [
        {"id": "msg_001", "role": "user", "content": "你好"}
    ],
    "tools": [],
    "context": [],
    "forwardedProps": {},
    "state": None,
}

print("=== POST /ag-ui (TestClient) ===", flush=True)
response = client.post("/ag-ui", json=body)
print(f"status_code={response.status_code}", flush=True)
print(f"content-type={response.headers.get('content-type')}", flush=True)
print(f"headers={dict(response.headers)}", flush=True)
print("", flush=True)

raw = response.content.decode("utf-8", errors="replace")
print("=== RAW SSE BODY ===", flush=True)
print(raw, flush=True)
print("=== END RAW SSE BODY ===", flush=True)
print("", flush=True)

# 逐行解析并统计事件
lines = raw.splitlines()
found_finished = False
found_started = False
event_types = []
for line in lines:
    if line.startswith("data: "):
        payload = line[6:].strip()
        if not payload:
            continue
        try:
            event = json.loads(payload)
            event_types.append(event.get("type"))
            if event.get("type") == "RUN_FINISHED":
                found_finished = True
            if event.get("type") == "RUN_STARTED":
                found_started = True
        except json.JSONDecodeError as e:
            print(f"JSON parse error: {e} on line: {line}", flush=True)

print(f"event_types={event_types}", flush=True)
print(f"RUN_STARTED={found_started}, RUN_FINISHED={found_finished}", flush=True)

if not found_finished:
    print("ERROR: backend did not emit RUN_FINISHED in TestClient response", flush=True)
    sys.exit(1)
print("OK: backend emitted RUN_FINISHED", flush=True)
