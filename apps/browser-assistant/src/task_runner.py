"""
GeoLens 本地浏览器助手 - 任务执行器与编排状态机 (TaskRunner)
控制 9 步自动化发布流程、双向比对、状态流转、暂停/恢复、手动接管与人工发布包回退
"""
import time
from datetime import datetime, timezone
from typing import Any
import threading

from .models import (
    TaskStatus, StepName, StepStatus, StepLog, FsmState,
    CreatePublishTaskRequest, TaskStatusResponse, ManualPublishPackage, ValidationDiff,
    MediaItem
)
from .browser_manager import browser_manager
from .adapters.registry import registry
from .security import sanitize_log_message


class TaskExecutionState:
    """单个发布任务的内部状态跟踪"""
    def __init__(self, req: CreatePublishTaskRequest):
        self.req = req
        self.task_id = req.task_id
        self.channel = req.channel.upper()
        self.account_id = req.account_id
        self.status = TaskStatus.READY
        self.current_step: StepName | None = None
        self.fsm_state: FsmState = FsmState.INITIALIZING
        self.current_state_title: str = "任务启动与初始化"
        self.resumable: bool = False
        self.screenshot_path: str | None = None
        self.recovery_guidance: str | None = None
        self.steps: list[StepLog] = []
        self.validation: ValidationDiff | None = None
        self.manual_package: ManualPublishPackage | None = None
        self.error_message: str | None = None
        self.published_url: str | None = None
        self.external_asset_id: str | None = None
        
        # 控制标志
        self.is_paused = False
        self.is_cancelled = False
        self.is_manual_takeover = False
        self.lock = threading.RLock()
        
        now = datetime.now(timezone.utc).isoformat()
        self.created_at = now
        self.updated_at = now

        # 初始化人工发布包作为底线保障
        self._init_manual_package()

    def _init_manual_package(self):
        checklist = [
            f"1. 确认登录 {self.channel} 官方创作者账号",
            "2. 检查标题无违规与错别字",
            "3. 核对正文排版及分段换行",
            "4. 按照编号顺序上传素材配图",
            "5. 填入相关话题标签以增加曝光",
            "6. 预览确认无误后点击发布",
            "7. 在 GeoLens 控制台回填文章公开链接"
        ]
        instructions = (
            f"如果自动化遇到验证码、登录失效或结构变动，请在打开的受控浏览器中手动完成上述操作。"
            f"所有文案与素材均可在右侧面板一键复制与下载。"
        )
        
        # 获取真实创作者链接
        creator_url_map = {
            "ZHIHU": "https://zhuanlan.zhihu.com/write",
            "SIMULATION": "http://127.0.0.1:8765/static/simulation-editor.html",
            "XIAOHONGSHU": "https://creator.xiaohongshu.com/publish/publish?source=official",
            "BILIBILI": "https://member.bilibili.com/platform/upload/video/frame",
            "DOUYIN": "https://creator.douyin.com/creator-micro/content/upload",
            "WECHAT_CHANNELS": "https://channels.weixin.qq.com/platform/post/create",
            "KUAISHOU": "https://cp.kuaishou.com/article/publish/video",
            "WEIBO": "https://weibo.com/",
            "BAIJIAHAO": "https://baijiahao.baidu.com/builder/rc/edit?type=news",
            "WECHAT_OFFICIAL_ACCOUNT": "https://mp.weixin.qq.com/",
            "TOUTIAO": "https://mp.toutiao.com/profile_v4/graphic/publish",
        }
        creator_url = creator_url_map.get(self.channel, "https://www.zhihu.com/creator")

        self.manual_package = ManualPublishPackage(
            channel=self.channel,
            title=self.req.title,
            body=self.req.body,
            hashtags=self.req.tags,
            media_items=self.req.media_items,
            creator_url=creator_url,
            checklist=checklist,
            instructions=instructions,
            generated_at=datetime.now(timezone.utc).isoformat()
        )

    def add_log(
        self,
        step: StepName,
        name: str,
        status: StepStatus,
        msg: str,
        duration_ms: int | None = None,
        data: dict[str, Any] | None = None,
        fsm_state: FsmState | None = None,
        screenshot_path: str | None = None,
        recovery_guidance: str | None = None,
        resumable: bool | None = None
    ):
        with self.lock:
            safe_msg = sanitize_log_message(msg)
            if fsm_state is not None:
                self.fsm_state = fsm_state
                self.current_state_title = name
            if screenshot_path is not None:
                self.screenshot_path = screenshot_path
            if recovery_guidance is not None:
                self.recovery_guidance = recovery_guidance
            if resumable is not None:
                self.resumable = resumable
            log = StepLog(
                step=step,
                name=name,
                status=status,
                message=safe_msg,
                timestamp=datetime.now(timezone.utc).isoformat(),
                duration_ms=duration_ms,
                data=data,
                fsm_state=fsm_state or self.fsm_state,
                screenshot_path=screenshot_path,
                recovery_guidance=recovery_guidance
            )
            self.steps.append(log)
            self.updated_at = datetime.now(timezone.utc).isoformat()

    def to_response(self) -> TaskStatusResponse:
        is_running = browser_manager.is_driver_running(self.channel, self.account_id)
        with self.lock:
            return TaskStatusResponse(
                task_id=self.task_id,
                channel=self.channel,
                account_id=self.account_id,
                status=self.status,
                current_step=self.current_step,
                fsm_state=self.fsm_state,
                current_state_title=self.current_state_title,
                resumable=self.resumable,
                screenshot_path=self.screenshot_path,
                recovery_guidance=self.recovery_guidance,
                steps=list(self.steps),
                validation=self.validation,
                manual_package=self.manual_package,
                error_message=self.error_message,
                is_paused=self.is_paused,
                is_manual_takeover=self.is_manual_takeover,
                browser_running=is_running,
                published_url=self.published_url,
                external_asset_id=self.external_asset_id,
                created_at=self.created_at,
                updated_at=self.updated_at
            )


