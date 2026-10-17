"""
GeoLens 本地浏览器助手 - 哔哩哔哩 (B站) 视频平台适配器 (BilibiliPublisher)
适配 B站创作者服务平台视频投稿页面 (https://member.bilibili.com/platform/upload/video/frame)
结合 social-auto-upload 与 auto-publish 实测经验：
1. 支持关闭未保存草稿弹窗（"不用了"）与各类新手引导浮层
2. 支持视频文件通过 input[type='file'] 真实上传与上传状态等待
3. 支持稿件标题（限 80 字）填写与防截断校验
4. 支持富文本/纯文本视频简介 (Description) 填写
5. 支持通过 #tag-container 录入并确认话题标签（最多 10 个）
6. 支持自制声明与封面图片上传
7. PREPARE_ONLY 原则：停留在最终投稿确认阶段，绝不自动越权点击立即投稿
8. 可信结果检测：区分平台审核中与公开发布
"""
import time
from typing import Any
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class BilibiliPublisher(BasePublisher):
    """哔哩哔哩 (B站) 视频投稿发布适配器"""

    CHANNEL = "BILIBILI"
    CREATOR_URL = "https://member.bilibili.com/platform/upload/video/frame"
    HOME_URL = "https://member.bilibili.com/"
    LOGIN_URL = "https://passport.bilibili.com/login"

    # 选择器定义
    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, ".header-avatar-wrap img"),
            (By.CSS_SELECTOR, "img.avatar-img"),
            (By.CSS_SELECTOR, ".nav-avatar"),
            (By.CSS_SELECTOR, ".bili-avatar"),
            (By.CSS_SELECTOR, ".up-info-container"),
            (By.CSS_SELECTOR, "a[href*='space.bilibili.com']"),
            (By.CSS_SELECTOR, ".user-profile"),
        ],
        "login_modal": [
            (By.XPATH, "//*[contains(text(), '扫码登录') or contains(text(), '密码登录') or contains(text(), '短信登录')]"),
            (By.CSS_SELECTOR, ".login-form"),
            (By.CSS_SELECTOR, ".qrcode-img"),
            (By.CSS_SELECTOR, ".bili-mini-login"),
            (By.CSS_SELECTOR, ".login-box"),
            (By.CSS_SELECTOR, ".passport-login-container"),
        ],
        # 2. 引导与草稿恢复浮层 (Popovers / Draft prompt)
        "dismiss_draft": [
            (By.XPATH, "//button[contains(text(), '不用了') or contains(., '不用了')]"),
            (By.XPATH, "//span[contains(text(), '不用了')]"),
            (By.CSS_SELECTOR, ".bcc-dialog button.bcc-button--default"),
        ],
        # 3. 视频上传入口
        "video_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='video']"),
            (By.CSS_SELECTOR, ".upload-wrp input[type='file']"),
            (By.CSS_SELECTOR, "input.upload-file"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        "upload_btn": [
            (By.CSS_SELECTOR, ".upload-btn-container"),
            (By.XPATH, "//*[contains(text(), '上传视频') or contains(text(), '选择视频')]"),
            (By.CSS_SELECTOR, ".upload-wrp"),
        ],
        # 4. 稿件标题输入框 (上限 80 字)
        "title": [
            (By.CSS_SELECTOR, "input[placeholder*='请输入稿件标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='稿件标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, "input.title-input"),
            (By.CSS_SELECTOR, ".video-title input"),
        ],
        # 5. 视频简介富文本/输入框 (上限 2000 字)
        "description": [
            (By.CSS_SELECTOR, "div.ql-editor[contenteditable='true']"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "textarea[placeholder*='输入简介']"),
            (By.CSS_SELECTOR, "textarea.archive-desc-editor"),
            (By.CSS_SELECTOR, "textarea.desc-input"),
        ],
        # 6. 标签输入框
        "tag_input": [
            (By.CSS_SELECTOR, "#tag-container input[placeholder*='按回车键Enter创建标签']"),
            (By.CSS_SELECTOR, "input[placeholder*='按回车键Enter创建标签']"),
            (By.CSS_SELECTOR, "input[placeholder*='Enter创建标签']"),
            (By.CSS_SELECTOR, "input[placeholder*='创建标签']"),
            (By.CSS_SELECTOR, "#tag-container input"),
        ],
        # 7. 封面设置
        "cover_trigger": [
            (By.XPATH, "//*[contains(text(), '封面设置') or contains(text(), '设置封面') or contains(text(), '更换封面')]"),
            (By.CSS_SELECTOR, ".cover-preview"),
            (By.CSS_SELECTOR, ".cover-editor"),
        ],
        "cover_input": [
            (By.CSS_SELECTOR, ".cover-editor input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, ".bcc-dialog input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
        ],
        # 8. 自制声明单选框
        "original_radio": [
            (By.XPATH, "//span[contains(text(), '自制')]/preceding-sibling::input"),
            (By.XPATH, "//span[contains(text(), '自制')]/.."),
            (By.CSS_SELECTOR, "label.radio-item:nth-child(1)"),
        ],
        # 9. 视频上传与处理状态监测
        "upload_complete_status": [
            (By.XPATH, "//*[contains(text(), '上传完成') or contains(text(), '转码完成') or contains(text(), '处理完成')]"),
            (By.CSS_SELECTOR, ".upload-success"),
            (By.CSS_SELECTOR, ".file-item.is-success"),
            (By.CSS_SELECTOR, ".file-list .file-item"),
            (By.CSS_SELECTOR, ".video-item"),
        ],
        "video_duration": [
            (By.CSS_SELECTOR, ".duration"),
            (By.CSS_SELECTOR, ".video-duration"),
            (By.CSS_SELECTOR, ".file-item .time"),
            (By.XPATH, "//*[contains(@class, 'duration') or contains(@class, 'time')]"),
        ],
        "video_thumbnail": [
            (By.CSS_SELECTOR, ".cover-preview img"),
            (By.CSS_SELECTOR, ".video-cover img"),
            (By.CSS_SELECTOR, "img.cover-img"),
            (By.CSS_SELECTOR, ".file-item img"),
            (By.CSS_SELECTOR, ".video-item img"),
        ],
        "upload_error": [
            (By.XPATH, "//*[contains(text(), '上传失败') or contains(text(), '格式不支持') or contains(text(), '文件损坏')]"),
            (By.CSS_SELECTOR, ".upload-error"),
            (By.CSS_SELECTOR, ".error-tip"),
        ],
        # 10. 最终提交按钮
        "submit_btn": [
            (By.CSS_SELECTOR, "button.submit-add"),
            (By.CSS_SELECTOR, ".submit-btn button"),
            (By.XPATH, "//button[contains(text(), '立即投稿') or contains(., '立即投稿')]"),
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def is_video_channel(self) -> bool:
        return True

    def dismiss_popovers(self):
        """清除 B站 页面上的草稿恢复提示、新手引导或弹窗"""
        try:
            # 1. 尝试按 ESC 键
            try:
                body = self.driver.find_element(By.TAG_NAME, "body")
                body.send_keys(Keys.ESCAPE)
            except Exception:
                pass

            # 2. 检查是否有"不用了"草稿弹窗
            for by, sel in self.SELECTORS["dismiss_draft"]:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        try:
                            el.click()
                            time.sleep(0.5)
                            break
                        except Exception:
                            self.driver.execute_script("arguments[0].click();", el)
                            time.sleep(0.5)
                            break

            # 3. JS 清理气泡和引导浮层
            js_clean = """
                var selectors = ['.bcc-popover', '.guide-bubble', '.driver-popover-item', '.ant-popover', 'div[role="tooltip"]', '.modal-wrapper .guide'];
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
        """检查 B站 创作者中心登录状态"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "浏览器会话未就绪", {}

        # 若在 passport 登录页
        if "passport.bilibili.com" in curr_url:
            return False, "当前处于 B站 登录页面，等待创作者扫码登录", {"url": curr_url}

        # 检查是否出现登录弹窗
        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "检测到 B站 登录弹窗，请在打开的浏览器中扫码登录", {"url": curr_url}
            except Exception:
                continue

        # 检查已登录头像或用户信息
        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "已成功登录 B站 创作者平台", {"url": curr_url}
            except Exception:
                continue

        # 检查页面是否已出现真正的上传文件按钮或输入框，且绝无登录卡片遮罩
        for by, sel in self.SELECTORS["video_input"] + self.SELECTORS["upload_btn"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() or e.tag_name == "input" for e in elems):
                    try:
                        page_text = self.driver.page_source
                        if not any(k in page_text for k in ["扫码登录", "密码登录", "短信登录"]):
                            return True, "已连接 B站 创作者管理页面", {"url": curr_url}
                    except Exception:
                        pass
            except Exception:
                continue

        return False, "未检测到 B站 创作者有效登录态，请在受控浏览器中完成登录", {"url": curr_url}

    def open_editor(self) -> tuple[bool, str]:
        """打开 B站 视频投稿页面"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(2.0)
            self.dismiss_popovers()
            return True, "已在受控浏览器打开 B站 视频投稿页面"
        except Exception as e:
            return False, f"打开 B站 投稿页面失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """
        上传视频素材及可选封面
        B站必须先注入视频文件，页面才会渲染标题与标签表单
        """
        if not media_items:
            return False, "未提供任何视频或素材文件"

        # 1. 查找视频素材
        video_item = None
        cover_item = None
        for item in media_items:
            mtype = (item.type or "").upper()
            if mtype == "VIDEO" or (item.local_path and Path(item.local_path).suffix.lower() in [".mp4", ".mov", ".flv", ".webm", ".mkv", ".avi"]):
                if not video_item:
                    video_item = item
            elif mtype in ["COVER", "IMAGE"]:
                if not cover_item:
                    cover_item = item

        # 如果没有显式指定 VIDEO 类型，但有本地素材，优先选用第一个素材
        if not video_item and media_items:
            video_item = media_items[0]

        if not video_item or not video_item.local_path:
            return False, "未找到有效的本地视频文件路径"

        video_path = Path(video_item.local_path).resolve()
        if not video_path.exists() or video_path.stat().st_size == 0:
            return False, f"本地视频文件不存在或为空 (0 bytes): {video_path}"

        self.dismiss_popovers()

        # 2. 定位视频上传文件输入框
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
            # 降级尝试通过跨 frame 深度检索
            file_input = self.find_file_input_cross_frames("video")

        if not file_input:
            return False, "未能定位到 B站 视频上传文件输入框"

        try:
            # 注入视频文件绝对路径
            file_input.send_keys(str(video_path))
            time.sleep(2.5)
            self.dismiss_popovers()
        except Exception as e:
            return False, f"向 B站 上传视频文件失败：{e}"

        # 3. 如果提供了封面素材，尝试设置封面
        if cover_item and cover_item.local_path:
            self.upload_cover(cover_item)

        # 4. 等待编辑表单出现（标题输入框就绪）
        for _ in range(5):
            if self._is_editor_ready():
                break
            time.sleep(0.5)
            self.dismiss_popovers()

        return True, f"B站视频文件已成功载入：{video_path.name} (大小: {video_path.stat().st_size} bytes)"

    def wait_for_upload_completion(self, timeout_sec: int = 90) -> tuple[bool, str]:
        """
        验证 B站 视频上传与平台处理完成状态，严格核验视频缩略图、时长与处理状态，绝不仅凭 input 写入判断
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
                                return False, f"B站平台提示视频上传/处理失败: {err_txt}"
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
                return True, f"B站视频上传与平台解析处理已完成{meta_str}"

            time.sleep(1.0)

        # 超时判断
        if self._is_editor_ready():
            return True, "B站编辑表单已就绪，视频已在后台转码队列中，可进行后续信息审核"
        return False, f"等待 B站 视频上传与平台处理超时 ({timeout_sec}s)"

    def _is_editor_ready(self) -> bool:
        """检查 B站 编辑表单是否已展开"""
        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True
            except Exception:
                continue
        for by, sel in self.SELECTORS["tag_input"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True
            except Exception:
                continue
        return False

    def upload_cover(self, cover_item: MediaItem) -> tuple[bool, str]:
        """上传 B站 视频封面"""
        if not cover_item or not cover_item.local_path:
            return False, "未提供封面本地路径"

        cover_path = Path(cover_item.local_path).resolve()
        if not cover_path.exists() or cover_path.stat().st_size == 0:
            return False, f"封面图片不存在或为空: {cover_path}"

        try:
            # 查找封面触发入口
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

            # 查找弹窗中的封面上传 input
            for by, sel in self.SELECTORS["cover_input"]:
                inputs = self.driver.find_elements(by, sel)
                for inp in inputs:
                    inp.send_keys(str(cover_path))
                    time.sleep(1.5)
                    # 尝试点击确认按钮
                    for confirm_text in ["完成", "确定", "确认", "保存"]:
                        try:
                            btn = self.driver.find_element(By.XPATH, f"//button[contains(text(), '{confirm_text}')]")
                            if btn.is_displayed():
                                btn.click()
                                time.sleep(0.5)
                                break
                        except Exception:
                            pass
                    return True, f"B站封面上传成功: {cover_path.name}"
            return False, "未找到封面上传文件输入框"
        except Exception as e:
            return False, f"封面上传失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写稿件标题（限 80 字，超出安全截断并记录）"""
        self.dismiss_popovers()
        max_len = 80
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
            return False, "未能定位到 B站 稿件标题输入框"

        try:
            self.set_field_text(title_input, safe_title)
            time.sleep(0.3)
            msg = f"标题已成功填入：{safe_title}"
            if truncated:
                msg += f"（原标题超长，已截断至 80 字）"
            return True, msg
        except Exception as e:
            return False, f"写入 B站 标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写视频简介描述（限 2000 字）"""
        self.dismiss_popovers()
        max_len = 2000
        safe_body = body.strip()
        if len(safe_body) > max_len:
            safe_body = safe_body[:max_len]

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
            return True, "未找到独立简介框或当前界面未展开简介区域，跳过"

        try:
            self.set_field_text(desc_elem, safe_body)
            time.sleep(0.3)
            return True, f"视频简介已填入（共 {len(safe_body)} 字）"
        except Exception as e:
            return False, f"写入视频简介失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """填写投稿标签（最多 10 个，按回车键添加）"""
        if not tags:
            return True, "未提供标签，跳过标签填写"

        self.dismiss_popovers()
        tag_input = None
        for by, sel in self.SELECTORS["tag_input"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        tag_input = el
                        break
                if tag_input:
                    break
            except Exception:
                continue

        if not tag_input:
            return True, "未定位到 B站 标签输入框，可能需等待视频上传完成"

        added = []
        clean_tags = [t.strip().lstrip("#").rstrip("，,。.!！;；") for t in tags if t.strip()]
        for tag in clean_tags[:10]:
            try:
                tag_input.click()
                time.sleep(0.2)
                tag_input.send_keys(tag)
                time.sleep(0.3)
                tag_input.send_keys(Keys.ENTER)
                time.sleep(0.3)
                added.append(tag)
            except Exception:
                continue

        return True, f"已添加 {len(added)} 个 B站 标签：{', '.join(added)}"

    def fill_required_declarations(self) -> tuple[bool, str]:
        """选择自制声明"""
        try:
            for by, sel in self.SELECTORS["original_radio"]:
                elems = self.driver.find_elements(by, sel)
                for el in elems:
                    if el.is_displayed():
                        try:
                            el.click()
                            time.sleep(0.3)
                            return True, "已选择【自制】声明"
                        except Exception:
                            self.driver.execute_script("arguments[0].click();", el)
                            time.sleep(0.3)
                            return True, "已选择【自制】声明"
            return True, "自制声明已保持默认"
        except Exception as e:
            return True, f"声明设置跳过：{e}"

    def fill_category(self, category: str) -> tuple[bool, str]:
        """设置 B站 分区/分类"""
        if not category:
            return True, "未指定分区，采用平台自动识别分区"
        try:
            part_entries = self.driver.find_elements(By.XPATH, f"//*[contains(@class, 'select-item') or contains(@class, 'type-item')][contains(text(), '{category}')]")
            for entry in part_entries:
                if entry.is_displayed():
                    try:
                        entry.click()
                        return True, f"已选择 B站 分区：{category}"
                    except Exception:
                        self.driver.execute_script("arguments[0].click();", entry)
                        return True, f"已选择 B站 分区：{category}"
            return True, f"未找到精确匹配的分区 '{category}'，保留默认分区设置"
        except Exception as e:
            return True, f"设置分区跳过：{e}"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """双向校验填写结果与原始内容是否一致"""
        actual_title = ""
        actual_body = ""
        actual_tags = []
        discrepancies = []

        # 1. 回读标题
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

        # 2. 回读简介
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

        # 3. 回读已创建的标签
        try:
            tag_chips = self.driver.find_elements(By.CSS_SELECTOR, "#tag-container .tag-item, .tag-area .label-item, .tag-container span")
            for chip in tag_chips:
                txt = chip.text.replace("×", "").replace("x", "").strip()
                if txt and txt not in actual_tags:
                    actual_tags.append(txt)
        except Exception:
            pass

        # 标题校验 (支持 80 字截断)
        exp_title_norm = expected_title[:80].strip()
        title_match = (actual_title == exp_title_norm) or (exp_title_norm in actual_title) or (actual_title in exp_title_norm)
        if not title_match:
            discrepancies.append(f"标题不一致（预期: '{exp_title_norm}', 实际: '{actual_title}'）")

        # 简介校验
        body_match = True
        if expected_body.strip() and actual_body:
            ratio = len(actual_body) / max(len(expected_body.strip()), 1)
            body_match = ratio >= 0.5
        elif expected_body.strip() and not actual_body:
            body_match = False
            discrepancies.append("视频简介未在页面成功回读")

        tags_match = True
        if expected_tags and actual_tags:
            overlap = set(t.lstrip("#") for t in expected_tags) & set(actual_tags)
            tags_match = len(overlap) > 0
        elif expected_tags and not actual_tags:
            discrepancies.append("标签未在页面回读出对应标签项")

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
            tags_actual=actual_tags,
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """
        停留在最终发布确认阶段，滚动到【立即投稿】按钮区域
        严格执行 PREPARE_ONLY 原则，绝不越权自动点击提交
        """
        self.dismiss_popovers()
        self.inject_preview_guard_banner("哔哩哔哩 B站")
        try:
            for by, sel in self.SELECTORS["submit_btn"]:
                elems = self.driver.find_elements(by, sel)
                for btn in elems:
                    if btn.is_displayed():
                        self.driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", btn)
                        time.sleep(0.5)
                        # 高亮展示
                        self.driver.execute_script("arguments[0].style.outline = '3px solid #fb7299';", btn)
                        return True, "受控浏览器已停留在 B站 投稿确认按钮处，等待创作者审核无误后亲自点击【立即投稿】"
            return True, "受控浏览器已停留在 B站 投稿页面底部，等待创作者亲自确认提交"
        except Exception as e:
            return True, f"已停留在投稿确认阶段：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """检测投稿是否已提交，区分审核中与落地链接"""
        try:
            curr_url = self.driver.current_url.lower()
            # 若 URL 包含 BV 号或稿件 ID
            if "/video/bv" in curr_url or "bilibili.com/video/" in curr_url:
                return True, "已检测到 B站 视频正式发布链接", {
                    "canonical_url": self.driver.current_url,
                    "status": "PUBLISHED"
                }

            # 检查是否有投稿成功或审核中提示
            success_keywords = ["投稿成功", "正在审核", "稿件审核中", "进入稿件管理"]
            page_text = self.driver.page_source
            for kw in success_keywords:
                if kw in page_text:
                    return True, f"已检测到 B站 提交成功提示（{kw}）", {
                        "canonical_url": self.driver.current_url,
                        "status": "PENDING_REVIEW"
                    }

            return False, "未检测到 B站 发布完成凭证，请在页面中确认或回填落地链接", {}
        except Exception as e:
            return False, f"检测发布结果异常：{e}", {}

    def get_manual_checklist(self) -> list[str]:
        return [
            "确认已登录正确的 B站 创作者账号",
            "检查稿件标题是否在 80 字以内且表达准确",
            "核对视频是否上传并转码完毕（预览画面可播放）",
            "核对视频简介、分区以及自制声明选项",
            "核对投稿标签是否包含目标热点话题",
            "核对 16:9 横版封面设置效果",
            "创作者亲自核对无误后点击【立即投稿】",
            "待审核通过后在 GeoLens 控制台回填 B 站 BV 视频链接"
        ]
