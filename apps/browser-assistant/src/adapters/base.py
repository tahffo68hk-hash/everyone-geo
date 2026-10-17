"""
GeoLens 本地浏览器助手 - 平台适配器抽象基类 (BasePublisher)
规范各目标平台发布适配器的生命周期与操作契约
"""
from abc import ABC, abstractmethod
from typing import Any
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from ..models import MediaItem, ValidationDiff


class BasePublisher(ABC):
    """平台发布适配器基类"""
    def __init__(self, driver: webdriver.Chrome, timeout_sec: int = 15):
        self.driver = driver
        self.timeout_sec = timeout_sec
        self.wait = WebDriverWait(driver, timeout_sec)

    @abstractmethod
    def get_channel_name(self) -> str:
        """返回适配的渠道标识，例如 ZHIHU, SIMULATION, XIAOHONGSHU"""
        pass

    @abstractmethod
    def get_creator_url(self) -> str:
        """返回官方创作页面绝对 URL"""
        pass

    @abstractmethod
    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """
        检查目标平台登录状态
        :return: (is_logged_in, status_message, extra_data)
        """
        pass

    def open_login_page(self) -> tuple[bool, str]:
        """
        打开对应平台的官方登录/扫码页面
        :return: (success, status_message)
        """
        try:
            self.driver.get(self.get_creator_url())
            return True, f"已在受控浏览器打开 {self.get_channel_name()} 官方页面"
        except Exception as e:
            return False, f"打开登录页失败：{e}"

    @abstractmethod
    def open_editor(self) -> tuple[bool, str]:
        """
        打开对应平台的内容创作与文章发布页面
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_title(self, title: str) -> tuple[bool, str]:
        """
        自动填写标题
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_content(self, body: str) -> tuple[bool, str]:
        """
        自动填写正文 (需处理富文本、段落换行或 Markdown)
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """
        自动上传图片或视频素材
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """
        自动填写话题标签及其他适用字段
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """
        双向校验填写结果与原始内容是否一致
        :return: ValidationDiff 结构体
        """
        pass

    @abstractmethod
    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """
        停留在最终发布确认阶段，滚动到确认区域，留给用户核查与最终决定
        不得未经授权擅自点击终态发布提交
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """
        根据真实平台反馈，记录提交、审核或发布结果
        :return: (is_published, status_message, {canonical_url, external_asset_id, etc.})
        """
        pass

    def get_manual_checklist(self) -> list[str]:
        """返回人工发布时的核对清单"""
        return [
            "确认已登录正确的创作者账号",
            "检查文章标题无错漏与错别字",
            "核对正文排版、段落换行与重点加粗",
            "核对配图清晰度与展示顺序",
            "确认话题标签与专栏分类",
            "完成最终人工核对后点击发布"
        ]

    # ---- 常用辅助工具方法 ----
    def safe_find(self, by: By, value: str, timeout: int | None = None):
        t = timeout or self.timeout_sec
        return WebDriverWait(self.driver, t).until(
            EC.presence_of_element_located((by, value))
        )

    def safe_click(self, by: By, value: str, timeout: int | None = None):
        t = timeout or self.timeout_sec
        element = WebDriverWait(self.driver, t).until(
            EC.element_to_be_clickable((by, value))
        )
        try:
            element.click()
        except Exception:
            # 降级为 JS 点击，避免被浮层或动画阻挡
            self.driver.execute_script("arguments[0].click();", element)
        return element

    def js_set_value(self, element, value: str):
        """通过 JS 直接设值并触发 input/change 事件"""
        self.driver.execute_script("""
            arguments[0].value = arguments[1];
            arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
            arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
        """, element, value)
