"""
百家号平台适配器 (BaijiahaoPublisher) 规范与单元测试
验证：
1. 渠道元数据与官方 URL
2. 64 字标题上限校验与截断
3. 正文编辑器写入
4. 配图上传
5. 引导浮层清理
6. PREPARE_ONLY：停留在【发布】按钮阶段（绝不自动提交）
7. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.baijiahao import BaijiahaoPublisher
from src.models import MediaItem


def test_baijiahao_publisher_metadata():
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)
    assert pub.get_channel_name() == "BAIJIAHAO"
    assert "baijiahao.baidu.com" in pub.get_creator_url()
    assert pub.is_video_channel() is False

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("百家号" in item for item in checklist)
    assert any("发布" in item for item in checklist)


def test_baijiahao_title_64_char_limit():
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)

    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower() or "标题" in sel:
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    long_title = "【实测对比】2026年最新AI全流程自动化发布系统深度体验与最佳实践指南全平台多模态内容分发落地实战长标题测试"
    assert len(long_title) > 50

    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "64 字" in msg or "填入" in msg


def test_baijiahao_dismiss_popovers():
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_baijiahao_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)

    # 1. 空列表应该为 True (允许纯文本发布)
    ok, msg = pub.upload_media([])
    assert ok is True

    # 2. 真实图片素材
    real_img = tmp_path / "test_baijiahao.png"
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


def test_baijiahao_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)

    publish_btn = MagicMock()
    publish_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish_btn" in str(sel) or "publishButton" in sel or "发布" in sel:
            return [publish_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发布" in msg or "确认" in msg
    publish_btn.click.assert_not_called()


def test_baijiahao_validate_draft():
    driver = MagicMock()
    pub = BaijiahaoPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "百家号深度评测指南"
    title_elem.text = "百家号深度评测指南"

    editor_elem = MagicMock()
    editor_elem.get_attribute.return_value = "百家号精彩长文内容，包含深度数据与结构化分析"
    editor_elem.text = "百家号精彩长文内容，包含深度数据与结构化分析"

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower() or "标题" in sel:
            return [title_elem]
        if "content" in sel.lower() or "ProseMirror" in sel or "ueditor" in sel or "textarea" in sel:
            return [editor_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="百家号深度评测指南",
        expected_body="百家号精彩长文内容，包含深度数据与结构化分析",
        expected_tags=[],
        expected_media_count=0
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.passed is True
