"""
GeoLens 本地浏览器助手 - 浏览器与 Profile 管理器
管理独立 Chrome Profile、多账号隔离、驱动生命周期与重连机制
"""
import os
import shutil
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import WebDriverException
from .config import PROFILES_DIR, SCREENSHOTS_DIR, settings


class BrowserManager:
    """管理针对各平台与账号的受控 Chrome 实例"""
    def __init__(self):
        # 记录正在运行的 driver: key -> webdriver.Chrome
        self._active_drivers: dict[str, webdriver.Chrome] = {}
        # 记录启动配置
        self._driver_configs: dict[str, dict] = {}

    def _get_profile_key(self, channel: str, account_id: str = "default") -> str:
        safe_channel = "".join(c for c in channel if c.isalnum() or c in "_-").lower()
        safe_account = "".join(c for c in account_id if c.isalnum() or c in "_-").lower()
        return f"{safe_channel}_{safe_account}"

    def get_profile_path(self, channel: str, account_id: str = "default") -> Path:
        """获取目标平台和账号绑定的独立 Profile 目录路径"""
        key = self._get_profile_key(channel, account_id)
        profile_path = PROFILES_DIR / key
        profile_path.mkdir(parents=True, exist_ok=True)
        return profile_path

    def is_driver_running(self, channel: str, account_id: str = "default") -> bool:
        """检查特定会话的浏览器是否处于正常运行状态"""
        key = self._get_profile_key(channel, account_id)
        driver = self._active_drivers.get(key)
        if not driver:
            return False
        try:
            # 探测当前 window_handles 确认进程存活
            _ = driver.window_handles
            return True
        except Exception:
            # 已崩溃或被用户手动关闭
            self._active_drivers.pop(key, None)
            return False

    def get_or_create_driver(
        self,
        channel: str,
        account_id: str = "default",
        headless: bool = False
    ) -> webdriver.Chrome:
        """
        获取已有驱动或启动全新的受控 Chrome 实例
        使用专属 Profile 目录，用户登录状态持久化在本地 Profile
        """
        key = self._get_profile_key(channel, account_id)
        
        # 如果已有存活的 driver 且配置一致，直接复用
        if self.is_driver_running(channel, account_id):
            curr_headless = self._driver_configs.get(key, {}).get("headless", False)
            if curr_headless == headless:
                return self._active_drivers[key]
            else:
                # 模式变更（例如从 headless 切换为人工可见模式），关闭重建
                self.close_driver(channel, account_id)

        profile_path = self.get_profile_path(channel, account_id)

        options = Options()
        # 关键：指定独立的 User Data Directory，杜绝接管用户日常浏览器 Profile
        options.add_argument(f"--user-data-dir={str(profile_path)}")
        options.add_argument("--profile-directory=Default")
        options.add_argument("--no-first-run")
        options.add_argument("--no-default-browser-check")
        options.add_argument("--disable-search-engine-choice-screen")
        options.add_argument("--disable-blink-features=AutomationControlled")
        
        # 规避某些安全机制误报
        options.add_experimental_option("excludeSwitches", ["enable-automation"])
        options.add_experimental_option("useAutomationExtension", False)

        if headless:
            options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--window-size=1920,1080")
        else:
            options.add_argument("--window-size=1400,900")

        # 显式路径配置（若系统有特殊指定）
        if settings.chrome_binary_path and os.path.exists(settings.chrome_binary_path):
            options.binary_location = settings.chrome_binary_path

        try:
            # Selenium 4 自动使用 Selenium Manager 下载/匹配 ChromeDriver
            driver = webdriver.Chrome(options=options)
            driver.set_page_load_timeout(settings.page_load_timeout_sec)
            driver.implicitly_wait(2)
            
            self._active_drivers[key] = driver
            self._driver_configs[key] = {"headless": headless, "started_at": time.time()}
            return driver
        except WebDriverException as e:
            # 常见错误：Profile 目录被另一个 Chrome 实例独占锁定
            if "user data directory is already in use" in str(e).lower():
                raise RuntimeError(
                    f"浏览器 Profile 目录已被占用：{profile_path}。请先关闭冲突的 Chrome 窗口后重试。"
                ) from e
            raise RuntimeError(f"启动 Chrome 失败：{e}") from e

    def close_driver(self, channel: str, account_id: str = "default") -> bool:
        """安全关闭指定会话的浏览器进程"""
        key = self._get_profile_key(channel, account_id)
        driver = self._active_drivers.pop(key, None)
        self._driver_configs.pop(key, None)
        if driver:
            try:
                driver.quit()
                return True
            except Exception:
                return False
        return False

    def clear_profile(self, channel: str, account_id: str = "default") -> bool:
        """
        清理特定会话的本地 Profile 数据（重置登录态）
        必须先确保浏览器已关闭
        """
        self.close_driver(channel, account_id)
        profile_path = self.get_profile_path(channel, account_id)
        if profile_path.exists():
            try:
                # 稍作等待以释放文件句柄
                time.sleep(0.5)
                shutil.rmtree(profile_path, ignore_errors=True)
                profile_path.mkdir(parents=True, exist_ok=True)
                return True
            except Exception as e:
                raise RuntimeError(f"清理 Profile 目录失败：{e}") from e
        return True

    def take_screenshot(self, channel: str, account_id: str = "default", name: str = "snapshot") -> str | None:
        """对当前页面捕获快照截图，用于结果留存或故障分析"""
        key = self._get_profile_key(channel, account_id)
        driver = self._active_drivers.get(key)
        if not driver:
            return None
        try:
            timestamp = int(time.time() * 1000)
            file_name = f"{key}_{name}_{timestamp}.png"
            file_path = SCREENSHOTS_DIR / file_name
            driver.save_screenshot(str(file_path))
            return str(file_path)
        except Exception:
            return None

    def close_all(self):
        """关闭所有处于运行状态的浏览器"""
        keys = list(self._active_drivers.keys())
        for key in keys:
            driver = self._active_drivers.pop(key, None)
            if driver:
                try:
                    driver.quit()
                except Exception:
                    pass
        self._driver_configs.clear()


# 全局单例
browser_manager = BrowserManager()
