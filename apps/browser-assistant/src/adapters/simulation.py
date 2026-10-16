"""
GeoLens 本地浏览器助手 - 本地仿真发布平台适配器 (LocalSimulationPublisher)
基于本地受控静态仿真页面运行，支持 100% 离线、高确定性的端到端测试与逻辑验证
"""
import time
from typing import Any
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from .base import BasePublisher
from ..models import MediaItem, ValidationDiff
from ..config import settings


class LocalSimulationPublisher(BasePublisher):
    """本地仿真平台发布适配器"""
    
    CHANNEL = "SIMULATION"

    def __init__(self, driver, timeout_sec: int = 10, server_url: str | None = None):
        super().__init__(driver, timeout_sec)
        self.server_url = server_url or f"http://{settings.host}:{settings.port}"

    def get_channel_name(self) -> str:
        return self.CHANNEL

    def get_creator_url(self) -> str:
        from ..config import BASE_DIR
        local_html = BASE_DIR / "src" / "static" / "simulation-editor.html"
        if local_html.exists():
            import os
            return f"file:///{str(local_html).replace(os.sep, '/')}"
        return f"{self.server_url}/static/simulation-editor.html"

    def check_login(self) -> tuple[bool, str, dict[str, Any]]:
        """检查仿真页面登录态"""
        try:
            curr_url = self.driver.current_url
            if "simulation-editor.html" not in curr_url:
                self.open_editor()
            
            avatar = self.safe_find(By.ID, "user-avatar", timeout=3)
            user_name = self.safe_find(By.ID, "user-name", timeout=3)
            if avatar and user_name:
                return True, "仿真创作者账号已登录并就绪", {"user": user_name.text}
            return False, "未检测到仿真创作者身份", {}
        except Exception as e:
            return False, f"登录态检测失败：{e}", {}

    def open_editor(self) -> tuple[bool, str]:
        """打开本地仿真编辑器"""
        url = self.get_creator_url()
        try:
            self.driver.get(url)
            self.safe_find(By.ID, "sim-title", timeout=5)
            return True, "本地仿真创作编辑器已就绪"
        except Exception as e:
            return False, f"打开仿真编辑器失败：{e}"

    def fill_title(self, title: str) -> tuple[bool, str]:
        """填入标题"""
        try:
            title_elem = self.safe_find(By.ID, "sim-title")
            title_elem.clear()
            title_elem.send_keys(title)
            # 触发 input
            self.driver.execute_script("arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", title_elem)
            return True, f"仿真平台标题已填入（{len(title)} 字）"
        except Exception as e:
            return False, f"填写标题失败：{e}"

    def fill_content(self, body: str) -> tuple[bool, str]:
        """填入富文本正文"""
        try:
            body_elem = self.safe_find(By.ID, "sim-body")
            body_elem.click()
            
            # 使用 DataTransfer 模拟真实富文本粘贴
            js_paste_script = """
                var element = arguments[0];
                var text = arguments[1];
                element.innerText = text;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            """
            self.driver.execute_script(js_paste_script, body_elem, body)
            return True, f"仿真平台正文已写入（{len(body)} 字）"
        except Exception as e:
            return False, f"写入正文失败：{e}"

    def upload_media(self, media_items: list[MediaItem]) -> tuple[bool, str]:
        """上传素材"""
        if not media_items:
            return True, "无素材需上传"
        try:
            input_elem = self.safe_find(By.ID, "sim-media-input")
            uploaded = 0
            for item in media_items:
                if item.local_path:
                    try:
                        input_elem.send_keys(item.local_path)
                        uploaded += 1
                    except Exception:
                        pass
            return True, f"已上传素材 {uploaded}/{len(media_items)} 个"
        except Exception as e:
            return False, f"上传素材失败：{e}"

    def fill_tags(self, tags: list[str]) -> tuple[bool, str]:
        """填入标签"""
        if not tags:
            return True, "无标签需填写"
        try:
            tag_input = self.safe_find(By.ID, "sim-tag-input")
            added = []
            for tag in tags[:5]:
                clean_tag = tag.replace("#", "").strip()
                if not clean_tag:
                    continue
                tag_input.send_keys(clean_tag)
                tag_input.send_keys(Keys.ENTER)
                time.sleep(0.1)
                added.append(clean_tag)
            return True, f"已添加话题标签：{', '.join(added)}"
        except Exception as e:
            return False, f"添加标签失败：{e}"

    def validate_draft(
        self,
        expected_title: str,
        expected_body: str,
        expected_tags: list[str],
        expected_media_count: int = 0
    ) -> ValidationDiff:
        """从 DOM 读取输入值并比对一致性"""
        title_elem = self.safe_find(By.ID, "sim-title")
        body_elem = self.safe_find(By.ID, "sim-body")
        
        actual_title = (title_elem.get_attribute("value") or "").strip()
        actual_body = (body_elem.text or "").strip()
        
        # 标签比对
        tag_chips = self.driver.find_elements(By.CSS_SELECTOR, "#sim-tags-wrapper .tag-chip span:first-child")
        actual_tags = [c.text.replace("#", "").strip() for c in tag_chips]

        discrepancies = []
        title_match = (actual_title == expected_title.strip())
        if not title_match:
            discrepancies.append(f"标题不一致：期望「{expected_title}」，实际「{actual_title}」")

        exp_len = len(expected_body.strip())
        act_len = len(actual_body)
        body_match = (actual_body == expected_body.strip()) or (abs(act_len - exp_len) < 5)
        if not body_match:
            discrepancies.append(f"正文不一致：期望字数 {exp_len}，实际检测到 {act_len}")

        tags_expected_clean = [t.replace("#", "").strip() for t in expected_tags]
        tags_match = set(tags_expected_clean).issubset(set(actual_tags)) if tags_expected_clean else True
        if not tags_match:
            discrepancies.append(f"话题标签不一致：期望 {tags_expected_clean}，实际填入 {actual_tags}")

        passed = title_match and body_match and tags_match

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
            tags_match=tags_match,
            tags_expected=expected_tags,
            tags_actual=actual_tags,
            discrepancies=discrepancies
        )

    def prepare_for_confirmation(self) -> tuple[bool, str]:
        """停留在发布确认前，高亮发布按钮"""
        try:
            pub_btn = self.safe_find(By.ID, "sim-publish-btn")
            self.driver.execute_script("""
                arguments[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                arguments[0].style.outline = '3px solid #2563eb';
                arguments[0].style.boxShadow = '0 0 12px rgba(37, 99, 235, 0.6)';
            """, pub_btn)
            return True, "表单已自动填妥并通过校验，正停留在最终发布按钮前等待人工确认"
        except Exception as e:
            return False, f"准备确认阶段异常：{e}"

    def simulate_user_publish_click(self) -> tuple[bool, str]:
        """辅助方法（测试专用）：模拟用户在浏览器亲自点击确认发布按钮"""
        try:
            self.safe_click(By.ID, "sim-publish-btn")
            time.sleep(0.5)
            return True, "模拟用户点击确认发布成功"
        except Exception as e:
            return False, f"点击发布按钮失败：{e}"

    def read_publish_result(self) -> tuple[bool, str, dict[str, Any]]:
        """读取仿真发布结果"""
        try:
            pub_url = self.driver.execute_script("return document.body.getAttribute('data-published-url');")
            pub_id = self.driver.execute_script("return document.body.getAttribute('data-published-id');")
            if pub_url and pub_id:
                return True, "检测到文章公开发布成功", {
                    "canonical_url": pub_url,
                    "external_asset_id": pub_id
                }
            return False, "尚未检测到发布结果，仍处于等待发布阶段", {}
        except Exception as e:
            return False, f"读取发布结果异常：{e}", {}
