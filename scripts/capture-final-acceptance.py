# -*- coding: utf-8 -*-
import os
import re
import sys
import uuid
import json
from playwright.sync_api import sync_playwright, expect

SCREENSHOT_DIR = r"C:\Users\35287\.gemini\antigravity\brain\ac3737f9-5393-49dc-873a-604d0afcd8ad\screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def main():
    print("=== 开始运行 GeoLens 真实企业演示最终验收 Playwright 脚本 ===")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 960})
        page = context.new_page()

        # 1. 注册与登录
        suffix = uuid.uuid4().hex[:8]
        email = f"final-eval-{suffix}@geolens.test"
        password = "FinalAcceptance_2026!"
        
        print(f"1. 注册并登录用户: {email}...")
        page.goto("http://localhost:3000/register")
        page.wait_for_load_state("networkidle")
        
        inputs = page.locator("input").all()
        inputs[0].fill("最终验收首席评估官")
        inputs[1].fill(email)
        inputs[2].fill(password)
        inputs[3].fill("瑞幸咖啡企业体验组")
        page.get_by_role("button", name="注册").click()
        page.wait_for_url(re.compile(r"/app"), timeout=30000)
        page.wait_for_load_state("networkidle")
        print("  [OK] 登录完成，进入系统主界面")

        # 2. 通过 API 准备项目：瑞幸咖啡全渠道GEO体验项目
        print("2. 准备企业项目：瑞幸咖啡...")
        orgs_res = page.request.get("http://localhost:3001/organizations")
        orgs = orgs_res.json()
        org_id = orgs[0]["id"]
        
        proj_res = page.request.post(
            f"http://localhost:3001/organizations/{org_id}/projects",
            data={"name": "瑞幸咖啡全渠道GEO体验项目", "domain": "luckincoffee.com"}
        )
        proj_id = proj_res.json()["id"]
        print(f"  [OK] 项目已创建，ID: {proj_id}")

        # 3. 打开多平台内容发布工作台
        workbench_url = f"http://localhost:3000/app/content/distribution?project={proj_id}"
        print(f"3. 打开多平台内容发布工作台: {workbench_url}...")
        page.goto(workbench_url)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("button:has-text('AI 智能生成')", timeout=30000)
        page.wait_for_timeout(1000)

        # 4. 切换到【AI 智能生成】入口
        print("4. 切换至【AI 智能生成】入口...")
        ai_tab = page.locator("button:has-text('AI 智能生成')")
        ai_tab.first.click()
        page.wait_for_timeout(1000)

        # 5. 填写瑞幸咖啡主题与业务信息
        print("5. 填入品牌与文章主题...")
        brand_input = page.locator("input[placeholder*='瑞幸咖啡']")
        if brand_input.count() > 0:
            brand_input.first.fill("瑞幸咖啡")

        topic_input = page.locator("input[placeholder*='消费场景']")
        expect(topic_input.first).to_be_visible(timeout=10000)
        topic_input.first.fill("瑞幸咖啡适合哪些消费场景，以及如何根据不同需求选择咖啡产品")
        print("  [OK] 已填入核心主题")

        brief_input = page.locator("input[placeholder*='经典款对比']")
        if brief_input.count() > 0:
            brief_input.first.fill("突出高性价比、生椰拿铁、美式咖啡、早八提神与自提便利性")

        provider_select = page.locator("select:has(option:has-text('DeepSeek'))")
        if provider_select.count() > 0:
            print("  检查到 Provider 下拉框包含 DeepSeek 真实模型与 Mock 模式，当前设置使用 mock 演示以保护 API 预算")
            provider_select.first.select_option("mock")

        # 6. 点击【立即生成完整文章】
        gen_btn = page.locator("button:has-text('完整文章')")
        expect(gen_btn.first).to_be_visible(timeout=10000)
        print("6. 点击【✨ 立即生成完整文章】...")
        gen_btn.first.click()
        
        # 7. 等待正文渲染并验证
        body_editor = page.locator("textarea[rows='14']")
        expect(body_editor.first).to_be_visible(timeout=30000)
        body_text = body_editor.first.input_value()
        print(f"  [OK] 完整正文已在页面中渲染！字数: {len(body_text)} 字")

        title_editor = page.locator("input[placeholder*='文章标题']").first
        if title_editor.count() > 0 and title_editor.is_visible():
            title_editor.fill("瑞幸咖啡消费场景全解析：早八到下午茶的精准选型指南")

        # 截图 1: AI 完整文章网页预览
        shot1 = os.path.join(SCREENSHOT_DIR, "01-ai-full-article-ui.png")
        page.screenshot(path=shot1, full_page=False)
        print(f"  [截图保存] {shot1}")

        # 8. 点击采纳并进入发布工作台
        print("7. 点击【采纳并立即进入发布】...")
        adopt_btn = page.locator("button:has-text('采纳并立即进入发布')")
        expect(adopt_btn.first).to_be_visible(timeout=10000)
        adopt_btn.first.click()
        page.wait_for_timeout(2000)

        # 刷新页面验证持久化与重新读取
        print("8. 刷新工作台页面验证草稿重新读取...")
        page.reload()
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("button:has-text('选择已有草稿')", timeout=30000)
        
        # 点击选择已有草稿展示草稿卡片
        existing_tab = page.locator("button:has-text('选择已有草稿')")
        if existing_tab.count() > 0:
            existing_tab.first.click()
            page.wait_for_timeout(1000)

        # 截图 2: 草稿保存并重新打开
        shot2 = os.path.join(SCREENSHOT_DIR, "02-draft-saved-reopened.png")
        page.screenshot(path=shot2, full_page=False)
        print(f"  [截图保存] {shot2}")

        # 9. 滚动至渠道内容适配预览 (切换为小红书显示字数与样式)
        print("9. 切换至小红书渠道适配预览...")
        xhs_btn = page.locator("button:has-text('小红书')")
        if xhs_btn.count() > 0:
            xhs_btn.first.click()
            page.wait_for_timeout(800)
        preview_sec = page.locator("text='发布内容预览与校验'")
        if preview_sec.count() > 0:
            preview_sec.first.scroll_into_view_if_needed()
            page.wait_for_timeout(1000)
        
        shot3 = os.path.join(SCREENSHOT_DIR, "03-channel-adaptation.png")
        page.screenshot(path=shot3, full_page=False)
        print(f"  [截图保存] {shot3}")

        # 10. 滚动至受控分发与发布准备区域
        print("10. 滚动至发布准备区域 (Prepare-Only Guard & Browser Assistant)...")
        prep_banner = page.locator("text='选择发布方式与执行平台'")
        if prep_banner.count() > 0:
            prep_banner.first.scroll_into_view_if_needed()
            page.wait_for_timeout(1000)

        shot4 = os.path.join(SCREENSHOT_DIR, "04-publish-preparation.png")
        page.screenshot(path=shot4, full_page=False)
        print(f"  [截图保存] {shot4}")

        # 11. 为当前项目生成 GEO 基准测试报告并检查来源标识 (DEMO/Mock)
        print("11. 为当前项目生成 GEO 基准测试报告并检查来源标识...")
        opts_res = page.request.get("http://localhost:3001/monitor-tasks/options")
        assert opts_res.ok, f"options failed: {opts_res.status}"
        mock_engine = next((e for e in opts_res.json().get("engines", []) if e.get("provider") == "mock"), None)
        assert mock_engine, "Mock engine not found"
        mock_engine_id = mock_engine["id"]

        suite_res = page.request.post(
            f"http://localhost:3001/projects/{proj_id}/benchmark-suites",
            data={
                "name": "瑞幸咖啡全渠道GEO体验问题集",
                "version": "1.0",
                "queries": [
                    {
                        "queryText": "哪些连锁咖啡品牌的生椰系列好喝且适合早八自提？",
                        "category": "tool-discovery",
                        "intent": "DISCOVERY",
                        "sanity": False,
                        "queryType": "DISCOVERY",
                        "sortOrder": 0,
                    },
                    {
                        "queryText": "生椰拿铁和美式咖啡哪个提神效果更好？",
                        "category": "comparison",
                        "intent": "COMPARISON",
                        "sanity": False,
                        "queryType": "DISCOVERY",
                        "sortOrder": 1,
                    },
                    {
                        "queryText": "瑞幸咖啡有哪些经典招牌饮品与选型推荐？",
                        "category": "sanity-control",
                        "intent": "INFORMATIONAL",
                        "sanity": True,
                        "queryType": "BRANDED_SANITY",
                        "sortOrder": 2,
                    },
                ]
            }
        )
        assert suite_res.ok, f"suite_res failed: {suite_res.status} {suite_res.text()}"
        suite_id = suite_res.json()["id"]

        run_res = page.request.post(
            f"http://localhost:3001/benchmark-suites/{suite_id}/runs",
            data={"engineId": mock_engine_id, "runType": "demo"}
        )
        assert run_res.ok, f"run_res failed: {run_res.status} {run_res.text()}"
        run_id = run_res.json()["id"]

        for _ in range(40):
            r = page.request.get(f"http://localhost:3001/benchmark-runs/{run_id}")
            status = r.json().get("status")
            print(f"  Benchmark run status: {status}")
            if status in ["SUCCEEDED", "PARTIAL", "FAILED"]:
                break
            page.wait_for_timeout(1000)

        rep_res = page.request.post(f"http://localhost:3001/benchmark-runs/{run_id}/reports", data={})
        assert rep_res.ok, f"rep_res failed: {rep_res.status} {rep_res.text()}"
        rep_id = rep_res.json()["id"]
        
        report_url = f"http://localhost:3000/app/reports/{rep_id}?project={proj_id}"
        print(f"  打开当前项目报告: {report_url}...")
        page.goto(report_url)
        page.wait_for_load_state("networkidle")
        page.wait_for_selector("h1", timeout=30000)
        page.wait_for_timeout(2000)

        shot5 = os.path.join(SCREENSHOT_DIR, "05-geo-report-provenance.png")
        page.screenshot(path=shot5, full_page=False)
        print(f"  [截图保存] {shot5}")

        # 12. 访问 Control Center /dev/status
        print("12. 访问 Control Center /dev/status...")
        page.goto("http://localhost:3000/dev/status")
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)

        shot6 = os.path.join(SCREENSHOT_DIR, "06-restart-recovery.png")
        page.screenshot(path=shot6, full_page=False)
        print(f"  [截图保存] {shot6}")

        browser.close()
        print("=== 全部 6 张最终验收真实浏览器截图已成功保存！ ===")

if __name__ == "__main__":
    main()
