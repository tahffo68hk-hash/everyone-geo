"""
微博平台适配器 (WeiboPublisher) 规范与单元测试
验证：
1. 渠道元数据与官方 URL
2. 微博正文写入与双井号话题 (#话题#) 录入
3. 素材图片上传
4. 引导浮层清理
5. PREPARE_ONLY：停留在【发送】按钮阶段（绝不自动提交）
6. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.weibo import WeiboPublisher
from src.models import MediaItem


def test_weibo_publisher_metadata():
    driver = MagicMock()
    pub = WeiboPublisher(driver)
    assert pub.get_channel_name() == "WEIBO"
    assert "weibo.com" in pub.get_creator_url()
    assert pub.is_video_channel() is False

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("微博" in item for item in checklist)
    assert any("话题" in item for item in checklist)


def test_weibo_dismiss_popovers():
    driver = MagicMock()
    pub = WeiboPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_weibo_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = WeiboPublisher(driver)

    # 1. 空列表应该为 True (允许纯文本微博)
    ok, msg = pub.upload_media([])
    assert ok is True

    # 2. 真实图片素材
    real_img = tmp_path / "test_weibo.png"
    real_img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x01" * 100)

    file_input = MagicMock()
    file_input.get_attribute.return_value = "image/png"

    def mock_find_elements(by, sel):
        if "file" in sel.lower():
            return [file_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    item = MediaItem(index=1, type="IMAGE", url=f"file:///{real_img.as_posix()}", local_path=str(real_img))
    ok, msg = pub.upload_media([item])
    assert ok is True
    assert "已上传" in msg


def test_weibo_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = WeiboPublisher(driver)

    send_btn = MagicMock()
    send_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "send_btn" in str(sel) or "Tool_btn" in sel or "发送" in sel:
            return [send_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发送" in msg or "确认" in msg
    send_btn.click.assert_not_called()


def test_weibo_validate_draft():
    driver = MagicMock()
    pub = WeiboPublisher(driver)

    editor_elem = MagicMock()
    editor_elem.get_attribute.return_value = "微博精彩测试内容，欢迎关注！ #科技数码# #AI工具#"
    editor_elem.text = "微博精彩测试内容，欢迎关注！ #科技数码# #AI工具#"

    def mock_find_elements(by, sel):
        if "content" in sel.lower() or "Form_input" in sel or "textarea" in sel:
            return [editor_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="微博标题测试",
        expected_body="微博精彩测试内容，欢迎关注！",
        expected_tags=["科技数码", "AI工具"],
        expected_media_count=0
    )

    assert diff.body_match is True
    assert diff.tags_match is True
    assert diff.passed is True
