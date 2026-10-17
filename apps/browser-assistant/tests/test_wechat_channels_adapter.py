"""
微信视频号平台适配器 (WechatChannelsPublisher) 规范与单元测试
验证：
1. 渠道元数据、官方创作 URL 与 is_video_channel 判定
2. 20 字短标题截断与校验
3. 导览与遮罩浮层清理
4. 本地视频文件上传与文件存在性检查
5. 视频描述正文与 #话题 录入
6. PREPARE_ONLY：停留在【发表】按钮阶段（绝不自动提交）
7. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.wechat_channels import WechatChannelsPublisher
from src.models import MediaItem


def test_wechat_channels_publisher_metadata():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)
    assert pub.get_channel_name() == "WECHAT_CHANNELS"
    assert "channels.weixin.qq.com" in pub.get_creator_url()
    assert pub.is_video_channel() is True

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("短标题" in item or "标题" in item for item in checklist)
    assert any("视频" in item for item in checklist)
    assert any("发表" in item for item in checklist)


def test_wechat_channels_title_20_char_limit():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower() or "短标题" in sel:
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    long_title = "【深度评测】微信视频号2026年全流程自动化发布系统落地实践超长标题测试"
    assert len(long_title) > 20

    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "20 字" in msg or "截断" in msg


def test_wechat_channels_dismiss_popovers():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_wechat_channels_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    # 1. 空列表失败
    ok, msg = pub.upload_media([])
    assert ok is False
    assert "未提供" in msg

    # 2. 文件不存在失败
    fake_item = MediaItem(index=1, type="VIDEO", url="file:///fake.mp4", local_path="D:/fake/not_exist.mp4")
    ok, msg = pub.upload_media([fake_item])
    assert ok is False
    assert "不存在" in msg

    # 3. 真实视频文件
    real_video = tmp_path / "test_channels.mp4"
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
    assert "已成功载入" in msg
    file_input.send_keys.assert_called_once_with(str(real_video.resolve()))


def test_wechat_channels_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    publish_btn = MagicMock()
    publish_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish_btn" in str(sel) or "发表" in sel or "primary" in sel:
            return [publish_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发表" in msg or "确认" in msg
    publish_btn.click.assert_not_called()


def test_wechat_channels_validate_draft():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "视频号短标题评测"
    title_elem.text = "视频号短标题评测"

    desc_elem = MagicMock()
    desc_elem.get_attribute.return_value = "这是视频号详尽的描述内容 #AI科技 #实战指南"
    desc_elem.text = "这是视频号详尽的描述内容 #AI科技 #实战指南"

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "短标题" in sel:
            return [title_elem]
        if "desc" in sel.lower() or "editor" in sel.lower() or "textarea" in sel.lower():
            return [desc_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="视频号短标题评测",
        expected_body="这是视频号详尽的描述内容",
        expected_tags=["AI科技", "实战指南"],
        expected_media_count=1
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.tags_match is True
    assert diff.passed is True


def test_wechat_channels_wait_for_upload_completion():
    driver = MagicMock()
    pub = WechatChannelsPublisher(driver)

    # 1. 模拟平台上传报错
    err_elem = MagicMock()
    err_elem.is_displayed.return_value = True
    err_elem.text = "文件格式不符，请上传合法的 MP4/MOV 格式"

    def mock_elements_error(by, sel):
        if "上传失败" in str(sel) or "文件格式不符" in str(sel):
            return [err_elem]
        return []

    driver.find_elements.side_effect = mock_elements_error
    ok, msg = pub.wait_for_upload_completion(timeout_sec=2)
    assert ok is False
    assert "格式不符" in msg or "失败" in msg

    # 2. 模拟转码完成与视频信息就绪
    desc_elem = MagicMock()
    desc_elem.is_displayed.return_value = True

    duration_elem = MagicMock()
    duration_elem.is_displayed.return_value = True
    duration_elem.text = "01:15"

    thumb_elem = MagicMock()
    thumb_elem.is_displayed.return_value = True
    thumb_elem.get_attribute.return_value = "https://channels.weixin.qq.com/preview/cover.jpg"

    def mock_elements_success(by, sel):
        sel_str = str(sel)
        if "description" in sel_str or "editor" in sel_str:
            return [desc_elem]
        if "duration" in sel_str or "time" in sel_str:
            return [duration_elem]
        if "cover" in sel_str or "img" in sel_str or "video" in sel_str:
            return [thumb_elem]
        return []

    driver.find_elements.side_effect = mock_elements_success
    ok, msg = pub.wait_for_upload_completion(timeout_sec=5)
    assert ok is True
    assert "已完成" in msg
    assert "01:15" in msg or "缩略图" in msg

