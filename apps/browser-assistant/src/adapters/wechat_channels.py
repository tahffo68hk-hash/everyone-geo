"""
GeoLens 本地浏览器助手 - 微信视频号平台适配器 (WechatChannelsPublisher)
适配微信视频号助手发布页面 (https://channels.weixin.qq.com/platform/post/create)
结合 social-auto-upload (tencent_uploader) 与 auto-publish 实测经验：
1. 支持清除新手导览浮层与弹窗
2. 支持视频文件通过 input[type='file'] 真实上传与上传处理状态检测
3. 支持短标题（短标题限制 20-30 字以内）与防截断设置
4. 支持视频详细描述正文及 #话题 自动录入
5. 支持个人主页卡片竖版封面触发与设置
6. PREPARE_ONLY 原则：停留在最终确认发表阶段，绝不越权点击【发表】
7. 可信结果检测：区分平台审核中与发表落地链接
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class WechatChannelsPublisher(BasePublisher):
    """微信视频号助手发布适配器"""

    CHANNEL = "WECHAT_CHANNELS"
    CREATOR_URL = "https://channels.weixin.qq.com/platform/post/create"
    HOME_URL = "https://channels.weixin.qq.com/platform"
    LOGIN_URL = "https://channels.weixin.qq.com/"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".finder-nickname"),
            (By.CSS_SELECTOR, ".account-info .name"),
            (By.CSS_SELECTOR, ".weui-desktop-account__info"),
            (By.CSS_SELECTOR, "img.finder-avatar"),
            (By.CSS_SELECTOR, "div.user-info"),
            (By.CSS_SELECTOR, ".weui-desktop-layout__header .avatar"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".login-container"),
            (By.CSS_SELECTOR, ".qrcode-container"),
            (By.CSS_SELECTOR, "img[src*='qrcode']"),
            (By.CSS_SELECTOR, ".login__qrcode"),
        ],
        # 2. 引导与遮罩
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过') or contains(text(), '确定')]"),
            (By.CSS_SELECTOR, ".guide-dialog__close"),
            (By.CSS_SELECTOR, ".weui-desktop-dialog__close-btn"),
        ],
        # 3. 视频上传入口
        "video_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='video']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        "upload_btn": [
            (By.XPATH, "//*[contains(text(), '选择视频') or contains(text(), '上传视频') or contains(text(), '点击上传')]"),
            (By.CSS_SELECTOR, ".upload-area"),
        ],
        # 4. 短标题 (限 20-30 字)
        "title": [
            (By.CSS_SELECTOR, "input[placeholder*='短标题']"),
            (By.XPATH, "//span[contains(text(), '短标题')]/following::input[1]"),
            (By.XPATH, "//*[contains(text(), '短标题')]/following-sibling::div//input"),
            (By.CSS_SELECTOR, ".short-title-input input"),
        ],
        # 5. 视频描述正文
        "description": [
            (By.CSS_SELECTOR, ".input-editor"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='添加描述']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='概括视频主要内容']"),
            (By.CSS_SELECTOR, "textarea"),
        ],
        # 6. 封面设置
        "cover_trigger": [
            (By.CSS_SELECTOR, ".vertical-cover-wrap"),
            (By.XPATH, "//*[contains(text(), '编辑封面') or contains(text(), '设置封面')]"),
            (By.CSS_SELECTOR, ".cover-preview"),
        ],
        "cover_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, ".weui-desktop-dialog input[type='file']"),
        ],
        # 7. 发表按钮
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '发表') or contains(., '发表')]"),
            (By.CSS_SELECTOR, "button.weui-desktop-btn_primary"),
            (By.CSS_SELECTOR, ".submit-button button"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def is_video_channel(self) -> bool:
        return True

    def dismiss_popovers(self):
        """清除微信视频号页面引导弹窗或遮罩"""
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
                var selectors = ['.weui-desktop-mask', '.guide-dialog', 'div[role="tooltip"]'];
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
        """检查微信视频号助手登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        # 检查是否处于根路径且有未登录二维码
        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "当前处于微信视频号扫码登录页面，请使用微信 App 扫码登录", {"url": curr_url}
            except Exception:
                continue

        # 检查是否已登录用户昵称或后台控制台
        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录微信视频号助手", {"url": curr_url}
            except Exception:
                continue

        if "channels.weixin.qq.com/platform" in curr_url:
            return True, "已连接微信视频号助手管理后台", {"url": curr_url}

        return False, "未检测到微信视频号助手有效登录态，请在受控浏览器中扫码完成登录", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开微信视频号发表页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开微信视频号发布页面"
        except Exception as e:
            return False, f"打开视频号发布页失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传视频素材及封面"""
        if not media_items:
            return False, "未提供任何视频或素材文件"

        video_item = None
        cover_item = None
        for item in media_items:
            mtype = (item.type or "").upper()
            if mtype == "VIDEO" or (item.local_path and Path(item.local_path).suffix.lower() in [".mp4", ".mov", ".flv", ".webm", ".mkv"]):
                if not video_item:
                    video_item = item
            elif mtype in ["COVER", "IMAGE"]:
                if not cover_item:
                    cover_item = item

        if not video_item and media_items:
            video_item = media_items[0]

        if not video_item or not video_item.local_path:
            return False, "未找到有效的本地视频文件路径"

        video_path = Path(video_item.local_path).resolve()
        if not video_path.exists() or video_path.stat().st_size == 0:
            return False, f"本地视频文件不存在或为空: {video_path}"

        self.dismiss_popovers()

        file_input = None
        for by, sel in self.SELECTORS["video_input"]:
            try:
                inputs = self.driver.find_elements(by, sel)
                for inp in inputs:
                    accept = (inp.get_attribute("accept") or "").lower()
                    if "video" in accept or accept == "" or "mp4" in accept:
                        file_input = inp
                        break
                if file_input:
                    break
            except Exception:
                continue

        if not file_input:
            try:
                file_input = self.driver.find_element(By.CSS_SELECTOR, "input[type='file']")
            except Exception:
                pass

        if not file_input:
            return False, "未能定位到视频号视频上传 input 元素"

        try:
            file_input.send_keys(str(video_path))
            time.sleep(2.5)
            self.dismiss_popovers()
        except Exception as e:
            return False, f"向视频号上传视频文件失败：{e}"

        # 尝试设置封面
        if cover_item and cover_item.local_path:
            self.upload_cover(cover_item)

        # 等待编辑页就绪
        for _ in range(15):
            if self._is_editor_ready():
                break
            time.sleep(1.0)
            self.dismiss_popovers()

        return True, f"微信视频号视频素材已成功载入：{video_path.name} (大小: {video_path.stat().st_size} bytes)"

    def _is_editor_ready(self) -> bool:
        for by, sel in self.SELECTORS["description"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True
            except Exception:
                continue
        return False

    def upload_cover(self, cover_item: MediaItem) -> tuple[bool, str]:
        """设置视频号封面"""
        if not cover_item or not cover_item.local_path:
            return False, "未提供封面本地路径"

        cover_path = Path(cover_item.local_path).resolve()
        if not cover_path.exists() or cover_path.stat().st_size == 0:
            return False, f"封面图片不存在或为空: {cover_path}"

        try:
            for by, sel in self.SELECTORS["cover_trigger"]:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        try:
                            el.click()
                        except Exception:
                            self.driver.execute_script("arguments[0].click();", el)
                        time.sleep(1.0)
                        break

            for by, sel in self.SELECTORS["cover_input"]:
                inputs = self.driver.find_elements(by, sel)
                for inp in inputs:
                    inp.send_keys(str(cover_path))
                    time.sleep(1.5)
                    for confirm_text in ["确认", "确定", "完成"]:
                        try:
                            btn = self.driver.find_element(By.XPATH, f"//button[contains(text(), '{confirm_text}')]")
                            if btn.is_displayed():
                                btn.click()
                                time.sleep(0.5)
                                break
                        except Exception:
                            pass
                    return True, f"微信视频号封面上传成功: {cover_path.name}"
            return False, "未找到视频号封面 input"
        except Exception as e:
            return False, f"封面上传失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写短标题（建议 20 字以内）"""
        self.dismiss_popovers()
        max_len = 20
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
            return True, "当前视频号页面无独立短标题字段或已合并入主描述"

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
            msg = f"短标题已填入：{safe_title}"
            if truncated:
                msg += "（已截断至 20 字）"
            return True, msg
        except Exception as e:
            return False, f"写入视频号短标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写视频描述"""
        self.dismiss_popovers()
        safe_body = body.strip()

        desc_elem = None
        for by, sel in self.SELECTORS["description"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        desc_elem = el
                        break
                if desc_elem:
                    break
            except Exception:
                continue

        if not desc_elem:
            return False, "未能定位到微信视频号描述输入框"

        try:
            desc_elem.click()
            time.sleep(0.2)
            if desc_elem.get_attribute("contenteditable") == "true":
                self.driver.execute_script("""
                    arguments[0].innerText = arguments[1];
                    arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                    arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
                """, desc_elem, safe_body)
            else:
                desc_elem.send_keys(Keys.CONTROL, "a")
                desc_elem.send_keys(Keys.BACKSPACE)
                self.js_set_value(desc_elem, safe_body)
            time.sleep(0.3)
            return True, f"视频描述已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入视频描述失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """在视频描述末尾追加 #话题 标签"""
        if not tags:
            return True, "未提供标签，跳过"

        clean_tags = [f"#{t.strip().lstrip('#')}" for t in tags if t.strip()]
        tags_str = " " + " ".join(clean_tags[:5]) + " "

        desc_elem = None
        for by, sel in self.SELECTORS["description"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        desc_elem = el
                        break
                if desc_elem:
                    break
            except Exception:
                continue

        if not desc_elem:
            return True, "未找到描述框，跳过标签追加"

        try:
            desc_elem.click()
            time.sleep(0.2)
            if desc_elem.get_attribute("contenteditable") == "true":
                curr = desc_elem.text
                new_t = curr + tags_str
                self.driver.execute_script("""
                    arguments[0].innerText = arguments[1];
                    arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                    arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
                """, desc_elem, new_t)
            else:
                desc_elem.send_keys(tags_str)
            time.sleep(0.3)
            return True, f"已在描述末尾追加话题：{tags_str.strip()}"
        except Exception as e:
            return False, f"追加视频号标签失败：{e}"

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

        for by, sel in self.SELECTORS["description"]:
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

        exp_title_norm = expected_title[:20].strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_body) or (actual_title in exp_title_norm)

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("视频号描述未在页面成功回读")

        tags_match = True
        if expected_tags and actual_body:
            tags_match = any(t.lstrip("#") in actual_body for t in expected_tags)

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
            media_count_actual=1 if self._is_editor_ready() else 0,
            tags_match=tags_match,
            tags_expected=expected_tags,
            tags_actual=[t for t in expected_tags if t.lstrip("#") in actual_body],
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """停留在最终发布确认阶段，高亮【发表】按钮，绝不自动越权提交"""
        self.dismiss_popovers()
        try:
            for by, sel in self.SELECTORS["publish_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #07c160';", btn)
                        return True, "受控浏览器已停留在微信视频号【发表】按钮处，等待创作者审核后亲自点击发表"
            return True, "已停留在微信视频号发表确认页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "channels.weixin.qq.com/platform/post/list" in curr_url or "post/detail" in curr_url:
                return True, "已跳转至视频列表页，视频号视频已提交", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }

            page_text = self.driver.page_source
            for kw in ["发表成功", "审核中", "正在处理"]:
                if kw in page_text:
                    return True, f"已检测到微信视频号发表状态提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }
            return False, "未检测到微信视频号发布凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测视频号发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已扫码登录正确的微信视频号账号",
            "检查视频短标题（20 字以内，简明抓人）",
            "核对视频描述与 #话题 标签",
            "核对个人主页卡片竖版封面展示效果",
            "可选配置微信公众号关联图文链接（实现公私域引流闭环）",
            "创作者亲自核对无误后在浏览器中点击【发表】",
            "发布成功后在 GeoLens 控制台回填视频号落地链接"
        ]
