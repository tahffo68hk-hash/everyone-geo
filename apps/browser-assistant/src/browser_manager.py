"""
GeoLens 本地浏览器助手 - 浏览器与 Profile 管理器
管理独立 Chrome Profile、多账号隔离、驱动生命周期与重连机制
"""
import os
import shutil
import time
import threading
import concurrent.futures
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
        # 线程锁保障驱动字典与并发操作安全
        self._lock = threading.RLock()
        # 记录正在执行耗时操作的驱动标记，避免轮询探针对其并发加锁
        self._driver_busy: set[str] = set()
        # 记录上次健康探测成功时间戳，防止高频前端轮询反复触发远程网络调用
        self._last_healthy_check: dict[str, float] = {}

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

    def mark_busy(self, channel: str, account_id: str = "default"):
        key = self._get_profile_key(channel, account_id)
        with self._lock:
            self._driver_busy.add(key)

    def mark_idle(self, channel: str, account_id: str = "default"):
        key = self._get_profile_key(channel, account_id)
        with self._lock:
            self._driver_busy.discard(key)
            self._last_healthy_check[key] = time.time()

    def is_driver_running(self, channel: str, account_id: str = "default") -> bool:
        """
        检查特定会话的浏览器是否处于正常运行状态
        增加本地进程快速探针与防死锁短路机制，杜绝前端 1s 轮询与发布主线程远程调用冲突
        """
        key = self._get_profile_key(channel, account_id)
        driver = self._active_drivers.get(key)
        if not driver:
            return False

        # 1. 快速检查底层 ChromeDriver 操作系统进程是否存活
        try:
            proc = getattr(getattr(driver, "service", None), "process", None)
            if proc and proc.poll() is not None:
                # 进程已经退出
                with self._lock:
                    self._active_drivers.pop(key, None)
                    self._driver_configs.pop(key, None)
                    self._driver_busy.discard(key)
                    self._last_healthy_check.pop(key, None)
                return False
        except Exception:
            pass

        # 2. 如果当前有任务正在操作该驱动，说明它处于活跃忙碌状态，直接返回 True 避免并发指令死锁
        if key in self._driver_busy:
            return True

        # 3. 如果在 2.5 秒内刚刚探测成功过，复用探测结果，避免高频打挂 ChromeDriver
        now = time.time()
        if now - self._last_healthy_check.get(key, 0) < 2.5:
            return True

        # 4. 执行实际存活探测 (设置快速超时与异常清理)
        try:
            _ = driver.window_handles
            self._last_healthy_check[key] = now
            return True
        except Exception:
            with self._lock:
                self._active_drivers.pop(key, None)
                self._driver_configs.pop(key, None)
                self._driver_busy.discard(key)
                self._last_healthy_check.pop(key, None)
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
        增加启动看门狗超时、陈旧文件清理与核心稳定性参数
        """
        key = self._get_profile_key(channel, account_id)

        with self._lock:
            # 如果已有存活的 driver 且配置一致，直接复用
            if self.is_driver_running(channel, account_id):
                curr_headless = self._driver_configs.get(key, {}).get("headless", False)
                if curr_headless == headless:
                    return self._active_drivers[key]
                else:
                    # 模式变更（例如从 headless 切换为人工可见模式），关闭重建
                    self.close_driver(channel, account_id)

            profile_path = self.get_profile_path(channel, account_id)

            # 启动前清理陈旧锁文件以防旧会话非正常退出残留阻塞
            for lock_name in ["DevToolsActivePort", "SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]:
                lock_file = profile_path / lock_name
                if lock_file.exists():
                    try:
                        lock_file.unlink(missing_ok=True)
                    except Exception:
                        pass

            options = Options()
            # 关键：指定独立的 User Data Directory，杜绝接管用户日常浏览器 Profile
            options.add_argument(f"--user-data-dir={str(profile_path)}")
            options.add_argument("--profile-directory=Default")
            options.add_argument("--no-first-run")
            options.add_argument("--no-default-browser-check")
            options.add_argument("--disable-search-engine-choice-screen")
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_argument("--remote-debugging-port=0")
            options.add_argument("--disable-features=Translate,OptimizationHints,MediaRouter")
            options.add_argument("--disable-background-networking")
            options.add_argument("--disable-sync")
            options.add_argument("--disable-default-apps")
            options.add_argument("--no-service-autorun")
            options.add_argument("--password-store=basic")
            
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

            # 使用看门狗线程启动 Chrome，防止底层 socket 连接无响应死锁
            def _launch():
                return webdriver.Chrome(options=options)

            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(_launch)
                    try:
                        driver = future.result(timeout=25.0)
                    except concurrent.futures.TimeoutError:
                        raise RuntimeError(
                            f"调起 Chrome 实例超时 (25s)。请确认系统无冲突的 Chrome 进程独占 Profile 目录：{profile_path}"
                        )

                driver.set_page_load_timeout(settings.page_load_timeout_sec)
                driver.implicitly_wait(1)

                self._active_drivers[key] = driver
                self._driver_configs[key] = {"headless": headless, "started_at": time.time()}
                self._last_healthy_check[key] = time.time()
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
        with self._lock:
            self._driver_busy.discard(key)
            self._last_healthy_check.pop(key, None)
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
        with self._lock:
            keys = list(self._active_drivers.keys())
            for key in keys:
                driver = self._active_drivers.pop(key, None)
                if driver:
                    try:
                        driver.quit()
                    except Exception:
                        pass
            self._driver_configs.clear()
            self._driver_busy.clear()
            self._last_healthy_check.clear()


# 全局单例
browser_manager = BrowserManager()

