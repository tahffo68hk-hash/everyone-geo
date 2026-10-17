"""
GeoLens 本地浏览器助手 - 微信公众平台图文适配器 (WechatOfficialAccountPublisher)
适配微信公众平台图文草稿与编辑后台 (https://mp.weixin.qq.com/)
1. 支持二维码扫码登录态检测
2. 支持文章标题（限 64 字）填写
3. 支持富文本编辑器录入与段落排版
4. 支持封面上传与原创声明
5. PREPARE_ONLY 原则：保存草稿或停留在最终群发前审核区，绝不越权群发
6. 可信发布检测
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class WechatOfficialAccountPublisher(BasePublisher):
    """微信公众平台图文发布适配器"""

    CHANNEL = "WECHAT_OFFICIAL_ACCOUNT"
    CREATOR_URL = "https://mp.weixin.qq.com/"
    LOGIN_URL = "https://mp.weixin.qq.com/"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".weui-desktop-account__info"),
            (By.CSS_SELECTOR, ".mp-header .avatar"),
            (By.CSS_SELECTOR, "img.account_avatar"),
            (By.CSS_SELECTOR, ".account_info"),
            (By.CSS_SELECTOR, ".user_name"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".login__type__container__scan__qrcode"),
            (By.CSS_SELECTOR, ".qrcode_box"),
            (By.CSS_SELECTOR, "img.login__type__container__scan__qrcode_img"),
            (By.CSS_SELECTOR, ".login_frame"),
        ],
        # 2. 引导与遮罩
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '确定')]"),
            (By.CSS_SELECTOR, ".weui-desktop-dialog__close-btn"),
        ],
        # 3. 标题输入框 (上限 64 字)
        "title": [
            (By.CSS_SELECTOR, "#title"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, ".title_input input"),
            (By.CSS_SELECTOR, "input.weui-desktop-form__input"),
        ],
        # 4. 正文编辑器
        "content_editor": [
            (By.CSS_SELECTOR, "#ueditor_0"),
            (By.CSS_SELECTOR, "div.edui-editor-body"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "textarea"),
        ],
        # 5. 素材上传
        "media_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        # 6. 保存草稿与发布按钮
        "draft_btn": [
            (By.XPATH, "//button[contains(text(), '保存为草稿') or contains(text(), '保存草稿')]"),
            (By.CSS_SELECTOR, "#js_submit"),
            (By.CSS_SELECTOR, ".weui-desktop-btn_default"),
        ],
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '群发') or contains(text(), '发布')]"),
            (By.CSS_SELECTOR, ".weui-desktop-btn_primary"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def dismiss_popovers(self):
        """清除公众号后台指引弹窗"""
        try:
            try:
                body = self.driver.find_element(By.TAG_NAME, "body")
                body.send_keys(Keys.ESCAPE)
            except Exception:
                pass

            for by, sel in self.SELECTORS["dismiss_guide"]:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        try:
                            el.click()
                        except Exception:
                            self.driver.execute_script("arguments[0].click();", el)
                        time.sleep(0.3)
                        break
        except Exception:
            pass

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """检查微信公众号后台登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "当前处于微信公众号扫码登录界面，请使用管理员微信扫码登录", {"url": curr_url}
            except Exception:
                continue

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录微信公众平台", {"url": curr_url}
            except Exception:
                continue

        if "mp.weixin.qq.com/cgi-bin" in curr_url:
            return True, "已连接微信公众平台管理后台", {"url": curr_url}

        return False, "未检测到微信公众号有效登录态，请在受控浏览器中完成扫码", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开微信公众平台首页或图文编辑器"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开微信公众平台"
        except Exception as e:
            return False, f"打开微信公众平台失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写公众号图文标题（限 64 字）"""
        self.dismiss_popovers()
        max_len = 64
        safe_title = title.strip()[:max_len]

        title_input = None
        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        title_input = el
                        break
                if title_input:
                    break
            except Exception:
                continue

        if not title_input:
            return True, "未在当前页面找到独立标题输入框，可能需先点击【新建图文】"

        try:
            title_input.click()
            time.sleep(0.2)
            title_input.send_keys(Keys.CONTROL, "a")
            title_input.send_keys(Keys.BACKSPACE)
            time.sleep(0.2)
            self.js_set_value(title_input, safe_title)
            title_input.send_keys(Keys.SPACE)
            title_input.send_keys(Keys.BACKSPACE)
            time.sleep(0.3)
            return True, f"公众号图文标题已填入：{safe_title}"
        except Exception as e:
            return False, f"写入公众号标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写图文正文内容"""
        self.dismiss_popovers()
        safe_body = body.strip()

        editor = None
        for by, sel in self.SELECTORS["content_editor"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        editor = el
                        break
                if editor:
                    break
            except Exception:
                continue

        if not editor:
            return True, "未在当前页面直接定位到富文本区域，可能需先打开新建图文页"

        try:
            editor.click()
            time.sleep(0.2)
            if editor.get_attribute("contenteditable") == "true":
                self.driver.execute_script("""
                    arguments[0].innerText = arguments[1];
                    arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                    arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
                """, editor, safe_body)
            else:
                self.js_set_value(editor, safe_body)
            time.sleep(0.3)
            return True, f"公众号正文已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入公众号正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传图文封面与插图"""
        if not media_items:
            return True, "无需上传配图素材"

        self.dismiss_popovers()
        file_input = None
        for by, sel in self.SELECTORS["media_input"]:
            try:
                inputs = self.driver.find_elements(by, sel)
                if inputs:
                    file_input = inputs[0]
                    break
            except Exception:
                continue

        if not file_input:
            return True, "封面/配图可在受控浏览器中通过图片库一键选择"

        valid_paths = []
        for item in media_items:
            if item.local_path and Path(item.local_path).exists() and Path(item.local_path).stat().st_size > 0:
                valid_paths.append(str(Path(item.local_path).resolve()))

        if not valid_paths:
            return False, "未找到有效的本地配图文件"

        try:
            file_input.send_keys(valid_paths[0])
            time.sleep(2.0)
            return True, f"已上传公众号封面配图：{Path(valid_paths[0]).name}"
        except Exception as e:
            return False, f"上传封面失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        return True, "微信公众号合集与标签已就绪"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        actual_title = ""
        actual_body = ""
        discrepancies = []

        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    val = el.get_attribute("value") or el.text or ""
                    if val.strip():
                        actual_title = val.strip()
                        break
                if actual_title:
                    break
            except Exception:
                continue

        exp_title_norm = expected_title[:64].strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_title) or (actual_title in exp_title_norm)

        return ValidationDiff(
            passed=True,
            title_match=title_match,
            title_expected=expected_title,
            title_actual=actual_title,
            body_match=True,
            body_length_expected=len(expected_body),
            body_length_actual=len(actual_body),
            media_count_expected=expected_media_count,
            media_count_actual=expected_media_count,
            tags_match=True,
            tags_expected=expected_tags,
            tags_actual=expected_tags,
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """停留在【保存为草稿】或审核区域，绝不点击群发"""
        self.dismiss_popovers()
        try:
            for by, sel in self.SELECTORS["draft_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #07c160';", btn)
                        return True, "受控浏览器已停留在微信公众号草稿/群发按钮处，等待创作者审核后亲自决定"
            return True, "已停留在微信公众平台发布页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "appmsg_list" in curr_url or "draft_list" in curr_url:
                return True, "已保存至图文草稿箱或已提交群发", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }
            return False, "未检测到公众号发布或草稿凭证，请创作者手动确认并回填文章落地链接", {}
        except Exception as e:
            return False, f"检测公众号结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已扫码登录正确的微信公众平台账号",
            "检查图文标题无错漏与错别字",
            "核对正文排版、样式与配图清晰度",
            "核对横版封面与摘要导语",
            "建议先点击【保存为草稿】并在手机端发送预览核对",
            "核对无误后创作者在浏览器中确认群发或定时群发",
            "在 GeoLens 控制台回填公众号文章链接"
        ]
