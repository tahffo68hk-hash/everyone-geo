import os
import sys
import time
import requests
from playwright.sync_api import sync_playwright, expect
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SCREENSHOTS_DIR = Path(r"C:\Users\35287\.gemini\antigravity\brain\ac3737f9-5393-49dc-873a-604d0afcd8ad\screenshots")
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

def main():
    print("[FactCheck-E2E] Starting Fact Check & Safe Rewrite UI Verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # 1. 注册并登录
        print("[FactCheck-E2E] 1. Registering test user...")
        page.goto("http://localhost:3000/register")
        page.wait_for_load_state("networkidle")
        inputs = page.locator("input")
        inputs.nth(0).fill("Fact Check User")
        test_email = f"factcheck-{time.time_ns()}@example.com"
        inputs.nth(1).fill(test_email)
        inputs.nth(2).fill("GeoLens-E2E-Pass123!")
        inputs.nth(3).fill("Fact Check Test Org")
        page.get_by_role("button", name="注册").click()
        page.wait_for_url(lambda u: "/app" in u, timeout=30_000)
        page.wait_for_load_state("networkidle")

        project_id = ""
        url = page.url
        if "project=" in url:
            project_id = url.split("project=")[1].split("&")[0]
        if not project_id:
            orgs = page.evaluate("() => fetch('http://localhost:3001/organizations', { credentials: 'include' }).then(r => r.json())")
            org_id = orgs[0]['id']
            proj_res = page.evaluate(f"() => fetch('http://localhost:3001/organizations/{org_id}/projects', {{ method: 'POST', credentials: 'include', headers: {{ 'Content-Type': 'application/json' }}, body: JSON.stringify({{ name: 'FactCheck Project {int(time.time())}' }}) }}).then(r => r.json())")
            project_id = proj_res.get('id', '')

        print(f"[FactCheck-E2E] Resolved Project ID: {project_id}")

        # 创建一个包含违规极限词/未核实声明的草稿
        draft_res = page.evaluate(f"""() => fetch('http://localhost:3001/projects/{project_id}/content-drafts', {{
            method: 'POST',
            credentials: 'include',
            headers: {{ 'Content-Type': 'application/json' }},
            body: JSON.stringify({{
                title: '豆包AI实测：这5个场景用起来真香，但有两个坑我先踩为敬',
                body: '## 引言：豆包到底适合干啥？\\n\\n先说结论：**豆包不是万能神器，但效果最好，是唯一的最佳选择。**\\n\\n作为一个从去年开始把豆包当日常工具用的普通用户，今天这篇不吹不黑，直接告诉你哪些场景豆包用起来真香。',
                targetAudience: '科技爱好者与职场办公族',
                topic: '豆包适合哪些场景',
                tags: ['#豆包AI', '#AI实测', '#办公神器'],
            }})
        }}).then(r => r.json())""")

        draft_id = draft_res["id"]
        print(f"[FactCheck-E2E] Created test draft ID: {draft_id}")

        # 提交草稿进入审核态 READY_FOR_REVIEW
        submit_res = page.evaluate(f"""() => fetch('http://localhost:3001/content-drafts/{draft_id}/submit', {{
            method: 'POST',
            credentials: 'include',
        }}).then(r => r.json())""")
        print(f"[FactCheck-E2E] Submitted draft status: {submit_res.get('status')}")

        target_url = f"http://localhost:3000/app/content/{draft_id}?project={project_id}"
        print(f"[FactCheck-E2E] Navigating to: {target_url}")
        page.goto(target_url)
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(2000)

        # 3. 模拟用户点击“批准此版本”
        print("[FactCheck-E2E] Clicking '批准此版本'...")
        approve_btn = page.get_by_role("button", name="批准此版本")
        expect(approve_btn).to_be_visible(timeout=10_000)
        approve_btn.click()
        page.wait_for_timeout(2000)

        # 4. 验证错误提示出现，并且显示“一键自动安全改写并批准”按钮
        print("[FactCheck-E2E] Verifying fact check blocking alert and 1-click safe rewrite button...")
        alert_box = page.locator("div.border-red-200[role='alert']")
        expect(alert_box).to_be_visible(timeout=5000)
        
        alert_text = alert_box.inner_text()
        print(f"[FactCheck-E2E] Alert text: {repr(alert_text)}")
        buttons = alert_box.locator("button").all_inner_texts()
        print(f"[FactCheck-E2E] Buttons in alert: {buttons}")
        
        safe_rewrite_btn = alert_box.locator("button:has-text('安全改写')").first
        expect(safe_rewrite_btn).to_be_visible()
        print("[FactCheck-E2E] ✓ Found safe rewrite button inside blocking alert banner!")

        page.screenshot(path=str(SCREENSHOTS_DIR / "12-fact-check-blocked-with-actions.png"))

        # 5. 点击“一键自动安全改写并批准”
        print("[FactCheck-E2E] Clicking '一键自动安全改写并批准'...")
        safe_rewrite_btn.click()
        page.wait_for_timeout(4000)

        # 6. 验证审批通过状态
        print("[FactCheck-E2E] Verifying draft is now APPROVED...")
        page_text = page.locator("body").inner_text()
        assert "APPROVED" in page_text or "已批准" in page_text, f"Draft approval failed! Text: {page_text[:400]}"
        print("[FactCheck-E2E] ✓ Draft successfully sanitized and approved!")

        page.screenshot(path=str(SCREENSHOTS_DIR / "13-safe-rewrite-approved.png"))
        browser.close()
        print("\n=======================================================")
        print("  FACT CHECK & SAFE REWRITE UI VERIFICATION PASSED!   ")
        print("=======================================================")

if __name__ == "__main__":
    main()
