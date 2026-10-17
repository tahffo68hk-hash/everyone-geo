"""
GeoLens 本地浏览器助手 - 任务执行器与编排状态机 (TaskRunner)
控制 9 步自动化发布流程、双向比对、状态流转、暂停/恢复、手动接管与人工发布包回退
"""
import time
from datetime import datetime, timezone
from typing import Any
import threading

from .models import (
    TaskStatus, StepName, StepStatus, StepLog,
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

    def add_log(self, step: StepName, name: str, status: StepStatus, msg: str, duration_ms: int | None = None, data: dict[str, Any] | None = None):
        with self.lock:
            safe_msg = sanitize_log_message(msg)
            log = StepLog(
                step=step,
                name=name,
                status=status,
                message=safe_msg,
                timestamp=datetime.now(timezone.utc).isoformat(),
                duration_ms=duration_ms,
                data=data
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
        if state:
            with state.lock:
                state.is_paused = False
                state.add_log(state.current_step or StepName.CHECK_LOGIN, "任务恢复", StepStatus.RUNNING, "用户已恢复自动化流程")
            return True
        return False

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
        """核心 9 步发布流水线执行函数"""
        req = state.req
        channel = state.channel
        account_id = state.account_id

        # 1. 启动受控浏览器
        try:
            state.add_log(StepName.CHECK_LOGIN, "启动浏览器", StepStatus.RUNNING, f"正在调起 {channel} 受控 Chrome 实例 (Profile: {channel}_{account_id})")
            driver = browser_manager.get_or_create_driver(
                channel=channel,
                account_id=account_id,
                headless=req.headless
            )
            state.add_log(StepName.CHECK_LOGIN, "浏览器已就绪", StepStatus.SUCCESS, f"已成功调起并连接 {channel} 受控 Chrome 实例")
            publisher = registry.get_publisher(channel, driver)
        except Exception as e:
            state.status = TaskStatus.MANUAL_REQUIRED
            state.is_manual_takeover = True
            state.error_message = f"调起浏览器失败：{e}"
            state.add_log(StepName.CHECK_LOGIN, "启动浏览器失败", StepStatus.FAILED, f"{e}。已保留当前任务并开启人工接管模式，请使用右侧发布包手动完成发布。")
            return

        browser_manager.mark_busy(channel, account_id)
        try:
            # 检查是否为未适配渠道（人工回退）
            if not registry.is_fully_automated(channel):
                state.status = TaskStatus.MANUAL_REQUIRED
                state.is_manual_takeover = True
                publisher.open_editor()
                state.add_log(
                    StepName.OPEN_EDITOR,
                    "人工辅助发布模式",
                    StepStatus.SUCCESS,
                    f"{channel} 暂未开放完全无人值守自动化。已为您在受控浏览器打开官方创作页面，请使用右侧发布包手动粘贴发布。"
                )
                return

            # 2. 步骤 1: 检查登录态
            state.current_step = StepName.CHECK_LOGIN
            state.status = TaskStatus.FILLING
            t0 = time.time()
            state.add_log(StepName.CHECK_LOGIN, "检查登录状态", StepStatus.RUNNING, f"正在打开官方页面并检测 {channel} 登录态...")

            # 先尝试访问官方页面探测登录
            publisher.open_editor()
            is_logged_in, login_msg, extra = publisher.check_login()
            duration = int((time.time() - t0) * 1000)

            if not is_logged_in:
                state.status = TaskStatus.WAITING_FOR_LOGIN
                state.add_log(StepName.CHECK_LOGIN, "等待用户登录", StepStatus.FAILED, f"{login_msg}。受控浏览器已保持打开，请在窗口中扫码或输入账号登录后重试。", duration)
                return
            else:
                state.add_log(StepName.CHECK_LOGIN, "登录状态正常", StepStatus.SUCCESS, login_msg, duration)

            if not self._wait_if_paused(state):
                return

            # 3. 步骤 2: 打开创作页面
            state.current_step = StepName.OPEN_EDITOR
            mode_desc = "视频发布模式" if publisher.is_video_channel() else "图文发布模式"
            state.add_log(StepName.OPEN_EDITOR, "切换创作页面", StepStatus.RUNNING, f"正在切换至 {mode_desc}...")
            t0 = time.time()
            ok, msg = publisher.open_editor()
            duration = int((time.time() - t0) * 1000)
            if not ok:
                state.status = TaskStatus.FAILED
                state.error_message = msg
                state.add_log(StepName.OPEN_EDITOR, "打开创作页失败", StepStatus.FAILED, msg, duration)
                return
            state.add_log(StepName.OPEN_EDITOR, "创作页已就绪", StepStatus.SUCCESS, msg, duration)

            if not self._wait_if_paused(state):
                return

            # 视频平台以及小红书均要求先上传素材以唤起主编辑表单
            upload_media_first = getattr(publisher, "upload_media_first", False) or publisher.is_video_channel() or channel in ["XIAOHONGSHU", "BILIBILI", "DOUYIN", "WECHAT_CHANNELS", "KUAISHOU"]

            if upload_media_first:
                # 步骤: 上传素材与配图/视频
                state.current_step = StepName.UPLOAD_MEDIA
                media_desc = "视频及封面素材" if publisher.is_video_channel() else "配图素材"
                state.add_log(StepName.UPLOAD_MEDIA, "上传素材", StepStatus.RUNNING, f"正在准备并上传 {len(req.media_items)} 项{media_desc}以激活编辑器...")
                t0 = time.time()
                prepared_items = self._prepare_local_media_items(req.media_items, req.task_id)
                ok, msg = publisher.upload_media(prepared_items)
                duration = int((time.time() - t0) * 1000)
                if not ok and publisher.is_video_channel():
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.error_message = msg
                    state.add_log(StepName.UPLOAD_MEDIA, "视频上传失败", StepStatus.FAILED, f"{msg}。已保留当前受控浏览器，请人工接管", duration)
                    return
                state.add_log(StepName.UPLOAD_MEDIA, "素材上传完成", StepStatus.SUCCESS if ok else StepStatus.SKIPPED, msg, duration)
                time.sleep(1.2)  # 等待前端切片渲染与编辑器表单展开

                # 视频渠道强制核验平台处理、缩略图与转码状态
                if publisher.is_video_channel() and ok:
                    state.add_log(StepName.UPLOAD_MEDIA, "视频处理监测", StepStatus.RUNNING, "正在检测平台视频切片、转码解析与缩略图状态...")
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
                        state.error_message = msg_up
                        state.add_log(StepName.UPLOAD_MEDIA, "视频转码处理异常", StepStatus.FAILED, f"{msg_up}。请在受控浏览器中人工核查", dur_up)
                        return
                    state.add_log(StepName.UPLOAD_MEDIA, "视频转码就绪", StepStatus.SUCCESS, msg_up, dur_up)

                if not self._wait_if_paused(state):
                    return

                # 步骤: 填写标题
                state.current_step = StepName.FILL_TITLE
                title_display = req.title[:30] if len(req.title) > 30 else req.title
                state.add_log(StepName.FILL_TITLE, "填写标题", StepStatus.RUNNING, f"正在输入标题：{title_display}...")
                t0 = time.time()
                ok, msg = publisher.fill_title(req.title)
                duration = int((time.time() - t0) * 1000)
                if not ok:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.error_message = msg
                    state.add_log(StepName.FILL_TITLE, "填写标题失败", StepStatus.FAILED, f"{msg}。已保留当前进度，请手动接管", duration)
                    return
                state.add_log(StepName.FILL_TITLE, "标题填写成功", StepStatus.SUCCESS, msg, duration)

                if not self._wait_if_paused(state):
                    return

                # 步骤: 填写正文富文本 / 视频描述
                state.current_step = StepName.FILL_CONTENT
                content_desc = "视频简介描述" if publisher.is_video_channel() else "正文内容"
                state.add_log(StepName.FILL_CONTENT, f"填写{content_desc}", StepStatus.RUNNING, f"正在写入{content_desc}（共 {len(req.body)} 字）...")
                t0 = time.time()
                ok, msg = publisher.fill_content(req.body)
                duration = int((time.time() - t0) * 1000)
                if not ok:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.error_message = msg
                    state.add_log(StepName.FILL_CONTENT, f"填写{content_desc}失败", StepStatus.FAILED, f"{msg}。已保留当前进度，请手动接管", duration)
                    return
                state.add_log(StepName.FILL_CONTENT, f"{content_desc}填写成功", StepStatus.SUCCESS, msg, duration)

                if not self._wait_if_paused(state):
                    return
            else:
                # 步骤: 填写标题
                state.current_step = StepName.FILL_TITLE
                title_display = req.title[:30] if len(req.title) > 30 else req.title
                state.add_log(StepName.FILL_TITLE, "填写标题", StepStatus.RUNNING, f"正在输入标题：{title_display}...")
                t0 = time.time()
                ok, msg = publisher.fill_title(req.title)
                duration = int((time.time() - t0) * 1000)
                if not ok:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.error_message = msg
                    state.add_log(StepName.FILL_TITLE, "填写标题失败", StepStatus.FAILED, f"{msg}。已保留当前进度，请手动接管", duration)
                    return
                state.add_log(StepName.FILL_TITLE, "标题填写成功", StepStatus.SUCCESS, msg, duration)

                if not self._wait_if_paused(state):
                    return

                # 步骤: 填写正文富文本
                state.current_step = StepName.FILL_CONTENT
                state.add_log(StepName.FILL_CONTENT, "填写正文", StepStatus.RUNNING, f"正在写入正文内容（共 {len(req.body)} 字）...")
                t0 = time.time()
                ok, msg = publisher.fill_content(req.body)
                duration = int((time.time() - t0) * 1000)
                if not ok:
                    state.status = TaskStatus.MANUAL_REQUIRED
                    state.error_message = msg
                    state.add_log(StepName.FILL_CONTENT, "填写正文失败", StepStatus.FAILED, f"{msg}。已保留当前进度，请手动接管", duration)
                    return
                state.add_log(StepName.FILL_CONTENT, "正文填写成功", StepStatus.SUCCESS, msg, duration)

                if not self._wait_if_paused(state):
                    return

                # 步骤: 上传素材与配图
                state.current_step = StepName.UPLOAD_MEDIA
                state.add_log(StepName.UPLOAD_MEDIA, "上传素材", StepStatus.RUNNING, f"正在准备并按序上传 {len(req.media_items)} 张素材图片...")
                t0 = time.time()
                prepared_items = self._prepare_local_media_items(req.media_items, req.task_id)
                ok, msg = publisher.upload_media(prepared_items)
                duration = int((time.time() - t0) * 1000)
                state.add_log(StepName.UPLOAD_MEDIA, "素材上传完成", StepStatus.SUCCESS if ok else StepStatus.SKIPPED, msg, duration)

                if not self._wait_if_paused(state):
                    return

            # 7. 步骤 6: 填入话题标签
            state.current_step = StepName.FILL_TAGS
            state.add_log(StepName.FILL_TAGS, "填写标签", StepStatus.RUNNING, "正在添加话题标签...")
            t0 = time.time()
            ok, msg = publisher.fill_tags(req.tags)
            duration = int((time.time() - t0) * 1000)
            state.add_log(StepName.FILL_TAGS, "标签填写完成", StepStatus.SUCCESS if ok else StepStatus.SKIPPED, msg, duration)

            # 附加：必要声明与分区设置 (如自制声明、AI生成标记)
            try:
                publisher.fill_required_declarations()
            except Exception:
                pass

            if not self._wait_if_paused(state):
                return

            # 8. 步骤 7: 双向一致性比对校验
            state.current_step = StepName.VALIDATE_DRAFT
            state.add_log(StepName.VALIDATE_DRAFT, "一致性比对", StepStatus.RUNNING, "正在从页面 DOM 反读数据执行双向比对校验...")
            t0 = time.time()
            validation = publisher.validate_draft(
                expected_title=req.title,
                expected_body=req.body,
                expected_tags=req.tags,
                expected_media_count=len(req.media_items)
            )
            duration = int((time.time() - t0) * 1000)
            state.validation = validation

            if validation.passed:
                state.add_log(
                    StepName.VALIDATE_DRAFT,
                    "一致性比对通过",
                    StepStatus.SUCCESS,
                    f"内容校验通过：标题完全匹配，正文字数基本吻合（检测到 {validation.body_length_actual} 字）",
                    duration
                )
            else:
                dis_str = "；".join(validation.discrepancies)
                state.add_log(
                    StepName.VALIDATE_DRAFT,
                    "一致性比对提醒",
                    StepStatus.RUNNING,
                    f"校验发现差异（{dis_str}），已进入人工确认阶段供作者核查",
                    duration
                )

            # 9. 步骤 8: 准备确认 (绝对不擅自点击最终发布按钮)
            state.current_step = StepName.PREPARE_CONFIRMATION
            t0 = time.time()
            ok, msg = publisher.prepare_for_confirmation()
            duration = int((time.time() - t0) * 1000)

            # 截图存证
            browser_manager.take_screenshot(channel, account_id, f"draft_ready_{req.task_id[:8]}")

            state.status = TaskStatus.AWAITING_CONFIRMATION
            state.add_log(
                StepName.PREPARE_CONFIRMATION,
                "等待最终人工确认",
                StepStatus.SUCCESS,
                "所有内容已自动填入完毕并通过比对。当前浏览器已停留在最终发布确认区，请创作者核对无误后在浏览器中点击【发布】或在 GeoLens 面板完成发布结果确认。",
                duration
            )
        finally:
            browser_manager.mark_idle(channel, account_id)


task_manager = TaskManager()
