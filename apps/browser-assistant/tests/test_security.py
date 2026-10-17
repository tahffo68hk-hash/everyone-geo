"""
安全与鉴权机制单元测试
"""
import pytest
from unittest.mock import MagicMock
from fastapi import Request

from src.security import (
    get_or_create_pairing_token,
    verify_origin,
    verify_request_auth,
    sanitize_log_message,
    CURRENT_TOKEN
)
from src.config import settings


def test_token_generation_and_persistence():
    token = get_or_create_pairing_token()
    assert token is not None
    assert len(token) >= 32
    # 再次调用返回相同 token
    token2 = get_or_create_pairing_token()
    assert token == token2


def test_origin_whitelist():
    # 允许的合法来源
    for origin in settings.allowed_origins:
        req = MagicMock(spec=Request)
        req.headers = {"origin": origin}
        assert verify_origin(req) is True

    # 恶意来源被拦截
    bad_req = MagicMock(spec=Request)
    bad_req.headers = {"origin": "http://evil-hacker.com"}
    assert verify_origin(bad_req) is False

    # 无 origin 头的本地直接调用 (如 curl / 本地单元测试) 允许
    local_req = MagicMock(spec=Request)
    local_req.headers = {}
    assert verify_origin(local_req) is True


def test_request_auth_verification():
    # 携带有效 X-Assistant-Token
    req_valid = MagicMock(spec=Request)
    req_valid.headers = {"X-Assistant-Token": CURRENT_TOKEN}
    assert verify_request_auth(req_valid) is True

    # 携带有效 Bearer Token
    req_bearer = MagicMock(spec=Request)
    req_bearer.headers = {"Authorization": f"Bearer {CURRENT_TOKEN}"}
    assert verify_request_auth(req_bearer) is True

    # 缺少或错误 Token
    req_invalid = MagicMock(spec=Request)
    req_invalid.headers = {"X-Assistant-Token": "wrong-token-123456789"}
    assert verify_request_auth(req_invalid) is False

    req_empty = MagicMock(spec=Request)
    req_empty.headers = {}
    assert verify_request_auth(req_empty) is False


    raw_log = "User logged in with password='Secret123!' and token='abc12345xyz' cookie='z_c0=my_session_cookie;'"
    cleaned = sanitize_log_message(raw_log)
    assert "Secret123!" not in cleaned
    assert "abc12345xyz" not in cleaned
    assert "my_session_cookie" not in cleaned
    assert "***REDACTED***" in cleaned


def test_validate_media_file_path_security(tmp_path):
    from src.security import validate_media_file_path

    # 1. 空路径校验
    ok, msg, p = validate_media_file_path("")
    assert ok is False
    assert "不能为空" in msg

    # 2. 非法敏感扩展名拦截 (.env, .py, .sh, .exe)
    malicious_script = tmp_path / "steal_tokens.py"
    malicious_script.write_text("print('steal')", encoding="utf-8")
    ok, msg, p = validate_media_file_path(malicious_script)
    assert ok is False
    assert "安全拦截" in msg or "非受信任" in msg

    malicious_env = tmp_path / ".env"
    malicious_env.write_text("SECRET=123", encoding="utf-8")
    ok, msg, p = validate_media_file_path(malicious_env)
    assert ok is False

    # 3. 敏感目录拦截
    ssh_fake_dir = tmp_path / ".ssh"
    ssh_fake_dir.mkdir(parents=True, exist_ok=True)
    fake_id_rsa = ssh_fake_dir / "id_rsa.mp4"
    fake_id_rsa.write_bytes(b"\x00\x00\x00\x1cftypisom" + b"1" * 100)
    ok, msg, p = validate_media_file_path(fake_id_rsa)
    assert ok is False
    assert ".ssh" in msg

    # 4. 文件不存在或大小为 0
    non_existent = tmp_path / "not_exist.mp4"
    ok, msg, p = validate_media_file_path(non_existent)
    assert ok is False
    assert "不存在" in msg

    zero_byte_file = tmp_path / "empty.mp4"
    zero_byte_file.write_bytes(b"")
    ok, msg, p = validate_media_file_path(zero_byte_file)
    assert ok is False
    assert "0 字节" in msg

    # 5. 合法视频与图片通过校验
    valid_video = tmp_path / "real_video.mp4"
    valid_video.write_bytes(b"\x00\x00\x00\x1cftypisom" + b"\x01" * 1024)
    ok, msg, p = validate_media_file_path(valid_video, expected_type="VIDEO")
    assert ok is True
    assert p == valid_video.resolve()

    valid_image = tmp_path / "cover.jpg"
    valid_image.write_bytes(b"\xff\xd8\xff\xe0" + b"\x02" * 512)
    ok, msg, p = validate_media_file_path(valid_image, expected_type="IMAGE")
    assert ok is True

    # 6. 类型不匹配拦截 (图片当成视频，或视频当成图片)
    ok, msg, p = validate_media_file_path(valid_image, expected_type="VIDEO")
    assert ok is False
    assert "格式不匹配" in msg


def test_validate_canonical_url_hostname_security():
    from src.security import validate_canonical_url_hostname

    # 1. 空或无效 scheme
    ok, msg = validate_canonical_url_hostname("", "BILIBILI")
    assert ok is False

    ok, msg = validate_canonical_url_hostname("javascript:alert(1)", "BILIBILI")
    assert ok is False

    # 2. 禁止内嵌用户名密码凭据
    ok, msg = validate_canonical_url_hostname("https://admin:pass@bilibili.com/video/BV123", "BILIBILI")
    assert ok is False
    assert "授权凭据" in msg

    # 3. 杜绝子串匹配漏洞 (例如 evil-bilibili.com 包含 bilibili.com)
    ok, msg = validate_canonical_url_hostname("https://evil-bilibili.com/video/BV123", "BILIBILI")
    assert ok is False
    assert "必须属于官方域名" in msg

    ok, msg = validate_canonical_url_hostname("https://attacker.com/bilibili.com/fake", "BILIBILI")
    assert ok is False
    assert "必须属于官方域名" in msg

    # 4. 杜绝 Mock 与 Fake 假域名
    ok, msg = validate_canonical_url_hostname("https://mock-douyin.com/video/123", "DOUYIN")
    assert ok is False

    ok, msg = validate_canonical_url_hostname("https://localhost:8000/douyin", "DOUYIN")
    assert ok is False
    assert "禁止使用 localhost" in msg

    # 5. 三大视频平台真实合法 URL 检验通过
    ok, msg = validate_canonical_url_hostname("https://www.bilibili.com/video/BV1xx411c7mD", "BILIBILI")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://b23.tv/BV1xx411c7mD", "BILIBILI")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://www.douyin.com/video/7123456789012345678", "DOUYIN")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://channels.weixin.qq.com/platform/post/detail?id=123", "WECHAT_CHANNELS")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://weixin.qq.com/sph/12345", "WECHAT_CHANNELS")
    assert ok is True

    # 6. 仿真通道合法性
    ok, msg = validate_canonical_url_hostname("http://localhost:8000/published/123", "SIMULATION")
    assert ok is True

