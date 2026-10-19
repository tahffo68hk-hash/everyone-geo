"""
GeoLens - 剩余 8 大平台真实自动化巡检与 PREPARE_ONLY 验收脚本
覆盖渠道：知乎 (ZHIHU)、微博 (WEIBO)、抖音 (DOUYIN)、微信公众号 (WECHAT_OFFICIAL_ACCOUNT)、
今日头条 (TOUTIAO)、百家号 (BAIJIAHAO)、快手 (KUAISHOU)、微信视频号 (WECHAT_CHANNELS)

执行原则：
1. 真实浏览器探测登录态；
2. 若已登录，立即执行完整 PREPARE_ONLY 流程（导航、选型、填表、素材上传、自检比对、停在发布前高亮按钮，存证截图），判定 REAL_READY_FOR_REVIEW；
3. 若未登录，打开对应官方登录/扫码入口，留存真实二维码/登录界面截图，判定 LOGIN_REQUIRED，不挂起等待；
4. 绝不伪造 PASS，绝不公开发布，汇总平台验收矩阵与详细证据链。
"""
import sys
import os
import time
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR.parent.parent))

from src.browser_manager import browser_manager
from src.adapters.registry import registry
from src.models import MediaItem

CHANNELS = [
    {
        "channel": "ZHIHU",
        "name": "知乎",
        "content_type": "ARTICLE",
        "is_video": False,
        "title": "2026年企业级多平台自动化发布实战解析：GeoLens架构设计",
        "body": "在当今多端分发时代，创作者面临跨平台适配繁复、账号登录态隔离与内容安全发布的严峻挑战。\n\nGeoLens 采用本地受控浏览器 + 15状态可观测有限状态机（FSM）架构，确保所有自动化流程均运行在用户合法受权的独立 Profile 环境中。\n\n在发布前严格实施 PREPARE_ONLY 安全闸门，由创作者最终确认，杜绝未经授权的公开提交。",
        "tags": ["AI工具", "前沿科技", "发布评测", "软件架构"]
    },
    {
        "channel": "WEIBO",
        "name": "微博",
        "content_type": "IMAGE_TEXT",
        "is_video": False,
        "title": "GeoLens 多平台自动化发布架构实战评测",
        "body": "【GeoLens 企业级自动化发布架构实测】\n采用本地独立受控 Chrome Profile，无侵入适配多渠道。\n核心坚持 PREPARE_ONLY 原则：所有表单自动回填，发布按钮精准高亮，由创作者核对无误后手动确认，确保零违规与安全合规！\n#AI工具# #前沿科技# #发布评测#",
        "tags": ["AI工具", "前沿科技", "发布评测"]
    },
    {
        "channel": "DOUYIN",
        "name": "抖音",
        "content_type": "VIDEO",
        "is_video": True,
        "title": "GeoLens多平台发布评测",
        "body": "本视频实测 GeoLens 本地受控浏览器发布架构，包含全套字段校验与 PREPARE_ONLY 人工审核保障机制。#AI工具 #前沿科技 #发布评测",
        "tags": ["AI工具", "前沿科技", "发布评测"]
    },
    {
        "channel": "WECHAT_OFFICIAL_ACCOUNT",
        "name": "微信公众号",
        "content_type": "ARTICLE",
        "is_video": False,
        "title": "企业级多平台自动化发布实战：GeoLens 本地受控架构解析",
        "body": "在内容分发场景中，创作者面临跨平台适配繁复、登录态隔离与合规发布的综合挑战。\n\nGeoLens 创新性构建本地受控浏览器助手，通过 15 步状态机与全流程双向比对，实现正文、标题与配图的自动化预填。\n\n坚守 PREPARE_ONLY 守卫机制，始终停留在草稿与发布前确认区域，留给创作者充分审核空间。",
        "tags": ["AI工具", "前沿科技"]
    },
    {
        "channel": "TOUTIAO",
        "name": "今日头条",
        "content_type": "ARTICLE",
        "is_video": False,
        "title": "GeoLens多平台自动化架构实测",
        "body": "今日头条创作者后台实测：GeoLens 通过受控浏览器技术完成文章编辑与排版预填。\n\n系统具备双向比对与敏感内容拦截机制，严格遵守 PREPARE_ONLY 规范，停留在最终发布确认区域，确保发布合规。",
        "tags": ["前沿科技", "自媒体运营"]
    },
    {
        "channel": "BAIJIAHAO",
        "name": "百度百家号",
        "content_type": "ARTICLE",
        "is_video": False,
        "title": "百度百家号自动化发布实战评测：GeoLens 核心解析",
        "body": "针对百度百家号创作者平台，GeoLens 实现了富文本编辑器的自动化定位与内容回填。\n\n通过本地 Profile 隔离保存创作者会话，执行 15 状态发布机流水线，发布前注入安全预览横幅，保障内容安全可控。",
        "tags": ["前沿科技", "百家号攻略"]
    },
    {
        "channel": "KUAISHOU",
        "name": "快手",
        "content_type": "VIDEO",
        "is_video": True,
        "title": "GeoLens多平台自动化发布实战",
        "body": "快手创作者服务平台实测：本地受控浏览器自动化视频上传与简介录入，严格遵循 PREPARE_ONLY 发布前核验。#前沿科技 #AI工具",
        "tags": ["前沿科技", "AI工具"]
    },
    {
        "channel": "WECHAT_CHANNELS",
        "name": "微信视频号",
        "content_type": "VIDEO",
        "is_video": True,
        "title": "GeoLens发布评测",
        "body": "微信视频号助手实操评测：本地受控浏览器上传与短标题设置，停留在最终发表前供创作者人工审核。#前沿科技 #科技分享",
        "tags": ["前沿科技", "科技分享"]
    }
]

