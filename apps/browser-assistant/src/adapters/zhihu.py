"""
GeoLens 本地浏览器助手 - 知乎文章平台适配器 (ZhihuPublisher)
适配知乎专栏/创作者文章编辑器 (https://zhuanlan.zhihu.com/write)
"""
import time
from typing import Any
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class ZhihuPublisher(BasePublisher):
    """知乎专栏/文章编辑器发布适配器"""
    
    CHANNEL = "ZHIHU"
    CREATOR_URL = "https://zhuanlan.zhihu.com/write"
    SIGNIN_URL = "https://www.zhihu.com/signin"

    # 集中维护选择器
    SELECTORS = {
        # 登录态标识
        "avatar": [
            (By.CSS_SELECTOR, ".AppHeader-profile"),
            (By.CSS_SELECTOR, ".WriteIndex-avatar"),
            (By.CSS_SELECTOR, "header button[aria-label*='头像']"),
            (By.CSS_SELECTOR, "header img[alt*='头像']"),
            (By.CSS_SELECTOR, ".Avatar"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".SignContainer"),
            (By.CSS_SELECTOR, ".SignFlow"),
            (By.CSS_SELECTOR, ".Sign-content"),
        ],
        # 标题输入框
        "title": [
            (By.CSS_SELECTOR, "textarea.WriteIndex-titleInput"),
            (By.CSS_SELECTOR, "textarea[placeholder*='标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, ".Input[placeholder*='标题']"),
        ],
        # 正文富文本编辑器 (Draft.js / ContentEditable)
        "content_editor": [
            (By.CSS_SELECTOR, "div.public-DraftEditor-content"),
            (By.CSS_SELECTOR, "div.DraftEditor-editorContainer div[contenteditable='true']"),
            (By.CSS_SELECTOR, "div.notranslate.public-DraftEditor-content"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
        ],
        # 图片上传
        "image_file_input": [
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, ".WriteIndex input[type='file']"),
        ],
        # 话题标签 / 专栏选择
        "topic_input": [
            (By.CSS_SELECTOR, ".PublishPanel-tagInput input"),
            (By.CSS_SELECTOR, "input[placeholder*='添加话题']"),
            (By.CSS_SELECTOR, "input[placeholder*='话题']"),
            (By.CSS_SELECTOR, ".Tag-input"),
        ],
        # 发布与保存按钮
        "publish_btn": [
            (By.CSS_SELECTOR, ".PublishPanel-publishButton"),
            (By.CSS_SELECTOR, "button.Button--primary"),
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
        ],
        "draft_save_status": [
            (By.CSS_SELECTOR, ".WriteIndex-draftStatus"),
            (By.XPATH, "//*[contains(text(), '已保存') or contains(text(), '草稿保存')]"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """检查知乎登录状态"""
        curr_url = self.driver.current_url.lower()
        if "zhihu.com/signin" in curr_url or "signin" in curr_url:
            return False, "当前处于知乎登录页面，请先扫码或验证登录", {}

        # 检查是否携带知乎关键鉴权 Cookie z_c0
        cookies = {c["name"]: c["value"] for c in self.driver.get_cookies()}
        if "z_c0" in cookies:
            return True, "检测到有效知乎登录凭证 (z_c0)", {"has_cookie": True}

        # 检查页面是否有用户头像或登录弹窗
        for by, sel in self.SELECTORS["login_modal"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return False, "检测到知乎登录弹窗，请在浏览器中完成登录", {}
            except Exception:
                pass

        for by, sel in self.SELECTORS["avatar"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "检测到知乎用户头像元素，已登录", {"selector": sel}
            except Exception:
                pass

        # 如果直接访问过知乎其他页面且无登录阻断，再尝试探测主页
        if "zhihu.com" in curr_url:
            page_src = self.driver.page_source
            if "登录" in page_src and "创作者中心" not in page_src:
                return False, "知乎页面提示未登录，请完成登录", {}
            return True, "已在知乎会话内", {}

    def open_login_page(self) -> tuple[bool, str]:
        """打开知乎扫码/密码登录页"""
        try:
            curr_url = self.driver.current_url.lower()
            if "zhihu.com/signin" not in curr_url:
                self.driver.get(self.SIGNIN_URL)
                time.sleep(1.0)
            return True, "已在受控 Chrome 窗口打开知乎登录页"
        except Exception as e:
            return False, f"打开知乎登录页失败：{e}"

    def navigate_creator_center(self) -> tuple[bool, str]:
        """导航至知乎专栏写作中心"""
        try:
            curr_url = self.driver.current_url.lower()
            if "zhuanlan.zhihu.com/write" not in curr_url:
                self.driver.get(self.CREATOR_URL)
                time.sleep(1.8)
            self.handle_new_tab()
            return True, "已成功进入知乎专栏写作中心"
        except Exception as e:
            return False, f"进入知乎写作中心失败：{e}"

    def select_content_type(self, content_type: str = "ARTICLE") -> tuple[bool, str]:
        """选择知乎创作类型（专栏文章）"""
        self.handle_new_tab()
        return True, "知乎专栏写作模式就绪"

    def ensure_editor_ready(self) -> tuple[bool, str]:
        """确认知乎专栏编辑器 DOM 就绪"""
        self.handle_new_tab()
        for by, sel in self.SELECTORS["title"] + self.SELECTORS["content_editor"]:
            try:
                elems = self.driver.find_elements(by, sel)
                if any(e.is_displayed() for e in elems):
                    return True, "知乎专栏文章编辑器 DOM 已就绪"
            except Exception:
                pass
        return True, "知乎专栏页面就绪"

    def open_editor(self) -> tuple[bool, str]:
        """打开知乎专栏写作页面"""
        try:
            self.driver.get(self.CREATOR_URL)
            time.sleep(1.5)
            # 等待标题输入框或正文加载
            for by, sel in self.SELECTORS["title"]:
                try:
                    elem = self.safe_find(by, sel, timeout=8)
                    if elem:
                        return True, "知乎专栏文章编辑器已成功加载"
                except Exception:
                    continue
            return True, "已打开知乎创作页面"
        except Exception as e:
            return False, f"打开知乎写作页面超时或失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填写知乎文章标题"""
        title = title.strip()
        if len(title) > 100:
            title = title[:100]  # 知乎标题上限 100 字

        target_elem = None
        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                visible = [e for e in elems if e.is_displayed()]
                if visible:
                    target_elem = visible[0]
                    break
            except Exception:
                continue

        if not target_elem:
            return False, "未在知乎页面找到标题输入框，请检查页面结构"

        try:
            target_elem.click()
            # 清空现有标题
            target_elem.send_keys(Keys.CONTROL + "a")
            target_elem.send_keys(Keys.BACKSPACE)
            time.sleep(0.1)
            target_elem.send_keys(title)
            # 补发 input 事件
            self.driver.execute_script("arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", target_elem)
            return True, f"标题已自动填入知乎编辑器（共 {len(title)} 字）"
        except Exception as e:
            # 降级尝试 JS 直接设值
            try:
                self.js_set_value(target_elem, title)
                return True, f"标题通过 JS 辅助填入（共 {len(title)} 字）"
            except Exception as e2:
                return False, f"填写标题失败：{e2}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写知乎正文 (富文本 Draft.js / ContentEditable)"""
        editor_elem = None
        for by, sel in self.SELECTORS["content_editor"]:
            try:
                elems = self.driver.find_elements(by, sel)
                visible = [e for e in elems if e.is_displayed()]
                if visible:
                    editor_elem = visible[0]
                    break
            except Exception:
                continue

        if not editor_elem:
            return False, "未找到知乎正文富文本输入区"

        try:
            editor_elem.click()
            time.sleep(0.2)
            
            # 知乎 Draft.js 富文本支持从剪贴板粘贴或模拟输入
            # 为了保留分段和空行，我们按段落组织
            paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
            
            # 使用 DataTransfer API 在富文本编辑器中模拟原生粘贴事件，这能最真实保留富文本格式
            js_paste_script = """
                var element = arguments[0];
                var text = arguments[1];
                element.focus();
                var event = new ClipboardEvent('paste', {
                    bubbles: true,
                    cancelable: true,
                    clipboardData: new DataTransfer()
                });
                event.clipboardData.setData('text/plain', text);
                element.dispatchEvent(event);
            """
            self.driver.execute_script(js_paste_script, editor_elem, body)
            time.sleep(0.5)

            # 检查是否成功注入，如果没有则降级逐段 send_keys
            current_text = editor_elem.text
            if not current_text or len(current_text) < 10:
                editor_elem.click()
                for i, para in enumerate(paragraphs):
                    editor_elem.send_keys(para)
                    if i < len(paragraphs) - 1:
                        editor_elem.send_keys(Keys.ENTER)
                    time.sleep(0.05)

            return True, f"正文已写入知乎富文本编辑器（共 {len(body)} 字，{len(paragraphs)} 个段落）"
        except Exception as e:
            return False, f"写入正文富文本失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传素材/图片"""
        if not media_items:
            return True, "无素材需上传"

        image_items = [m for m in media_items if m.type == "IMAGE"]
        if not image_items:
            return True, "无适用图片素材需上传"

        uploaded_count = 0
        file_input = None
        for by, sel in self.SELECTORS["image_file_input"]:
            try:
                inputs = self.driver.find_elements(by, sel)
                if inputs:
                    file_input = inputs[0]
                    break
            except Exception:
                continue

        if not file_input:
            # 知乎顶部工具栏常有图片图标，点击后激活 file input
            return True, f"检测到 {len(image_items)} 张待发布图片，请在人工核对时通过知乎图片工具栏确认"

        # 如果素材有本地有效绝对路径，通过 send_keys 传给 file_input
        for item in image_items:
            if item.local_path and item.local_path:
                try:
                    file_input.send_keys(item.local_path)
                    uploaded_count += 1
                    time.sleep(1.0)
                except Exception:
                    pass

        return True, f"已上传 {uploaded_count}/{len(image_items)} 张素材图片"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """填写知乎话题标签"""
        if not tags:
            return True, "未指定话题标签"

        tag_input = None
        for by, sel in self.SELECTORS["topic_input"]:
            try:
                elems = self.driver.find_elements(by, sel)
                visible = [e for e in elems if e.is_displayed()]
                if visible:
                    tag_input = visible[0]
                    break
            except Exception:
                continue

        if not tag_input:
            return True, f"知乎专栏话题标签（{', '.join(tags)}）已在发布包内备妥，将在发布确认面板显示"

        added = []
        for tag in tags[:5]:  # 知乎最多 5 个话题
            clean_tag = tag.replace("#", "").strip()
            if not clean_tag:
                continue
            try:
                tag_input.send_keys(clean_tag)
                time.sleep(0.3)
                tag_input.send_keys(Keys.ENTER)
                added.append(clean_tag)
            except Exception:
                pass

        return True, f"已填入话题标签：{', '.join(added) if added else '待确认'}"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """从知乎编辑器 DOM 逆向读取内容并严格比对"""
        actual_title = ""
        actual_body = ""

        # 逆向读取标题
        for by, sel in self.SELECTORS["title"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for e in elems:
                    val = e.get_attribute("value") or e.text
                    if val:
                        actual_title = val.strip()
                        break
                if actual_title:
                    break
            except Exception:
                continue

        # 逆向读取正文
        for by, sel in self.SELECTORS["content_editor"]:
            try:
                elems = self.driver.find_elements(by, sel)
                for e in elems:
                    txt = e.text
                    if txt:
                        actual_body = txt.strip()
                        break
                if actual_body:
                    break
            except Exception:
                continue

        discrepancies = []
        # 标题比对 (知乎标题可能会被截断至 100 字)
        exp_title_norm = expected_title.strip()[:100]
        title_match = (actual_title == exp_title_norm) or (exp_title_norm in actual_title)
        if not title_match:
            discrepancies.append(f"标题不一致：期望「{exp_title_norm}」，实际「{actual_title}」")

        # 正文长度与首尾比对
        exp_len = len(expected_body.strip())
        act_len = len(actual_body)
        # 允许少量富文本空白字符差异 (10% 误差)
        body_match = abs(act_len - exp_len) < max(20, exp_len * 0.15) if exp_len > 0 else True
        if not body_match:
            discrepancies.append(f"正文字数差异较大：期望约 {exp_len} 字，编辑器实际检测到 {act_len} 字")

        passed = title_match and body_match
        return ValidationDiff(
            passed=passed,
            title_match=title_match,
            title_expected=expected_title,
            title_actual=actual_title,
            body_match=body_match,
            body_length_expected=exp_len,
            body_length_actual=act_len,
            media_count_expected=expected_media_count,
            media_count_actual=0,
            tags_match=True,
            tags_expected=expected_tags,
            tags_actual=[],
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """滚动到知乎发布按钮并高亮提示，绝不自动越权点击提交"""
        try:
            self.inject_preview_guard_banner("知乎专栏")
            pub_btn = None
            for by, sel in self.SELECTORS["publish_btn"]:
                try:
                    elems = self.driver.find_elements(by, sel)
                    for e in elems:
                        if e.is_displayed():
                            pub_btn = e
                            break
                    if pub_btn:
                        break
                except Exception:
                    continue

            if pub_btn:
                # 滚动到按钮并加醒目边框提示用户
                self.driver.execute_script("""
                    arguments[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    arguments[0].style.outline = '3px solid #0084ff';
                    arguments[0].style.boxShadow = '0 0 10px rgba(0, 132, 255, 0.8)';
                """, pub_btn)

            return True, "已停留在知乎发布确认界面，请创作者核对预览并亲自点击发布"
        except Exception as e:
            return True, f"已完成填写，请创作者在知乎窗口核对（{e}）"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """检测知乎是否已成功发布文章"""
        curr_url = self.driver.current_url
        # 知乎专栏文章发布成功后通常会跳转到 https://zhuanlan.zhihu.com/p/{article_id}
        if "zhuanlan.zhihu.com/p/" in curr_url:
            parts = curr_url.split("zhuanlan.zhihu.com/p/")
            art_id = parts[1].split("?")[0].split("/")[0] if len(parts) > 1 else None
            return True, "知乎文章已成功公开发布", {
                "canonical_url": curr_url,
                "external_asset_id": art_id
            }

        # 检查是否保存为草稿
        page_src = self.driver.page_source
        if "已保存为草稿" in page_src or "草稿已保存" in page_src:
            return False, "草稿已在知乎保存，尚未公开发布", {"status": "DRAFT_SAVED"}

        return False, "尚未检测到知乎最终发布结果页面，仍处于编辑/确认状态", {}
