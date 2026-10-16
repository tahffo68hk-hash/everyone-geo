"""
GeoLens 本地浏览器助手 - 测试执行脚本
一键运行安全测试、驱动管理测试、知乎适配器测试与真实受控 Chrome E2E 自动化
"""
import sys
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR.parent.parent))

def p(*args, **kwargs):
    print(*args, **kwargs, flush=True)

def run_all_tests():
    p("=" * 65)
    p("   GeoLens Browser Assistant - Test Suite Runner")
    p("=" * 65)

    failures = 0
    passed = 0

    # 1. 运行安全测试
    p("\n[1/4] Running Security & Token Auth Tests...")
    try:
        from tests import test_security
        test_security.test_token_generation_and_persistence()
        test_security.test_origin_whitelist()
        test_security.test_request_auth_verification()
        test_security.test_sensitive_log_sanitization()
        p("  -> PASS: Security tests passed (4/4)")
        passed += 4
    except Exception as e:
        p(f"  -> FAIL: Security test failed: {e}")
        failures += 1

    # 2. 运行浏览器管理测试
    p("\n[2/4] Running Browser Manager & Profile Isolation Tests...")
    try:
        from tests import test_browser_manager
        test_browser_manager.test_profile_path_isolation()
        test_browser_manager.test_driver_state_tracking()
        p("  -> PASS: Browser manager tests passed (2/2)")
        passed += 2
    except Exception as e:
        p(f"  -> FAIL: Browser manager test failed: {e}")
        failures += 1

    # 3. 运行知乎平台适配器测试
    p("\n[3/5] Running Zhihu Adapter Unit Tests...")
    try:
        from tests import test_zhihu_adapter
        test_zhihu_adapter.test_zhihu_publisher_metadata()
        test_zhihu_adapter.test_zhihu_validate_draft_logic()
        p("  -> PASS: Zhihu adapter tests passed (2/2)")
        passed += 2
    except Exception as e:
        p(f"  -> FAIL: Zhihu adapter test failed: {e}")
        failures += 1

    # 4. 运行小红书平台适配器测试
    p("\n[4/5] Running Xiaohongshu Adapter Unit Tests...")
    try:
        from tests import test_xiaohongshu_adapter
        test_xiaohongshu_adapter.test_xiaohongshu_publisher_metadata()
        test_xiaohongshu_adapter.test_xiaohongshu_title_20_char_limit()
        test_xiaohongshu_adapter.test_xiaohongshu_popover_dismissal()
        test_xiaohongshu_adapter.test_xiaohongshu_validate_draft_logic()
        test_xiaohongshu_adapter.test_xiaohongshu_prepare_for_confirmation_gate()
        test_xiaohongshu_adapter.test_xiaohongshu_read_publish_result()
        p("  -> PASS: Xiaohongshu adapter tests passed (6/6)")
        passed += 6
    except Exception as e:
        p(f"  -> FAIL: Xiaohongshu adapter test failed: {e}")
        failures += 1

    # 5. 运行人工发布包 ZIP 生成与导出测试
    p("\n[5/6] Running Manual Package ZIP Generator Tests...")
    try:
        from tests import test_manual_package_zip
        test_manual_package_zip.test_generate_manual_package_zip_content()
        p("  -> PASS: Manual package ZIP stream, README.md, manifest passed")
        passed += 1
    except Exception as e:
        p(f"  -> FAIL: Manual package ZIP test failed: {e}")
        failures += 1

    # 6. 运行真实受控 Chrome Selenium E2E 测试
    p("\n[6/6] Running Real Selenium Chrome Headless E2E Pipeline Tests...")
    try:
        from tests import test_e2e_simulation
        test_e2e_simulation.test_real_selenium_e2e_pipeline()
        p("  -> PASS: Real Selenium E2E 9-step pipeline & screenshot passed")
        test_e2e_simulation.test_task_manager_pause_and_takeover()
        p("  -> PASS: Task pause, resume, takeover & confirmation passed")
        passed += 2
    except Exception as e:
        import traceback
        traceback.print_exc()
        p(f"  -> FAIL: Real Selenium E2E test failed: {e}")
        failures += 1

    p("\n" + "=" * 65)
    p(f"   Test Summary: {passed} Passed, {failures} Failed")
    p("=" * 65)

    if failures > 0:
        sys.exit(1)
    else:
        p(" All Python browser assistant tests completed successfully!\n")

if __name__ == "__main__":
    run_all_tests()
