"""
GeoLens 本地浏览器助手 - 命令行启动入口
"""
import sys
import os
from pathlib import Path

# 添加当前目录与上一级至 sys.path
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))
sys.path.insert(0, str(CURRENT_DIR.parent.parent))

import uvicorn
from src.config import settings, RUNTIME_DIR
from src.security import CURRENT_TOKEN

def main():
    print("=" * 65)
    print("   GeoLens 本地浏览器自动化辅助发布助手 (Selenium V2A)")
    print("=" * 65)
    print(f" 服务监听地址: http://{settings.host}:{settings.port}")
    print(f" 允许请求来源: {', '.join(settings.allowed_origins)}")
    print(f" 本地配对令牌: {CURRENT_TOKEN}")
    print(f" 运行缓存目录: {RUNTIME_DIR}")
    print("=" * 65)
    print(" 提示: 浏览器将在用户本机运行，使用专用 Profile 隔离保存登录态。")
    print(" 助手正在启动中，请勿关闭本窗口...\n")

    uvicorn.run(
        "src.server:app",
        host=settings.host,
        port=settings.port,
        log_level="info",
        reload=False
    )

if __name__ == "__main__":
    main()
