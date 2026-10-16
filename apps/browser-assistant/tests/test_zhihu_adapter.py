"""
知乎平台适配器逻辑与选择器规范单元测试
"""
from unittest.mock import MagicMock
from src.adapters.zhihu import ZhihuPublisher
from src.models import MediaItem


def test_zhihu_publisher_metadata():
    driver = MagicMock()
    pub = ZhihuPublisher(driver)
    assert pub.get_channel_name() == "ZHIHU"
    assert pub.get_creator_url() == "https://zhuanlan.zhihu.com/write"
    
    checklist = pub.get_manual_checklist()
    assert len(checklist) >= 4
    assert any("创作者账号" in item for item in checklist)


def test_zhihu_validate_draft_logic():
    driver = MagicMock()
    pub = ZhihuPublisher(driver)
    
    # Mock find_elements 返回的标题与正文
    title_elem = MagicMock()
    title_elem.get_attribute.return_value = "AI 项目助手最佳实践"
    
    body_elem = MagicMock()
    body_elem.text = "这是一篇关于 AI 项目助手在团队研发中的深度落地评测与实操指南。"
    
    def mock_find_elements(by, sel):
        if "title" in sel.lower():
            return [title_elem]
        if "drafteditor" in sel.lower() or "contenteditable" in sel.lower():
            return [body_elem]
        return []
        
    driver.find_elements.side_effect = mock_find_elements
    
    diff = pub.validate_draft(
        expected_title="AI 项目助手最佳实践",
        expected_body="这是一篇关于 AI 项目助手在团队研发中的深度落地评测与实操指南。",
        expected_tags=["人工智能", "开发工具"]
    )
    
    assert diff.passed is True
    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.discrepancies == []
