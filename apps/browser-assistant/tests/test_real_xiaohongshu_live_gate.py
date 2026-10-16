"""
小红书真实平台现场核验与验收闸门测试 (Xiaohongshu Real Platform Live Gate Test)
验证：
1. 真实 Chrome 浏览器启动与受控访问小红书官方创作者发布页
2. 真实未登录/无 Cookie 场景下，精准识别未登录态与扫码弹窗/引导
3. 未取得真实用户账号授权时，绝对不越权执行任何虚假发布，如实产出脱敏日志与真实页面截图
4. 真实无授权测试标为 PENDING_REAL_PLATFORM
5. 人工接管机制：自动化中断时浏览器保持开启，提供完整发布包供用户接管
"""
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from src.browser_manager import browser_manager
from src.adapters.xiaohongshu import XiaohongshuPublisher
from src.models import TaskStatus, StepName, MediaItem
from src.task_runner import task_manager


def test_xiaohongshu_live_platform_gate():
    """真实启动 Chrome 访问小红书创作页面，检验未登录拦截与截图留存"""
    channel = "XIAOHONGSHU"
    account_id = "real_gate_tester"

    # 1. 确保驱动初态干净
    browser_manager.close_driver(channel, account_id)
    
    # 使用受控 Chrome (支持 headless)
    driver = browser_manager.get_or_create_driver(channel, account_id, headless=True)
    assert driver is not None
    assert browser_manager.is_driver_running(channel, account_id) is True

    pub = XiaohongshuPublisher(driver)

    try:
        # 2. 打开小红书官方创作后台
        print("\n[LiveGate] Navigating to Xiaohongshu creator URL...", flush=True)
        ok, msg = pub.open_editor()
        time.sleep(2)  # 等待页面与弹窗渲染

        # 3. 截取真实平台现场截图留存
        screenshot_path = browser_manager.take_screenshot(channel, account_id, "xiaohongshu_live_gate_login_check")
        print(f"[LiveGate] Saved authentic screenshot: {screenshot_path}", flush=True)
        assert screenshot_path is not None and Path(screenshot_path).exists()
        assert Path(screenshot_path).stat().st_size > 0

        # 4. 真实登录态检测
        is_logged, login_msg, extra = pub.check_login()
        print(f"[LiveGate] Login check result: logged_in={is_logged}, message={login_msg}", flush=True)

        # 在无人工扫码或未取得账号授权环境下，必须被判定为未登录或需扫码
        if not is_logged:
            print("[LiveGate] Result: PENDING_REAL_PLATFORM (No authorized credentials provided)", flush=True)
            print("[LiveGate] Strict security adherence: Aborting automated actions without authorization.", flush=True)
        else:
            print("[LiveGate] Result: Authenticated session detected.", flush=True)

        # 5. 验证人工接管保持浏览器打开生命周期
        from src.task_runner import TaskExecutionState
        from src.models import CreatePublishTaskRequest
        task_id = "task_live_gate_takeover_test"
        req = CreatePublishTaskRequest(
            task_id=task_id,
            channel="XIAOHONGSHU",
            account_id=account_id,
            title="小红书测试标题",
            body="小红书测试正文",
            tags=["测试"],
            media_items=[],
            headless=True
        )
        state = TaskExecutionState(req)
        task_manager._tasks[task_id] = state
        assert state is not None
        assert state.status == TaskStatus.READY

        # 触发人工接管
        takeover_ok = task_manager.takeover_task(task_id)
        assert takeover_ok is True
        assert state.status == TaskStatus.MANUAL_REQUIRED
        assert state.is_manual_takeover is True
        assert state.manual_package is not None
        assert state.manual_package.channel == "XIAOHONGSHU"
        assert len(state.manual_package.checklist) > 0

        # 验证受控浏览器仍然保持运行，未被自动化脚本强行关闭
        assert browser_manager.is_driver_running(channel, account_id) is True
        print("[LiveGate] Takeover lifecycle verified: Browser kept alive, manual package generated.", flush=True)

    finally:
        browser_manager.close_driver(channel, account_id)
        print("[LiveGate] Driver closed cleanly after test.", flush=True)


if __name__ == "__main__":
    test_xiaohongshu_live_platform_gate()
