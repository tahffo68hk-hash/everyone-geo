import re
import uuid
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        page_errors: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        def log_response(response) -> None:
            if "localhost:3001" not in response.url:
                return
            print(f"API_RESPONSE {response.status} {response.url}")
            if "/content-drafts" in response.url and response.request.method == "GET":
                try:
                    rows = response.json()
                    print("DRAFT_LIST_IDS", [row.get("id") for row in rows if isinstance(row, dict)])
                except Exception:
                    pass

        page.on("response", log_response)
        page.on("requestfailed", lambda request: print(f"REQUEST_FAILED {request.url} {request.failure}"))
        page.on("dialog", lambda dialog: dialog.accept())

        page.goto("http://localhost:3000/register")
        page.wait_for_load_state("networkidle")
        fields = page.locator("input")
        fields.nth(0).fill("Quick Start E2E")
        fields.nth(1).fill(f"quick-start-{uuid.uuid4().hex[:10]}@e2e.test")
        fields.nth(2).fill("QuickStart-Test-123!")
        fields.nth(3).fill("GeoLens Quick Start E2E Org")
        page.get_by_role("button", name="注册").click()
        page.wait_for_url(re.compile(r"/app(?:\?.*)?$"), timeout=30_000)
        page.wait_for_load_state("networkidle")

        page.goto("http://localhost:3000/app/quick-start")
        page.wait_for_load_state("networkidle")
        brand_input = page.locator("#quick-start-brand")
        if not brand_input.count():
            body = page.locator("body").inner_text().encode("unicode_escape").decode()
            raise AssertionError(f"Quick Start brand field missing at {page.url}: {body[-1000:]}")
        expect(brand_input).to_be_visible(timeout=20_000)
        brand_input.fill("星河协同云")
        page.get_by_text("高级设置：官网、行业、竞品和 AI Provider").click()
        page.get_by_label("行业（可留空，由 AI 推断）").fill("协同办公软件")
        page.get_by_label("官网地址").fill("https://xinghe.example.com")
        print("BRAND_VALUE", brand_input.input_value())
        print("START_BUTTON_DISABLED", page.get_by_role("button", name="生成监测问题").is_disabled())
        page.get_by_role("button", name="生成监测问题").click()
        page.wait_for_timeout(3_000)
        query_heading = page.get_by_role("heading", name="检查监测问题")
        if not query_heading.count():
            body_text = page.locator("body").inner_text().encode("unicode_escape").decode()
            alerts = [alert.inner_text().encode("unicode_escape").decode() for alert in page.get_by_role("alert").all()]
            raise AssertionError(f"Question generation did not advance: alerts={alerts}; page={body_text[-1600:]}; errors={page_errors}")
        expect(query_heading).to_be_visible(timeout=60_000)

        first_question = page.get_by_label("监测问题 1")
        first_question.fill("哪些协同办公软件适合 100 人以内的团队？")
        expect(first_question).to_have_value("哪些协同办公软件适合 100 人以内的团队？")
        page.get_by_role("button", name=re.compile("确认问题并继续")).click()
        expect(page.get_by_role("heading", name="选择检测方式")).to_be_visible()
        engine_select = page.get_by_label("检测引擎")
        if engine_select.count():
            options = engine_select.locator("option").all()
            mock_option = next((opt for opt in options if "Mock" in opt.inner_text()), options[0] if options else None)
            if mock_option:
                engine_select.select_option(mock_option.get_attribute("value"))
        page.get_by_role("button", name=re.compile("开始 Mock 检测")).click()
        expect(page.get_by_role("heading", name="检测任务正在执行")).to_be_visible(timeout=20_000)

        expect(page.get_by_role("heading", name=re.compile("的 GEO 检测结果"))).to_be_visible(timeout=180_000)
        page.get_by_role("button", name="生成 AI 优化建议").click()
        expect(page.get_by_text("AI 补充建议")).to_be_visible(timeout=30_000)
        page.get_by_role("button", name=re.compile("根据建议生成内容")).click()
        expect(page.get_by_text("目标平台")).to_be_visible()
        page.get_by_role("button", name="生成平台内容").click()
        body = page.get_by_label("正文")
        expect(body).to_be_visible(timeout=30_000)
        body.fill(body.input_value() + "\n\nE2E 已编辑内容。")
        page.get_by_role("button", name=re.compile("保存到内容工作台")).click()
        expect(page.get_by_role("heading", name="报告和内容已进入正式工作台")).to_be_visible(timeout=30_000)
        distribution = page.get_by_role("link", name=re.compile("进入多平台分发工作台"))
        href = distribution.get_attribute("href")
        assert href and "draftId=" in href, f"Distribution URL did not carry draft ID: {href}"
        distribution.click()
        page.wait_for_url(re.compile(r"/app/content/distribution\?.*draftId="), timeout=30_000)
        page.wait_for_load_state("networkidle")
        selected_draft = parse_qs(urlparse(page.url).query).get("draftId", [""])[0]
        page.wait_for_selector(f'option[value="{selected_draft}"]', state="attached", timeout=30_000)
        selects = page.locator("select").all()
        matching_selects = [select for select in selects if select.locator(f'option[value="{selected_draft}"]').count()]
        if not matching_selects:
            options = [[{"value": option.get_attribute("value"), "label": option.inner_text()} for option in select.locator("option").all()] for select in selects]
            raise AssertionError(f"Distribution draft was not loaded: url={page.url}; options={options}")
        draft_select = matching_selects[0]
        expect(draft_select).to_have_value(selected_draft, timeout=30_000)
        expect(page.get_by_text("E2E 已编辑内容。", exact=False)).to_be_visible(timeout=30_000)
        assert not page_errors, f"Browser page errors: {page_errors}"

        print("E2E_OK: register -> brand -> generated/edit questions -> Mock benchmark -> report/evidence -> AI recommendation -> content generation/edit/save -> distribution")
        print(f"DISTRIBUTION_URL_HAS_DRAFT_ID: {'draftId=' in page.url}")
        print("PUBLICATION_NOT_TRIGGERED: true")
        browser.close()


if __name__ == "__main__":
    main()
