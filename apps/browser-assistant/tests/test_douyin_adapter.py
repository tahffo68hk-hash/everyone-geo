"""
抖音短视频平台适配器 (DouyinPublisher) 规范与单元测试
验证：
1. 渠道元数据、官方创作 URL 与 is_video_channel 判定
2. 30 字标题上限安全截断与校验
3. 创作者引导浮层清理
4. 本地视频文件上传与文件存在性检查
5. 简介与 #话题 录入
6. PREPARE_ONLY：停留在发布确认阶段（绝不自动提交）
7. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.douyin import DouyinPublisher
from src.models import MediaItem


def test_douyin_publisher_metadata():
    driver = MagicMock()
    pub = DouyinPublisher(driver)
    assert pub.get_channel_name() == "DOUYIN"
    assert "creator.douyin.com" in pub.get_creator_url()
    assert pub.is_video_channel() is True

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("30 字" in item or "标题" in item for item in checklist)
    assert any("视频" in item for item in checklist)
    assert any("封面" in item for item in checklist)


def test_douyin_title_30_char_limit():
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower() or "作品标题" in sel:
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    long_title = "【实测对比】2026年最新AI全流程自动化发布系统深度体验与最佳实践指南"
    assert len(long_title) > 30

    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "30 字" in msg or "截断" in msg


def test_douyin_dismiss_popovers():
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_douyin_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    # 1. 空列表失败
    ok, msg = pub.upload_media([])
    assert ok is False
    assert "未提供" in msg

    # 2. 文件不存在失败
    fake_item = MediaItem(index=1, type="VIDEO", url="file:///fake.mp4", local_path="D:/fake/not_exist.mp4")
    ok, msg = pub.upload_media([fake_item])
    assert ok is False
    assert "不存在" in msg

    # 3. 真实合法视频文件
    real_video = tmp_path / "test_douyin.mp4"
    real_video.write_bytes(b"\x00\x00\x00 ftypisom" + b"\x01" * 1024)

    file_input = MagicMock()
    file_input.get_attribute.return_value = "video/mp4"

    def mock_find_elements(by, sel):
        if "file" in sel.lower() or "upload" in sel.lower():
            return [file_input]
        return []

    driver.find_elements.side_effect = mock_find_elements

    real_item = MediaItem(index=1, type="VIDEO", url=f"file:///{real_video.as_posix()}", local_path=str(real_video))
    ok, msg = pub.upload_media([real_item])
    assert ok is True
    assert "已成功载入" in msg
    file_input.send_keys.assert_called_once_with(str(real_video.resolve()))


def test_douyin_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    publish_btn = MagicMock()
    publish_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish_btn" in str(sel) or "button--" in sel or "发布" in sel:
            return [publish_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发布" in msg or "确认" in msg
    publish_btn.click.assert_not_called()


def test_douyin_validate_draft():
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "抖音短视频实战评测"
    title_elem.text = "抖音短视频实战评测"

    desc_elem = MagicMock()
    desc_elem.get_attribute.return_value = "这是抖音视频的精彩文案 #AI工具 #短视频运营"
    desc_elem.text = "这是抖音视频的精彩文案 #AI工具 #短视频运营"

    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_elem]
        if "desc" in sel.lower() or "textarea" in sel.lower():
            return [desc_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="抖音短视频实战评测",
        expected_body="这是抖音视频的精彩文案",
        expected_tags=["AI工具", "短视频运营"],
        expected_media_count=1
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.tags_match is True
    assert diff.passed is True


def test_douyin_wait_for_upload_completion():
    driver = MagicMock()
    pub = DouyinPublisher(driver)

    # 1. 模拟平台上传报错
    err_elem = MagicMock()
    err_elem.is_displayed.return_value = True
    err_elem.text = "视频转码失败，请检查视频清晰度与码率"

    def mock_elements_error(by, sel):
        if "上传失败" in str(sel) or "视频转码失败" in str(sel):
            return [err_elem]
        return []

    driver.find_elements.side_effect = mock_elements_error
    ok, msg = pub.wait_for_upload_completion(timeout_sec=2)
    assert ok is False
    assert "转码失败" in msg or "失败" in msg

    # 2. 模拟转码完成与播放器就绪
    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    duration_elem = MagicMock()
    duration_elem.is_displayed.return_value = True
    duration_elem.text = "00:30"

    thumb_elem = MagicMock()
    thumb_elem.is_displayed.return_value = True
    thumb_elem.get_attribute.return_value = "https://p3.douyinpic.com/tos-cn-i-cover.jpeg"

    def mock_elements_success(by, sel):
        sel_str = str(sel)
        if "title" in sel_str:
            return [title_elem]
        if "duration" in sel_str or "time" in sel_str:
            return [duration_elem]
        if "player" in sel_str or "cover" in sel_str:
            return [thumb_elem]
        return []

    driver.find_elements.side_effect = mock_elements_success
    ok, msg = pub.wait_for_upload_completion(timeout_sec=5)
    assert ok is True
    assert "已完成" in msg
    assert "00:30" in msg or "缩略图" in msg

