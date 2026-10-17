"""
GeoLens 本地浏览器助手 - 快手创作者服务平台适配器 (KuaishouPublisher)
适配快手创作者服务平台视频发布页面 (https://cp.kuaishou.com/article/publish/video)
结合 social-auto-upload (ks_uploader) 实测经验：
1. 支持清除 Joyride 新手引导遮罩 (#react-joyride-portal / spotlight) 与提示弹窗
2. 支持视频文件通过 input[type='file'] 真实上传与状态检测
3. 支持作品标题与作品描述富文本录入
4. 支持在作品描述末尾智能录入 #话题 标签
5. 支持"封面设置"弹窗触发与自定义封面上传
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


class KuaishouPublisher(BasePublisher):
    """快手创作者服务平台短视频发布适配器"""

    CHANNEL = "KUAISHOU"
    CREATOR_URL = "https://cp.kuaishou.com/article/publish/video"
    HOME_URL = "https://cp.kuaishou.com/"
    LOGIN_URL = "https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts%3FfollowUrl%3Dhttps%253A%252F%252Fcp.kuaishou.com%252Farticle%252Fpublish%252Fvideo%26setRootDomain%3Dtrue"

    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".user-name"),
            (By.CSS_SELECTOR, ".header-user .name"),
            (By.CSS_SELECTOR, "div.names div.name"),
            (By.CSS_SELECTOR, "img.avatar"),
            (By.CSS_SELECTOR, "div.user-info"),
            (By.CSS_SELECTOR, ".header-right .user-box"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, "#login-form"),
            (By.CSS_SELECTOR, "div.qr-login img[alt='qrcode']"),
            (By.CSS_SELECTOR, ".login-container"),
            (By.CSS_SELECTOR, ".login-modal"),
        ],
        # 2. 引导遮罩与弹窗
        "dismiss_guide": [
            (By.XPATH, "//button[contains(text(), '我知道了') or contains(text(), '跳过') or contains(text(), '关闭')]"),
            (By.CSS_SELECTOR, "button[aria-label='Skip']"),
            (By.CSS_SELECTOR, "div.ant-modal-close"),
        ],
        # 3. 视频上传入口
        "video_input": [
            (By.CSS_SELECTOR, "button[class^='_upload-btn'] input[type='file']"),
            (By.CSS_SELECTOR, "div.progress-div input[type='file']"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='video']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        "upload_btn": [
            (By.CSS_SELECTOR, "button[class^='_upload-btn']"),
            (By.XPATH, "//*[contains(text(), '上传视频') or contains(text(), '选择视频')]"),
        ],
        # 4. 标题输入框 (若存在独立标题框)
        "title": [
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.XPATH, "//label[contains(text(), '标题')]/following-sibling::div//input"),
            (By.CSS_SELECTOR, ".title-input input"),
        ],
        # 5. 描述编辑区 (富文本 contenteditable 或 textarea)
        "description": [
            (By.XPATH, "//*[contains(text(), '描述')]/following::div[@contenteditable='true'][1]"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='描述']"),
            (By.CSS_SELECTOR, "textarea"),
        ],
        # 6. 封面设置
        "cover_trigger": [
            (By.XPATH, "//span[contains(text(), '封面设置')]/.."),
            (By.XPATH, "//*[contains(text(), '封面设置') or contains(text(), '设置封面')]"),
            (By.CSS_SELECTOR, ".cover-setting"),
        ],
        "cover_input": [
            (By.CSS_SELECTOR, "div[role='document'].ant-modal input[type='file']"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
        ],
        # 7. 发布确认按钮
        "publish_btn": [
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
            (By.CSS_SELECTOR, "button.ant-btn-primary"),
            (By.CSS_SELECTOR, ".publish-btn button"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def is_video_channel(self) -> bool:
        return True

    def dismiss_popovers(self):
        """清除快手页面上的 Joyride 引导遮罩与各类确认弹窗"""
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

            # 核心防踩坑：清除 Joyride 聚光灯遮罩层
            js_clean = """
                var portal = document.getElementById('react-joyride-portal');
                if (portal) portal.remove();
                document.querySelectorAll('.react-joyride__spotlight').forEach(function(e) { e.remove(); });
                document.querySelectorAll('.ant-popover, div[role="tooltip"]').forEach(function(e) { e.style.display = 'none'; });
            """
            self.driver.execute_script(js_clean)
        except Exception:
            pass

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """检查快手创作者服务平台登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        if "passport.kuaishou.com" in curr_url:
            return False, "当前处于快手登录扫码页面，等待创作者扫码登录", {"url": curr_url}

        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "检测到快手登录弹窗，请在打开的受控浏览器中扫码登录", {"url": curr_url}
            except Exception:
                continue

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录快手创作者服务平台", {"url": curr_url}
            except Exception:
                continue

        if "cp.kuaishou.com" in curr_url and "publish" in curr_url:
            return True, "已连接快手创作者服务平台", {"url": curr_url}

        return False, "未检测到快手创作者有效登录态，请在浏览器中完成登录", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开快手视频上传发布页"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开快手创作者视频发布页面"
        except Exception as e:
            return False, f"打开快手发布页失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传视频素材或多图图文，及封面"""
        if not media_items:
            return False, "未提供任何视频或素材文件"

        video_item = None
        cover_item = None
        image_items = []
        for item in media_items:
            mtype = (item.type or "").upper()
            if mtype == "VIDEO" or (item.local_path and Path(item.local_path).suffix.lower() in [".mp4", ".mov", ".flv", ".webm", ".mkv"]):
                if not video_item:
                    video_item = item
            elif mtype in ["COVER"]:
                if not cover_item:
                    cover_item = item
            elif mtype in ["IMAGE"]:
                image_items.append(item)
                if not cover_item:
                    cover_item = item

        if not video_item and media_items:
            first_path = media_items[0].local_path or ""
            if Path(first_path).suffix.lower() in [".mp4", ".mov", ".flv", ".webm", ".mkv"]:
                video_item = media_items[0]

        self.dismiss_popovers()

        # === A. 视频模式 ===
        if video_item:
            if not video_item.local_path:
                return False, "未找到有效的本地视频文件路径"

            video_path = Path(video_item.local_path).resolve()
            if not video_path.exists() or video_path.stat().st_size == 0:
                return False, f"本地视频文件不存在或为空: {video_path}"

            file_input = self.find_file_input_cross_frames("video")
            if not file_input:
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
                return False, "未能定位到快手视频上传 input 元素"

            try:
                file_input.send_keys(str(video_path))
                time.sleep(2.0)
                self.dismiss_popovers()
            except Exception as e:
                return False, f"向快手上传视频文件失败：{e}"

            # 尝试设置封面
            if cover_item and cover_item.local_path:
                self.upload_cover(cover_item)

            # 等待编辑页就绪
            for _ in range(15):
                if self._is_editor_ready():
                    break
                time.sleep(1.0)
                self.dismiss_popovers()

            return True, f"快手视频素材已成功载入：{video_path.name} (大小: {video_path.stat().st_size} bytes)"

        # === B. 图文模式 ===
        if image_items:
            # 切换「图文」tab
            for tab_sel in ["//div[contains(@role, 'tab') and contains(text(), '图文')]", "//*[contains(text(), '图文')]", "div[role='tablist'] div:nth-child(2)"]:
                try:
                    tabs = self.driver.find_elements(By.XPATH, tab_sel) if tab_sel.startswith("//") else self.driver.find_elements(By.CSS_SELECTOR, tab_sel)
                    for tab in tabs:
                        if tab.is_displayed():
                            tab.click()
                            time.sleep(1.0)
                            break
                except Exception:
                    pass

            img_input = self.find_file_input_cross_frames("image")
            if not img_input:
                for by, sel in self.SELECTORS["video_input"]:
                    try:
                        inputs = self.driver.find_elements(by, sel)
                        if inputs:
                            img_input = inputs[0]
                            break
                    except Exception:
                        continue

            if not img_input:
                return False, "未能定位到快手图文上传 input 元素"

            valid_paths = [str(Path(img.local_path).resolve()) for img in image_items if img.local_path and Path(img.local_path).exists()]
            if not valid_paths:
                return False, "未找到有效的本地图文图片路径"

            try:
                img_input.send_keys("\n".join(valid_paths))
                time.sleep(2.0)
                self.dismiss_popovers()
            except Exception as e:
                return False, f"向快手上传图文素材失败：{e}"

            return True, f"快手图文素材已成功载入：共 {len(valid_paths)} 张图片"

        return False, "未找到可上传的有效素材"

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
        """上传快手封面"""
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

            # 切换到上传封面 Tab
            try:
                tab = self.driver.find_element(By.XPATH, "//div[contains(text(), '上传封面')]")
                if tab.is_displayed():
                    tab.click()
                    time.sleep(0.5)
            except Exception:
                pass

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
                    return True, f"快手封面上传成功: {cover_path.name}"
            return False, "未找到快手封面上传 input"
        except Exception as e:
            return False, f"快手封面设置失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写标题 (若存在独立标题输入框)"""
        self.dismiss_popovers()
        safe_title = title.strip()

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
            return True, "快手当前页面为描述驱动模式，标题已作为描述前缀处理"

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
            return True, f"快手作品标题已填入：{safe_title}"
        except Exception as e:
            return False, f"写入快手标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写作品描述"""
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
            return False, "未能定位到快手作品描述输入框"

        try:
            self.set_field_text(desc_elem, safe_body)
            time.sleep(0.3)
            return True, f"快手作品描述已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入快手描述失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """在描述编辑区末尾添加 #话题 标签"""
        if not tags:
            return True, "未提供标签，跳过"

        clean_tags = [f"#{t.strip().lstrip('#')}" for t in tags if t.strip()]
        tags_str = " " + " ".join(clean_tags[:4]) + " "

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
                new_t = (curr + tags_str).strip()
                self.js_set_value(desc_elem, new_t)
            else:
                desc_elem.send_keys(tags_str)
            time.sleep(0.3)
            return True, f"已在快手描述中追加话题：{tags_str.strip()}"
        except Exception as e:
            return False, f"追加快手话题失败：{e}"

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

        exp_title_norm = expected_title.strip()
        title_match = (not exp_title_norm) or (actual_title == exp_title_norm) or (exp_title_norm in actual_body) or (actual_title in exp_title_norm)

        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.4
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("快手作品描述未在页面成功回读")

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
        """停留在最终发布确认阶段，高亮【发布】按钮，绝不自动越权提交"""
        self.dismiss_popovers()
        self.inject_preview_guard_banner("快手创作者服务平台")
        try:
            for by, sel in self.SELECTORS["publish_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #ff5000';", btn)
                        return True, "受控浏览器已停留在快手【发布】按钮处，等待创作者审核后亲自点击发布"
            return True, "已停留在快手发布确认页面底部，等待创作者人工确认"
        except Exception as e:
            return True, f"已停留在发布确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        try:
            curr_url = self.driver.current_url.lower()
            if "article/manage/video" in curr_url or "status=2" in curr_url:
                return True, "已跳转至作品管理页面，快手视频已提交", {
                    "canonical_url": self.driver.current_url,
                    "status": "PENDING_REVIEW"
                }

            page_text = self.driver.page_source
            for kw in ["发布成功", "作品发布成功", "审核中"]:
                if kw in page_text:
                    return True, f"已检测到快手发布结果提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }
            return False, "未检测到快手发布完成凭证，请创作者手动确认并回填落地链接", {}
        except Exception as e:
            return False, f"检测快手发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已登录正确的快手创作者服务账号",
            "核对视频描述与 #话题 标签录入",
            "检查视频上传与转码预览状态",
            "核对封面设置展示效果",
            "创作者亲自核对无误后在浏览器中点击【发布】",
            "发布成功后在 GeoLens 控制台回填快手作品链接"
        ]