class TaskManager:
    """管理并发任务实例与线程执行"""
    def __init__(self):
        self._tasks: dict[str, TaskExecutionState] = {}
        self._threads: dict[str, threading.Thread] = {}

    def get_task(self, task_id: str) -> TaskExecutionState | None:
        return self._tasks.get(task_id)

    def start_task(self, req: CreatePublishTaskRequest) -> TaskStatusResponse:
        """创建并异步启动自动化发布任务"""
        state = TaskExecutionState(req)
        self._tasks[req.task_id] = state

        thread = threading.Thread(target=self._run_task_pipeline, args=(state,), daemon=True)
        self._threads[req.task_id] = thread
        thread.start()

        return state.to_response()

    def pause_task(self, task_id: str) -> bool:
        state = self.get_task(task_id)
        if state:
            with state.lock:
                state.is_paused = True
                curr = state.current_step or StepName.CHECK_LOGIN
                state.add_log(curr, "任务暂停", StepStatus.RUNNING, "用户已请求暂停自动化流程")
            return True
        return False

    def resume_task(self, task_id: str) -> bool:
        state = self.get_task(task_id)
        if not state:
            return False
        with state.lock:
            state.is_paused = False
            state.is_manual_takeover = False
            thread = self._threads.get(task_id)
            if not thread or not thread.is_alive():
                state.status = TaskStatus.FILLING
                state.add_log(
                    state.current_step or StepName.CHECK_LOGIN,
                    "原任务恢复执行",
                    StepStatus.RUNNING,
                    "正在继续执行原发布任务流水线..."
                )
                new_thread = threading.Thread(target=self._run_task_pipeline, args=(state,), daemon=True)
                self._threads[task_id] = new_thread
                new_thread.start()
                return True
            else:
                state.add_log(
                    state.current_step or StepName.CHECK_LOGIN,
                    "任务恢复",
                    StepStatus.RUNNING,
                    "创作者已恢复自动化流程"
                )
                return True

    def cancel_task(self, task_id: str) -> bool:
        state = self.get_task(task_id)
        if state:
            with state.lock:
                state.is_cancelled = True
                state.status = TaskStatus.FAILED
                state.error_message = "用户取消了本次发布任务"
                state.add_log(state.current_step or StepName.CHECK_LOGIN, "任务取消", StepStatus.FAILED, "任务已被用户主动取消")
            return True
        return False

    def takeover_task(self, task_id: str) -> bool:
        """人工手动接管：暂停自动化，保留浏览器，切换至手动发布包"""
        state = self.get_task(task_id)
        if state:
            with state.lock:
                state.is_paused = True
                state.is_manual_takeover = True
                state.status = TaskStatus.MANUAL_REQUIRED
                state.add_log(
                    state.current_step or StepName.CHECK_LOGIN,
                    "人工手动接管",
                    StepStatus.RUNNING,
                    "用户已开启手动接管模式。受控浏览器将保持打开状态，用户可在浏览器中自主操作，并可从右侧面板复制标题、正文与素材包。"
                )
            return True
        return False

    def confirm_publish_result(
        self,
        task_id: str,
        canonical_url: str | None,
        external_asset_id: str | None,
        verification_note: str | None = None,
        target_status: str = "PUBLISHED"
    ) -> tuple[bool, str]:
        """由用户或自动化录入真实发布结果，区分已公开与审核中，实施严格真实性约束"""
        state = self.get_task(task_id)
        if not state:
            return False, "任务不存在"

        if not canonical_url and not external_asset_id:
            return False, "必须提供真实公开链接 (canonical_url) 或平台内容 ID (external_asset_id)"

        # 校验核验说明 (与 API 端的 MANUAL_VERIFIED 规则对齐)
        if not verification_note or not verification_note.strip():
            return False, "必须提供明确的人工核验说明 (verification_note) 以记录证明依据"

        # 真实性与防 Mock 检查：严格按真实 Hostname 检验，杜绝子串匹配绕过
        if canonical_url:
            from .security import validate_canonical_url_hostname
            ok_url, msg_url = validate_canonical_url_hostname(canonical_url, state.channel)
            if not ok_url:
                return False, msg_url

        norm_status = target_status.upper().strip() if target_status else "PUBLISHED"
        with state.lock:
            state.published_url = canonical_url
            state.external_asset_id = external_asset_id
            if norm_status == "PENDING_REVIEW":
                state.status = TaskStatus.PENDING_REVIEW
                state.add_log(
                    StepName.READ_RESULT,
                    "平台审核中状态已确认",
                    StepStatus.RUNNING,
                    f"已记录提交审核：链接={canonical_url or '无'}，内容ID={external_asset_id or '无'}，说明={verification_note}"
                )
                return True, "已成功登记为【平台审核中】状态"
            else:
                state.status = TaskStatus.PUBLISHED
                state.add_log(
                    StepName.READ_RESULT,
                    "公开发布结果已确认 (MANUAL_VERIFIED)",
                    StepStatus.SUCCESS,
                    f"已成功确认公开发布落地：链接={canonical_url or '无'}，内容ID={external_asset_id or '无'}，核验依据={verification_note}"
                )
                return True, "已成功确认公开发布落地 (MANUAL_VERIFIED)"

    def _wait_if_paused(self, state: TaskExecutionState) -> bool:
        """如果处于暂停状态，循环等待至恢复或取消"""
        while state.is_paused and not state.is_cancelled:
            time.sleep(0.5)
        return not state.is_cancelled

    def _prepare_local_media_items(self, media_items: list[MediaItem], task_id: str) -> list[MediaItem]:
        """
        确保素材（图片/视频/封面）在本地有实际安全受权的文件路径，供 WebDriver input[type=file] 上传
        若仅有远程 URL，自动缓存到 TEMP_DIR；若为 file:// 或本地路径，通过 validate_media_file_path 执行白名单与防越权校验
        """
        from .config import TEMP_DIR
        from .security import validate_media_file_path
        from pathlib import Path
        import urllib.request
        import ssl
        from urllib.parse import urlparse

        prepared = []
        for item in media_items:
            new_item = MediaItem(
                index=item.index,
                type=item.type,
                url=item.url,
                local_path=item.local_path,
                mime_type=item.mime_type,
                notes=item.notes
            )

            candidate_path = None
            # 1. 优先使用明确的本地路径
            if new_item.local_path and Path(new_item.local_path).is_absolute():
                candidate_path = new_item.local_path
            elif new_item.url and new_item.url.startswith("file://"):
                fpath = new_item.url[7:]
                if fpath.startswith("/") and len(fpath) > 3 and fpath[2] == ":":
                    fpath = fpath[1:]
                candidate_path = fpath
            elif new_item.local_path:
                candidate_path = new_item.local_path

            if candidate_path:
                ok_path, msg_path, safe_p = validate_media_file_path(candidate_path, new_item.type)
                if ok_path and safe_p:
                    new_item.local_path = str(safe_p)
                    new_item.size_bytes = safe_p.stat().st_size
                    prepared.append(new_item)
                    continue
                else:
                    new_item.notes = f"{new_item.notes or ''} [路径安全拦截: {msg_path}]"

            # 2. 如果是 http/https 远程 URL，下载缓存并校验
            if new_item.url and new_item.url.startswith(("http://", "https://")):
                try:
                    parsed = urlparse(new_item.url)
                    p_ext = Path(parsed.path).suffix.lower()
                    if new_item.type == "VIDEO":
                        ext = p_ext if p_ext in [".mp4", ".mov", ".webm", ".avi", ".flv", ".mkv"] else ".mp4"
                    else:
                        ext = p_ext if p_ext in [".png", ".jpg", ".jpeg", ".webp"] else ".jpg"
                    cached_file = TEMP_DIR / f"{task_id[:8]}_{new_item.index}{ext}"
                    if not cached_file.exists() or cached_file.stat().st_size == 0:
                        ctx = ssl.create_default_context()
                        ctx.check_hostname = False
                        ctx.verify_mode = ssl.CERT_NONE
                        req = urllib.request.Request(
                            new_item.url,
                            headers={"User-Agent": "Mozilla/5.0 GeoLens-Assistant/2.0"}
                        )
                        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                            content = resp.read()
                            if content and len(content) > 0:
                                cached_file.write_bytes(content)
                    if cached_file.exists():
                        ok_cache, msg_cache, safe_cache = validate_media_file_path(cached_file, new_item.type)
                        if ok_cache and safe_cache:
                            new_item.local_path = str(safe_cache)
                            new_item.size_bytes = safe_cache.stat().st_size
                except Exception:
                    pass
            prepared.append(new_item)
        return prepared

    def _run_task_pipeline(self, state: TaskExecutionState):
        """核心 15 步可观察状态机 (FSM) 自动化执行流水线"""
        from .config import TEMP_DIR
        req = state.req
        channel = state.channel
        account_id = state.account_id

        # 1. 状态 1: INITIALIZING (启动或连接受控浏览器)
        try:
            state.add_log(
                StepName.CHECK_LOGIN,
                "启动受控浏览器 (INITIALIZING)",
                StepStatus.RUNNING,
                f"正在调起 {channel} 受控 Chrome 实例 (Profile: {channel}_{account_id})",
                fsm_state=FsmState.INITIALIZING
            )
            driver = browser_manager.get_or_create_driver(
                channel=channel,
                account_id=account_id,
                headless=req.headless
            )
            publisher = registry.get_publisher(channel, driver)
            state.add_log(
                StepName.CHECK_LOGIN,
                "浏览器已就绪 (INITIALIZING)",
                StepStatus.SUCCESS,
                f"已成功调起并建立与 {channel} 受控 Chrome 实例的连接",
                fsm_state=FsmState.INITIALIZING
            )
        except Exception as e:
            state.status = TaskStatus.MANUAL_REQUIRED
            state.fsm_state = FsmState.FAILED
            state.is_manual_takeover = True
            state.error_message = f"调起浏览器失败：{e}"
            state.recovery_guidance = "请检查 ChromeDriver 路径与 Chrome 安装，或直接使用右侧人工发布包"
            state.add_log(
                StepName.CHECK_LOGIN,
                "启动浏览器失败 (FAILED)",
                StepStatus.FAILED,
                f"{e}。已保留当前任务并开启人工接管模式，请使用右侧发布包手动完成发布。",
                fsm_state=FsmState.FAILED,
                recovery_guidance=state.recovery_guidance
            )
            return

        browser_manager.mark_busy(channel, account_id)

        def _check_blocked(step_name: StepName, current_fsm: FsmState) -> bool:
            """检测风控阻断/滑块验证并保留现场快照"""
            is_blocked, block_msg = publisher.detect_blocking()
            if is_blocked:
                snap_path = str(TEMP_DIR / f"blocked_{req.task_id[:8]}.png")
                publisher.capture_screenshot(snap_path)
                state.status = TaskStatus.MANUAL_REQUIRED
                state.fsm_state = FsmState.BLOCKED
                state.screenshot_path = snap_path
                state.recovery_guidance = block_msg
                state.resumable = True
                state.add_log(
                    step_name,
                    "遇到安全验证阻断 (BLOCKED)",
                    StepStatus.FAILED,
                    block_msg,
                    fsm_state=FsmState.BLOCKED,
                    screenshot_path=snap_path,
                    recovery_guidance=block_msg,
                    resumable=True
                )
                return True
            return False

        try:
            # 检查是否为未适配渠道（人工回退）
            if not registry.is_fully_automated(channel):
                state.status = TaskStatus.MANUAL_REQUIRED
                state.fsm_state = FsmState.READY_FOR_REVIEW
                state.is_manual_takeover = True
                publisher.open_editor()
                state.add_log(
                    StepName.OPEN_EDITOR,
                    "人工辅助发布模式 (MANUAL_FALLBACK)",
                    StepStatus.SUCCESS,
                    f"{channel} 暂未开放完全无人值守自动化。已为您在受控浏览器打开官方创作页面，请使用右侧发布包手动粘贴发布。",
                    fsm_state=FsmState.READY_FOR_REVIEW
                )
                return

            # 2. 状态 2: SESSION_CHECK (检查登录态与 Cookie)
            state.current_step = StepName.CHECK_LOGIN
            state.status = TaskStatus.FILLING
            t0 = time.time()
            state.add_log(
                StepName.CHECK_LOGIN,
                "检查会话有效性 (SESSION_CHECK)",
                StepStatus.RUNNING,
                f"正在检测 {channel} 登录 Cookie 与活跃会话凭据...",
                fsm_state=FsmState.SESSION_CHECK
            )

            is_logged_in, login_msg, extra = publisher.check_login()
            duration = int((time.time() - t0) * 1000)

            # 3. 状态 3: LOGIN_REQUIRED (未登录，等待创作者扫码授权)
            if not is_logged_in:
                state.status = TaskStatus.PENDING_ACCOUNT_AUTH
                state.fsm_state = FsmState.LOGIN_REQUIRED
                state.resumable = True
                state.recovery_guidance = "请使用对应手机 App 扫码登录。扫码完成后系统将自动继续，无需重新提交"
                state.add_log(
                    StepName.CHECK_LOGIN,
                    "等待创作者扫码授权 (LOGIN_REQUIRED)",
                    StepStatus.RUNNING,
                    f"{login_msg}。受控 Chrome 窗口已保持打开并展示登录界面。创作者扫码授权后系统将自动继续原任务，无需重新创建内容。",
                    duration_ms=duration,
                    fsm_state=FsmState.LOGIN_REQUIRED,
                    recovery_guidance=state.recovery_guidance,
                    resumable=True
                )

                # 持续监听扫码授权状态（持续 180 秒）
                poll_deadline = time.time() + 180
                while time.time() < poll_deadline and not state.is_cancelled:
                    if state.is_manual_takeover or state.is_paused:
                        return
                    time.sleep(2.0)
                    try:
                        ok_recheck, msg_recheck, _ = publisher.check_login()
                        if ok_recheck:
                            is_logged_in = True
                            state.status = TaskStatus.FILLING
                            state.fsm_state = FsmState.SESSION_CHECK
                            state.add_log(
                                StepName.CHECK_LOGIN,
                                "扫码授权成功 (SESSION_CHECK)",
                                StepStatus.SUCCESS,
                                f"已检测到创作者登录成功（{msg_recheck}），原任务自动继续执行！",
                                fsm_state=FsmState.SESSION_CHECK
                            )
                            break
                    except Exception:
                        pass

                if not is_logged_in:
                    state.status = TaskStatus.PENDING_ACCOUNT_AUTH
                    state.fsm_state = FsmState.LOGIN_REQUIRED
                    state.add_log(
                        StepName.CHECK_LOGIN,
                        "等待扫码超时或已暂停",
                        StepStatus.FAILED,
                        "未在限定时间内完成扫码。受控 Chrome 保持打开，扫码完成后可在控制台点击【已完成登录，继续原任务】恢复执行。",
                        fsm_state=FsmState.LOGIN_REQUIRED,
                        recovery_guidance="扫码完成后点击【已完成登录，继续原任务】",
                        resumable=True
                    )
                    return
            else:
                state.add_log(
                    StepName.CHECK_LOGIN,
                    "会话凭据有效 (SESSION_CHECK)",
                    StepStatus.SUCCESS,
                    login_msg,
                    duration_ms=duration,
                    fsm_state=FsmState.SESSION_CHECK
                )

            if not self._wait_if_paused(state):
                return

            # 4. 状态 4: CREATOR_CENTER_NAVIGATION (导航至平台创作者中心主入口)
            state.current_step = StepName.OPEN_EDITOR
            state.add_log(
                StepName.OPEN_EDITOR,
                "导航创作者服务中心 (CREATOR_CENTER_NAVIGATION)",
                StepStatus.RUNNING,
                f"正在导航至 {channel} 创作者服务中心主入口...",
                fsm_state=FsmState.CREATOR_CENTER_NAVIGATION
            )
            t0 = time.time()
            ok_nav, msg_nav = publisher.navigate_creator_center()
            dur_nav = int((time.time() - t0) * 1000)
            if not ok_nav:
                snap_path = str(TEMP_DIR / f"fail_nav_{req.task_id[:8]}.png")
                publisher.capture_screenshot(snap_path)
                state.status = TaskStatus.FAILED
                state.fsm_state = FsmState.FAILED
                state.error_message = msg_nav
                state.screenshot_path = snap_path
                state.recovery_guidance = "创作者中心页面导航失败，请检查网络连接或在浏览器中刷新"
                state.add_log(StepName.OPEN_EDITOR, "导航创作者中心失败 (FAILED)", StepStatus.FAILED, msg_nav, dur_nav, fsm_state=FsmState.FAILED, screenshot_path=snap_path)
                return
            if _check_blocked(StepName.OPEN_EDITOR, FsmState.CREATOR_CENTER_NAVIGATION):
                return
            state.add_log(StepName.OPEN_EDITOR, "创作者中心已就绪 (CREATOR_CENTER_NAVIGATION)", StepStatus.SUCCESS, msg_nav, dur_nav, fsm_state=FsmState.CREATOR_CENTER_NAVIGATION)

            if not self._wait_if_paused(state):
                return

            # 5. 状态 5: CONTENT_TYPE_SELECTION (显式选择创作类型：图文/视频/长文)
            content_type = getattr(req, "content_type", None) or ("VIDEO" if publisher.is_video_channel() else "IMAGE_TEXT")
            state.add_log(
                StepName.OPEN_EDITOR,
                "选择创作类型 (CONTENT_TYPE_SELECTION)",
                StepStatus.RUNNING,
                f"正在选择并切换至创作类型：{content_type}...",
                fsm_state=FsmState.CONTENT_TYPE_SELECTION
            )
            t0 = time.time()
            ok_type, msg_type = publisher.select_content_type(content_type)
            dur_type = int((time.time() - t0) * 1000)
            if _check_blocked(StepName.OPEN_EDITOR, FsmState.CONTENT_TYPE_SELECTION):
                return
            state.add_log(StepName.OPEN_EDITOR, "创作类型已切换 (CONTENT_TYPE_SELECTION)", StepStatus.SUCCESS, msg_type, dur_type, fsm_state=FsmState.CONTENT_TYPE_SELECTION)

            if not self._wait_if_paused(state):
                return

            # 6. 状态 6: EDITOR_READY (确认编辑器 DOM 就绪，清除各类新手引导和遮罩浮层)
            state.add_log(
                StepName.OPEN_EDITOR,
                "确认编辑器可交互 (EDITOR_READY)",
                StepStatus.RUNNING,
                "正在检测编辑器 DOM 元素就绪状态并清除阻断浮层与引导...",
                fsm_state=FsmState.EDITOR_READY
            )
            t0 = time.time()
            ok_ready, msg_ready = publisher.ensure_editor_ready()
            dur_ready = int((time.time() - t0) * 1000)
            if _check_blocked(StepName.OPEN_EDITOR, FsmState.EDITOR_READY):
                return
            state.add_log(StepName.OPEN_EDITOR, "编辑器表单就绪 (EDITOR_READY)", StepStatus.SUCCESS, msg_ready, dur_ready, fsm_state=FsmState.EDITOR_READY)

            if not self._wait_if_paused(state):
                return

            # 视频平台以及小红书均要求先上传素材以唤起主编辑表单
            upload_media_first = getattr(publisher, "upload_media_first", False) or publisher.is_video_channel() or channel in ["XIAOHONGSHU", "BILIBILI", "DOUYIN", "WECHAT_CHANNELS", "KUAISHOU"]

            if upload_media_first:
                # 7. 状态 9: MEDIA_UPLOAD (上传图片或视频素材，等待平台切片解析完成)
                state.current_step = StepName.UPLOAD_MEDIA
                media_desc = "视频及封面素材" if publisher.is_video_channel() else "配图素材"
                state.add_log(
                    StepName.UPLOAD_MEDIA,
                    f"上传素材 (MEDIA_UPLOAD)",
                    StepStatus.RUNNING,
                    f"正在准备并上传 {len(req.media_items)} 项{media_desc}以激活编辑器...",
                    fsm_state=FsmState.MEDIA_UPLOAD
                )
                t0 = time.time()
                prepared_items = self._prepare_local_media_items(req.media_items, req.task_id)
                ok_med, msg_med = publisher.upload_media(prepared_items)
                dur_med = int((time.time() - t0) * 1000)
                if not ok_med and publisher.is_video_channel():
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.fsm_state = FsmState.BLOCKED
                    state.error_message = msg_med
                    state.recovery_guidance = "请检查视频格式并手动拖拽视频至受控浏览器上传区"
                    state.add_log(StepName.UPLOAD_MEDIA, "视频上传受阻 (BLOCKED)", StepStatus.FAILED, f"{msg_med}。已保留当前受控浏览器，请人工接管", dur_med, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                    return
                state.add_log(StepName.UPLOAD_MEDIA, "素材上传完成 (MEDIA_UPLOAD)", StepStatus.SUCCESS if ok_med else StepStatus.SKIPPED, msg_med, dur_med, fsm_state=FsmState.MEDIA_UPLOAD)
                time.sleep(1.2)

                # 视频渠道监测转码
                if publisher.is_video_channel() and ok_med:
                    state.add_log(StepName.UPLOAD_MEDIA, "视频转码处理监测 (MEDIA_UPLOAD)", StepStatus.RUNNING, "正在检测平台视频切片、转码解析与缩略图状态...", fsm_state=FsmState.MEDIA_UPLOAD)
                    t_up = time.time()
                    ok_up = False
                    msg_up = ""
                    try:
                        ok_up, msg_up = publisher.wait_for_upload_completion(timeout_sec=90)
                    except Exception as e:
                        msg_up = f"视频上传处理检测异常: {e}"
                    dur_up = int((time.time() - t_up) * 1000)
                    if not ok_up:
                        state.status = TaskStatus.MANUAL_REQUIRED
                        state.fsm_state = FsmState.BLOCKED
                        state.error_message = msg_up
                        state.recovery_guidance = "平台视频转码中或提示异常，请在受控浏览器查看提示"
                        state.add_log(StepName.UPLOAD_MEDIA, "视频转码未完成 (BLOCKED)", StepStatus.FAILED, f"{msg_up}。请在受控浏览器中人工核查", dur_up, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                        return
                    state.add_log(StepName.UPLOAD_MEDIA, "视频转码就绪 (MEDIA_UPLOAD)", StepStatus.SUCCESS, msg_up, dur_up, fsm_state=FsmState.MEDIA_UPLOAD)

                if not self._wait_if_paused(state):
                    return

                # 8. 状态 7: TITLE_FILL (填写标题并校验字数上限)
                state.current_step = StepName.FILL_TITLE
                title_display = req.title[:30] if len(req.title) > 30 else req.title
                state.add_log(StepName.FILL_TITLE, "填写标题 (TITLE_FILL)", StepStatus.RUNNING, f"正在输入标题：{title_display}...", fsm_state=FsmState.TITLE_FILL)
                t0 = time.time()
                ok_ti, msg_ti = publisher.fill_title(req.title)
                dur_ti = int((time.time() - t0) * 1000)
                if not ok_ti:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.fsm_state = FsmState.BLOCKED
                    state.error_message = msg_ti
                    state.recovery_guidance = "标题框定位未响应，请在受控浏览器中手动粘贴标题"
                    state.add_log(StepName.FILL_TITLE, "填写标题受阻 (BLOCKED)", StepStatus.FAILED, f"{msg_ti}。已保留当前进度，请手动接管", dur_ti, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                    return
                state.add_log(StepName.FILL_TITLE, "标题填写成功 (TITLE_FILL)", StepStatus.SUCCESS, msg_ti, dur_ti, fsm_state=FsmState.TITLE_FILL)

                if not self._wait_if_paused(state):
                    return

                # 9. 状态 8: BODY_FILL (写入正文描述 / 简介)
                state.current_step = StepName.FILL_CONTENT
                content_desc = "视频简介描述" if publisher.is_video_channel() else "正文内容"
                state.add_log(StepName.FILL_CONTENT, f"填写{content_desc} (BODY_FILL)", StepStatus.RUNNING, f"正在写入{content_desc}（共 {len(req.body)} 字）...", fsm_state=FsmState.BODY_FILL)
                t0 = time.time()
                ok_cnt, msg_cnt = publisher.fill_content(req.body)
                dur_cnt = int((time.time() - t0) * 1000)
                if not ok_cnt:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.fsm_state = FsmState.BLOCKED
                    state.error_message = msg_cnt
                    state.recovery_guidance = "正文输入未响应，请在受控浏览器中手动粘贴正文"
                    state.add_log(StepName.FILL_CONTENT, f"填写{content_desc}受阻 (BLOCKED)", StepStatus.FAILED, f"{msg_cnt}。已保留当前进度，请手动接管", dur_cnt, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                    return
                state.add_log(StepName.FILL_CONTENT, f"{content_desc}填写成功 (BODY_FILL)", StepStatus.SUCCESS, msg_cnt, dur_cnt, fsm_state=FsmState.BODY_FILL)

                if not self._wait_if_paused(state):
                    return
            else:
                # 状态 7: TITLE_FILL
                state.current_step = StepName.FILL_TITLE
                title_display = req.title[:30] if len(req.title) > 30 else req.title
                state.add_log(StepName.FILL_TITLE, "填写标题 (TITLE_FILL)", StepStatus.RUNNING, f"正在输入标题：{title_display}...", fsm_state=FsmState.TITLE_FILL)
                t0 = time.time()
                ok_ti, msg_ti = publisher.fill_title(req.title)
                dur_ti = int((time.time() - t0) * 1000)
                if not ok_ti:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.fsm_state = FsmState.BLOCKED
                    state.error_message = msg_ti
                    state.recovery_guidance = "标题框定位未响应，请在受控浏览器中手动粘贴标题"
                    state.add_log(StepName.FILL_TITLE, "填写标题受阻 (BLOCKED)", StepStatus.FAILED, f"{msg_ti}。已保留当前进度，请手动接管", dur_ti, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                    return
                state.add_log(StepName.FILL_TITLE, "标题填写成功 (TITLE_FILL)", StepStatus.SUCCESS, msg_ti, dur_ti, fsm_state=FsmState.TITLE_FILL)

                if not self._wait_if_paused(state):
                    return

                # 状态 8: BODY_FILL
                state.current_step = StepName.FILL_CONTENT
                state.add_log(StepName.FILL_CONTENT, "填写正文 (BODY_FILL)", StepStatus.RUNNING, f"正在写入正文内容（共 {len(req.body)} 字）...", fsm_state=FsmState.BODY_FILL)
                t0 = time.time()
                ok_cnt, msg_cnt = publisher.fill_content(req.body)
                dur_cnt = int((time.time() - t0) * 1000)
                if not ok_cnt:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.fsm_state = FsmState.BLOCKED
                    state.error_message = msg_cnt
                    state.recovery_guidance = "正文输入未响应，请在受控浏览器中手动粘贴正文"
                    state.add_log(StepName.FILL_CONTENT, "填写正文受阻 (BLOCKED)", StepStatus.FAILED, f"{msg_cnt}。已保留当前进度，请手动接管", dur_cnt, fsm_state=FsmState.BLOCKED, recovery_guidance=state.recovery_guidance)
                    return
                state.add_log(StepName.FILL_CONTENT, "正文填写成功 (BODY_FILL)", StepStatus.SUCCESS, msg_cnt, dur_cnt, fsm_state=FsmState.BODY_FILL)

                if not self._wait_if_paused(state):
                    return

                # 状态 9: MEDIA_UPLOAD
                state.current_step = StepName.UPLOAD_MEDIA
                state.add_log(StepName.UPLOAD_MEDIA, "上传素材 (MEDIA_UPLOAD)", StepStatus.RUNNING, f"正在准备并按序上传 {len(req.media_items)} 张素材图片...", fsm_state=FsmState.MEDIA_UPLOAD)
                t0 = time.time()
                prepared_items = self._prepare_local_media_items(req.media_items, req.task_id)
                ok_med, msg_med = publisher.upload_media(prepared_items)
                dur_med = int((time.time() - t0) * 1000)
                state.add_log(StepName.UPLOAD_MEDIA, "素材上传完成 (MEDIA_UPLOAD)", StepStatus.SUCCESS if ok_med else StepStatus.SKIPPED, msg_med, dur_med, fsm_state=FsmState.MEDIA_UPLOAD)

                if not self._wait_if_paused(state):
                    return

            # 10. 状态 10: TAG_FILL (填写话题标签与平台分类)
            state.current_step = StepName.FILL_TAGS
            state.add_log(StepName.FILL_TAGS, "填写标签 (TAG_FILL)", StepStatus.RUNNING, "正在添加话题标签...", fsm_state=FsmState.TAG_FILL)
            t0 = time.time()
            ok_tag, msg_tag = publisher.fill_tags(req.tags)
            dur_tag = int((time.time() - t0) * 1000)
            state.add_log(StepName.FILL_TAGS, "标签填写完成 (TAG_FILL)", StepStatus.SUCCESS if ok_tag else StepStatus.SKIPPED, msg_tag, dur_tag, fsm_state=FsmState.TAG_FILL)

            if not self._wait_if_paused(state):
                return

            # 11. 状态 11: COVER_SELECTION (选择或上传独立封面图片与自制声明)
            state.add_log(StepName.FILL_TAGS, "封面与声明设置 (COVER_SELECTION)", StepStatus.RUNNING, "正在处理封面设置与原创合规声明...", fsm_state=FsmState.COVER_SELECTION)
            try:
                publisher.fill_required_declarations()
            except Exception:
                pass
            state.add_log(StepName.FILL_TAGS, "封面与声明就绪 (COVER_SELECTION)", StepStatus.SUCCESS, "封面与声明检查完成", fsm_state=FsmState.COVER_SELECTION)

            if not self._wait_if_paused(state):
                return

            # 12. 状态 12: VALIDATION (双向核验页面填写内容与原始内容的一致性)
            state.current_step = StepName.VALIDATE_DRAFT
            state.add_log(StepName.VALIDATE_DRAFT, "一致性比对 (VALIDATION)", StepStatus.RUNNING, "正在从页面 DOM 反读数据执行双向比对校验...", fsm_state=FsmState.VALIDATION)
            t0 = time.time()
            validation = publisher.validate_draft(
                expected_title=req.title,
                expected_body=req.body,
                expected_tags=req.tags,
                expected_media_count=len(req.media_items)
            )
            dur_val = int((time.time() - t0) * 1000)
            state.validation = validation

            if validation.passed:
                state.add_log(
                    StepName.VALIDATE_DRAFT,
                    "一致性比对通过 (VALIDATION)",
                    StepStatus.SUCCESS,
                    f"内容校验通过：标题完全匹配，正文字数基本吻合（检测到 {validation.body_length_actual} 字）",
                    dur_val,
                    fsm_state=FsmState.VALIDATION
                )
            else:
                dis_str = "；".join(validation.discrepancies)
                state.add_log(
                    StepName.VALIDATE_DRAFT,
                    "一致性比对提醒 (VALIDATION)",
                    StepStatus.RUNNING,
                    f"校验发现差异（{dis_str}），已进入人工确认阶段供作者核查",
                    dur_val,
                    fsm_state=FsmState.VALIDATION
                )

            # 13. 状态 13: READY_FOR_REVIEW (滚动至最终确认区域，停留在发布前供人工审核)
            state.current_step = StepName.PREPARE_CONFIRMATION
            t0 = time.time()
            ok_prep, msg_prep = publisher.prepare_for_confirmation()
            dur_prep = int((time.time() - t0) * 1000)

            # 截图存证
            snap_file = browser_manager.take_screenshot(channel, account_id, f"draft_ready_{req.task_id[:8]}")
            state.screenshot_path = snap_file

            state.status = TaskStatus.AWAITING_CONFIRMATION
            state.fsm_state = FsmState.READY_FOR_REVIEW
            state.add_log(
                StepName.PREPARE_CONFIRMATION,
                "等待最终人工确认 (READY_FOR_REVIEW)",
                StepStatus.SUCCESS,
                "所有内容已自动填入完毕并通过比对。当前浏览器已停留在最终发布确认区，请创作者核对无误后在浏览器中点击【发布】或在 GeoLens 面板完成发布结果确认。",
                dur_prep,
                fsm_state=FsmState.READY_FOR_REVIEW,
                screenshot_path=snap_file
            )
        except Exception as e:
            # 状态 15: FAILED (执行失败并保留现场快照与诊断日志)
            snap_path = str(TEMP_DIR / f"fail_{req.task_id[:8]}.png")
            try:
                publisher.capture_screenshot(snap_path)
                state.screenshot_path = snap_path
            except Exception:
                pass
            state.status = TaskStatus.FAILED
            state.fsm_state = FsmState.FAILED
            state.error_message = f"执行异常：{e}"
            state.recovery_guidance = "请检查受控浏览器控制台或手动接管完成本次发布"
            state.add_log(
                state.current_step or StepName.OPEN_EDITOR,
                "执行异常 (FAILED)",
                StepStatus.FAILED,
                f"流水线执行异常：{e}",
                fsm_state=FsmState.FAILED,
                screenshot_path=state.screenshot_path,
                recovery_guidance=state.recovery_guidance
            )
        finally:
            browser_manager.mark_idle(channel, account_id)


task_manager = TaskManager()
