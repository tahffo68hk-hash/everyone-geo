"""
GeoLens Selenium 本地浏览器辅助发布 - 核心配置模块
"""
import os
from pathlib import Path
from pydantic import BaseModel, Field

# 默认基础路径
BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent.parent
RUNTIME_DIR = REPO_ROOT / ".runtime" / "browser-assistant"
PROFILES_DIR = RUNTIME_DIR / "profiles"
SCREENSHOTS_DIR = RUNTIME_DIR / "screenshots"
TOKEN_FILE = RUNTIME_DIR / "assistant_token.json"

# 确保目录存在
PROFILES_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)


class AssistantSettings(BaseModel):
    # 服务主机与端口
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8765)
    
    # 允许访问的源（GeoLens Web / API 前端）
    allowed_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ]
    )
    
    # 浏览器相关
    browser_type: str = Field(default="chrome")
    chrome_binary_path: str | None = Field(default=None)
    headless_default: bool = Field(default=False)
    
    # 超时控制 (秒)
    element_timeout_sec: int = Field(default=15)
    page_load_timeout_sec: int = Field(default=30)
    
    # 鉴权配置
    token_header_name: str = Field(default="X-Assistant-Token")
    auth_enabled: bool = Field(default=True)


settings = AssistantSettings()
