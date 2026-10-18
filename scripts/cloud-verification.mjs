// Only localhost fixtures and generated media. No platform login or external uploads.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { browserExecutable, prepare } from "./publisher/executor.mjs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { openStore, patch, recover } from "./publisher/store.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = await mkdtemp(path.join(tmpdir(), "geolens-cloud-"));
await mkdir("screenshots", { recursive: true });
await mkdir("docs", { recursive: true });
const result = {
  date: new Date().toISOString(),
  display: process.env.DISPLAY || null,
  headed: false,
  profileRestored: false,
  accountIsolated: false,
  fileUpload: false,
  finalSubmitClicked: null,
  realPlatformLogin: false,
  userTakeover: "未验证：需要用户实际操作云桌面",
  errors: [],
};
let ctx;
const launch = (profile) =>
  chromium.launchPersistentContext(path.join(dir, profile), {
    executablePath: browserExecutable(),
    headless: !process.env.DISPLAY,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
const open = async (context) => {
  const page = context.pages()[0] || (await context.newPage());
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") result.errors.push(m.text());
  });
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.goto("http://localhost:3100/test-platform");
  await page.waitForFunction(() => document.body.dataset.testReady === "true");
  return page;
};
try {
  ctx = await launch("account-a");
  let page = await open(ctx);
  result.headed = !!process.env.DISPLAY;
  await ctx.addCookies([
    {
      name: "cloud-test-session",
      value: "local-fixture-only",
      url: "http://localhost:3100",
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);
  await page.evaluate(() =>
    localStorage.setItem("cloud-test-profile", "account-a"),
  );
  const file = path.join(dir, "actual-file.png");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4fcAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(file, png);
  const readback = await prepare(page, "test", {
    title: "云浏览器本地验证",
    body: "实际文件上传；等待人工审核",
    tags: "#本地验证",
    type: "image",
    media: [{ path: file }],
  });
  const received = await page
    .locator("#media")
    .evaluate(async (e) =>
      Array.from(new Uint8Array(await e.files[0].arrayBuffer())),
    );
  assert.deepEqual(Buffer.from(received), png);
  result.fileUpload = true;
  result.finalSubmitClicked = readback.finalSubmitClicked;
  assert.equal(result.finalSubmitClicked, false);
  await page.screenshot({
    path: "screenshots/cloud-headed.png",
    fullPage: true,
  });
  await ctx.close();
  ctx = await launch("account-a");
  page = await open(ctx);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cloud-test-profile")),
    "account-a",
  );
  assert.equal(
    (await ctx.cookies()).find((c) => c.name === "cloud-test-session")?.value,
    "local-fixture-only",
  );
  result.profileRestored = true;
  await ctx.close();
  ctx = await launch("account-b");
  page = await open(ctx);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("cloud-test-profile")),
    null,
  );
  assert.ok(
    !(await ctx.cookies()).some((c) => c.name === "cloud-test-session"),
  );
  result.accountIsolated = true;
  let store = openStore(path.join(dir, "tasks.db"));
  store
    .prepare(
      "INSERT INTO publisher_accounts(id,owner,platform,label) VALUES('a','owner','test','fixture')",
    )
    .run();
  for (const id of ["completed", "interrupted"])
    store
      .prepare(
        "INSERT INTO publisher_jobs(id,owner,content_id,platform,account_id,payload,is_mock) VALUES(?,'owner','content','test','a','{}',1)",
      )
      .run(id);
  patch(store, "completed", {
    status: "FILLED_AWAITING_REVIEW",
    readback: JSON.stringify(readback),
  });
  patch(store, "interrupted", {
    status: "FILLING",
    pid: 2147483647,
    heartbeat: Date.now() - 60000,
  });
  store.close();
  store = openStore(path.join(dir, "tasks.db"));
  recover(store);
  assert.equal(
    store
      .prepare("SELECT status FROM publisher_jobs WHERE id='completed'")
      .get().status,
    "FILLED_AWAITING_REVIEW",
  );
  assert.deepEqual(
    JSON.parse(
      store
        .prepare("SELECT readback FROM publisher_jobs WHERE id='completed'")
        .get().readback,
    ),
    readback,
  );
  assert.equal(
    store
      .prepare("SELECT status FROM publisher_jobs WHERE id='interrupted'")
      .get().status,
    "FAILED",
  );
  result.taskRestored = true;
  result.interruptedTaskRecovered = true;
  store.close();
  assert.deepEqual(result.errors, []);
} finally {
  await ctx?.close();
  await rm(dir, { recursive: true, force: true });
  await writeFile(
    "docs/cloud-verification.json",
    JSON.stringify(result, null, 2) + "\n",
  );
}
console.log(JSON.stringify(result));
