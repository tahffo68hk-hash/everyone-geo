"""
GeoLens 本地浏览器助手 - 安全与鉴权模块
实现:
1. 来源白名单校验 (Origin Verification)
2. 本地配对令牌校验 (Pairing Token Auth)
3. 敏感数据脱敏 (Sensitive Data Sanitization)
"""
import json
import os
import re
import secrets
from fastapi import Request, HTTPException, status
from .config import settings, TOKEN_FILE


def get_or_create_pairing_token() -> str:
    """获取或生成本地配对令牌，持久化保存在 .runtime 目录下"""
    if TOKEN_FILE.exists():
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            if data.get("token") and len(data["token"]) >= 16:
                return data["token"]
        except Exception:
            pass
    
    # 生成 32 字节高强度随机令牌
    new_token = secrets.token_urlsafe(32)
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(
        json.dumps({"token": new_token, "created_at": str(os.path.getctime(str(TOKEN_FILE.parent))) if TOKEN_FILE.parent.exists() else ""}, indent=2),
        encoding="utf-8"
    )
    return new_token


CURRENT_TOKEN = get_or_create_pairing_token()


def verify_origin(request: Request) -> bool:
    """检查 Origin / Referer 来源是否属于白名单"""
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    
    # 本地非跨域直接请求 (如 Python 测试、curl、无 origin 头) 允许
    if not origin and not referer:
        return True
    
    check_url = origin or referer or ""
    for allowed in settings.allowed_origins:
        if check_url.startswith(allowed):
            return True
            
    return False


def verify_request_auth(request: Request) -> bool:
    """
    检查请求鉴权令牌
    支持 X-Assistant-Token 请求头 或 Authorization: Bearer <token>
    """
    if not settings.auth_enabled:
        return True
        
    token_header = request.headers.get(settings.token_header_name)
    auth_header = request.headers.get("Authorization")
    
    bearer_token = None
    if auth_header and auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:].strip()
        
    candidate = token_header or bearer_token
    if not candidate:
        return False
        
    # 常量时间比较防止时序攻击
    return secrets.compare_digest(candidate, CURRENT_TOKEN)


# 敏感信息过滤正则
SENSITIVE_PATTERNS = [
    (re.compile(r'(password|passwd|pwd)\s*[=:]\s*["\']?([^"\'\s&]+)', re.IGNORECASE), r'\1=***REDACTED***'),
    (re.compile(r'(token|bearer|auth|secret|key)\s*[=:]\s*["\']?([^"\'\s&]+)', re.IGNORECASE), r'\1=***REDACTED***'),
    (re.compile(r'(cookie|session_id|z_c0)\s*[=:]\s*["\']?([^"\'\s&;]+)', re.IGNORECASE), r'\1=***REDACTED***'),
]


def sanitize_log_message(msg: str) -> str:
    """脱敏日志中的密码、Cookie、Token 等关键凭据"""
    if not msg:
        return ""
    sanitized = msg
    for pattern, repl in SENSITIVE_PATTERNS:
        sanitized = pattern.sub(repl, sanitized)
    return sanitized
