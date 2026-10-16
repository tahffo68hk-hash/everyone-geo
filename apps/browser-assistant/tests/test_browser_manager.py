"""
浏览器与 Profile 隔离单元测试
"""
from src.browser_manager import browser_manager
from src.config import PROFILES_DIR


def test_profile_path_isolation():
    path_zhihu1 = browser_manager.get_profile_path("ZHIHU", "user_1")
    path_zhihu2 = browser_manager.get_profile_path("ZHIHU", "user_2")
    path_sim = browser_manager.get_profile_path("SIMULATION", "default")
    
    # 互不相同，严格隔离
    assert path_zhihu1 != path_zhihu2
    assert path_zhihu1 != path_sim
    assert "zhihu_user_1" in str(path_zhihu1).lower()
    assert "zhihu_user_2" in str(path_zhihu2).lower()
    assert "simulation_default" in str(path_sim).lower()
    
    # 均位于 PROFILES_DIR 内部，不篡改操作系统默认 Chrome 用户目录
    assert PROFILES_DIR in path_zhihu1.parents or path_zhihu1.parent == PROFILES_DIR


def test_driver_state_tracking():
    # 初始无运行中 driver
    assert browser_manager.is_driver_running("ZHIHU", "non_existent") is False
