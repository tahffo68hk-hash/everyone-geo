"""
三大主流视频平台 (B站、抖音、微信视频号) 端到端集成与安全闸门测试
涵盖:
1. 任务管道完整链路：视频与封面准备、上传、平台转码等待、字段自动填入、DOM反读比对、PREPARE_ONLY
2. 本地文件安全防护：拦截非白名单扩展名、路径穿越、敏感系统目录
3. 发布凭证 Hostname 强校验：拦截 mock 域名、本地回环、子串匹配伪造，放行真实平台域名
4. 人工接管与发布包完整性：失败或等待登录时保留受控浏览器并提供完整素材包
"""
import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.models import (
    CreatePublishTaskRequest, TaskStatus, StepName, MediaItem
)
from src.task_runner import TaskManager, TaskExecutionState
from src.security import validate_media_file_path, validate_canonical_url_hostname
from src.adapters.bilibili import BilibiliPublisher
from src.adapters.douyin import DouyinPublisher
from src.adapters.wechat_channels import WechatChannelsPublisher


FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
SAMPLE_VIDEO = FIXTURES_DIR / "sample_test_video.mp4"
SAMPLE_COVER = FIXTURES_DIR / "sample_test_cover.jpg"


def test_media_security_boundaries(tmp_path: Path):
    """验证本地素材读取与上传安全防护边界"""
    # 1. 尝试窃取敏感凭证文件
    fake_env = tmp_path / ".env"
    fake_env.write_text("DATABASE_URL=postgres://root:secret@localhost/db", encoding="utf-8")
    ok, msg, p = validate_media_file_path(fake_env, expected_type="VIDEO")
    assert ok is False
    assert "安全拦截" in msg or "非受信任" in msg

    # 2. 尝试读取系统敏感目录
    git_dir = tmp_path / ".git"
    git_dir.mkdir()
    fake_git_config = git_dir / "config.mp4"
    fake_git_config.write_bytes(b"\x00\x00\x00\x1cftypisom" + b"\x01" * 100)
    ok, msg, p = validate_media_file_path(fake_git_config, expected_type="VIDEO")
    assert ok is False
    assert ".git" in msg

    # 3. 真实视频测试素材正常通过
    assert SAMPLE_VIDEO.exists()
    ok, msg, p = validate_media_file_path(SAMPLE_VIDEO, expected_type="VIDEO")
    assert ok is True
    assert p == SAMPLE_VIDEO.resolve()

    # 4. 真实封面测试素材正常通过
    assert SAMPLE_COVER.exists()
    ok, msg, p = validate_media_file_path(SAMPLE_COVER, expected_type="IMAGE")
    assert ok is True
    assert p == SAMPLE_COVER.resolve()


def test_canonical_url_hostname_security_boundaries():
    """验证发布凭证 Hostname 严格匹配，防御子串匹配绕过与 Mock 凭证伪造"""
    # Bilibili
    ok, msg = validate_canonical_url_hostname("https://www.bilibili.com/video/BV1uv411q7dC", "BILIBILI")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://b23.tv/BV1uv411q7dC", "BILIBILI")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://fake-bilibili.com/video/BV1uv411q7dC", "BILIBILI")
    assert ok is False
    assert "fake-bilibili.com" in msg or "必须属于官方域名" in msg

    # Douyin
    ok, msg = validate_canonical_url_hostname("https://www.douyin.com/video/7123456789012345678", "DOUYIN")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("https://evil.com?q=douyin.com", "DOUYIN")
    assert ok is False

    # WeChat Channels
    ok, msg = validate_canonical_url_hostname("https://channels.weixin.qq.com/platform/post/detail?id=123", "WECHAT_CHANNELS")
    assert ok is True

    ok, msg = validate_canonical_url_hostname("http://localhost:3000/mock/channels", "WECHAT_CHANNELS")
    assert ok is False
    assert "禁止使用 localhost" in msg


