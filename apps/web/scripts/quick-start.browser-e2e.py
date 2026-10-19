import json
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
        project_creations: list[dict[str, str]] = []
        draft_rows_by_id: dict[str, dict] = {}
        failed_poll_ids: list[str] = []
        report_creation_requests: list[str] = []
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        def log_response(response) -> None:
            if "localhost:3101" not in response.url:
                return
            if response.request.method == "POST" and "/organizations/" in response.url and response.url.endswith("/projects"):
                try:
                    response_path = urlparse(response.url).path.rstrip("/")
                    project_creations.append({
                        "id": response.json().get("id", ""),
                        "organizationId": response_path.split("/")[-2],
                    })
                except Exception:
                    pass
            if "/content-drafts" in response.url and response.request.method == "GET":
                try:
                    data = response.json()
                    print(f"DRAFT_LIST_RESPONSE status={response.status} type={type(data).__name__}")
                    if isinstance(data, list):
                        rows = [row for row in data if isinstance(row, dict)]
                        draft_rows_by_id.update({row.get("id", ""): row for row in rows})
                        print("DRAFT_LIST_ROWS", [{"id": row.get("id"), "projectId": row.get("projectId"), "title": row.get("title"), "sourceRecommendationId": row.get("sourceRecommendationId")} for row in rows])
                    else:
                        print("DRAFT_LIST_BODY", str(data)[:1000])
                except Exception as error:
                    print(f"DRAFT_LIST_PARSE_ERROR status={response.status} error={error}")

        page.on("response", log_response)
        page.on("requestfailed", lambda request: print(f"REQUEST_FAILED {request.url} {request.failure}"))
        page.on("dialog", lambda dialog: dialog.accept())

        failed_query_set = False

        def fail_first_question_generation(route) -> None:
            nonlocal failed_query_set
            if not failed_query_set:
                failed_query_set = True
                route.fulfill(status=503, content_type="application/json", body=json.dumps({"message": "E2E 测试性问题生成失败"}, ensure_ascii=False))
                return
            route.continue_()

        simulated_failed_poll = False

        def fail_first_run_poll(route) -> None:
            nonlocal simulated_failed_poll
            parsed = urlparse(route.request.url)
            if not simulated_failed_poll and route.request.method == "GET" and re.fullmatch(r"/benchmark-runs/[0-9a-f-]+", parsed.path):
                simulated_failed_poll = True
                run_id = parsed.path.rsplit("/", 1)[-1]
                failed_poll_ids.append(run_id)
                print(f"SIMULATED_FAILED_RUN {run_id}")
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "id": run_id,
                    "status": "FAILED",
                    "progress": 100,
                    "completedRuns": 10,
                    "plannedRuns": 10,
                    "analyzedRuns": 0,
                    "terminal": True,
                    "provider": "mock",
                    "engine": {"name": "GeoLens Mock E2E", "model": "mock"},
                }))
                return
            if route.request.method == "POST" and re.fullmatch(r"/benchmark-runs/[0-9a-f-]+/reports", parsed.path):
                report_creation_requests.append(parsed.path)
            route.continue_()

        page.route("**/ai/query-set", fail_first_question_generation)
        page.route("**/benchmark-runs/*", fail_first_run_poll)

        page.goto("http://localhost:3100/register")
        page.wait_for_load_state("networkidle")
        fields = page.locator("input")
        fields.nth(0).fill("Quick Start E2E")
        fields.nth(1).fill(f"quick-start-{uuid.uuid4().hex[:10]}@e2e.test")
        fields.nth(2).fill("QuickStart-Test-123!")
        fields.nth(3).fill("GeoLens Quick Start E2E Org")
        page.get_by_role("button", name="注册").click()
        page.wait_for_url(re.compile(r"/app(?:\?.*)?$"), timeout=30_000)
        page.wait_for_load_state("networkidle")

        page.goto("http://localhost:3100/app/quick-start")
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
        expect(page.get_by_text("E2E 测试性问题生成失败", exact=True)).to_be_visible(timeout=30_000)
        assert len(project_creations) == 1 and project_creations[0]["id"], f"Expected one project to be created before retry: {project_creations}"
        page.reload(wait_until="networkidle")
        expect(page.locator("#quick-start-brand")).to_have_value("星河协同云", timeout=30_000)
        page.wait_for_timeout(500)
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
        page.reload(wait_until="networkidle")
        expect(page.get_by_role("heading", name="检查监测问题")).to_be_visible(timeout=30_000)
        expect(page.get_by_label("监测问题 1")).to_have_value("哪些协同办公软件适合 100 人以内的团队？")
        page.get_by_role("button", name=re.compile("确认问题并继续")).click()
        expect(page.get_by_role("heading", name="选择检测方式")).to_be_visible()
        engine_select = page.get_by_label("检测引擎")
        if engine_select.count():
            options = engine_select.locator("option").all()
            preferred_mock = next((option for option in options if "geolens mock" in option.inner_text().lower()), None)
            if preferred_mock is None:
                preferred_mock = next((option for option in options if "mock" in option.inner_text().lower() and not re.search(r"fail|retry|e2e|test", option.inner_text(), re.IGNORECASE)), None)
            assert preferred_mock is not None, f"The demo run exposed no deterministic Mock engine: {[option.inner_text() for option in options]}"
            engine_select.select_option(preferred_mock.get_attribute("value"))
        page.get_by_role("button", name=re.compile("开始 Mock 检测")).click()
        retry_run_button = page.get_by_role("button", name="重新运行检测")
        try:
            expect(retry_run_button).to_be_visible(timeout=30_000)
        except AssertionError as error:
            body_text = page.locator("body").inner_text().encode("unicode_escape").decode()
            raise AssertionError(f"Terminal run recovery missing: simulated={failed_poll_ids}, reportPosts={report_creation_requests}, page={body_text[-1800:]}") from error
        page.wait_for_timeout(5_000)
        assert len(failed_poll_ids) == 1, f"Terminal failed run was polled repeatedly: {failed_poll_ids}"
        assert not report_creation_requests, f"A report was attempted for a run with no analyses: {report_creation_requests}"
        page.get_by_role("button", name="重新运行检测").click()
        page.get_by_role("button", name=re.compile("开始 Mock 检测")).click()
        expect(page.get_by_role("heading", name="检测任务正在执行")).to_be_visible(timeout=20_000)

        expect(page.get_by_role("heading", name=re.compile("的 GEO 检测结果"))).to_be_visible(timeout=180_000)
        expect(page.get_by_text("诊断正在根据报告证据生成规则建议…")).not_to_be_visible(timeout=30_000)
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
        expect(page.get_by_text("选择目标草稿", exact=True)).to_be_visible(timeout=30_000)
        expect(page.locator(f'select option[value="{selected_draft}"]')).to_have_count(1, timeout=30_000)
        selects = page.locator("select").all()
        matching_selects = [select for select in selects if select.locator(f'option[value="{selected_draft}"]').count()]
        if not matching_selects:
            options = [[{"value": option.get_attribute("value"), "label": option.inner_text()} for option in select.locator("option").all()] for select in selects]
            raise AssertionError(f"Distribution draft was not loaded: url={page.url}; options={options}")
        draft_select = matching_selects[0]
        expect(draft_select).to_have_value(selected_draft, timeout=30_000)
        expect(page.get_by_text("E2E 已编辑内容。", exact=False)).to_be_visible(timeout=30_000)
        saved_draft = draft_rows_by_id.get(selected_draft)
        assert saved_draft and saved_draft.get("sourceRecommendationId"), f"Saved draft lost formal recommendation lineage: {saved_draft}"
        assert not page_errors, f"Browser page errors: {page_errors}"
        assert len(project_creations) == 1, f"Retry unexpectedly created another project: {project_creations}"

        second_project_response = context.request.post(
            f"http://localhost:3101/organizations/{project_creations[0]['organizationId']}/projects",
            data={"name": f"快速开始切换验证-{uuid.uuid4().hex[:8]}"},
        )
        assert second_project_response.status == 201, f"Could not create isolated project-switch fixture: {second_project_response.status}"
        second_project_id = second_project_response.json()["id"]
        page.goto(f"http://localhost:3100/app/quick-start?project={project_creations[0]['id']}")
        page.wait_for_load_state("networkidle")
        project_switcher = page.get_by_label("选择监测项目")
        expect(project_switcher).to_be_visible()
        project_switcher.select_option(second_project_id)
        page.wait_for_url(re.compile(rf"/app/quick-start\?project={re.escape(second_project_id)}$"), timeout=30_000)
        page.wait_for_timeout(1_000)
        switch_debug = page.evaluate("""() => ({
          url: location.href,
          selectedProjectId: document.querySelector('select[aria-label="选择监测项目"]')?.value,
          targetProfile: null,
          quickStartStorage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('geolens:quick-start:'))),
        })""")
        switch_debug["targetProfile"] = page.evaluate("""async (projectId) => {
          const response = await fetch(`http://localhost:3101/projects/${projectId}/target-profile`, { credentials: 'include' });
          return { status: response.status, body: await response.text() };
        }""", second_project_id)
        try:
            expect(page.locator("#quick-start-brand")).to_have_value("", timeout=30_000)
        except AssertionError as error:
            raise AssertionError(f"Project switch retained prior flow: {switch_debug}") from error

        print("E2E_OK: register -> create project -> recover query-generation failure after reload -> edit questions -> recover terminal run without analyses -> Mock benchmark -> report/evidence/recommendation lineage -> content generation/edit/save -> distribution -> switch projects")
        print(f"DISTRIBUTION_URL_HAS_DRAFT_ID: {'draftId=' in href}")
        print("PUBLICATION_NOT_TRIGGERED: true")
        browser.close()


if __name__ == "__main__":
    main()
