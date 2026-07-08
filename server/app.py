"""
app.py - FastAPI 应用构建文件

功能说明：
- 创建 FastAPI 应用实例
- 注册所有路由：
  - POST /ag-ui: AG-UI 协议端点
  - WS /debug/ws: WebSocket 调试端点
- 配置 CORS（跨域资源共享）
- 配置生命周期（lifespan）
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agui_endpoint import agui_router
from debug_ws import debug_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    应用生命周期管理

    启动时：初始化资源
    关闭时：清理资源
    """
    print("AG-UI 调试服务正在启动...")
    yield
    print("AG-UI 调试服务正在关闭...")


def create_app() -> FastAPI:
    """
    创建 FastAPI 应用实例
    """
    app = FastAPI(
        title="AG-UI 协议调试服务",
        description="独立的 AG-UI 协议实现，用于调试和学习 AG-UI 协议",
        version="1.0.0",
        lifespan=lifespan,
    )

    # 配置 CORS（允许前端开发服务器和生产部署访问）
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",    # Vite 开发服务器
            "http://127.0.0.1:5173",
            "http://localhost:8090",    # 生产部署
            "http://127.0.0.1:8090",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # 注册路由
    app.include_router(agui_router)
    app.include_router(debug_router)

    # 健康检查端点
    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": "ag-ui-debug-server",
            "version": "1.0.0",
        }

    # Agent 配置信息端点
    @app.get("/agent/config")
    async def agent_config():
        from agent_runner import get_agent_config
        return get_agent_config()

    return app
