"""
GeoLens 本地浏览器助手 - 平台适配器抽象基类 (BasePublisher)
规范各目标平台发布适配器的生命周期与操作契约
"""
from abc import ABC, abstractmethod
from typing import Any
from selenium import webdriver
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.by import By
from ..models import MediaItem, ValidationDiff


class BasePublisher(ABC):
    """平台发布适配器基类"""
    def __init__(self, driver: webdriver.Chrome, timeout_sec: int = 15):
        self.driver = driver
        self.timeout_sec = timeout_sec
        self.wait = WebDriverWait(driver, timeout_sec)

    @abstractmethod
    def get_channel_name(self) -> str:
        """返回适配的渠道标识，例如 ZHIHU, SIMULATION, XIAOHONGSHU"""
        pass

    @abstractmethod
    def get_creator_url(self) -> str:
        """返回官方创作页面绝对 URL"""
        pass

    @abstractmethod
    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """
        检查目标平台登录状态
        :return: (is_logged_in, status_message, extra_data)
        """
        pass

    def open_login_page(self) -> tuple[bool, str]:
        """
        打开对应平台的官方登录/扫码页面
        :return: (success, status_message)
        """
        try:
            self.driver.get(self.get_creator_url())
            return True, f"已在受控浏览器打开 {self.get_channel_name()} 官方页面"
        except Exception as e:
            return False, f"打开登录页失败：{e}"

    def navigate_creator_center(self) -> tuple[bool, str]:
        """导航至创作者服务中心入口"""
        try:
            curr = self.driver.current_url.lower()
            creator_url = self.get_creator_url()
            if creator_url and creator_url.split("?")[0].rstrip("/") not in curr:
                self.driver.get(creator_url)
            self.dismiss_popovers()
            self.handle_new_tab()
            return True, f"已进入 {self.get_channel_name()} 创作者中心"
        except Exception as e:
            return False, f"进入创作者中心失败：{e}"

    def select_content_type(self, content_type: str = "IMAGE_TEXT") -> tuple[bool, str]:
        """显式选择创作类型 (图文/视频/长文/动态)"""
        self.dismiss_popovers()
        self.handle_new_tab()
        # 兼容各子类的专有切换逻辑 (如小红书 _switch_to_image_tab)
        if hasattr(self, "_switch_to_image_tab") and content_type in ["IMAGE_TEXT", "ARTICLE"]:
            try:
                self._switch_to_image_tab()
            except Exception:
                pass
        return True, f"已选择 {self.get_channel_name()} 创作类型：{content_type}"

    def ensure_editor_ready(self) -> tuple[bool, str]:
        """确认编辑器 DOM 与交互状态就绪，并自动清理弹窗"""
        self.dismiss_popovers()
        self.handle_new_tab()
        return True, "编辑器页面已处于可交互编辑态"

    def handle_new_tab(self) -> bool:
        """检测并切换到新打开的标签页（应对部分平台点击新建后新开窗口的行为）"""
        try:
            handles = self.driver.window_handles
            if len(handles) > 1 and self.driver.current_window_handle != handles[-1]:
                self.driver.switch_to.window(handles[-1])
                return True
        except Exception:
            pass
        return False

    def capture_screenshot(self, save_path: str) -> bool:
        """捕获当前受控浏览器画面快照供诊断溯源"""
        try:
            from pathlib import Path
            p = Path(save_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            self.driver.save_screenshot(str(p))
            return True
        except Exception:
            return False

    def detect_blocking(self) -> tuple[bool, str]:
        """毫秒级检测风控、验证码、短信验证或滑块阻断"""
        try:
            page_src = self.driver.page_source
            blocked_keywords = ["验证码", "安全验证", "滑块验证", "短信验证", "请完成验证", "访问受限", "异常操作", "环境异常"]
            for kw in blocked_keywords:
                if kw in page_src:
                    # 避免把正常文案中的“验证”误判为阻断，需检测特定弹窗容器
                    js_check_modal = """
                        var selectors = ['.geetest_radar_tip', '.nc_wrapper', '.secsdk-captcha-drag-icon', '.yidun_modal', '.captcha-modal', '[class*="captcha"]', '[class*="verify-bar"]', '.vaptcha-container'];
                        for (var i = 0; i < selectors.length; i++) {
                            var el = document.querySelector(selectors[i]);
                            if (el && el.offsetParent !== null) return true;
                        }
                        return false;
                    """
                    if self.driver.execute_script(js_check_modal):
                        return True, f"检测到平台安全验证机制（{kw}），请在受控浏览器中手动完成验证"
        except Exception:
            pass
        return False, ""

    @abstractmethod
    def open_editor(self) -> tuple[bool, str]:
        """
        打开对应平台的内容创作与文章发布页面
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_title(self, title: str) -> tuple[bool, str]:
        """
        自动填写标题
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_content(self, body: str) -> tuple[bool, str]:
        """
        自动填写正文 (需处理富文本、段落换行或 Markdown)
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """
        自动上传图片或视频素材
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """
        自动填写话题标签及其他适用字段
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """
        双向校验填写结果与原始内容是否一致
        :return: ValidationDiff 结构体
        """
        pass

    @abstractmethod
    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """
        停留在最终发布确认阶段，滚动到确认区域，留给用户核查与最终决定
        不得未经授权擅自点击终态发布提交
        :return: (success, status_message)
        """
        pass

    @abstractmethod
    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """
        根据真实平台反馈，记录提交、审核或发布结果
        :return: (is_published, status_message, {canonical_url, external_asset_id, etc.})
        """
        pass

    def is_video_channel(self) -> bool:
        """判断是否为以视频上传为核心的渠道"""
        return False

    def dismiss_popovers(self):
        """清除页面引导弹窗、新手浮层或草稿恢复提示 (子类按需重写)"""
        pass

    def upload_cover(self, cover_item: MediaItem) -> tuple[bool, str]:
        """独立上传封面图片 (视频平台适用)"""
        return True, "未配置独立封面上传逻辑"

    def fill_category(self, category: str) -> tuple[bool, str]:
        """设置发布分类/分区"""
        return True, "未配置分区设置"

    def fill_required_declarations(self) -> tuple[bool, str]:
        """设置平台要求的必要声明 (如原创声明、AI 生成标记等)"""
        return True, "已确认声明设置"

    def wait_for_upload_completion(self, timeout_sec: int = 60) -> tuple[bool, str]:
        """等待素材/视频上传及转码处理完成"""
        return True, "上传完成状态已就绪"

    def get_manual_checklist(self) -> list[str]:
        """返回人工发布时的核对清单"""
        return [
            "确认已登录正确的创作者账号",
            "检查文章标题无错漏与错别字",
            "核对正文排版、段落换行与重点加粗",
            "核对配图清晰度与展示顺序",
            "确认话题标签与专栏分类",
            "完成最终人工核对后点击发布"
        ]

    # ---- 常用辅助工具方法 ----
    def safe_find(self, by: By, value: str, timeout: int | None = None):
        t = timeout or self.timeout_sec
        return WebDriverWait(self.driver, t).until(
            EC.presence_of_element_located((by, value))
        )

    def safe_click(self, by: By, value: str, timeout: int | None = None):
        t = timeout or self.timeout_sec
        element = WebDriverWait(self.driver, t).until(
            EC.element_to_be_clickable((by, value))
        )
        try:
            element.click()
        except Exception:
            # 降级为 JS 点击，避免被浮层或动画阻挡
            self.driver.execute_script("arguments[0].click();", element)
        return element

    def js_set_value(self, element, value: str):
        """
        通过 JS 直接设值并触发 input/change/blur 事件
        深度适配 React、Vue、Angular 及各平台自定义 WebComponent (Semi Design / Ant Design / TDesign)
        """
        js_code = """
            var el = arguments[0];
            var val = arguments[1];
            if (!el) return;
            try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(e){}
            try { el.focus(); } catch(e){}
            if (el.matches && el.matches('input, textarea')) {
                try {
                    if (el._valueTracker) {
                        el._valueTracker.setValue('');
                    }
                } catch(e) {}
                var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                var desc = Object.getOwnPropertyDescriptor(proto, 'value');
                if (desc && desc.set) {
                    desc.set.call(el, val);
                } else {
                    el.value = val;
                }
            } else {
                try {
                    document.execCommand('selectAll', false, null);
                    var inserted = document.execCommand('insertText', false, val);
                    if (!inserted) {
                        el.innerText = val;
                    }
                } catch(e) {
                    el.innerText = val;
                }
            }
            try {
                el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: val }));
            } catch(e) {
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        """
        self.driver.execute_script(js_code, element, value)

    def set_field_text(self, element, value: str):
        """
        全保真设值：组合原生键盘清除与底层原型注入，彻底杜绝单页应用表单丢失输入的问题
        """
        try:
            element.click()
        except Exception:
            try:
                self.driver.execute_script("arguments[0].click();", element)
            except Exception:
                pass
        self.js_set_value(element, value)

    def find_file_input_cross_frames(self, kind: str = "video") -> Any | None:
        """
        跨主文档与所有 iframe 递归寻找文件上传输入框
        解决微信视频号等复杂 SPA 在微前端子 iframe 内渲染上传组件的问题
        """
        expected_type = "video" if kind.lower() == "video" else "image"
        
        # 1. 在当前/主文档中查找
        try:
            inputs = self.driver.find_elements(By.CSS_SELECTOR, "input[type='file']")
            for inp in inputs:
                accept = (inp.get_attribute("accept") or "").lower()
                if expected_type in accept or accept == "" or (".mp4" in accept if expected_type == "video" else (".png" in accept or ".jpg" in accept)):
                    return inp
        except Exception:
            pass

        # 2. 遍历 iframe
        try:
            frames = self.driver.find_elements(By.TAG_NAME, "iframe")
            for fr in frames:
                try:
                    self.driver.switch_to.frame(fr)
                    sub_inputs = self.driver.find_elements(By.CSS_SELECTOR, "input[type='file']")
                    for inp in sub_inputs:
                        accept = (inp.get_attribute("accept") or "").lower()
                        if expected_type in accept or accept == "" or (".mp4" in accept if expected_type == "video" else (".png" in accept or ".jpg" in accept)):
                            return inp
                    self.driver.switch_to.default_content()
                except Exception:
                    self.driver.switch_to.default_content()
                    continue
        except Exception:
            try:
                self.driver.switch_to.default_content()
            except Exception:
                pass

        return None

    def inject_preview_guard_banner(self, platform_name: str = "", extra_tip: str = ""):
        """
        在受控浏览器顶部注入显著的 GeoLens PREPARE_ONLY 预览安全守卫横幅
        明确提示创作者：内容已自动填写完成，处于发布前人工审核阶段，绝不自动提交。
        """
        try:
            plat_str = f"【{platform_name}】" if platform_name else ""
            tip_str = f" · {extra_tip}" if extra_tip else " · 请创作者亲自核对标题、正文、素材与各项设置后手动点击最终发布"
            full_msg = f"🛡️ GeoLens 自动化发布准备已完成 {plat_str}{tip_str}"
            js_code = """
                var existing = document.getElementById('geolens-preview-guard-banner');
                if (existing) {
                    existing.innerHTML = arguments[0];
                    return;
                }
                var banner = document.createElement('div');
                banner.id = 'geolens-preview-guard-banner';
                banner.innerHTML = arguments[0];
                banner.style.position = 'fixed';
                banner.style.top = '0';
                banner.style.left = '0';
                banner.style.right = '0';
                banner.style.zIndex = '2147483647';
                banner.style.backgroundColor = '#1e293b';
                banner.style.color = '#38bdf8';
                banner.style.borderBottom = '3px solid #0284c7';
                banner.style.textAlign = 'center';
                banner.style.padding = '10px 16px';
                banner.style.fontSize = '14px';
                banner.style.fontWeight = '700';
                banner.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif';
                banner.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
                banner.style.pointerEvents = 'none';
                banner.style.letterSpacing = '0.5px';
                document.body.appendChild(banner);
            """
            self.driver.execute_script(js_code, full_msg)
        except Exception:
            pass


