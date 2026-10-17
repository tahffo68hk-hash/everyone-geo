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
from pathlib import Path
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


ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".avi", ".flv", ".mkv"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
ALLOWED_MEDIA_EXTENSIONS = ALLOWED_VIDEO_EXTENSIONS | ALLOWED_IMAGE_EXTENSIONS

SENSITIVE_DIRECTORY_NAMES = {
    ".ssh", ".aws", ".azure", ".kube", ".gnupg", ".git", "system32", "syswow64", "windows"
}


def validate_media_file_path(file_path: str | Path, expected_type: str | None = None) -> tuple[bool, str, Path | None]:
    """
    检查本地文件访问权限，严格防御任意本地文件被非法读取或越权上传:
    1. 校验扩展名必须属于合法素材白名单（视频/图片），严禁 .env/.key/代码/脚本/系统可执行文件
    2. 防御路径穿越与系统敏感目录（System32, .ssh, .git, etc.）
    3. 校验文件在本地存在、为常规文件且非空 (size > 0)
    """
    if not file_path:
        return False, "文件路径不能为空", None

    try:
        p = Path(file_path).resolve()
    except Exception as e:
        return False, f"无效的文件路径格式: {e}", None

    ext = p.suffix.lower()
    if not ext or ext not in ALLOWED_MEDIA_EXTENSIONS:
        return False, f"安全拦截: 不允许访问非受信任媒体类型文件 '{ext}'，仅限音视频及图片素材", None

    # 类型专项匹配
    norm_type = (expected_type or "").upper()
    if norm_type == "VIDEO" and ext not in ALLOWED_VIDEO_EXTENSIONS:
        return False, f"格式不匹配: 视频渠道仅接受合法视频文件 ({', '.join(sorted(ALLOWED_VIDEO_EXTENSIONS))})，实际为 {ext}", None
    elif norm_type in ("IMAGE", "COVER") and ext not in ALLOWED_IMAGE_EXTENSIONS:
        return False, f"格式不匹配: 图片素材仅接受合法图片格式 ({', '.join(sorted(ALLOWED_IMAGE_EXTENSIONS))})，实际为 {ext}", None

    # 敏感目录安全拦截
    parts_lower = [part.lower() for part in p.parts]
    for sensitive in SENSITIVE_DIRECTORY_NAMES:
        if sensitive in parts_lower:
            return False, f"安全拦截: 禁止读取敏感系统或凭据目录 '{sensitive}' 下的文件", None

    if not p.exists():
        return False, f"本地素材文件不存在: {p}", None

    if not p.is_file():
        return False, f"指定路径不是合法的常规文件: {p}", None

    try:
        size = p.stat().st_size
        if size == 0:
            return False, f"素材文件大小为 0 字节: {p}", None
        # 限制单文件上限不超过 2GB
        if size > 2 * 1024 * 1024 * 1024:
            return False, f"素材文件过大 ({size / (1024*1024):.1f} MB)，超出助手 2GB 限制", None
    except Exception as e:
        return False, f"读取本地素材元数据失败: {e}", None

    return True, "文件校验通过", p


PLATFORM_HOSTNAME_RULES: dict[str, list[str]] = {
    "BILIBILI": ["bilibili.com", "b23.tv"],
    "DOUYIN": ["douyin.com", "iesdouyin.com"],
    "WECHAT_CHANNELS": ["weixin.qq.com", "qq.com"],
    "KUAISHOU": ["kuaishou.com", "kwai.com"],
    "WEIBO": ["weibo.com", "weibo.cn"],
    "BAIJIAHAO": ["baidu.com"],
    "WECHAT_OFFICIAL_ACCOUNT": ["mp.weixin.qq.com", "weixin.qq.com", "qq.com"],
    "TOUTIAO": ["toutiao.com"],
    "ZHIHU": ["zhihu.com"],
    "XIAOHONGSHU": ["xiaohongshu.com", "xhslink.com"],
}


def validate_canonical_url_hostname(canonical_url: str, channel: str) -> tuple[bool, str]:
    """
    通过真实 URL 解析并校验 hostname，杜绝字符串子串包含匹配绕过
    """
    if not canonical_url or not canonical_url.strip():
        return False, "发布落地链接不能为空"

    from urllib.parse import urlparse

    try:
        parsed = urlparse(canonical_url.strip())
    except Exception as e:
        return False, f"落地链接 URL 解析失败: {e}"

    if parsed.scheme.lower() not in ("http", "https"):
        return False, f"发布链接协议必须为 http 或 https，当前为 '{parsed.scheme}'"

    hostname = (parsed.hostname or "").lower().strip()
    if not hostname:
        return False, "发布链接缺少合法的 host 域名"

    # 杜绝任何嵌入的凭据 (如 https://user:pass@evil.com)
    if parsed.username or parsed.password:
        return False, "安全拦截: 禁止在发布 URL 中包含用户名或密码等授权凭据"

    norm_ch = channel.upper().strip()
    if norm_ch == "SIMULATION":
        if hostname in ("localhost", "127.0.0.1", "test.local") or hostname.endswith(".local"):
            return True, "仿真通道域名合规"
        return False, "仿真通道仅接受本地回环或 .local 域名"

    # 真实平台禁止 localhost / IP 回环
    if hostname in ("localhost", "127.0.0.1", "[::1]", "0.0.0.0") or hostname.startswith("192.168.") or hostname.startswith("10."):
        return False, "真实平台发布凭证禁止使用 localhost 或本地私有 IP 地址"

    if any(bad in hostname for bad in ["mock", "fake", "example.com"]):
        return False, f"禁止使用 Mock 或测试用假域名 '{hostname}' 作为已发布证据"

    allowed_domains = PLATFORM_HOSTNAME_RULES.get(norm_ch)
    if not allowed_domains:
        # 未显式配置白名单的平台，至少要求非空且非本地
        return True, "未知平台通用域名已记录"

    match = False
    for d in allowed_domains:
        if hostname == d or hostname.endswith("." + d):
            match = True
            break

    if not match:
        allowed_str = ", ".join(allowed_domains)
        return False, f"{norm_ch} 发布落地链接域名非法 ('{hostname}')，必须属于官方域名 [{allowed_str}] 或其子域"

    return True, "发布链接真实 Hostname 验证通过"

