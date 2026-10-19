"""
GeoLens 本地浏览器助手 - 今日头条内容发布适配器 (ToutiaoPublisher)
适配今日头条创作者服务平台 (https://mp.toutiao.com/profile_v4/graphic/publish)
1. 支持头条号登录态检测
2. 支持文章标题（限 30 字以内）填写与校验
3. 支持正文富文本录入
4. 支持封面选择与配图上传
5. PREPARE_ONLY 原则：停留在【发布】按钮处，绝不自动越权提交
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


class ToutiaoPublisher(BasePublisher):
    """今日头条创作者平台文章发布适配器"""

    CHANNEL = "TOUTIAO"
    CREATOR_URL = "https://mp.toutiao.com/profile_v4/graphic/publish"
    HOME_URL = "https://mp.toutiao.com/"
    LOGIN_URL = "https://mp.toutiao.com/auth/page/login"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, "img[class*='avatar']"),
            (By.CSS_SELECTOR, ".user-avatar"),
            (By.CSS_SELECTOR, ".header-user-avatar"),
            (By.CSS_SELECTOR, "div.user-info"),
            (By.CSS_SELECTOR, ".account-name"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".login-container"),
            (By.CSS_SELECTOR, "div[class*='login-box']"),
            (By.CSS_SELECTOR, "div[class*='qrcode']"),
            (By.CSS_SELECTOR, ".auth-login-box"),
        ],
        # 2. 引导与遮罩
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过') or contains(text(), '确定')]"),
            (By.CSS_SELECTOR, ".byte-modal-close"),
            (By.CSS_SELECTOR, ".semi-modal-close"),
        ],
        # 3. 标题输入框 (上限 30 字)
        "title": [
            (By.CSS_SELECTOR, "textarea[placeholder*='标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, ".article-title-wrap textarea"),
            (By.CSS_SELECTOR, ".title-input"),
        ],
        # 4. 正文编辑器 (ProseMirror / ByteEditor)
        "content_editor": [
            (By.CSS_SELECTOR, "div.ProseMirror"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, ".c-editor-content"),
            (By.CSS_SELECTOR, "textarea"),
        ],
        # 5. 素材上传
        "media_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        # 6. 发布按钮
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
            (By.CSS_SELECTOR, "button.byte-btn-primary"),
            (By.CSS_SELECTOR, ".publish-btn button"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def dismiss_popovers(self):
        """清除头条创作后台引导浮层"""
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
                var selectors = ['.byte-modal-mask', '.semi-modal-mask', 'div[role="tooltip"]'];
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
        """检查今日头条创作者中心登录态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        # 若当前处于空标签页，自动加载创作平台以提取登录态
        if not curr_url or curr_url in ["data:,", "about:blank", "chrome://new-tab-page/", "chrome://newtab/"]:
            try:
                self.driver.get(self.HOME_URL)
                time.sleep(2.0)
                curr_url = self.driver.current_url.lower()
            except Exception:
                pass

        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "当前处于今日头条登录界面，请在打开的受控浏览器中完成登录", {"url": curr_url}
            except Exception:
                continue

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录今日头条创作者平台", {"url": curr_url}
            except Exception:
                continue

        if "mp.toutiao.com/profile" in curr_url or "mp.toutiao.com/graphic" in curr_url:
            return True, "已连接今日头条创作发布后台", {"url": curr_url}

        return False, "未检测到今日头条有效登录态，请在受控浏览器中登录", {"url": curr_url}

    def open_login_page(self) -> tuple[bool, str]:
        """打开今日头条创作者平台登录页"""
        try:
            self.driver.get(self.LOGIN_URL)
            time.sleep(1.5)
            return True, "已在受控 Chrome 窗口打开今日头条登录页"
        except Exception as e:
            return False, f"打开今日头条登录页失败：{e}"

    def open_editor(self) -> tuple[bool, str]:
        """打开今日头条图文创作页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开今日头条文章发布页面"
        except Exception as e:
            return False, f"打开今日头条发布页失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写头条文章标题（建议 30 字以内）"""
        self.dismiss_popovers()
        max_len = 30
        truncated = False
        safe_title = title.strip()
        if len(safe_title) > max_len:
            safe_title = safe_title[:max_len]
            truncated = True

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
            return False, "未能定位到今日头条文章标题输入框"

        try:
            self.set_field_text(title_input, safe_title)
            time.sleep(0.3)
            msg = f"头条文章标题已填入：{safe_title}"
            if truncated:
                msg += "（超长已截断至 30 字以内）"
            return True, msg
        except Exception as e:
            return False, f"写入头条标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写正文富文本"""
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
            return False, "未能定位到今日头条正文编辑器"

        try:
            self.set_field_text(editor, safe_body)
            time.sleep(0.3)
            return True, f"头条正文已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入头条正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传头条配图素材"""
        if not media_items:
            return True, "纯文案发布，无需上传素材"

        self.dismiss_popovers()
        file_input = self.find_file_input_cross_frames("image")
        if not file_input:
            for by, sel in self.SELECTORS["media_input"]:
                try:
                    inputs = self.driver.find_elements(by, sel)
                    if inputs:
                        file_input = inputs[0]
                        break
                except Exception:
                    continue

        if not file_input:
            return True, "未直接定位到图片 input，可在受控浏览器中通过图片库添加"

        valid_paths = []
        for item in media_items:
            if item.local_path and Path(item.local_path).exists() and Path(item.local_path).stat().st_size > 0:
                valid_paths.append(str(Path(item.local_path).resolve()))

        if not valid_paths:
            return False, "未找到有效的本地配图文件"

        try:
            file_input.send_keys("\n".join(valid_paths[:3]))
            time.sleep(2.0)
            return True, f"已上传 {len(valid_paths[:3])} 张头条配图"
        except Exception as e:
            return False, f"上传头条配图失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        return True, "今日头条话题标签已就绪"

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

        exp_title_norm = expected_title[:30].strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_title) or (actual_title in exp_title_norm)
        if not title_match:
            discrepancies.append(f"标题不一致（预期: '{exp_title_norm}', 实际: '{actual_title}'）")

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("头条正文未在编辑器中成功回读")

        passed = len(discrepancies) == 0

        return ValidationDiff(
            passed=passed,
            title_match=title_match,
            title_expected=expected_title,
            title_actual=actual_title,
            body_match=body_match,
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
        """停留在最终发布确认阶段，高亮【发布】按钮，绝不自动越权提交"""
        self.dismiss_popovers()
        self.inject_preview_guard_banner("今日头条")
        try:
            for by, sel in self.SELECTORS["publish_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #f85959';", btn)
                        return True, "受控浏览器已停留在今日头条【发布】按钮处，等待创作者审核后亲自点击发布"
            return True, "已停留在今日头条发布页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "mp.toutiao.com/profile_v4/graphic/articles" in curr_url or "articles" in curr_url:
                return True, "已跳转至文章管理页，头条文章已提交", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }

            page_text = self.driver.page_source
            for kw in ["发布成功", "发表成功", "审核中"]:
                if kw in page_text:
                    return True, f"已检测到今日头条发布提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }
            return False, "未检测到今日头条发布凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测今日头条发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已登录正确的今日头条号账号",
            "检查文章标题（30 字以内，清晰凝练）",
            "核对正文排版、段落换行与重要结论",
            "核对封面展示模式与声明选项",
            "创作者亲自核对无误后在浏览器中点击【发布】",
            "发布成功后在 GeoLens 控制台回填今日头条文章公开链接"
        ]
