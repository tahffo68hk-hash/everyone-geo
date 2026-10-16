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


def test_sensitive_log_sanitization():
    raw_log = "User logged in with password='Secret123!' and token='abc12345xyz' cookie='z_c0=my_session_cookie;'"
    cleaned = sanitize_log_message(raw_log)
    assert "Secret123!" not in cleaned
    assert "abc12345xyz" not in cleaned
    assert "my_session_cookie" not in cleaned
    assert "***REDACTED***" in cleaned
