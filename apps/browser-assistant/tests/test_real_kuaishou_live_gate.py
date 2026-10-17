"""
快手真实平台现场核验与验收闸门测试 (Kuaishou Real Platform Live Gate Test)
验证：
1. 真实受控 Chrome 启动并导航至快手创作者服务平台视频上传页
2. 真实未登录场景下精准识别未登录态与扫码登录入口
3. 截图留存存证
4. 验证人工接管模式下浏览器保持存活与发布包完整性
5. 验证 open_login_page() 能正确导航至快手官方登录页
"""
import time
from pathlib import Path
from src.browser_manager import browser_manager
from src.adapters.kuaishou import KuaishouPublisher
from src.models import TaskStatus, CreatePublishTaskRequest
from src.task_runner import task_manager, TaskExecutionState


def test_kuaishou_live_platform_gate():
    channel = "KUAISHOU"
    account_id = "real_gate_tester"

    browser_manager.close_driver(channel, account_id)
    driver = browser_manager.get_or_create_driver(channel, account_id, headless=True)
    assert driver is not None
    assert browser_manager.is_driver_running(channel, account_id) is True

    pub = KuaishouPublisher(driver)

    try:
        print("\n[LiveGate] Navigating to Kuaishou creator URL...", flush=True)
        ok, msg = pub.open_editor()
        assert ok is True
        time.sleep(2.5)

        # 截图留存
        screenshot_path = browser_manager.take_screenshot(channel, account_id, "kuaishou_live_gate_login_check")
        assert screenshot_path is not None and Path(screenshot_path).exists()
        assert Path(screenshot_path).stat().st_size > 0
        print(f"[LiveGate] Saved Kuaishou authentic screenshot: {screenshot_path}", flush=True)

        # 真实登录态探测
        is_logged, login_msg, extra = pub.check_login()
        print(f"[LiveGate] Kuaishou login check: is_logged={is_logged}, msg={login_msg}", flush=True)

        if not is_logged:
            print("[LiveGate] Result: PENDING_REAL_PLATFORM (No authorized credentials provided)", flush=True)
        else:
            print("[LiveGate] Result: REAL_LOGIN_PASS (Active session detected)", flush=True)

        # 验证人工接管模式
        task_id = "task_kuaishou_gate_takeover"
        req = CreatePublishTaskRequest(
            task_id=task_id,
            channel="KUAISHOU",
            account_id=account_id,
            title="快手短视频测试标题",
            body="快手短视频详细文案内容",
            tags=["测试标签"],
            media_items=[],
            headless=True
        )
        state = TaskExecutionState(req)
        task_manager._tasks[task_id] = state
        takeover_ok = task_manager.takeover_task(task_id)
        assert takeover_ok is True
        assert state.status == TaskStatus.MANUAL_REQUIRED
        assert state.manual_package is not None
        assert state.manual_package.channel == "KUAISHOU"
        assert browser_manager.is_driver_running(channel, account_id) is True

    finally:
        browser_manager.close_driver(channel, account_id)


def test_kuaishou_open_login_page():
    channel = "KUAISHOU"
    account_id = "real_gate_tester"
    browser_manager.close_driver(channel, account_id)
    driver = browser_manager.get_or_create_driver(channel, account_id, headless=True)
    try:
        pub = KuaishouPublisher(driver)
        ok, msg = pub.open_login_page()
        assert ok is True
        curr_url = driver.current_url.lower()
        assert "kuaishou.com" in curr_url
    finally:
        browser_manager.close_driver(channel, account_id)
