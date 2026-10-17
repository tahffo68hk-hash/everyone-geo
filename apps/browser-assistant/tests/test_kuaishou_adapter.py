"""
快手视频发布适配器 (KuaishouPublisher) 规范与单元测试
验证：
1. 渠道元数据、官方创作 URL 与 is_video_channel 判定
2. 引导与遮罩清理
3. 本地视频文件上传与文件存在性检查
4. 描述与 #话题 录入
5. PREPARE_ONLY：停留在【发布】按钮阶段（绝不自动提交）
6. ValidationDiff DOM 反读比对
"""
from pathlib import Path
from unittest.mock import MagicMock
from src.adapters.kuaishou import KuaishouPublisher
from src.models import MediaItem


def test_kuaishou_publisher_metadata():
    driver = MagicMock()
    pub = KuaishouPublisher(driver)
    assert pub.get_channel_name() == "KUAISHOU"
    assert "cp.kuaishou.com" in pub.get_creator_url()
    assert pub.is_video_channel() is True

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("快手" in item for item in checklist)
    assert any("视频" in item for item in checklist)
    assert any("发布" in item for item in checklist)


def test_kuaishou_dismiss_popovers():
    driver = MagicMock()
    pub = KuaishouPublisher(driver)

    body_mock = MagicMock()
    guide_btn = MagicMock()
    guide_btn.is_displayed.return_value = True

    driver.find_element.return_value = body_mock
    driver.find_elements.return_value = [guide_btn]

    pub.dismiss_popovers()

    body_mock.send_keys.assert_called_once()
    driver.execute_script.assert_called()


def test_kuaishou_upload_media_validation(tmp_path: Path):
    driver = MagicMock()
    pub = KuaishouPublisher(driver)

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
    real_video = tmp_path / "test_kuaishou.mp4"
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


def test_kuaishou_prepare_for_confirmation_never_submits():
    driver = MagicMock()
    pub = KuaishouPublisher(driver)

    publish_btn = MagicMock()
    publish_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish_btn" in str(sel) or "ant-btn-primary" in sel or "发布" in sel:
            return [publish_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发布" in msg or "确认" in msg
    publish_btn.click.assert_not_called()


def test_kuaishou_validate_draft():
    driver = MagicMock()
    pub = KuaishouPublisher(driver)

    desc_elem = MagicMock()
    desc_elem.get_attribute.return_value = "快手短视频深度评测实操指南 #AI科技 #短视频"
    desc_elem.text = "快手短视频深度评测实操指南 #AI科技 #短视频"

    def mock_find_elements(by, sel):
        if "desc" in sel.lower() or "contenteditable" in sel.lower() or "textarea" in sel.lower():
            return [desc_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="快手短视频深度评测",
        expected_body="快手短视频深度评测实操指南",
        expected_tags=["AI科技", "短视频"],
        expected_media_count=1
    )

    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.tags_match is True
    assert diff.passed is True
