import { chromium } from "playwright";
import { browserExecutable } from "./publisher/executor.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve("data/browsers");
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
  args: ["--no-sandbox"],
});
const ctx = await browser.newContext(),
  page = await ctx.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
async function call(p, b) {
  const r = await ctx.request[b === undefined ? "get" : "post"](
    "http://localhost:3100/api/" + p,
    b === undefined ? {} : { data: b },
  );
  const d = await r.json();
  assert.ok(r.ok(), JSON.stringify(d));
  return d;
}
try {
  // Build source content entirely through explicitly mock product API.
  const { id } = await call("runs", { name: "发布测试品牌" });
  await call(`runs/${id}/generate`, {});
  await call(`runs/${id}/execute`, { confirmed: true });
  const c = await call(`reports/${id}/generate`, {
    channel: "xiaohongshu",
    confirmed: true,
  });
  const upload = await ctx.request.post("http://localhost:3100/api/media", {
    multipart: {
      contentId: c.id,
      file: {
        name: "test.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4fcAAAAASUVORK5CYII=",
          "base64",
        ),
      },
    },
  });
  assert.ok(upload.ok());
  const m = await upload.json();
  const a = await call("publish/accounts", {
    platform: "test",
    label: "离线验收",
  });
  const target = {
    platform: "test",
    accountId: a.id,
    type: "image",
    title: "自动填写验收",
    body: "本地上传与填写验证",
    tags: "#本地测试",
    mediaIds: [m.id],
  };
  const jobs = await call("publish/create", {
    contentId: c.id,
    targets: [target],
  });
  const jobId = jobs.ids[0];
  await call("publish/fill/" + jobId, {});
  let job;
  for (let n = 0; n < 60; n++) {
    job = (await call("publish/workspace")).jobs.find((j) => j.id === jobId);
    if (!["DRAFT", "FILLING"].includes(job.status) && !job.pid) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(job.status, "FILLED_AWAITING_REVIEW", JSON.stringify(job));
  const read = JSON.parse(job.readback);
  assert.equal(read.title, target.title);
  assert.equal(read.body, target.body);
  assert.equal(read.mediaCount, 1);
  assert.equal(read.finalSubmitClicked, false);
  assert.equal(job.is_mock, 1);
  assert.equal(job.url, null);
  const pkg = await ctx.request.get(
    "http://localhost:3100/api/publish/export/" + jobId,
  );
  assert.equal(pkg.status(), 200);
  assert.equal((await pkg.body()).subarray(0, 2).toString(), "PK");
  const confirm = await ctx.request.post(
    "http://localhost:3100/api/publish/confirm/" + jobId,
    { data: { url: "https://example.com/fake", confirmed: true } },
  );
  assert.equal(confirm.status(), 400);
  const outsider = await browser.newContext();
  const blocked = await outsider.request.get(
    "http://localhost:3100/api/publish/export/" + jobId,
  );
  assert.equal(blocked.status(), 400);
  await outsider.close();
  await page.goto("http://localhost:3100/publish");
  await page
    .getByRole("heading", { name: "内容发布工作台", exact: true })
    .waitFor();
  await page.getByText("自动填写验收", { exact: true }).waitFor();
  await page.getByLabel("来源草稿").selectOption(c.id);
  await page
    .locator(".publish-platform")
    .filter({ hasText: "本地测试平台" })
    .getByRole("checkbox")
    .check();
  const editor = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "本地测试平台 · 适配预览与编辑",
        exact: true,
      }),
    });
  await editor.getByLabel("目标账号").selectOption(a.id);
  await editor.getByLabel("标题", { exact: true }).fill("UI 编辑标题");
  await editor.getByRole("checkbox").check();
  assert.equal(
    await editor.getByLabel("标题", { exact: true }).inputValue(),
    "UI 编辑标题",
  );
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/publish-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "docs/screenshots/publish-mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: API → subprocess → headless upload/fill/readback; no submit; ZIP; owner isolation; screenshots; zero page errors.",
  );
} finally {
  await ctx.close();
  await browser.close();
}
