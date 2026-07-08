import sys
from pathlib import Path

# 将 server 目录加入 Python 路径，使测试能直接导入项目模块
sys.path.insert(0, str(Path(__file__).parent.parent))
