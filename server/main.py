"""
main.py - 后端服务入口文件

启动方式：
    python main.py

    或者使用 uvicorn 命令：
    uvicorn main:app --host 127.0.0.1 --port 8090 --reload
"""

import sys
import os

# 将 agentscope-runtime 的 src 目录添加到 Python 路径
# 这样可以导入 agentscope_runtime 的 schemas 等模块
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
src_path = os.path.join(project_root, "src")
if src_path not in sys.path:
    sys.path.insert(0, src_path)

# 将当前目录添加到 Python 路径（确保模块导入正常）
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from app import create_app

# 创建 FastAPI 应用实例
app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8090,
        reload=False,
    )
