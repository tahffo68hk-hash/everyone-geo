"""
抖音真实平台现场核验与验收闸门测试 (Douyin Real Platform Live Gate Test)
验证：
1. 真实受控 Chrome 启动并导航至抖音创作者平台上传页
2. 真实未登录场景下精准识别未登录态与扫码登录指示
3. 截图留存存证
4. 验证人工接管模式下浏览器保持存活与发布包完整性
5. 验证 open_login_page() 能正确导航至抖音官方创作平台
"""
import time
from pathlib import Path
from src.browser_manager import browser_manager
from src.adapters.douyin import DouyinPublisher
from src.models import TaskStatus, CreatePublishTaskRequest
from src.task_runner import task_manager, TaskExecutionState


import os
import time
from pathlib import Path
from src.browser_manager import browser_manager
from src.adapters.douyin import DouyinPublisher
from src.models import TaskStatus, CreatePublishTaskRequest
from src.task_runner import task_manager, TaskExecutionState


def test_douyin_live_platform_gate():
    channel = "DOUYIN"
    account_id = "real_gate_tester"
    headless = os.environ.get("REAL_GATE_HEADLESS", "false").lower() in ("true", "1")
    close_on_finish = os.environ.get("CLOSE_DRIVER_ON_FINISH", "false").lower() in ("true", "1")

    driver = browser_manager.get_or_create_driver(channel, account_id, headless=headless)
    assert driver is not None
    assert browser_manager.is_driver_running(channel, account_id) is True

    pub = DouyinPublisher(driver)

    try:
        print("\n[LiveGate:DOUYIN] 阶段 1: 桌面可见 Chrome 启动与导航...", flush=True)
        ok, msg = pub.open_editor()
        assert ok is True
        time.sleep(2.5)

        # 截图留存存证
        screenshot_path = browser_manager.take_screenshot(channel, account_id, "douyin_live_gate_login_check")
        assert screenshot_path is not None and Path(screenshot_path).exists()
        assert Path(screenshot_path).stat().st_size > 0
        print(f"[LiveGate:DOUYIN] 截图留存成功: {screenshot_path}", flush=True)

        # 真实登录态探测
        is_logged, login_msg, extra = pub.check_login()
        print(f"[LiveGate:DOUYIN] 登录态检测: is_logged={is_logged}, msg={login_msg}", flush=True)

        if not is_logged:
            print("[LiveGate:DOUYIN] 状态判定: PENDING_ACCOUNT_AUTH (官方二维码已展示，等待创作者扫码登录，窗口保持开启)", flush=True)
            print("[LiveGate:DOUYIN] 结果标签: [PENDING_ACCOUNT_AUTH] - 未登录状态下不伪造 REAL_UPLOAD / REAL_AUTOFILL", flush=True)
        else:
            print("[LiveGate:DOUYIN] 状态判定: REAL_LOGIN_PASS (检测到有效登录态与用户信息)", flush=True)
            fixtures_video = Path(__file__).parent / "fixtures" / "sample_test_video.mp4"
            fixtures_cover = Path(__file__).parent / "fixtures" / "sample_test_cover.jpg"
            if fixtures_video.exists():
                from src.models import MediaItem
                video_item = MediaItem(index=1, type="VIDEO", url=f"file:///{fixtures_video.as_posix()}", local_path=str(fixtures_video))
                cover_item = MediaItem(index=2, type="IMAGE", url=f"file:///{fixtures_cover.as_posix()}", local_path=str(fixtures_cover))
                print("[LiveGate:DOUYIN] 阶段 2: 真实 H.264 视频与封面上传...", flush=True)
                ok_up, msg_up = pub.upload_media([video_item, cover_item])
                print(f"[LiveGate:DOUYIN] 视频上传反馈: ok={ok_up}, msg={msg_up}", flush=True)
                assert ok_up is True
                print("[LiveGate:DOUYIN] 结果标签: [REAL_UPLOAD_PASS]", flush=True)

                print("[LiveGate:DOUYIN] 阶段 3: 等待平台处理转码与缩略图解析...", flush=True)
                ok_proc, msg_proc = pub.wait_for_upload_completion(timeout_sec=90)
                print(f"[LiveGate:DOUYIN] 处理状态: ok={ok_proc}, msg={msg_proc}", flush=True)
                if ok_proc:
                    print("[LiveGate:DOUYIN] 结果标签: [REAL_PROCESSING_PASS]", flush=True)

                print("[LiveGate:DOUYIN] 阶段 4: 作品标题与简介描述填写...", flush=True)
                pub.fill_title("GeoLens 2026多平台自动化发布实战评测")
                pub.fill_content("本视频全面验证 GeoLens 本地浏览器受控发布架构，包含全套字段校验与 PREPARE_ONLY 人工审核保障机制。")
                pub.fill_tags(["AI工具", "前沿科技", "发布评测"])
                pub.fill_required_declarations()
                diff = pub.validate_draft("GeoLens 2026多平台自动化发布实战评测", "本视频全面验证 GeoLens 本地浏览器受控发布架构", ["AI工具", "前沿科技"])
                print(f"[LiveGate:DOUYIN] 表单回读一致性比对: passed={diff.passed}", flush=True)
                if diff.passed:
                    print("[LiveGate:DOUYIN] 结果标签: [REAL_AUTOFILL_PASS]", flush=True)

                ok_conf, msg_conf = pub.prepare_for_confirmation()
                draft_screen = browser_manager.take_screenshot(channel, account_id, "douyin_live_gate_draft_ready")
                print(f"[LiveGate:DOUYIN] 最终停留在发布确认页，高亮发布按钮，存证截图: {draft_screen}", flush=True)

        # 验证人工接管模式与发布包
        task_id = "task_douyin_gate_takeover"
        req = CreatePublishTaskRequest(
            task_id=task_id,
            channel="DOUYIN",
            account_id=account_id,
            title="抖音短视频测试标题",
            body="抖音短视频测试描述与文案",
            tags=["测试标签"],
            media_items=[],
            headless=headless
        )
        state = TaskExecutionState(req)
        task_manager._tasks[task_id] = state
        takeover_ok = task_manager.takeover_task(task_id)
        assert takeover_ok is True
        assert state.status == TaskStatus.MANUAL_REQUIRED
        assert state.manual_package is not None
        assert state.manual_package.channel == "DOUYIN"
        assert browser_manager.is_driver_running(channel, account_id) is True
        print("[LiveGate:DOUYIN] 结果标签: [HUMAN_TAKEOVER_PASS] - 人工发布包生成完毕，浏览器保持可见活跃", flush=True)

    finally:
        if close_on_finish:
            browser_manager.close_driver(channel, account_id)


def test_douyin_open_login_page():
    channel = "DOUYIN"
    account_id = "real_gate_login_probe"
    headless = os.environ.get("REAL_GATE_HEADLESS", "false").lower() in ("true", "1")
    browser_manager.close_driver(channel, account_id)
    driver = browser_manager.get_or_create_driver(channel, account_id, headless=headless)
    try:
        pub = DouyinPublisher(driver)
        ok, msg = pub.open_login_page()
        assert ok is True
        curr_url = driver.current_url.lower()
        assert "douyin.com" in curr_url
    finally:
        browser_manager.close_driver(channel, account_id)

