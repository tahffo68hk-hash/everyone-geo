import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/opt/google/chrome/chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const errors = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  return url.hostname === "localhost" || url.hostname === "127.0.0.1"
    ? route.continue()
    : route.abort();
});
try {
  await page.goto("http://localhost:3100");
  await page
    .getByRole("heading", { name: "让你的品牌更容易被 AI 推荐", exact: true })
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "模型设置" }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "模拟连接正常" }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByPlaceholder("输入你想监测的品牌或产品名称").fill("星河 CRM");
  await page.getByRole("button", { name: "开始 GEO 检测" }).click();
  await page.waitForURL(/\/runs\//);
  await page.getByRole("button", { name: "生成监测问题", exact: true }).click();
  await page.getByRole("textbox", { name: "问题 1", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: /^问题 / }).count(), 10);
  await page
    .getByRole("textbox", { name: "问题 1", exact: true })
    .fill("选择 CRM 客户关系管理软件时，如何评估需求和成本？");
  await page.getByRole("button", { name: "删除", exact: true }).last().click();
  await page
    .getByRole("button", { name: "保存问题与类别", exact: true })
    .click();
  await page.waitForTimeout(500);
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: "docs/screenshots/run-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "确认并开始检测", exact: true })
    .click();
  await page.getByText("COMPLETED", { exact: true }).waitFor();
  const id = page.url().split("/").pop();
  const evidence = await page.evaluate(
    async (id) => fetch("/api/runs/" + id).then((r) => r.json()),
    id,
  );
  assert.equal(evidence.responses.length, 9);
  assert.equal(evidence.run.is_mock, 1);
  assert.equal(evidence.metrics.total, 9);
  assert.equal(
    evidence.questions[0].text,
    "选择 CRM 客户关系管理软件时，如何评估需求和成本？",
  );
  assert.ok(
    evidence.responses.every(
      (r) =>
        r.is_mock === 1 &&
        r.web_search === 0 &&
        JSON.parse(r.citations).length === 0,
    ),
  );
  assert.equal(
    evidence.metrics.mentioned,
    evidence.responses.filter((r) => r.brand_mentioned).length,
  );
  await page.getByRole("link", { name: "查看检测报告" }).click();
  await page.getByText("本次检测提及率", { exact: true }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/report-desktop.png",
    fullPage: true,
  });
  const suggestionsCard = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "AI GEO 优化建议", exact: true }),
    });
  await suggestionsCard.getByRole("checkbox").check();
  await suggestionsCard
    .getByRole("button", { name: "生成 AI 优化建议", exact: true })
    .click();
  await suggestionsCard
    .getByRole("link", { name: /查看对应问题与回答/ })
    .first()
    .waitFor();
  await page.screenshot({
    path: "docs/screenshots/report-desktop.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "根据分析生成内容" }).click();
  await page
    .getByRole("heading", { name: "把检测线索变成有用的内容" })
    .waitFor();
  await page.getByRole("combobox").selectOption("xiaohongshu");
  await page
    .getByRole("checkbox", { name: "我确认模型与本次潜在费用" })
    .check();
  await page.getByRole("button", { name: "生成内容", exact: true }).click();
  await page
    .getByRole("heading", { name: "编辑与保存", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("人工编辑的小红书标题");
  await page.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "草稿已保存" }).waitFor();
  let contentData = await (
    await context.request.get("http://localhost:3100/api/reports/" + id)
  ).json();
  const contentId = contentData.contents[0].id;
  assert.equal(
    JSON.parse(contentData.contents[0].body).title,
    "人工编辑的小红书标题",
  );
  for (const channel of [
    "geo",
    "douyin",
    "bilibili",
    "channels",
    "kuaishou",
    "weibo",
    "wechat",
    "zhihu",
    "toutiao",
  ]) {
    const r = await context.request.post(
      `http://localhost:3100/api/reports/${id}/generate`,
      { data: { channel, confirmed: true } },
    );
    assert.equal(r.status(), 200, await r.text());
  }
  const { readFileSync } = await import("node:fs");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=",
    "base64",
  );
  const uploaded = await context.request.post(
    "http://localhost:3100/api/media",
    {
      multipart: {
        contentId,
        file: { name: "test.png", mimeType: "image/png", buffer: png },
      },
    },
  );
  assert.equal(uploaded.status(), 200, await uploaded.text());
  const asset = await uploaded.json();
  assert.equal(
    (await context.request.get("http://localhost:3100" + asset.url)).status(),
    200,
  );
  const videoUpload = await context.request.post(
    "http://localhost:3100/api/media",
    {
      multipart: {
        contentId,
        file: {
          name: "test.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync("public/demo/preview.mp4"),
        },
      },
    },
  );
  assert.equal(videoUpload.status(), 200, await videoUpload.text());
  const video = await videoUpload.json();
  assert.equal(
    (
      await context.request.get("http://localhost:3100" + video.url, {
        headers: { range: "bytes=0-99" },
      })
    ).status(),
    206,
  );
  const bad = await context.request.post("http://localhost:3100/api/media", {
    multipart: {
      contentId,
      file: {
        name: "bad.png",
        mimeType: "image/png",
        buffer: Buffer.from("<svg/>"),
      },
    },
  });
  assert.equal(bad.status(), 400);
  const unauthorized = await browser.newContext();
  assert.equal(
    (
      await unauthorized.request.get("http://localhost:3100" + asset.url)
    ).status(),
    404,
  );
  assert.equal(
    (
      await unauthorized.request.post(
        `http://localhost:3100/api/reports/${id}/save`,
        {
          data: {
            id: contentId,
            body: JSON.parse(contentData.contents[0].body),
          },
        },
      )
    ).status(),
    404,
  );
  await unauthorized.close();
  await page.reload();
  await page
    .getByRole("button", { name: /小红书图文笔记 · 人工编辑的小红书标题/ })
    .click();
  await page.getByAltText("用户上传素材").waitFor();
  assert.equal(
    await page
      .locator('video[src="/demo/preview.mp4"]')
      .evaluate((v) => v.readyState >= 1),
    true,
  );
  await page.screenshot({
    path: "docs/screenshots/content-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "docs/screenshots/content-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "内容发布", exact: true }).click();
  await page.getByRole("heading", { name: "内容发布工作台" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3100");
  await page
    .getByRole("heading", { name: "让你的品牌更容易被 AI 推荐", exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: "docs/screenshots/home-mobile.png",
    fullPage: true,
  });
  await page.goto("http://localhost:3100/reports/" + id);
  await page.getByText("本次检测提及率", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: "docs/screenshots/report-mobile.png",
    fullPage: true,
  });
  const other = await browser.newContext();
  const denied = await other.request.get(
    "http://localhost:3100/api/runs/" + id,
  );
  assert.match((await denied.json()).error, /当前会话/);
  await other.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "PASS",
      runId: id,
      responses: 9,
      consoleErrors: errors.length,
      realCalls: 0,
      publishing: 0,
    }),
  );
} finally {
  await browser.close();
}