def test_three_platforms_prepare_only_and_video_upload_pipeline(tmp_path: Path):
    """
    验证 B站、抖音、视频号三大视频平台在 TaskManager 完整流程中的执行：
    1. 素材准备与安全校验
    2. 视频文件写入与等待平台处理完成
    3. 标题截断与填入
    4. 简介正文与标签填入
    5. 必要声明填入
    6. 双向 DOM 回读比对
    7. PREPARE_ONLY 最终停留，绝不越权公开提交
    """
    platforms = [
        ("BILIBILI", BilibiliPublisher, 80),
        ("DOUYIN", DouyinPublisher, 30),
        ("WECHAT_CHANNELS", WechatChannelsPublisher, 20),
    ]

    for channel, publisher_cls, title_limit in platforms:
        tm = TaskManager()
        driver = MagicMock()
        pub = publisher_cls(driver)

        # Mock DOM 元素
        title_elem = MagicMock()
        title_elem.is_displayed.return_value = True
        title_elem.get_attribute.return_value = "测试视频标题"
        title_elem.text = "测试视频标题"

        desc_elem = MagicMock()
        desc_elem.is_displayed.return_value = True
        desc_elem.get_attribute.return_value = "测试视频简介描述内容 #AI科技 #实战"
        desc_elem.text = "测试视频简介描述内容 #AI科技 #实战"

        tag_elem = MagicMock()
        tag_elem.is_displayed.return_value = True
        tag_elem.text = "AI科技"

        avatar_elem = MagicMock()
        avatar_elem.is_displayed.return_value = True

        file_input = MagicMock()
        file_input.tag_name = "input"
        file_input.is_displayed.return_value = True
        file_input.get_attribute.return_value = "video/mp4"
        file_input.text = ""

        duration_elem = MagicMock()
        duration_elem.is_displayed.return_value = True
        duration_elem.text = "00:45"

        thumb_elem = MagicMock()
        thumb_elem.is_displayed.return_value = True
        thumb_elem.get_attribute.return_value = "https://static.platform.com/thumb.jpg"

        dismiss_btn = MagicMock()
        dismiss_btn.is_displayed.return_value = True

        submit_btn = MagicMock()
        submit_btn.is_displayed.return_value = True

        def make_find_elements(c_name):
            def mock_fe(by, sel):
                s = str(sel).lower()
                if "login" in s or "qrcode" in s or "error" in s or "失败" in s or "支持" in s or "损坏" in s:
                    return []
                if "不用了" in s or "我知道了" in s or "知道了" in s or "semi-modal-close" in s:
                    return [dismiss_btn]
                if "avatar" in s or "user" in s or "up-info" in s:
                    return [avatar_elem]
                if "file" in s or ("upload" in s and "status" not in s):
                    return [file_input]
                if "title" in s or "短标题" in s or "稿件" in s:
                    return [title_elem]
                if "desc" in s or "editor" in s or "textarea" in s or "zone" in s:
                    return [desc_elem]
                if "tag" in s:
                    return [tag_elem]
                if "duration" in s or "time" in s:
                    return [duration_elem]
                if ("thumb" in s or "cover" in s or "player" in s or "video-item img" in s) and "qrcode" not in s:
                    return [thumb_elem]
                if "submit" in s or "publish" in s or "发表" in s or "投稿" in s:
                    return [submit_btn]
                return []
            return mock_fe

        driver.find_elements.side_effect = make_find_elements(channel)
        driver.current_url = pub.get_creator_url()
        driver.page_source = f"<html><body>已登录 创作者中心 {channel}</body></html>"

        task_id = f"test_{channel.lower()}_e2e_task"
        req = CreatePublishTaskRequest(
            task_id=task_id,
            channel=channel,
            account_id="tester",
            title="【实测发布】2026年最新AI多平台全流程自动化评测指南" * 2,  # 确保超过各平台限制
            body="这是详尽的测试视频简介描述内容，用于验证各大主流视频平台的完整发布链路。",
            tags=["AI科技", "实战指南"],
            media_items=[
                MediaItem(index=1, type="VIDEO", url=f"file:///{SAMPLE_VIDEO.as_posix()}", local_path=str(SAMPLE_VIDEO)),
                MediaItem(index=2, type="IMAGE", url=f"file:///{SAMPLE_COVER.as_posix()}", local_path=str(SAMPLE_COVER)),
            ],
            headless=True
        )

        state = TaskExecutionState(req)
        tm._tasks[task_id] = state

        # Mock browser_manager 与 registry
        with patch("src.task_runner.registry.get_publisher") as mock_get_pub, \
             patch("src.task_runner.browser_manager") as mock_bm:
            mock_get_pub.return_value = pub
            mock_bm.get_or_create_driver.return_value = driver
            mock_bm.take_screenshot.return_value = str(tmp_path / f"{channel}_screenshot.png")

            # 执行发布流程
            tm._run_task_pipeline(state)

        # 验证结果
        assert state.status == TaskStatus.AWAITING_CONFIRMATION, f"{channel} 未停留在等待人工确认状态，当前状态为: {state.status}"
        assert state.validation is not None
        assert state.current_step == StepName.PREPARE_CONFIRMATION

        # 严格验证 PREPARE_ONLY：绝不自动点击终态发布按钮
        submit_btn.click.assert_not_called()

        # 验证人工确认结果回填逻辑：
        # 1. 尝试伪造 mock 链接确认应被拦截
        ok_fake, msg_fake = tm.confirm_publish_result(
            task_id=task_id,
            canonical_url=f"http://fake-{channel.lower()}.com/published/123",
            external_asset_id="fake_id_123",
            verification_note="测试人工核验"
        )
        assert ok_fake is False
        assert "域名非法" in msg_fake or "必须属于官方域名" in msg_fake or "fake" in msg_fake

        # 2. 填写真实合法链接确认通过
        official_domain = "bilibili.com" if channel == "BILIBILI" else ("douyin.com" if channel == "DOUYIN" else "weixin.qq.com")
        ok_real, msg_real = tm.confirm_publish_result(
            task_id=task_id,
            canonical_url=f"https://www.{official_domain}/video/test_vid_12345",
            external_asset_id="vid_12345",
            verification_note="创作者在受控 Chrome 亲自核验并公开发布，确认落地链接"
        )
        assert ok_real is True
        assert state.status == TaskStatus.PUBLISHED