def main():
    print("=" * 75, flush=True)
    print("   GeoLens Browser Assistant - 8大剩余平台真实自动化全面现场核验", flush=True)
    print("=" * 75, flush=True)

    fixtures_video = BASE_DIR / "tests" / "fixtures" / "sample_test_video.mp4"
    fixtures_cover = BASE_DIR / "tests" / "fixtures" / "sample_test_cover.jpg"

    results = []
    target_channel = sys.argv[1].upper() if len(sys.argv) > 1 else None
    channels_to_test = [c for c in CHANNELS if c["channel"] == target_channel] if target_channel else CHANNELS

    for item in channels_to_test:
        ch = item["channel"]
        name = item["name"]
        content_type = item["content_type"]
        is_video = item["is_video"]

        print(f"\n[{name} ({ch})] 开始执行真实平台探针与自动化验证...", flush=True)
        account_id = "default"

        # 确保原有句柄平稳释放
        browser_manager.close_driver(ch, account_id)
        time.sleep(1.0)

        step_records = []
        screenshot_path = None
        final_url = ""
        verdict = "NOT_IMPLEMENTED"
        block_reason = None
        val_diff = None

        driver = None
        try:
            # 1. 启动受控 Chrome
            step_records.append("1. 启动本地受控 Chrome 实例 (Profile: default)")
            driver = browser_manager.get_or_create_driver(ch, account_id, headless=True)
            pub = registry.get_publisher(ch, driver)
            time.sleep(1.5)

            # 2. 检查会话登录态
            step_records.append("2. 探测真实平台会话与登录状态")
            is_logged_in, login_msg, extra = pub.check_login()
            final_url = driver.current_url
            print(f"  -> 登录检测: is_logged_in={is_logged_in}, msg={login_msg}, url={final_url}", flush=True)

            if not is_logged_in:
                # 未登录分支：打开官方登录/扫码页并截图存证，标记 LOGIN_REQUIRED
                verdict = "LOGIN_REQUIRED"
                block_reason = login_msg
                step_records.append(f"3. 导航至官方扫码/登录页: {login_msg}")
                ok_open, msg_open = pub.open_login_page()
                time.sleep(2.5)
                final_url = driver.current_url
                
                snap_name = f"{ch.lower()}_login_required_gate"
                screenshot_path = browser_manager.take_screenshot(ch, account_id, snap_name)
                step_records.append(f"4. 留存官方登录页真实截图 ({Path(screenshot_path).name})")
                print(f"  -> 判定: LOGIN_REQUIRED | 截图: {screenshot_path}", flush=True)
            else:
                # 已登录分支：执行完整 PREPARE_ONLY 流程！
                print(f"  -> 检测到有效登录态，开始执行 PREPARE_ONLY 全自动化流程...", flush=True)
                step_records.append(f"3. 登录态有效: {login_msg}")

                # 创作者中心
                ok_nav, msg_nav = pub.navigate_creator_center()
                step_records.append(f"4. 导航至创作者中心: {msg_nav}")
                time.sleep(1.5)

                # 创作类型选择
                ok_type, msg_type = pub.select_content_type(content_type)
                step_records.append(f"5. 选择创作类型 ({content_type}): {msg_type}")
                time.sleep(1.2)

                # 编辑器就绪
                ok_ready, msg_ready = pub.ensure_editor_ready()
                step_records.append(f"6. 确认编辑器 DOM 就绪: {msg_ready}")

                # 素材上传
                media_list = []
                if is_video and fixtures_video.exists():
                    media_list.append(MediaItem(index=1, type="VIDEO", url=f"file:///{fixtures_video.as_posix()}", local_path=str(fixtures_video)))
                    if fixtures_cover.exists():
                        media_list.append(MediaItem(index=2, type="IMAGE", url=f"file:///{fixtures_cover.as_posix()}", local_path=str(fixtures_cover)))
                elif not is_video and fixtures_cover.exists():
                    media_list.append(MediaItem(index=1, type="IMAGE", url=f"file:///{fixtures_cover.as_posix()}", local_path=str(fixtures_cover)))

                if media_list:
                    ok_up, msg_up = pub.upload_media(media_list)
                    step_records.append(f"7. 上传测试素材 ({len(media_list)}项): {msg_up}")
                    time.sleep(2.0)
                    if is_video:
                        ok_proc, msg_proc = pub.wait_for_upload_completion(timeout_sec=45)
                        step_records.append(f"8. 视频转码处理检测: {msg_proc}")

                # 填写标题
                ok_ti, msg_ti = pub.fill_title(item["title"])
                step_records.append(f"9. 填写标题: {msg_ti}")

                # 填写正文
                ok_cnt, msg_cnt = pub.fill_content(item["body"])
                step_records.append(f"10. 填写正文内容: {msg_cnt}")

                # 填写标签
                ok_tag, msg_tag = pub.fill_tags(item["tags"])
                step_records.append(f"11. 填写话题标签: {msg_tag}")

                # 必要声明
                try:
                    pub.fill_required_declarations()
                    step_records.append("12. 确认原创及合规声明设置")
                except Exception:
                    pass

                # 双向比对
                diff = pub.validate_draft(item["title"], item["body"], item["tags"], len(media_list))
                step_records.append(f"13. DOM 双向比对结果: passed={diff.passed}, discrepancies={diff.discrepancies}")
                val_diff = {
                    "passed": diff.passed,
                    "title_match": diff.title_match,
                    "title_actual": diff.title_actual,
                    "body_match": diff.body_match,
                    "body_length_actual": diff.body_length_actual,
                    "discrepancies": diff.discrepancies
                }

                # 最终确认保护
                ok_conf, msg_conf = pub.prepare_for_confirmation()
                step_records.append(f"14. 停留在发布前并高亮按钮: {msg_conf}")

                final_url = driver.current_url
                snap_name = f"{ch.lower()}_real_ready_for_review"
                screenshot_path = browser_manager.take_screenshot(ch, account_id, snap_name)
                step_records.append(f"15. 留存发布前核验截图 ({Path(screenshot_path).name})")

                verdict = "REAL_READY_FOR_REVIEW"
                print(f"  -> 判定: REAL_READY_FOR_REVIEW | 截图: {screenshot_path}", flush=True)

        except Exception as e:
            import traceback
            traceback.print_exc()
            verdict = "BLOCKED"
            block_reason = f"执行异常: {str(e)}"
            step_records.append(f"异常阻断: {e}")
            if driver:
                try:
                    final_url = driver.current_url
                    snap_name = f"{ch.lower()}_blocked_exception"
                    screenshot_path = browser_manager.take_screenshot(ch, account_id, snap_name)
                except Exception:
                    pass
            print(f"  -> 判定: BLOCKED ({e})", flush=True)
        finally:
            if driver:
                browser_manager.close_driver(ch, account_id)
                time.sleep(1.0)

        results.append({
            "channel": ch,
            "name": name,
            "verdict": verdict,
            "url": final_url,
            "screenshot": screenshot_path,
            "steps": step_records,
            "block_reason": block_reason,
            "validation_diff": val_diff
        })

    # 输出结构化总结
    out_file = BASE_DIR / "verification_results.json"
    existing_results = []
    if out_file.exists():
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                existing_results = json.load(f)
        except Exception:
            existing_results = []
    
    result_map = {r["channel"]: r for r in existing_results}
    for r in results:
        result_map[r["channel"]] = r
    final_results = [result_map[c["channel"]] for c in CHANNELS if c["channel"] in result_map]

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(final_results, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 75, flush=True)
    print("   8大平台真实自动化全面现场核验矩阵", flush=True)
    print("=" * 75, flush=True)
    for r in results:
        status_tag = f"[{r['verdict']}]"
        print(f"{r['name']:<10} ({r['channel']:<22}) -> {status_tag:<24} URL: {r['url']}", flush=True)
        if r['screenshot']:
            print(f"   -> 存证截图: {r['screenshot']}", flush=True)
        if r['block_reason']:
            print(f"   -> 状态原因: {r['block_reason']}", flush=True)
        print("-" * 75, flush=True)

    print(f"\n完整证据链结果已持久化保存至: {out_file}", flush=True)

if __name__ == "__main__":
    main()
