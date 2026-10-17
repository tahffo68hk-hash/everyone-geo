"""
今日头条文章适配器 (ToutiaoPublisher) 单元测试
验证：
1. 渠道元数据与官方 URL
2. 引导遮罩与弹窗清理
3. 标题限制（30字以内）与超长截断处理
4. 正文富文本与配图上传
5. PREPARE_ONLY：停留在【发布】按钮处，绝不越权自动提交
6. ValidationDiff 反读校验
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.toutiao import ToutiaoPublisher
from src.models import MediaItem


def test_toutiao_metadata():
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)
    assert pub.get_channel_name() == "TOUTIAO"
    assert "toutiao.com" in pub.get_creator_url()
    assert pub.is_video_channel() is False

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("头条" in item for item in checklist)
    assert any("发布" in item for item in checklist)


def test_toutiao_dismiss_popovers():
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()
    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_toutiao_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)

    # 1. 空列表应为 True (纯文字发布)
    ok, msg = pub.upload_media([])
    assert ok is True

    # 2. 真实图片素材
    real_img = tmp_path / "test_toutiao_img.jpg"
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


def test_toutiao_fill_title_truncation():
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)

    title_input = MagicMock()
    title_input.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    # 超过 30 字截断
    long_title = "这是一条非常非常长的今日头条文章标题测试用例超过了三十个汉字的长度限制"
    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "头条文章标题已填入" in msg
    assert "截断" in msg


def test_toutiao_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)

    publish_btn = MagicMock()
    publish_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish" in str(sel).lower() or "发布" in str(sel):
            return [publish_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发布" in msg or "确认" in msg
    publish_btn.click.assert_not_called()


def test_toutiao_validate_draft():
    driver = MagicMock()
    pub = ToutiaoPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "头条短标题测试"
    title_elem.text = "头条短标题测试"

    body_elem = MagicMock()
    body_elem.get_attribute.return_value = "今日头条深度分析文章的正文内容，完整呈现实验结果。"
    body_elem.text = "今日头条深度分析文章的正文内容，完整呈现实验结果。"

    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_elem]
        elif "editor" in sel.lower() or "prosemirror" in sel.lower():
            return [body_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="头条短标题测试",
        expected_body="今日头条深度分析文章的正文内容，完整呈现实验结果。",
        expected_tags=["科技"],
        expected_media_count=0
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.passed is True
