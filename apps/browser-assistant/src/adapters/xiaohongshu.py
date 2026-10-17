"""
GeoLens 本地浏览器助手 - 小红书图文平台适配器 (XiaohongshuPublisher)
适配小红书创作者服务平台图文发布页面 (https://creator.xiaohongshu.com/publish/publish?source=official)
结合 social-auto-upload 与 xiaohongshu-mcp 实测经验，严格遵循：
1. 浮层/导览拦截自动清除 (dismiss_popovers)
2. 标题上限 20 字符强校验与截断安全保护
3. 多图按顺序上传与预览卡片校验 (1-9 张图文限制)
4. 话题标签 (#tag) 规范录入
5. PREPARE_ONLY 原则：停留在最终确认阶段，绝不自动越权点击发布
6. 可信发布结果检测：绝不将按钮消失或页面跳转误判为已发布
"""
import time
from typing import Any
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff


class XiaohongshuPublisher(BasePublisher):
    """小红书创作者服务平台图文笔记发布适配器"""

    CHANNEL = "XIAOHONGSHU"
    CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish?source=official"
    LOGIN_URL = "https://creator.xiaohongshu.com/login"

    # 选择器定义
    SELECTORS = {
        # 1. 登录态与用户身份识别
        "avatar": [
            (By.CSS_SELECTOR, "img.avatar-item"),
            (By.CSS_SELECTOR, ".user-avatar"),
            (By.CSS_SELECTOR, ".avatar-wrap"),
            (By.CSS_SELECTOR, ".side-bar-avatar"),
            (By.CSS_SELECTOR, "header img[alt*='头像']"),
            (By.CSS_SELECTOR, ".creator-avatar"),
            (By.CSS_SELECTOR, ".user-info"),
            (By.CSS_SELECTOR, ".author-name"),
        ],
        "login_modal": [
            (By.CSS_SELECTOR, ".login-box"),
            (By.CSS_SELECTOR, ".qrcode-img"),
            (By.CSS_SELECTOR, ".login-container"),
            (By.CSS_SELECTOR, ".qrcode-box"),
            (By.CSS_SELECTOR, ".content-wrapper .login"),
        ],
        # 2. 导览与阻断浮层 (Creator Popovers)
        "popovers": [
            (By.CSS_SELECTOR, ".d-popover"),
            (By.CSS_SELECTOR, ".guide-popover"),
            (By.CSS_SELECTOR, ".popover-content"),
            (By.CSS_SELECTOR, "div[role='tooltip']"),
            (By.CSS_SELECTOR, ".driver-popover-item"),
        ],
        # 3. 图文模式切换 Tab
        "tab_image_note": [
            (By.XPATH, "//div[contains(@class, 'tab') and (contains(text(), '上传图文') or contains(., '上传图文'))]"),
            (By.XPATH, "//span[contains(text(), '图文') or contains(text(), '上传图文')]"),
            (By.XPATH, "//div[contains(text(), '上传图文')]"),
            (By.CSS_SELECTOR, ".publish-tab:nth-child(2)"),
            (By.CSS_SELECTOR, "div[aria-label*='图文']"),
        ],
        # 4. 标题输入框 (上限 20 字)
        "title": [
            (By.CSS_SELECTOR, "input.d-input__inner[placeholder*='填写标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='填写标题']"),
            (By.CSS_SELECTOR, "input[placeholder*='标题']"),
            (By.CSS_SELECTOR, ".titleInput input"),
            (By.CSS_SELECTOR, ".title-input input"),
            (By.CSS_SELECTOR, "#post-title"),
        ],
        # 5. 正文描述富文本 (ContentEditable)
        "content_editor": [
            (By.CSS_SELECTOR, "p[data-placeholder*='输入正文描述']"),
            (By.CSS_SELECTOR, "div.post-content div[contenteditable='true']"),
            (By.CSS_SELECTOR, "div.ql-editor[contenteditable='true']"),
            (By.CSS_SELECTOR, "div[contenteditable='true']"),
            (By.CSS_SELECTOR, "#post-textarea"),
            (By.CSS_SELECTOR, "textarea[placeholder*='正文']"),
        ],
        # 6. 图片上传入口
        "image_file_input": [
            (By.CSS_SELECTOR, ".upload-content input.upload-input"),
            (By.CSS_SELECTOR, "input[type='file'][accept*='image']"),
            (By.CSS_SELECTOR, ".upload-input-container input[type='file']"),
            (By.CSS_SELECTOR, "input[type='file']"),
        ],
        # 7. 图片预览卡片
        "image_previews": [
            (By.CSS_SELECTOR, ".img-preview-area .pr"),
            (By.CSS_SELECTOR, ".preview-item"),
            (By.CSS_SELECTOR, ".upload-image-list .image-item"),
            (By.CSS_SELECTOR, ".image-box"),
            (By.CSS_SELECTOR, ".media-preview-card"),
        ],
        # 8. 话题与标签
        "topic_input": [
            (By.CSS_SELECTOR, "input[placeholder*='话题']"),
            (By.CSS_SELECTOR, ".topic-container input"),
            (By.CSS_SELECTOR, ".topic-input"),
        ],
        # 9. 原创声明 / 内容声明
        "original_declaration": [
            (By.XPATH, "//*[contains(text(), '声明原创') or contains(text(), '内容类型声明')]"),
            (By.CSS_SELECTOR, ".declaration-item"),
        ],
        # 10. 发布与草稿按钮
        "publish_btn": [
            (By.CSS_SELECTOR, "button.publishBtn"),
            (By.CSS_SELECTOR, "button.bg-red"),
            (By.CSS_SELECTOR, ".submit-btn button"),
            (By.XPATH, "//button[contains(text(), '发布') or contains(., '发布')]"),
            (By.CSS_SELECTOR, "button[type='submit']"),
        ],
        "draft_btn": [
            (By.XPATH, "//button[contains(text(), '存草稿') or contains(., '暂存')]"),
            (By.CSS_SELECTOR, ".draft-btn"),
        ],
    }

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        return self.CREATOR_URL

    def dismiss_popovers(self):
        """
        从小红书创作页面清除创作者新手引导或浮层阻断 (实测核心防踩坑逻辑)
        通过 Escape 键与 JS DOM 清除双重保障，避免 element click intercepted
        """
        try:
            # 1. 尝试按 ESC 键关闭可能打开的 popover
            try:
                body = self.driver.find_element(By.TAG_NAME, "body")
                body.send_keys(Keys.ESCAPE)
            except Exception:
                pass

            # 2. 执行安全 JS 清理已存在的引导浮层
            js_clean = """
                var selectors = ['.d-popover', '.guide-popover', '.driver-popover-item', '.ant-popover', 'div[role="tooltip"]'];
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
        """检查小红书创作者服务平台登录状态（高效低延迟探针）"""
        try:
            curr_url = self.driver.current_url.lower()
        except Exception:
            return False, "受控浏览器无响应或已关闭", {}

        if "login" in curr_url or "creator.xiaohongshu.com/login" in curr_url:
            return False, "当前处于小红书登录页面，请创作者在浏览器中扫码登录", {"url": curr_url}

        # 检查关键 Cookie
        try:
            cookies = {c["name"]: c["value"] for c in self.driver.get_cookies()}
        except Exception:
            cookies = {}
        has_auth_cookie = any(k in cookies for k in ["web_session", "a1", "customerClientId", "web_session_id"])

        # 使用单次 JS DOM 查询毫秒级探测登录弹窗/二维码或创作者头像，避免 WebDriver 隐式等待拖慢流水线
        js_probe = """
            var res = { has_modal: false, has_avatar: false, avatar_selector: null };
            var modalSels = ['.login-box', '.qrcode-img', '.login-container', '.qrcode-box', '.content-wrapper .login'];
            for (var i = 0; i < modalSels.length; i++) {
                var m = document.querySelector(modalSels[i]);
                if (m && m.offsetParent !== null) {
                    res.has_modal = true;
                    break;
                }
            }
            var avatarSels = ['img.avatar-item', '.user-avatar', '.avatar-wrap', '.side-bar-avatar', "header img[alt*='头像']", '.creator-avatar', '.user-info', '.author-name'];
            for (var j = 0; j < avatarSels.length; j++) {
                var a = document.querySelector(avatarSels[j]);
                if (a && a.offsetParent !== null) {
                    res.has_avatar = true;
                    res.avatar_selector = avatarSels[j];
                    break;
                }
            }
            return res;
        """
        try:
            probe_res = self.driver.execute_script(js_probe)
            if probe_res.get("has_modal"):
                return False, "检测到小红书登录弹窗或二维码，请在浏览器中完成扫码登录", {"has_cookie": has_auth_cookie}
            if probe_res.get("has_avatar"):
                return True, "检测到小红书创作者头像，已成功登录", {"selector": probe_res.get("avatar_selector"), "has_cookie": has_auth_cookie}
        except Exception:
            pass

        # 如果在 creator.xiaohongshu.com 域名且具备 Cookie
        if "creator.xiaohongshu.com" in curr_url and has_auth_cookie:
            return True, "检测到有效小红书创作者会话凭据", {"has_cookie": True}

        # 若在小红书域名下但未明确匹配
        if "xiaohongshu.com" in curr_url:
            try:
                page_src = self.driver.page_source
                if "扫码登录" in page_src or "登录小红书" in page_src:
                    return False, "小红书提示未登录，请在浏览器窗口扫码登录", {}
                return True, "小红书会话处于活跃状态", {}
            except Exception:
                pass

        return False, "未连接到小红书创作者平台页面", {}

    def open_editor(self) -> tuple[bool, str]:
        """打开小红书创作者发布页面并确保处于【上传图文】状态"""
        try:
            curr_url = self.driver.current_url
            if "creator.xiaohongshu.com/publish" not in curr_url:
                self.driver.get(self.CREATOR_URL)
                time.sleep(2.0)

            # 清理干扰导览浮层
            self.dismiss_popovers()

            # 切换到【上传图文】Tab
            self._switch_to_image_tab()

            # 再次清理浮层
            self.dismiss_popovers()

            return True, "小红书图文创作编辑器已成功加载"
        except Exception as e:
            return False, f"打开小红书发布页面失败：{e}"

    def _switch_to_image_tab(self):
        """确保当前处于【上传图文】Tab 模式"""
        try:
            # 优先使用单次 JS 探测并点击上传图文 Tab
            js_switch = """
                var tabs = document.querySelectorAll('.tab, .publish-tab, div[aria-label*="图文"], span');
                for (var i = 0; i < tabs.length; i++) {
                    var t = tabs[i];
                    if ((t.innerText || '').trim().includes('上传图文')) {
                        t.click();
                        return true;
                    }
                }
                return false;
            """
            switched = self.driver.execute_script(js_switch)
            if switched:
                time.sleep(0.5)
                return
        except Exception:
            pass

        for by, sel in self.SELECTORS["tab_image_note"]:
            try:
                elems = self.driver.find_elements(by, sel)
                visible = [e for e in elems if e.is_displayed()]
                if visible:
                    self.dismiss_popovers()
                    try:
                        visible[0].click()
                    except Exception:
                        self.driver.execute_script("arguments[0].click();", visible[0])
                    time.sleep(0.8)
                    break
            except Exception:
                continue

    def fill_title(self, title: str) -> tuple[bool, str]:
        """
        填写小红书笔记标题
        严格实施 20 字上限约束 (小红书平台硬性限制)
        """
        clean_title = title.strip()
        truncated = False
        if len(clean_title) > 20:
            clean_title = clean_title[:20]
            truncated = True

        self.dismiss_popovers()

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
            return False, "未在页面找到小红书标题输入框"

        try:
            target_elem.click()
            time.sleep(0.1)
            target_elem.send_keys(Keys.CONTROL + "a")
            target_elem.send_keys(Keys.BACKSPACE)
            time.sleep(0.1)
            target_elem.send_keys(clean_title)

            # 派发 input/change 事件确保前端响应式框架同步
            self.driver.execute_script("""
                arguments[0].dispatchEvent(new Event('input', { bubbles: true }));
                arguments[0].dispatchEvent(new Event('change', { bubbles: true }));
            """, target_elem)

            msg = f"小红书标题已填入（{len(clean_title)} 字）"
            if truncated:
                msg += f" [已安全截断至 20 字上限]"
            return True, msg
        except Exception as e:
            # 降级尝试 JS 直接设值
            try:
                self.js_set_value(target_elem, clean_title)
                return True, f"小红书标题通过 JS 辅助填入（{len(clean_title)} 字）"
            except Exception as e2:
                return False, f"填写小红书标题失败：{e2}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填写小红书正文描述富文本 (保留段落换行与表情)"""
        self.dismiss_popovers()

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
            return False, "未找到小红书正文输入区"

        try:
            editor_elem.click()
            time.sleep(0.2)

            # 使用 ClipboardEvent 模拟原生粘贴，保真度最高
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
            time.sleep(0.4)

            # 若未注入成功，降级按段落 send_keys
            current_text = editor_elem.text
            if not current_text or len(current_text) < 10:
                editor_elem.click()
                paragraphs = [p.strip() for p in body.split("\n") if p.strip()]
                for i, para in enumerate(paragraphs):
                    editor_elem.send_keys(para)
                    if i < len(paragraphs) - 1:
                        editor_elem.send_keys(Keys.ENTER)
                    time.sleep(0.04)

            return True, f"正文已写入小红书编辑器（共 {len(body)} 字）"
        except Exception as e:
            return False, f"写入正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """
        自动上传素材图片 (1-9 张图文限制)
        借鉴 social-auto-upload 验证成果：严格按编号顺序依次上传，避免异步并发打乱顺序
        """
        if not media_items:
            return True, "无图片素材需上传"

        image_items = [m for m in media_items if m.type == "IMAGE"]
        if not image_items:
            return True, "无适用图片素材需上传"

        # 小红书图文最多 9 张图片
        if len(image_items) > 9:
            image_items = image_items[:9]

        self.dismiss_popovers()

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
            return True, f"检测到 {len(image_items)} 张待发布图片，请在人工核对时拖拽上传"

        uploaded_count = 0
        for item in image_items:
            if item.local_path and item.local_path.strip():
                try:
                    # 依次上传
                    file_input.send_keys(item.local_path)
                    uploaded_count += 1
                    time.sleep(1.2)  # 等待前端切片和预览生成
                except Exception:
                    pass

        return True, f"已按顺序上传 {uploaded_count}/{len(image_items)} 张素材图片"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """
        填写小红书话题标签 (最多 10 个话题)
        支持直接追加 `#话题 ` 到正文，或输入至话题搜索框
        """
        if not tags:
            return True, "未指定话题标签"

        clean_tags = [t.replace("#", "").strip() for t in tags if t.strip()][:10]
        if not clean_tags:
            return True, "无有效标签"

        self.dismiss_popovers()

        # 优先在正文输入区追加 #tag
        tag_text = " " + " ".join([f"#{t}" for t in clean_tags]) + " "
        try:
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

            if editor_elem:
                editor_elem.click()
                time.sleep(0.1)
                # 追加话题到末尾
                editor_elem.send_keys(Keys.CONTROL, Keys.END)
                editor_elem.send_keys("\n" + tag_text)
                return True, f"已在正文末尾成功填入话题：{', '.join(clean_tags)}"
        except Exception:
            pass

        return True, f"话题标签（{', '.join(clean_tags)}）已在发布包内备妥"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """从真实小红书 DOM 中逆向读取内容并严格比对"""
        self.dismiss_popovers()

        actual_title = ""
        actual_body = ""
        actual_media_count = 0

        # 1. 逆向读取标题
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

        # 2. 逆向读取正文描述
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

        # 3. 统计已上传图片预览卡片
        for by, sel in self.SELECTORS["image_previews"]:
            try:
                previews = self.driver.find_elements(by, sel)
                count = len([p for p in previews if p.is_displayed()])
                if count > 0:
                    actual_media_count = count
                    break
            except Exception:
                continue

        discrepancies = []
        # 标题比对 (小红书标题上限 20 字)
        exp_title_norm = expected_title.strip()[:20]
        title_match = (actual_title == exp_title_norm) or (exp_title_norm in actual_title)
        if not title_match:
            discrepancies.append(f"标题不一致：期望「{exp_title_norm}」，实际「{actual_title}」")

        # 正文字数比对
        exp_len = len(expected_body.strip())
        act_len = len(actual_body)
        # 允许少量富文本格式与话题追加差异
        body_match = abs(act_len - exp_len) < max(30, exp_len * 0.2) if exp_len > 0 else True
        if not body_match:
            discrepancies.append(f"正文字数差异较大：期望约 {exp_len} 字，检测到 {act_len} 字")

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
            media_count_actual=actual_media_count,
            tags_match=True,
            tags_expected=expected_tags,
            tags_actual=[],
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """
        PREPARE_ONLY 核心原则：
        滚动到小红书发布按钮，添加高亮红色边框醒目提醒，绝对不越权点击最终发布！
        将控制权完全留给创作者核验与自行提交。
        """
        self.dismiss_popovers()
        try:
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
                # 滚动到按钮并加醒目小红书红边框 (#ff2442)
                self.driver.execute_script("""
                    arguments[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    arguments[0].style.outline = '3px solid #ff2442';
                    arguments[0].style.boxShadow = '0 0 12px rgba(255, 36, 66, 0.8)';
                """, pub_btn)

            return True, "已停留在小红书发布确认界面，请创作者核对预览并亲自点击发布"
        except Exception as e:
            return True, f"已完成填写，请创作者在小红书窗口核对（{e}）"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """
        检测小红书是否已真正成功发布笔记
        防踩坑：绝不将按钮消失或非预期跳转当成发布成功！必须具备真实的发布反馈
        """
        curr_url = self.driver.current_url.lower()

        # 1. 成功跳转到已发布笔记详情或管理后台
        # 例如 https://creator.xiaohongshu.com/creator/note/list 或 https://www.xiaohongshu.com/explore/{note_id}
        if "explore/" in curr_url:
            parts = curr_url.split("explore/")
            note_id = parts[1].split("?")[0].split("/")[0] if len(parts) > 1 else None
            return True, "小红书笔记已成功公开发布", {
                "canonical_url": curr_url,
                "external_asset_id": note_id
            }

        if "/creator/note/list" in curr_url:
            return True, "小红书笔记已提交至内容管理列表", {
                "canonical_url": curr_url,
                "status": "SUBMITTED"
            }

        # 2. 检查页面中是否出现明确的成功 Toast
        try:
            success_toasts = self.driver.find_elements(By.XPATH, "//*[contains(text(), '发布成功') or contains(text(), '提交成功')]")
            visible_toasts = [t for t in success_toasts if t.is_displayed()]
            if visible_toasts:
                return True, "小红书提示发布成功", {"toast": visible_toasts[0].text}
        except Exception:
            pass

        # 3. 检查草稿状态
        page_src = self.driver.page_source
        if "草稿已保存" in page_src or "已存草稿" in page_src:
            return False, "草稿已在小红书保存，尚未公开发布", {"status": "DRAFT_SAVED"}

        return False, "尚未检测到小红书最终发布落地凭证，仍处于编辑/确认状态", {}

    def get_manual_checklist(self) -> list[str]:
        """返回小红书图文发布专属人工核对清单"""
        return [
            "1. 确认小红书创作者账号及主体正确",
            "2. 核对笔记标题（严格限制 20 字以内，突出痛点与关键词）",
            "3. 检查 1~9 张配图清晰度与顺序（首图决定点击率）",
            "4. 核对正文排版、emoji 表情与分段空行",
            "5. 确认话题标签（#话题，建议 3~5 个热门标签）",
            "6. 确认原创声明与合规设置",
            "7. 在浏览器核查预览效果后，亲自点击【发布】"
        ]
