import os
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def main():
    output_dir = Path(".runtime/verification")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("[Browser Verification] Starting browser product gate verification...")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        # 1. Login page
        print("[1/8] Navigating to /login...")
        page.goto("http://localhost:3000/login", wait_until="networkidle")
        time.sleep(1)
        page.screenshot(path=str(output_dir / "00_login_page.png"))

        print("[2/8] Logging in as alice@geolens.local...")
        page.fill("input[type='email'], input[name='email']", "alice@geolens.local")
        page.fill("input[type='password'], input[name='password']", "Password123!")
        page.click("button[type='submit']")

        # Wait for navigation to /app
        page.wait_for_url("**/app**", timeout=10000)
        time.sleep(2)

        # 2. Verify authentic identity in Topbar
        print("[3/8] Verifying authentic user identity on Dashboard...")
        user_text = page.locator(".topbar-right").inner_text()
        print(f"Topbar text:\n{user_text}")

        assert "产品管理员" not in user_text, "ERROR: Found fake '产品管理员' placeholder!"
        assert "企业工作台" not in user_text, "ERROR: Found fake '企业工作台' placeholder!"
        assert "Alice Owner" in user_text or "alice@geolens.local" in user_text, "ERROR: Real user name not found!"
        assert "GeoLens Dev Org" in user_text, "ERROR: Real organization not found!"

        page.screenshot(path=str(output_dir / "01_dashboard_identity.png"))

        # 3. Check project selector
        print("[4/8] Checking project selector options...")
        project_select = page.locator("select[aria-label='切换当前项目'], select.project-selector, select").first
        select_options = project_select.locator("option").all_inner_texts()
        print(f"Available projects ({len(select_options)}):")
        for opt in select_options:
            print(f"  - {opt}")

        assert any("医学信息工程" in opt for opt in select_options), "ERROR: '医学信息工程' not in project list!"
        assert not any("Astra" in opt for opt in select_options), "ERROR: Found obsolete Astra project in list!"
        assert not any("独立验收" in opt for opt in select_options), "ERROR: Found QA project in list!"

        page.screenshot(path=str(output_dir / "02_project_selector.png"))

        # 4. Select "医学信息工程" and verify queries
        print("[5/8] Navigating to '医学信息工程' queries...")
        page.goto("http://localhost:3000/app/queries?project=9a182c11-5011-4f38-87f1-7d628a15e6ef", wait_until="networkidle")
        time.sleep(2)
        content_text = page.locator("#app-content").inner_text()
        print(f"Queries page content preview (first 200 chars): {content_text[:200]}")

        page.screenshot(path=str(output_dir / "03_medical_queries.png"))

        # 5. Check reports for "医学信息工程"
        print("[6/8] Navigating to '医学信息工程' reports...")
        page.goto("http://localhost:3000/app/reports?project=9a182c11-5011-4f38-87f1-7d628a15e6ef", wait_until="networkidle")
        time.sleep(2)
        reports_text = page.locator("#app-content").inner_text()
        print(f"Reports page content preview: {reports_text[:200]}")
        page.screenshot(path=str(output_dir / "04_medical_reports.png"))

        # Click report detail if link exists
        report_links = page.locator("a[href*='/app/reports/']").all()
        if report_links:
            first_report_href = report_links[0].get_attribute("href")
            print(f"Opening report: {first_report_href}")
            page.goto(f"http://localhost:3000{first_report_href}", wait_until="networkidle")
            time.sleep(2)
            page.screenshot(path=str(output_dir / "05_medical_report_detail.png"))

        # 6. Check content distribution workbench
        print("[7/8] Navigating to Content Distribution...")
        page.goto("http://localhost:3000/app/content/distribution?project=9a182c11-5011-4f38-87f1-7d628a15e6ef", wait_until="networkidle")
        time.sleep(2)
        dist_text = page.locator("#app-content").inner_text()
        print(f"Content distribution preview: {dist_text[:200]}")
        page.screenshot(path=str(output_dir / "06_content_distribution.png"))

        # Verify AI real toggle is unchecked
        ai_checkboxes = page.locator("input[type='checkbox']").all()
        for cb in ai_checkboxes:
            parent_text = cb.locator("..").inner_text()
            if "真实模型" in parent_text or "API 费用" in parent_text:
                print(f"Found AI checkbox: label='{parent_text}', checked={cb.is_checked()}")
                assert not cb.is_checked(), "ERROR: Real paid AI checkbox was automatically checked!"

        # 7. Check monitor page default engine selection
        print("[8/8] Navigating to Monitor page...")
        page.goto("http://localhost:3000/app/monitor?project=9a182c11-5011-4f38-87f1-7d628a15e6ef", wait_until="networkidle")
        time.sleep(2)
        monitor_text = page.locator("#app-content").inner_text()
        print(f"Monitor page preview: {monitor_text[:200]}")
        page.screenshot(path=str(output_dir / "07_monitor_page.png"))

        # Check button text on monitor page
        submit_btn = page.locator("button[type='submit']").inner_text()
        print(f"Monitor submit button text: '{submit_btn}'")
        assert "真实付费" not in submit_btn, "ERROR: Real paid engines were pre-selected by default!"

        # 8. Check /app/projects/new
        print("[9/9] Navigating to /app/projects/new...")
        page.goto("http://localhost:3000/app/projects/new", wait_until="networkidle")
        time.sleep(1)
        new_project_text = page.locator("#app-content").inner_text()
        print(f"New project page preview: {new_project_text[:200]}")
        page.screenshot(path=str(output_dir / "08_new_project_wizard.png"))

        browser.close()
        print("\nAll browser verifications PASSED successfully! Screenshots saved in .runtime/verification/")

if __name__ == "__main__":
    main()
