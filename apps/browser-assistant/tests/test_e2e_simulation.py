"""
真实受控 Chrome 浏览器端到端全流程测试 (Real Selenium E2E Automation)
针对仿真创作者平台验证完整的 9 步辅助发布流、双向比对、状态机与截图留证
"""
import os
import time
from pathlib import Path
from src.browser_manager import browser_manager
from src.adapters.simulation import LocalSimulationPublisher
from src.models import (
    CreatePublishTaskRequest, TaskStatus, StepName, MediaItem
)
from src.task_runner import task_manager

STATIC_HTML_PATH = Path(__file__).resolve().parent.parent / "src" / "static" / "simulation-editor.html"
FILE_URL = f"file:///{str(STATIC_HTML_PATH).replace(os.sep, '/')}"


def test_real_selenium_e2e_pipeline():
    """
    真实启动 Chrome (Headless 模式) 运行 9 步完整自动化
    """
    channel = "SIMULATION"
    account_id = "e2e_runner"
    
    # 确保驱动初态干净
    browser_manager.close_driver(channel, account_id)
    
    driver = browser_manager.get_or_create_driver(channel, account_id, headless=True)
    assert driver is not None
    assert browser_manager.is_driver_running(channel, account_id) is True
    
    # 实例化适配器并指定本地 file URL
    pub = LocalSimulationPublisher(driver)
    pub.get_creator_url = lambda: FILE_URL  # 重定向到本地文件 URL
    
    # 1. 打开创作页面
    ok, msg = pub.open_editor()
    assert ok is True
    assert "就绪" in msg
    
    # 2. 检查登录态
    is_logged, login_msg, extra = pub.check_login()
    assert is_logged is True
    assert "已登录" in login_msg
    
    # 3. 自动填写标题
    test_title = "【实测评测】GeoLens 本地浏览器受控辅助发布深度体验"
    ok, msg = pub.fill_title(test_title)
    assert ok is True
    
    # 4. 自动填写正文
    test_body = (
        "第一段：GeoLens 实现了基于受控 Chrome 浏览器的本地发布辅助器。\n"
        "第二段：该架构坚守安全底线，不上传密码与 Cookie，由用户自行扫码登录，并在发布前做双向校验与人工确认。"
    )
    ok, msg = pub.fill_content(test_body)
    assert ok is True
    
    # 5. 上传素材
    ok, msg = pub.upload_media([])
    assert ok is True
    
    # 6. 填写话题标签
    test_tags = ["AI生产力", "GEO优化", "内容自动化"]
    ok, msg = pub.fill_tags(test_tags)
    assert ok is True
    
    # 7. 校验填写结果与原始内容一致性 (DOM 逆向比对)
    diff = pub.validate_draft(
        expected_title=test_title,
        expected_body=test_body,
        expected_tags=test_tags
    )
    assert diff.passed is True
    assert diff.title_match is True
    assert diff.body_match is True
    assert diff.tags_match is True
    assert len(diff.discrepancies) == 0
    
    # 8. 停留在最终发布确认阶段 (绝不擅自点击提交)
    ok, msg = pub.prepare_for_confirmation()
    assert ok is True
    assert "等待人工确认" in msg
    
    # 捕获真实屏幕截图留存证据
    screenshot_file = browser_manager.take_screenshot(channel, account_id, "e2e_confirmation_ready")
    assert screenshot_file is not None
    assert os.path.exists(screenshot_file)
    print(f"\n[E2E 证据] 真实浏览器截图已成功保存至：{screenshot_file}")
    
    # 尚未点击发布，读取结果应为未发布
    is_pub, _, _ = pub.read_publish_result()
    assert is_pub is False
    
    # 9. 模拟用户在浏览器亲自完成核对并点击【确认发布】
    ok_click, _ = pub.simulate_user_publish_click()
    assert ok_click is True
    
    # 读取最终发布落地结果
    is_pub_final, pub_msg, data = pub.read_publish_result()
    assert is_pub_final is True
    assert "公开发布成功" in pub_msg
    assert data.get("canonical_url") is not None
    assert "articles/sim-" in data["canonical_url"]
    assert data.get("external_asset_id") is not None
    
    # 清理并关闭驱动
    print("[E2E] Closing driver...", flush=True)
    browser_manager.close_driver(channel, account_id)
    assert browser_manager.is_driver_running(channel, account_id) is False
    print("[E2E] Driver closed cleanly.", flush=True)


def test_task_manager_pause_and_takeover():
    """测试任务管理器的暂停、恢复、手动接管与发布确认状态流转"""
    print("[TaskManager] Starting state machine test...", flush=True)
    task_id = "test-task-takeover-001"
    req = CreatePublishTaskRequest(
        task_id=task_id,
        channel="SIMULATION",
        account_id="takeover_test",
        title="测试标题",
        body="测试正文内容",
        tags=["测试"],
        headless=True
    )
    
    from src.task_runner import TaskExecutionState
    state = TaskExecutionState(req)
    task_manager._tasks[task_id] = state
    
    assert state.status == TaskStatus.READY
    assert state.is_paused is False
    
    # 暂停任务
    assert task_manager.pause_task(task_id) is True
    assert state.is_paused is True
    print("[TaskManager] Pause verified.", flush=True)
    
    # 恢复任务
    assert task_manager.resume_task(task_id) is True
    assert state.is_paused is False
    print("[TaskManager] Resume verified.", flush=True)
    
    # 手动接管
    assert task_manager.takeover_task(task_id) is True
    assert state.is_manual_takeover is True
    assert state.status == TaskStatus.MANUAL_REQUIRED
    assert state.manual_package is not None
    assert state.manual_package.title == "测试标题"
    assert len(state.manual_package.checklist) > 0
    print("[TaskManager] Takeover verified.", flush=True)
    
    # 确认发布结果落地
    ok, msg = task_manager.confirm_publish_result(
        task_id=task_id,
        canonical_url="http://127.0.0.1:8765/articles/sim-123456",
        external_asset_id="sim-123456",
        verification_note="端到端仿真测试核验通过",
        target_status="PUBLISHED"
    )
    assert ok is True
    assert state.status == TaskStatus.PUBLISHED
    assert state.published_url == "http://127.0.0.1:8765/articles/sim-123456"
    assert state.external_asset_id == "sim-123456"
    print("[TaskManager] Publish confirmation verified.", flush=True)
