"""
小红书图文平台适配器 (XiaohongshuPublisher) 逻辑规范与单元测试
验证：
1. 渠道元数据与创作者官方 URL
2. 20 字标题上限强截断保护
3. 创作者新手引导浮层 (popovers) 自动清理
4. 顺序多图上传与预览卡片校验
5. DOM 逆向比对 (ValidationDiff)
6. PREPARE_ONLY 停留在最终发布确认阶段 (绝不越权提交)
7. 可信结果检测与防误判
"""
from unittest.mock import MagicMock, call
from src.adapters.xiaohongshu import XiaohongshuPublisher
from src.models import MediaItem


def test_xiaohongshu_publisher_metadata():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)
    assert pub.get_channel_name() == "XIAOHONGSHU"
    assert pub.get_creator_url() == "https://creator.xiaohongshu.com/publish/publish?source=official"

    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 5
    assert any("20 字" in item or "标题" in item for item in checklist)
    assert any("配图" in item or "图" in item for item in checklist)
    assert any("原创" in item for item in checklist)


def test_xiaohongshu_title_20_char_limit():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)

    title_elem = MagicMock()
    title_elem.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "input" in sel.lower():
            return [title_elem]
        return []

    driver.find_elements.side_effect = mock_find_elements

    # 测试超长标题（35 字符）
    long_title = "【实测体验】超深度落地AI项目自动化发布评测与最佳实操指南全流程"
    assert len(long_title) > 20

    ok, msg = pub.fill_title(long_title)
    assert ok is True
    assert "截断至 20 字" in msg or "20 字" in msg

    # 验证输入到 DOM 的最终标题长度严格不超过 20 字且与前 20 字符一致
    last_sent = title_elem.send_keys.call_args[0][0]
    assert len(last_sent) <= 20
    assert last_sent == long_title[:20]


def test_xiaohongshu_popover_dismissal():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)

    body_mock = MagicMock()
    driver.find_element.return_value = body_mock

    pub.dismiss_popovers()

    # 验证向 body 派发了 Escape 键
    body_mock.send_keys.assert_called_once()
    # 验证执行了清理 popover 的 JS 脚本
    driver.execute_script.assert_called_once()
    assert "d-popover" in driver.execute_script.call_args[0][0]


def test_xiaohongshu_validate_draft_logic():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)

    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "AI全流程自动化发布指南"

    body_elem = MagicMock()
    body_elem.text = "小红书图文笔记正文：包含 3 个核心技巧，建议收藏！#AI工具 #生产力"

    preview_img1 = MagicMock()
    preview_img1.is_displayed.return_value = True
    preview_img2 = MagicMock()
    preview_img2.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "title" in sel.lower() or "post-title" in sel.lower():
            return [title_elem]
        if "content" in sel.lower() or "post-textarea" in sel.lower() or "contenteditable" in sel.lower():
            return [body_elem]
        if "preview" in sel.lower() or "image" in sel.lower():
            return [preview_img1, preview_img2]
        return []

    driver.find_elements.side_effect = mock_find_elements

    diff = pub.validate_draft(
        expected_title="AI全流程自动化发布指南",
        expected_body="小红书图文笔记正文：包含 3 个核心技巧，建议收藏！",
        expected_tags=["AI工具", "生产力"],
        expected_media_count=2
    )

    assert diff.passed is True
    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.media_count_actual == 2
    assert len(diff.discrepancies) == 0


def test_xiaohongshu_prepare_for_confirmation_gate():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)

    pub_btn = MagicMock()
    pub_btn.is_displayed.return_value = True

    def mock_find_elements(by, sel):
        if "publish" in sel.lower() or "button" in sel.lower():
            return [pub_btn]
        return []

    driver.find_elements.side_effect = mock_find_elements

    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "发布确认" in msg

    # 验证红色高亮边框脚本执行
    scripts_called = [c[0][0] for c in driver.execute_script.call_args_list if c[0]]
    assert any("#ff2442" in s for s in scripts_called)

    # 核心安全准则：绝不越权调用 click() 点击发布
    pub_btn.click.assert_not_called()


def test_xiaohongshu_read_publish_result():
    driver = MagicMock()
    pub = XiaohongshuPublisher(driver)

    # 1. 处于编辑态，未跳转
    driver.current_url = "https://creator.xiaohongshu.com/publish/publish?source=official"
    driver.page_source = "<div>创作者服务平台 - 发布图文笔记</div>"
    driver.find_elements.return_value = []
    is_pub, msg, data = pub.read_publish_result()
    assert is_pub is False

    # 2. 成功跳转到已发布笔记详情
    driver.current_url = "https://www.xiaohongshu.com/explore/67890abcdef12345"
    is_pub, msg, data = pub.read_publish_result()
    assert is_pub is True
    assert data.get("external_asset_id") == "67890abcdef12345"
