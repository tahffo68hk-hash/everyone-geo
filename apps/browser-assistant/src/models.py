"""
GeoLens 本地浏览器助手 - 数据结构与状态模型
严格对齐 GeoLens Publication / PublishedAsset 状态体系
"""
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    WAITING_FOR_LOGIN = "WAITING_FOR_LOGIN"      # 等待用户在平台完成登录 (兼容旧版)
    PENDING_ACCOUNT_AUTH = "PENDING_ACCOUNT_AUTH"# 等待账号授权/扫码登录
    READY = "READY"                              # 登录已就绪，等待执行填写
    FILLING = "FILLING"                          # 正在自动填写表单/富文本/上传素材
    FILLED = "FILLED"                            # 表单填写完毕并通过一致性比对
    AWAITING_CONFIRMATION = "AWAITING_CONFIRMATION" # 停留在最终发布确认阶段，等待人工核查
    SUBMITTED = "SUBMITTED"                      # 用户或助手已点击提交
    PENDING_REVIEW = "PENDING_REVIEW"            # 平台审核中
    PUBLISHED = "PUBLISHED"                      # 已证实公开发布，具备可信落地链接/ID
    FAILED = "FAILED"                            # 自动化执行失败
    MANUAL_REQUIRED = "MANUAL_REQUIRED"          # 需人工接管处理（验证码、风控、表单结构变动等）


class FsmState(str, Enum):
    """标准 15 步可观察发布状态机 (FSM)"""
    INITIALIZING = "INITIALIZING"                              # 1. 调起并初始化受控浏览器
    SESSION_CHECK = "SESSION_CHECK"                            # 2. 检查会话与 Cookie 有效性
    LOGIN_REQUIRED = "LOGIN_REQUIRED"                          # 3. 未登录，进入等待扫码授权/人工接管
    CREATOR_CENTER_NAVIGATION = "CREATOR_CENTER_NAVIGATION"    # 4. 导航至平台创作者服务中心主入口
    CONTENT_TYPE_SELECTION = "CONTENT_TYPE_SELECTION"          # 5. 显式切换或点击创作类型 (图文/视频/专栏)
    EDITOR_READY = "EDITOR_READY"                              # 6. 编辑器 DOM 与可交互状态就绪，清除导览弹窗
    TITLE_FILL = "TITLE_FILL"                                  # 7. 填写标题并执行字数上限与特殊符号校验
    BODY_FILL = "BODY_FILL"                                    # 8. 写入正文描述 (富文本/Markdown/纯文本段落)
    MEDIA_UPLOAD = "MEDIA_UPLOAD"                              # 9. 上传图片或视频素材，等待平台切片解析完成
    TAG_FILL = "TAG_FILL"                                      # 10. 填写话题标签与平台分类
    COVER_SELECTION = "COVER_SELECTION"                        # 11. 选择或上传独立封面图片
    VALIDATION = "VALIDATION"                                  # 12. 双向核验填写字段与原始内容一致性
    READY_FOR_REVIEW = "READY_FOR_REVIEW"                      # 13. 滚动至最终发布区，停留在发布前供人工审核
    BLOCKED = "BLOCKED"                                        # 14. 遇到验证码、风控阻断或结构异常，等待接管
    FAILED = "FAILED"                                          # 15. 执行失败并保留现场快照与诊断信息


class StepName(str, Enum):
    CHECK_LOGIN = "CHECK_LOGIN"                  # 1. 检查目标平台登录状态
    OPEN_EDITOR = "OPEN_EDITOR"                  # 2. 打开对应的内容创作页面
    FILL_TITLE = "FILL_TITLE"                    # 3. 自动填写标题
    FILL_CONTENT = "FILL_CONTENT"                # 4. 自动填写正文 (富文本/Markdown)
    UPLOAD_MEDIA = "UPLOAD_MEDIA"                # 5. 自动上传图片或视频素材
    FILL_TAGS = "FILL_TAGS"                      # 6. 自动填写话题标签及其他适用字段
    VALIDATE_DRAFT = "VALIDATE_DRAFT"            # 7. 校验填写结果与原始内容是否一致
    PREPARE_CONFIRMATION = "PREPARE_CONFIRMATION"# 8. 停留在最终发布确认阶段
    READ_RESULT = "READ_RESULT"                  # 9. 记录提交、审核或发布结果


class StepStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"


class StepLog(BaseModel):
    step: StepName
    name: str
    status: StepStatus
    message: str
    timestamp: str
    duration_ms: int | None = None
    data: dict[str, Any] | None = None
    fsm_state: FsmState | None = None
    screenshot_path: str | None = None
    recovery_guidance: str | None = None


class MediaItem(BaseModel):
    index: int = 0
    type: str = "IMAGE"                          # IMAGE / VIDEO / COVER
    url: str = ""
    local_path: str | None = None
    mime_type: str = "image/png"
    size_bytes: int | None = None
    notes: str | None = None


class ValidationDiff(BaseModel):
    passed: bool
    title_match: bool
    title_expected: str
    title_actual: str
    body_match: bool
    body_length_expected: int
    body_length_actual: int
    media_count_expected: int
    media_count_actual: int
    tags_match: bool
    tags_expected: list[str] = Field(default_factory=list)
    tags_actual: list[str] = Field(default_factory=list)
    discrepancies: list[str] = Field(default_factory=list)


class ManualPublishPackage(BaseModel):
    channel: str
    title: str
    body: str
    hashtags: list[str] = Field(default_factory=list)
    media_items: list[MediaItem] = Field(default_factory=list)
    creator_url: str
    checklist: list[str] = Field(default_factory=list)
    instructions: str
    generated_at: str


class CreatePublishTaskRequest(BaseModel):
    task_id: str
    channel: str                                 # e.g. "ZHIHU", "SIMULATION", "XIAOHONGSHU"
    account_id: str = "default"                  # 用于多账号隔离的独立 Profile
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    media_items: list[MediaItem] = Field(default_factory=list)
    cover_url: str | None = None
    source_draft_id: str | None = None
    source_revision_id: str | None = None
    publication_id: str | None = None
    content_type: str = "IMAGE_TEXT"             # IMAGE_TEXT / VIDEO / ARTICLE
    headless: bool = False                       # 自动化测试时可选 True，人工时默认 False


class ConfirmPublishRequest(BaseModel):
    canonical_url: str | None = None             # 真实公开地址
    external_asset_id: str | None = None         # 平台内容 ID (如文章 ID、回答 ID)
    actual_published_at: str | None = None       # 真实发布时间
    verification_note: str | None = None         # 验证附言
    status: str = "PUBLISHED"                    # PUBLISHED | PENDING_REVIEW


class TaskStatusResponse(BaseModel):
    task_id: str
    channel: str
    account_id: str
    status: TaskStatus
    current_step: StepName | None = None
    fsm_state: FsmState | None = None
    current_state_title: str | None = None
    resumable: bool = False
    screenshot_path: str | None = None
    recovery_guidance: str | None = None
    steps: list[StepLog] = Field(default_factory=list)
    validation: ValidationDiff | None = None
    manual_package: ManualPublishPackage | None = None
    error_message: str | None = None
    is_paused: bool = False
    is_manual_takeover: bool = False
    browser_running: bool = False
    published_url: str | None = None
    external_asset_id: str | None = None
    created_at: str
    updated_at: str


class ExportPackageZipRequest(BaseModel):
    channel: str
    title: str
    body: str
    tags: list[str] = Field(default_factory=list)
    media_items: list[MediaItem] = Field(default_factory=list)

