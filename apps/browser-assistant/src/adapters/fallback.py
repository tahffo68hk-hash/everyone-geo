"""
GeoLens 本地浏览器助手 - 通用人工辅助回退适配器 (FallbackPublisher)
针对尚未构建完整自动化脚本的渠道 (小红书、B站、视频号、抖音等) 提供标准的人工发布回退流程
"""
from typing import Any
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff

CREATOR_URL_MAP = {
    "XIAOHONGSHU": "https://creator.xiaohongshu.com/publish/publish?source=official",
    "BILIBILI": "https://member.bilibili.com/",
    "DOUYIN": "https://creator.douyin.com/",
    "WECHAT_CHANNELS": "https://channels.weixin.qq.com/",
    "KUAISHOU": "https://cp.kuaishou.com/article/publish/video",
    "WEIBO": "https://weibo.com/",
    "BAIJIAHAO": "https://baijiahao.baidu.com/builder/rc/edit?type=news",
    "WECHAT_OFFICIAL_ACCOUNT": "https://mp.weixin.qq.com/",
    "TOUTIAO": "https://mp.toutiao.com/profile_v4/graphic/publish",
}


LOGIN_URL_MAP = {
    "XIAOHONGSHU": "https://creator.xiaohongshu.com/login",
    "ZHIHU": "https://www.zhihu.com/signin",
    "BILIBILI": "https://passport.bilibili.com/login",
    "DOUYIN": "https://creator.douyin.com/",
    "WECHAT_CHANNELS": "https://channels.weixin.qq.com/",
    "KUAISHOU": "https://cp.kuaishou.com/",
    "WEIBO": "https://weibo.com/",
    "BAIJIAHAO": "https://baijiahao.baidu.com/",
    "WECHAT_OFFICIAL_ACCOUNT": "https://mp.weixin.qq.com/",
    "TOUTIAO": "https://mp.toutiao.com/auth/page/login",
}


class FallbackPublisher(BasePublisher):
    """人工发布回退适配器"""
    
    def __init__(self, driver, channel: str):
        super().__init__(driver)
        self.channel = channel.upper()
        self.creator_url = CREATOR_URL_MAP.get(self.channel, "https://www.google.com")

    def get_channel_name(self) -> str:
        return self.channel

    def get_creator_url(self) -> str:
        return self.creator_url

    def open_login_page(self) -> tuple[bool, str]:
        login_url = LOGIN_URL_MAP.get(self.channel, self.creator_url)
        try:
            self.driver.get(login_url)
            return True, f"已在受控浏览器打开 {self.channel} 官方登录页面"
        except Exception as e:
            return False, f"打开 {self.channel} 登录页失败：{e}"

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        curr_url = self.driver.current_url
        if self.creator_url in curr_url or any(d in curr_url for d in ["xiaohongshu.com", "bilibili.com", "douyin.com", "qq.com"]):
            return True, f"已连接至 {self.channel} 平台创作者页面", {}
        return False, f"未打开 {self.channel} 官方创作者页面", {}

    def open_editor(self) -> tuple[bool, str]:
        try:
            self.driver.get(self.creator_url)
            return True, f"已自动为用户在受控浏览器打开 {self.channel} 官方创作者平台"
        except Exception as e:
            return False, f"打开 {self.channel} 页面失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        return False, f"{self.channel} 当前处于人工发布回退模式，请使用右侧一键复制标题"

    def fill_content(self, body: str) -> tuple[bool, str]:
        return False, f"{self.channel} 当前处于人工发布回退模式，请使用右侧一键复制正文"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        return False, f"{self.channel} 当前处于人工发布回退模式，请下载素材包并拖拽上传"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        return False, f"{self.channel} 请在创作者后台手动输入话题标签"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        return ValidationDiff(
            passed=False,
            title_match=False,
            title_expected=expected_title,
            title_actual="",
            body_match=False,
            body_length_expected=len(expected_body),
            body_length_actual=0,
            media_count_expected=expected_media_count,
            media_count_actual=0,
            tags_match=False,
            tags_expected=expected_tags,
            tags_actual=[],
            discrepancies=["当前渠道为人工发布回退，依赖用户最终核实"]
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        return True, f"已为用户打开 {self.channel} 创作工作台，提供完整发布包以供直接粘贴操作"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        return False, "需由用户发布后在 GeoLens 工作台回填真实文章链接", {}
