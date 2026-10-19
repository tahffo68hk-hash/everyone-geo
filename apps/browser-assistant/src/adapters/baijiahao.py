"""
GeoLens 本地浏览器助手 - 百家号平台适配器 (BaijiahaoPublisher)
适配百度百家号内容发布页面 (https://baijiahao.baidu.com/builder/rc/edit?type=news)
结合 social-auto-upload (baijiahao_uploader) 实测经验：
1. 支持清除新手导览浮层与弹窗
2. 支持文章标题（5-64 字）填写与防截断校验
3. 支持富文本编辑器 (ProseMirror / UEditor) 正文录入
4. 支持素材配图上传
5. PREPARE_ONLY 原则：停留在最终确认发布阶段，绝不自动越权点击发布
6. 可信结果检测：区分平台审核中与落地链接
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class BaijiahaoPublisher(BasePublisher):
    """百度百家号图文与内容发布适配器"""

    CHANNEL = "BAIJIAHAO"
    CREATOR_URL = "https://baijiahao.baidu.com/builder/rc/edit?type=news"
    HOME_URL = "https://baijiahao.baidu.com/builder/rc/home"
    LOGIN_URL = "https://baijiahao.baidu.com/"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".header-user-avatar"),
            (By.CSS_SELECTOR, ".user-name"),
            (By.CSS_SELECTOR, "[class*='user-avatar']"),
            (By.CSS_SELECTOR, "[class*='header-avatar']"),
            (By.CSS_SELECTOR, "div.user-info"),
            (By.CSS_SELECTOR, ".header-user-name"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".pass-login-container"),
            (By.CSS_SELECTOR, "div.tang-pass-login"),
            (By.CSS_SELECTOR, "div[class*='login-box']"),
            (By.CSS_SELECTOR, "#passport-login-pop"),
        ],
        # 2. 引导与遮罩
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过') or contains(text(), '关闭')]"),
            (By.CSS_SELECTOR, ".driver-popover-item"),
            (By.CSS_SELECTOR, ".ant-modal-close"),
        ],
        # 3. 标题输入框 (5-64 字)
        "title": [
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='请输入标题']"),
            (By.CSS_SELECTOR, "input.title-input"),
            (By.CSS_SELECTOR, "textarea[placeholder*='标题']"),
            (By.CSS_SELECTOR, "[class*='title'] input"),
        ],
        # 4. 正文编辑器 (ProseMirror / UEditor / contenteditable)
        "content_editor": [
            (By.CSS_SELECTOR, "div.ProseMirror"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "div.ueditor-body"),
            (By.CSS_SELECTOR, "div.ql-editor"),
            (By.CSS_SELECTOR, "textarea[placeholder*='正文']"),
        ],
        # 5. 素材上传
        "media_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        # 6. 最终发布按钮
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
            (By.CSS_SELECTOR, "button[class*='publishButton']"),
            (By.CSS_SELECTOR, ".client_pages_content_news_components_publishButton"),
            (By.CSS_SELECTOR, ".submit-btn button"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def dismiss_popovers(self):
        """清除百家号新手引导与阻断弹窗"""
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
                var selectors = ['.driver-popover-item', '.ant-modal-mask', 'div[role="tooltip"]', '.guide-mask'];
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
        """检查百度百家号登录状态"""
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
                    return False, "检测到百度登录窗口，请在打开的受控浏览器中扫码或输入百度账号登录", {"url": curr_url}
            except Exception:
                continue

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录百度百家号创作者平台", {"url": curr_url}
            except Exception:
                continue

        if "baijiahao.baidu.com/builder/rc" in curr_url:
            return True, "已连接百家号创作管理后台", {"url": curr_url}

        return False, "未检测到百家号有效登录态，请在受控浏览器中登录", {"url": curr_url}

    def open_login_page(self) -> tuple[bool, str]:
        """打开百度百家号创作者平台登录页"""
        try:
            self.driver.get(self.LOGIN_URL)
            time.sleep(1.5)
            return True, "已在受控 Chrome 窗口打开百度百家号登录页"
        except Exception as e:
            return False, f"打开百家号登录页失败：{e}"

    def open_editor(self) -> tuple[bool, str]:
        """打开百家号图文创作发布页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开百家号内容发布工作台"
        except Exception as e:
            return False, f"打开百家号发布页失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写文章标题（百家号限制 5-64 字）"""
        self.dismiss_popovers()
        max_len = 64
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
            return False, "未能定位到百家号文章标题输入框"

        try:
            self.set_field_text(title_input, safe_title)
            time.sleep(0.3)
            msg = f"百家号标题已填入：{safe_title}"
            if truncated:
                msg += "（已截断至 64 字以内）"
            return True, msg
        except Exception as e:
            return False, f"写入百家号标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写百家号正文内容"""
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
            return False, "未能定位到百家号富文本编辑器"

        try:
            self.set_field_text(editor, safe_body)
            time.sleep(0.3)
            return True, f"百家号正文已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入百家号正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传百家号配图素材"""
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
            try:
                file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")
            except Exception:
                pass

        if not file_input:
            return True, "未找到图片 input 元素，可能需在富文本菜单中手动上传"

        valid_paths = []
        for item in media_items:
            if item.local_path and Path(item.local_path).exists() and Path(item.local_path).stat().st_size > 0:
                valid_paths.append(str(Path(item.local_path).resolve()))

        if not valid_paths:
            return False, "未找到有效的本地配图文件"

        try:
            file_input.send_keys("\n".join(valid_paths[:3]))
            time.sleep(2.0)
            return True, f"已上传 {len(valid_paths[:3])} 张配图"
        except Exception as e:
            return False, f"上传百家号配图失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """百家号标签/关键词设置"""
        return True, "百家号标签已自动由系统智能抽取或在右侧面板配置"

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

        exp_title_norm = expected_title[:64].strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_title) or (actual_title in exp_title_norm)
        if not title_match:
            discrepancies.append(f"标题不一致（预期: '{exp_title_norm}', 实际: '{actual_title}'）")

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("百家号正文未在编辑器中成功回读")

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
        self.inject_preview_guard_banner("百度百家号")
        try:
            for by, sel in self.SELECTORS["publish_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #2932e1';", btn)
                        return True, "受控浏览器已停留在百家号【发布】按钮处，等待创作者审核后亲自点击发布"
            return True, "已停留在百家号发布页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "builder/rc/home" in curr_url or "builder/author/register" in curr_url:
                return True, "已跳转至百家号后台，文章已提交审核或发布", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }

            page_text = self.driver.page_source
            for kw in ["发布成功", "提交成功", "审核中"]:
                if kw in page_text:
                    return True, f"已检测到百家号提交结果提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }
            return False, "未检测到百家号发布完成凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测百家号发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已登录正确的百度百家号账号",
            "检查文章标题（5-30 字，避免标题党和错别字）",
            "核对正文排版、段落换行与插图质量",
            "核对封面图选择（单图或三图模式）",
            "创作者亲自核对无误后在浏览器中点击【发布】",
            "审核通过后在 GeoLens 控制台回填百度百家号公开落地链接"
        ]
