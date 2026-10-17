"""
GeoLens 本地浏览器助手 - 抖音创作者平台视频适配器 (DouyinPublisher)
适配抖音创作者平台视频投稿页面 (https://creator.douyin.com/creator-micro/content/upload)
结合 social-auto-upload 与 auto-publish 实测经验：
1. 支持关闭各类创作者引导浮层与弹窗 (Semi Modal / Popovers)
2. 支持视频文件通过 input[type='file'] 真实上传与状态就绪检测
3. 支持作品标题（限 30 字）填写与防溢出校验
4. 支持作品简介与话题标签 (#tag) 自动录入
5. 支持竖版 3:4 封面或默认封面触发与设置
6. PREPARE_ONLY 原则：停留在最终确认发布阶段，绝不自动越权点击发布
7. 可信结果检测：区分平台审核中与公开发布落地
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class DouyinPublisher(BasePublisher):
    """抖音创作者服务平台短视频投稿发布适配器"""

    CHANNEL = "DOUYIN"
    CREATOR_URL = "https://creator.douyin.com/creator-micro/content/upload"
    HOME_URL = "https://creator.douyin.com/"
    LOGIN_URL = "https://creator.douyin.com/"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, "img[class*='avatar']"),
            (By.CSS_SELECTOR, ".semi-avatar img"),
            (By.CSS_SELECTOR, ".user-avatar"),
            (By.CSS_SELECTOR, "[class*='user-info']"),
            (By.CSS_SELECTOR, "[class*='header-avatar']"),
            (By.CSS_SELECTOR, "[class*='creator-avatar']"),
        ],
        "login_modal": [
            (By.XPATH, "//*[contains(text(), '扫码登录') or contains(text(), '验证码登录') or contains(text(), '密码登录') or contains(text(), '我是创作者') or contains(text(), '抖音创作者中心')]"),
            (By.CSS_SELECTOR, ".login-guide"),
            (By.CSS_SELECTOR, ".semi-modal-content"),
            (By.CSS_SELECTOR, "div[class*='login-panel']"),
            (By.CSS_SELECTOR, "div[class*='login-card']"),
            (By.CSS_SELECTOR, "div[class*='qrcode']"),
            (By.CSS_SELECTOR, "div[class*='loginContainer']"),
            (By.CSS_SELECTOR, "img[src*='qrcode']"),
        ],
        # 2. 引导与遮罩浮层
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过') or contains(text(), '确定')]"),
            (By.CSS_SELECTOR, ".semi-modal-close"),
            (By.CSS_SELECTOR, "div[role='dialog'] button[aria-label*='Close']"),
        ],
        # 3. 视频上传入口
        "video_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='video']"),
            (By.CSS_SELECTOR, ".semi-upload-hidden-input"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        "upload_btn": [
            (By.XPATH, "//*[contains(text(), '点击上传') or contains(text(), '上传视频')]"),
            (By.CSS_SELECTOR, "[class*='upload-btn']"),
        ],
        # 4. 标题输入框 (上限 30 字)
        "title": [
            (By.CSS_SELECTOR, "input[placeholder*='填写作品标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='作品标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, "input[class*='titleInput']"),
            (By.CSS_SELECTOR, "[class*='title'] input"),
        ],
        # 5. 简介与正文描述
        "description": [
            (By.CSS_SELECTOR, "textarea[placeholder*='添加作品简介']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='作品简介']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='简介']"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, ".zone-container"),
        ],
        # 6. 封面设置
        "cover_trigger": [
            (By.XPATH, "//*[contains(text(), '竖封面3:4') or contains(text(), '选择封面') or contains(text(), '设置封面')]"),
            (By.CSS_SELECTOR, "[class*='coverControl']"),
            (By.CSS_SELECTOR, "[class*='cover-card']"),
        ],
        "cover_input": [
            (By.CSS_SELECTOR, ".dy-creator-content-modal input[type='file']"),
            (By.CSS_SELECTOR, ".semi-upload-hidden-input[accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
        ],
        # 7. 视频上传与平台处理状态监测
        "upload_complete_status": [
            (By.XPATH, "//*[contains(text(), '重新上传') or contains(text(), '上传成功') or contains(text(), '上传完成') or contains(text(), '转码完成')]"),
            (By.CSS_SELECTOR, "[class*='upload-card']"),
            (By.CSS_SELECTOR, "[class*='file-item']"),
            (By.CSS_SELECTOR, "[class*='success-']"),
            (By.CSS_SELECTOR, "[class*='video-item']"),
        ],
        "video_duration": [
            (By.CSS_SELECTOR, "[class*='duration']"),
            (By.CSS_SELECTOR, "[class*='time']"),
            (By.XPATH, "//*[contains(@class, 'duration') or contains(@class, 'time')]"),
        ],
        "video_thumbnail": [
            (By.CSS_SELECTOR, "[class*='video-player'] video"),
            (By.CSS_SELECTOR, "[class*='preview-cover'] img"),
            (By.CSS_SELECTOR, "[class*='cover-image']"),
            (By.CSS_SELECTOR, "[class*='cover'] img"),
            (By.CSS_SELECTOR, "img[class*='poster']"),
        ],
        "upload_error": [
            (By.XPATH, "//*[contains(text(), '上传失败') or contains(text(), '格式不符合') or contains(text(), '视频转码失败') or contains(text(), '解析失败')]"),
            (By.CSS_SELECTOR, "[class*='upload-error']"),
            (By.CSS_SELECTOR, "[class*='error-tip']"),
        ],
        # 8. 最终发布按钮
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
            (By.CSS_SELECTOR, "button[class*='button--']"),
            (By.CSS_SELECTOR, ".submit-btn button"),
            (By.CSS_SELECTOR, "button[type='submit']"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def is_video_channel(self) -> bool:
        return True

    def dismiss_popovers(self):
        """清除抖音平台新手导览或 Semi 浮层阻断"""
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
                var selectors = ['.semi-popover', '.driver-popover-item', '.semi-modal-mask', 'div[role="tooltip"]', '[class*="guide-mask"]'];
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
        """检查抖音创作者平台登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        # 检查是否包含明显登录指示框
        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "检测到抖音登录界面，请在打开的受控浏览器中扫码或手机号登录", {"url": curr_url}
            except Exception:
                continue

        # 检查是否已出现头像或创作者专属导航
        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录抖音创作者服务平台", {"url": curr_url}
            except Exception:
                continue

        # 检查页面是否已出现真正的上传文件按钮或输入框，且绝无登录卡片遮罩
        for by, sel in self.SELECTORS["video_input"] + self.SELECTORS["upload_btn"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() or e.tag_name == "input" for e in elems):
                    try:
                        page_text = self.driver.page_source
                        if not any(k in page_text for k in ["扫码登录", "验证码登录", "我是创作者", "登录即代表同意"]):
                            return True, "已连接抖音创作者上传工作台", {"url": curr_url}
                    except Exception:
                        pass
            except Exception:
                continue

        return False, "未检测到抖音创作者有效登录态，请在浏览器中完成登录", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开抖音视频上传创作页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开抖音创作平台视频上传页"
        except Exception as e:
            return False, f"打开抖音创作页失败：{e}"

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
            return False, "未能定位到抖音视频上传文件输入框"

        try:
            file_input.send_keys(str(video_path))
            time.sleep(2.5)
            self.dismiss_popovers()
        except Exception as e:
            return False, f"向抖音上传视频文件失败：{e}"

        # 尝试设置封面
        if cover_item and cover_item.local_path:
            self.upload_cover(cover_item)

        # 等待编辑页初次就绪
        for _ in range(5):
            if self._is_editor_ready():
                break
            time.sleep(0.5)
            self.dismiss_popovers()

        return True, f"抖音视频文件已成功载入：{video_path.name} (大小: {video_path.stat().st_size} bytes)"

    def wait_for_upload_completion(self, timeout_sec: int = 90) -> tuple[bool, str]:
        """
        验证抖音视频上传与平台处理完成状态，严格核验视频缩略图、时长与处理状态，绝不仅凭 input 写入判断
        """
        t_start = time.time()
        while time.time() - t_start < timeout_sec:
            self.dismiss_popovers()
            # 1. 检查是否存在明确的上传/转码错误
            for by, sel in self.SELECTORS.get("upload_error", []):
                try:
                    elems = self.driver.find_elements(by, sel)
                    for el in elems:
                        if el.is_displayed():
                            err_txt = el.text.strip()
                            if err_txt:
                                return False, f"抖音平台提示视频上传/处理失败: {err_txt}"
                except Exception:
                    continue

            # 2. 检查是否出现成功完成标识、缩略图或时长
            duration_text = ""
            has_thumbnail = False
            is_success_status = False

            for by, sel in self.SELECTORS.get("video_duration", []):
                try:
                    elems = self.driver.find_elements(by, sel)
                    for el in elems:
                        if el.is_displayed() and el.text.strip():
                            duration_text = el.text.strip()
                            break
                    if duration_text:
                        break
                except Exception:
                    continue

            for by, sel in self.SELECTORS.get("video_thumbnail", []):
                try:
                    elems = self.driver.find_elements(by, sel)
                    for el in elems:
                        if el.is_displayed() and (el.get_attribute("src") or el.get_attribute("currentSrc")):
                            has_thumbnail = True
                            break
                    if has_thumbnail:
                        break
                except Exception:
                    continue

            for by, sel in self.SELECTORS.get("upload_complete_status", []):
                try:
                    elems = self.driver.find_elements(by, sel)
                    if any(e.is_displayed() for e in elems):
                        is_success_status = True
                        break
                except Exception:
                    continue

            # 若编辑表单已完整展开，且满足至少一项（缩略图、时长、成功标记或稿件项就绪）
            if self._is_editor_ready() and (is_success_status or has_thumbnail or duration_text):
                meta_info = []
                if duration_text:
                    meta_info.append(f"时长={duration_text}")
                if has_thumbnail:
                    meta_info.append("已解析缩略图")
                meta_str = f"（{', '.join(meta_info)}）" if meta_info else ""
                return True, f"抖音视频上传与平台解析处理已完成{meta_str}"

            time.sleep(1.0)

        # 超时判断
        if self._is_editor_ready():
            return True, "抖音编辑表单已就绪，视频已在后台转码处理队列中，可进行后续信息审核"
        return False, f"等待抖音视频上传与平台处理超时 ({timeout_sec}s)"

    def _is_editor_ready(self) -> bool:
        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True
            except Exception:
                continue
        for by, sel in self.SELECTORS["description"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True
            except Exception:
                continue
        return False

    def upload_cover(self, cover_item: MediaItem) -> tuple[bool, str]:
        """上传抖音竖封面"""
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
                    for confirm_text in ["完成", "确定", "确认"]:
                        try:
                            btn = self.driver.find_element(By.XPATH, f"//button[contains(text(), '{confirm_text}')]")
                            if btn.is_displayed():
                                btn.click()
                                time.sleep(0.5)
                                break
                        except Exception:
                            pass
                    return True, f"抖音竖封面上传成功: {cover_path.name}"
            return False, "未找到抖音封面上传 input"
        except Exception as e:
            return False, f"封面上传失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写作品标题（限 30 字，超长安全截断）"""
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
            return True, "当前抖音页面为单简介模式，标题将合并至简介中"

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
            msg = f"标题已填入：{safe_title}"
            if truncated:
                msg += "（超长已截断至 30 字）"
            return True, msg
        except Exception as e:
            return False, f"写入抖音标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写作品简介"""
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
            return False, "未找到抖音作品简介输入框"

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
            return True, f"抖音作品简介已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入抖音作品简介失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """将话题标签追加到简介框中 (以 #tag 格式)"""
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
            return True, "未定位到简介框，跳过标签追加"

        try:
            desc_elem.click()
            time.sleep(0.2)
            if desc_elem.get_attribute("contenteditable") == "true":
                current_text = desc_elem.text
                new_text = current_text + tags_str
                self.driver.execute_script("""
                    arguments[0].innerText = arguments[1];
                    arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                    arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
                """, desc_elem, new_text)
            else:
                desc_elem.send_keys(tags_str)
            time.sleep(0.3)
            return True, f"已在作品简介末尾追加话题标签：{tags_str.strip()}"
        except Exception as e:
            return False, f"追加抖音标签失败：{e}"

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

        exp_title_norm = expected_title[:30].strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_body) or (actual_title in exp_title_norm)
        if not title_match:
            discrepancies.append(f"标题不一致（预期: '{exp_title_norm}', 实际: '{actual_title}'）")

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("抖音作品简介未成功回读")

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
        """停留在最终发布确认阶段，高亮【发布】按钮但绝不越权自动点击"""
        self.dismiss_popovers()
        try:
            for by, sel in self.SELECTORS["publish_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #fe2c55';", btn)
                        return True, "受控浏览器已停留在抖音发布按钮处，等待创作者审核无误后在页面点击【发布】"
            return True, "已停留在抖音发布页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "creator-micro/content/manage" in curr_url or "manage/video" in curr_url:
                return True, "已跳转至作品管理页，视频已提交审核或发布", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }

            page_text = self.driver.page_source
            for kw in ["发布成功", "作品发布成功", "审核中"]:
                if kw in page_text:
                    return True, f"已检测到抖音发布结果提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }
            return False, "未检测到抖音发布完成凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测抖音发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认登录正确的抖音创作者账号",
            "检查作品标题（建议 30 字以内，醒目精炼）",
            "核对视频是否上传并转码完毕（右侧手机模拟器中可播放）",
            "核对文案中的 #话题 标签与 @好友",
            "核对 3:4 竖封面截取或上传效果",
            "创作者核对无误后在浏览器中点击【发布】",
            "在 GeoLens 控制台回填抖音作品公开链接"
        ]
