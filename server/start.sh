#!/usr/bin/env bash

# AG-UI Debug Server 启动脚本
# 
# 用法：
#   ./start.sh              # 启动服务器（前台运行）
#   ./start.sh -d           # 启动服务器（后台运行，使用 nohup）
#   ./start.sh --stop       # 停止服务器
#   ./start.sh --status     # 查看服务器状态

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VENV_DIR="$PROJECT_ROOT/.venv"
PORT=8090
PID_FILE="/tmp/ag_ui_debug_server.pid"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 检查虚拟环境
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${RED}错误: 虚拟环境不存在: $VENV_DIR${NC}"
    echo -e "${YELLOW}请先创建虚拟环境并安装依赖：${NC}"
    echo -e "  cd $PROJECT_ROOT"
    echo -e "  python3 -m venv .venv"
    echo -e "  .venv/bin/pip install -r $SCRIPT_DIR/requirements.txt"
    exit 1
fi

# Python 路径
PYTHON="$VENV_DIR/bin/python"

# 检查 Python 是否存在
if [ ! -f "$PYTHON" ]; then
    echo -e "${RED}错误: Python 解释器不存在: $PYTHON${NC}"
    exit 1
fi

# 切换到工作目录
cd "$SCRIPT_DIR" || exit 1

# 添加 PYTHONPATH
export PYTHONPATH="${SCRIPT_DIR}:${PYTHONPATH}"

# 停止服务器
if [ "$1" == "--stop" ]; then
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "${YELLOW}正在停止服务器 (PID: $PID)...${NC}"
            kill "$PID"
            rm -f "$PID_FILE"
            echo -e "${GREEN}服务器已停止${NC}"
        else
            echo -e "${YELLOW}服务器未运行${NC}"
            rm -f "$PID_FILE"
        fi
    else
        echo -e "${YELLOW}找不到 PID 文件${NC}"
    fi
    exit 0
fi

# 查看状态
if [ "$1" == "--status" ]; then
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "${GREEN}服务器正在运行 (PID: $PID)${NC}"
            echo -e "${BLUE}监听地址: http://127.0.0.1:$PORT${NC}"
        else
            echo -e "${YELLOW}服务器未运行（PID 文件存在但进程已终止）${NC}"
            rm -f "$PID_FILE"
        fi
    else
        echo -e "${YELLOW}服务器未运行${NC}"
    fi
    exit 0
fi

# 检查端口是否被占用
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}警告: 端口 $PORT 已被占用${NC}"
    echo -e "${YELLOW}请先停止占用该端口的进程，或使用其他端口${NC}"
    exit 1
fi

# 检查服务器是否已经在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo -e "${YELLOW}服务器已经在运行 (PID: $OLD_PID)${NC}"
        echo -e "${BLUE}监听地址: http://127.0.0.1:$PORT${NC}"
        exit 0
    fi
fi

# 启动服务器
if [ "$1" == "-d" ] || [ "$1" == "--daemon" ]; then
    echo -e "${GREEN}启动服务器（后台运行）...${NC}"
    echo -e "${BLUE}监听地址: http://127.0.0.1:$PORT${NC}"
    nohup "$PYTHON" -c "
import sys
sys.path.insert(0, '.')
from app import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='127.0.0.1', port=$PORT, reload=False)
" > /tmp/ag_ui_debug_server.log 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    echo -e "${GREEN}服务器已启动 (PID: $PID)${NC}"
    echo -e "${BLUE}日志: /tmp/ag_ui_debug_server.log${NC}"
    echo -e "${BLUE}使用 ./start.sh --stop 停止${NC}"
else
    echo -e "${GREEN}启动服务器...${NC}"
    echo -e "${BLUE}监听地址: http://127.0.0.1:$PORT${NC}"
    echo -e "${YELLOW}按 Ctrl+C 停止${NC}"
    echo ""
    
    "$PYTHON" -c "
import sys
sys.path.insert(0, '.')
from app import create_app
import uvicorn
app = create_app()
uvicorn.run(app, host='127.0.0.1', port=$PORT, reload=False)
"
fi
