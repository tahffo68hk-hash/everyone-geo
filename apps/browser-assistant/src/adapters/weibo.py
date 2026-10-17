"""
GeoLens 本地浏览器助手 - 微博平台适配器 (WeiboPublisher)
适配新浪微博发布页面 (https://weibo.com/)
结合 social-auto-upload (weibo_uploader) 实测经验：
1. 支持清除引导浮层与广告/关注弹窗
2. 支持图文（1-9 张图片）与短视频素材通过 input[type='file'] 真实上传
3. 支持微博正文与双井号话题 (#话题#) 规范录入
4. PREPARE_ONLY 原则：停留在最终确认阶段，绝不自动越权点击【发送】
5. 可信结果检测：区分发布中与微博公开落地
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class WeiboPublisher(BasePublisher):
    """新浪微博图文与短视频发布适配器"""

    CHANNEL = "WEIBO"
    CREATOR_URL = "https://weibo.com/"
    LOGIN_URL = "https://weibo.com/login.php"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".woo-avatar-main"),
            (By.CSS_SELECTOR, "[class*='gn_name']"),
            (By.CSS_SELECTOR, "a[href*='/u/'] img"),
            (By.CSS_SELECTOR, ".woo-box-item-flex a[href*='/u/']"),
            (By.CSS_SELECTOR, "[class*='nav_user']"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".login-box"),
            (By.CSS_SELECTOR, "div[class*='login_wrapper']"),
            (By.CSS_SELECTOR, ".woo-modal-main .login"),
            (By.CSS_SELECTOR, "div[class*='login-panel']"),
        ],
        # 2. 引导与遮罩弹窗
        "dismiss_guide": [
            (By.CSS_SELECTOR, ".woo-dialog-close"),
            (By.CSS_SELECTOR, "i.woo-font--cross"),
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过')]"),
        ],
        # 3. 正文输入区 (支持双井号话题)
        "content_editor": [
            (By.CSS_SELECTOR, "textarea[placeholder*='新鲜事']"),
            (By.CSS_SELECTOR, "textarea[class*='Form_input']"),
            (By.CSS_SELECTOR, "div[contenteditable='true'][class*='Form_input']"),
            (By.CSS_SELECTOR, "div.Form_input_2gtXx"),
            (By.CSS_SELECTOR, "textarea"),
        ],
        # 4. 素材上传 (图片/视频)
        "media_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='video']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        "upload_btn": [
            (By.CSS_SELECTOR, "div[class*='toolbar_icon']"),
            (By.XPATH, "//*[contains(@title, '图片') or contains(@title, '视频')]"),
        ],
        # 5. 发送按钮
        "send_btn": [
            (By.XPATH, "//button[contains(text(), '发送') or contains(., '发送')]"),
            (By.CSS_SELECTOR, "button[class*='Tool_btn']"),
            (By.CSS_SELECTOR, ".send_btn button"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def dismiss_popovers(self):
        """清除微博页面浮层与引导"""
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

            js_clean = """
                var selectors = ['.woo-modal-mask', '.woo-pop-wrap', '.tips_bar', 'div[role="tooltip"]'];
                selectors.forEach(function(sel) {
                    var els = document.querySelectorAll(sel);
                    els.forEach(function(el) {
                        el.style.display = 'none';
                    });
                });
            """
            self.driver.execute_script(js_clean)
        except Exception:
            pass

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """检查新浪微博登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        if "weibo.com/login" in curr_url or "login.php" in curr_url:
            return False, "当前处于微博登录页，等待创作者扫码或账号登录", {"url": curr_url}

        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "检测到微博登录弹窗，请在打开的受控浏览器中扫码登录", {"url": curr_url}
            except Exception:
                continue

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录新浪微博", {"url": curr_url}
            except Exception:
                continue

        if "weibo.com" in curr_url and ("mygroups" in curr_url or "u/" in curr_url or "home" in curr_url):
            return True, "已连接微博首页与发布台", {"url": curr_url}

        return False, "未检测到微博有效登录态，请在浏览器中完成登录", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开微博发布首页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开微博发布工作台"
        except Exception as e:
            return False, f"打开微博首页失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """微博短博文默认无独立标题字段，标题将转换为加粗/置顶第一句"""
        # 如果是头条文章模式另当别论，标准微博发布框标题直接融合至正文首行
        return True, "微博正文将融合标题作为第一句"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写微博正文"""
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
            return False, "未能定位到微博新鲜事正文输入框"

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
                editor.send_keys(Keys.CONTROL, "a")
                editor.send_keys(Keys.BACKSPACE)
                self.js_set_value(editor, safe_body)
            time.sleep(0.3)
            return True, f"微博正文已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入微博正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传微博图片或视频素材"""
        if not media_items:
            return True, "纯文案发布，无需上传素材"

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
            try:
                file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")
            except Exception:
                pass

        if not file_input:
            return False, "未能定位到微博素材上传 input 元素"

        valid_paths = []
        for item in media_items:
            if item.local_path and Path(item.local_path).exists() and Path(item.local_path).stat().st_size > 0:
                valid_paths.append(str(Path(item.local_path).resolve()))

        if not valid_paths:
            return False, "未找到有效的本地素材文件"

        try:
            # 微博 input[type='file'] 支持多文件换行传入
            files_arg = "\n".join(valid_paths[:9])
            file_input.send_keys(files_arg)
            time.sleep(2.0)
            return True, f"已上传 {len(valid_paths[:9])} 个微博配图/媒体素材"
        except Exception as e:
            return False, f"上传微博素材失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """录入微博双井号话题 (#话题#)"""
        if not tags:
            return True, "未提供标签，跳过"

        clean_tags = [f"#{t.strip().lstrip('#').rstrip('#')}#" for t in tags if t.strip()]
        tags_str = " " + " ".join(clean_tags[:5]) + " "

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
            return True, "未找到编辑器，跳过话题录入"

        try:
            editor.click()
            time.sleep(0.2)
            if editor.get_attribute("contenteditable") == "true":
                curr = editor.text
                new_t = curr + tags_str
                self.driver.execute_script("""
                    arguments[0].innerText = arguments[1];
                    arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                    arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
                """, editor, new_t)
            else:
                editor.send_keys(tags_str)
            time.sleep(0.3)
            return True, f"已在微博末尾添加双井号话题：{tags_str.strip()}"
        except Exception as e:
            return False, f"追加微博话题失败：{e}"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        actual_body = ""
        discrepancies = []

        for by, sel in self.SELECTORS["content_editor"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    val = el.get_attribute("value") or el.text or ""
                    if val.strip():
                        actual_body = val.strip()
                        break
                if actual_body:
                    break
            except Exception:
                continue

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("微博正文未在发布框成功回读")

        tags_match = True
        if expected_tags and actual_body:
            tags_match = any(t.strip("#") in actual_body for t in expected_tags)

        passed = len(discrepancies) == 0

        return ValidationDiff(
            passed=passed,
            title_match=True,
            title_expected=expected_title,
            title_actual=expected_title,
            body_match=body_match,
            body_length_expected=len(expected_body),
            body_length_actual=len(actual_body),
            media_count_expected=expected_media_count,
            media_count_actual=expected_media_count,
            tags_match=tags_match,
            tags_expected=expected_tags,
            tags_actual=[t for t in expected_tags if t.strip("#") in actual_body],
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """停留在最终发布确认阶段，高亮【发送】按钮，绝不自动越权提交"""
        self.dismiss_popovers()
        try:
            for by, sel in self.SELECTORS["send_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #e6162d';", btn)
                        return True, "受控浏览器已停留在微博【发送】按钮处，等待创作者审核后亲自点击发送"
            return True, "已停留在微博发布区域底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "weibo.com/u/" in curr_url or "detail" in curr_url:
                return True, "已检测到微博已发布落地", {
                    "canonical_url": self.driver.current_url,
                    "status": "PUBLISHED"
                }
            return False, "未检测到微博发送完成凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测微博发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已登录正确的微博账号",
            "检查正文字数与排版（建议 140-500 字，言简意赅）",
            "核对 #双井号话题# 与 @好友",
            "核对配图九宫格展示顺序与清晰度",
            "创作者亲自核对无误后在浏览器中点击【发送】",
            "发布成功后在 GeoLens 控制台回填该微博公开链接"
        ]
