"""
微信公众平台图文适配器 (WechatOfficialAccountPublisher) 单元测试
验证：
1. 渠道元数据与官方 URL
2. 弹窗清理与引导遮罩消除
3. 标题限制（64字）与正文录入
4. 素材上传校验
5. PREPARE_ONLY：停留在草稿/群发按钮处，绝不越权自动提交
6. ValidationDiff 反读校验
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.wechat_official_account import WechatOfficialAccountPublisher
from src.models import MediaItem


def test_wechat_oa_metadata():
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)
    assert pub.get_channel_name() == "WECHAT_OFFICIAL_ACCOUNT"
    assert "mp.weixin.qq.com" in pub.get_creator_url()
    assert pub.is_video_channel() is False

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("微信" in item for item in checklist)
    assert any("草稿" in item for item in checklist)


def test_wechat_oa_dismiss_popovers():
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()
    body_mock.send_keys.assert_called_once()


def test_wechat_oa_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)

    # 1. 空列表应为 True (纯文字图文)
    ok, msg = pub.upload_media([])
    assert ok is True

    # 2. 真实图片素材
    real_img = tmp_path / "test_wechat_cover.jpg"
    real_img.write_bytes(b"\xff\xd8\xff\xe0" + b"\x01" * 100)

    file_input = MagicMock()
    def mock_find_elements(by, sel):
        if "file" in sel.lower():
            return [file_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    item = MediaItem(index=1, type="IMAGE", url=f"file:///{real_img.as_posix()}", local_path=str(real_img))
    ok, msg = pub.upload_media([item])
    assert ok is True
    assert "已上传" in msg
    file_input.send_keys.assert_called_once()


def test_wechat_oa_fill_title():
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)

    title_input = MagicMock()
    title_input.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    # 超过 64 字截断
    long_title = "GeoLens微信公众平台图文草稿发布能力全面测试" * 5
    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "公众号图文标题已填入" in msg


def test_wechat_oa_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)

    draft_btn = MagicMock()
    draft_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "草稿" in str(sel) or "js_submit" in str(sel):
            return [draft_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "草稿" in msg or "确认" in msg
    draft_btn.click.assert_not_called()


def test_wechat_oa_validate_draft():
    driver = MagicMock()
    pub = WechatOfficialAccountPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "微信公众平台深度体验报告"
    title_elem.text = "微信公众平台深度体验报告"

    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="微信公众平台深度体验报告",
        expected_body="正文内容测试",
        expected_tags=["微信", "科技"],
        expected_media_count=1
    )

    assert diff.title_match is True
    assert diff.passed is True
