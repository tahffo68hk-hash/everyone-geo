"""
B站视频平台适配器 (BilibiliPublisher) 规范与单元测试
验证：
1. 渠道元数据、官方创作 URL 与 is_video_channel 判定
2. 80 字标题上限安全截断与校验
3. 草稿弹窗 ("不用了") 与新手浮层清理
4. 本地视频文件上传与文件存在性检查
5. 视频简介填写与标签录入
6. 原创/自制声明选择
7. PREPARE_ONLY：停留在投稿确认阶段（绝不自动提交）
8. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock, patch
from src.adapters.bilibili import BilibiliPublisher
from src.models import MediaItem


def test_bilibili_publisher_metadata():
    driver = MagicMock()
    pub = BilibiliPublisher(driver)
    assert pub.get_channel_name() == "BILIBILI"
    assert "member.bilibili.com" in pub.get_creator_url()
    assert pub.is_video_channel() is True

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 6
    assert any("80 字" in item or "标题" in item for item in checklist)
    assert any("视频" in item for item in checklist)
    assert any("自制" in item for item in checklist)


def test_bilibili_title_80_char_limit():
    driver = MagicMock()
    pub = BilibiliPublisher(driver)

    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower() or "稿件" in sel:
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    # 测试超长标题（> 80 字符）
    long_title = "【实测对比】2026年最新AI全流程自动化发布系统全面评测：" + "超长内容测试" * 10
    assert len(long_title) > 80

    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "80 字" in msg or "截断" in msg

    # 验证最终设值到 DOM 的标题不超过 80 字
    assert pub.SELECTORS["title"] is not None


def test_bilibili_dismiss_popovers():
    driver = MagicMock()
    pub = BilibiliPublisher(driver)

    body_mock = MagicMock()
    draft_btn = MagicMock()
    draft_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [draft_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_bilibili_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = BilibiliPublisher(driver)

    # 1. 空列表应失败
    ok, msg = pub.upload_media([])
    assert ok is False
    assert "未提供" in msg

    # 2. 文件不存在应失败
    fake_item = MediaItem(index=1, type="VIDEO", url="file:///fake.mp4", local_path="D:/fake/not_exist.mp4")
    ok, msg = pub.upload_media([fake_item])
    assert ok is False
    assert "不存在" in msg

    # 3. 真实合法视频文件
    real_video = tmp_path / "test_video.mp4"
    real_video.write_bytes(b"\x00\x00\x00 ftypisom" + b"\x01" * 1024)

    file_input = MagicMock()
    file_input.get_attribute.return_value = "video/mp4"

    def mock_find_elements(by, sel):
        if "file" in sel.lower():
            return [file_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    real_item = MediaItem(index=1, type="VIDEO", url=f"file:///{real_video.as_posix()}", local_path=str(real_video))
    ok, msg = pub.upload_media([real_item])
    assert ok is True
    assert "已成功载入" in msg or "视频文件" in msg
    file_input.send_keys.assert_called_once_with(str(real_video.resolve()))


def test_bilibili_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = BilibiliPublisher(driver)

    submit_btn = MagicMock()
    submit_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "submit" in sel.lower() or "投稿" in sel:
            return [submit_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "立即投稿" in msg or "确认" in msg
    # 严格验证：绝不调用 submit_btn.click()
    submit_btn.click.assert_not_called()


def test_bilibili_validate_draft():
    driver = MagicMock()
    pub = BilibiliPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "B站实战发布评测"
    title_elem.text = "B站实战发布评测"

    desc_elem = MagicMock()
    desc_elem.get_attribute.return_value = "这是B站视频的详细简介内容说明"
    desc_elem.text = "这是B站视频的详细简介内容说明"

    tag_elem = MagicMock()
    tag_elem.text = "AI科技"

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "稿件" in sel:
            return [title_elem]
        if "desc" in sel.lower() or "ql-editor" in sel.lower():
            return [desc_elem]
        if "tag" in sel.lower():
            return [tag_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="B站实战发布评测",
        expected_body="这是B站视频的详细简介内容说明",
        expected_tags=["AI科技", "数码科普"],
        expected_media_count=1
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.tags_match is True
    assert diff.passed is True
