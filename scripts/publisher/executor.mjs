import { chromium } from "playwright";
import catalog from "./platforms.json" with { type: "json" };
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("data/browsers"))
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve("data/browsers");
export function browserExecutable() {
  const root = path.resolve("data/browsers");
  if (existsSync(root)) {
    const folder = readdirSync(root).find((x) => /^chromium-\d+$/.test(x));
    if (folder) return path.join(root, folder, "chrome-linux64/chrome");
  }
  return undefined;
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const waitForTakeover = (context) =>
  new Promise((resolve) => {
    const timer = setTimeout(
      resolve,
      +process.env.GEOLENS_TAKEOVER_MS || 15 * 60 * 1000,
    );
    context.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
// Ported creator selectors and upload-first sequence: see NOTICE.
export async function find(page, selectors, visible = true) {
  for (const frame of page.frames())
    for (const s of selectors) {
      const l = frame.locator(s).first();
      try {
        if ((await l.count()) && (!visible || (await l.isVisible()))) return l;
      } catch {}
    }
  return null;
}
// Hosts that only ever serve login/passport pages; being there means NOT logged in.
const LOGIN_HOSTS = {
  bilibili: [/(^|\.)passport\.bilibili\.com$/],
};
// Session cookies that must exist before a platform is treated as logged in.
const REQUIRED_COOKIES = { bilibili: ["SESSDATA", "DedeUserID"] };
export function onLoginPage(platform, url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return (LOGIN_HOSTS[platform] || []).some((r) => r.test(host));
}
export function hasSessionCookies(platform, cookies) {
  const need = REQUIRED_COOKIES[platform] || [];
  const now = Date.now() / 1000;
  return need.every((n) =>
    cookies.some(
      (c) =>
        c.name === n &&
        c.value &&
        (c.expires === -1 || !c.expires || c.expires > now),
    ),
  );
}
export async function isLoggedIn(page, context, platform) {
  const cfg = catalog[platform];
  if (onLoginPage(platform, page.url())) return false;
  if (REQUIRED_COOKIES[platform]) {
    const cookies = await context.cookies().catch(() => []);
    if (!hasSessionCookies(platform, cookies)) return false;
  }
  if (await find(page, cfg.selectors.login_modal || [])) return false;
  return !!(await find(
    page,
    [
      ...(cfg.selectors.avatar || []),
      ...(cfg.selectors.title || []),
      ...(cfg.selectors.video_input || []),
      ...(cfg.selectors.media_input || []),
      'input[type="file"]',
    ],
    false,
  ));
}
export async function prepare(page, platform, payload, progress = () => {}) {
  const config = catalog[platform],
    s = config.selectors;
  if (platform === "xiaohongshu") {
    const tab = page.getByText("上传图文", { exact: true }).first();
    if (await tab.isVisible().catch(() => false)) await tab.click();
  }
  const titles = [
    ...(s.title || []),
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
  ];
  const bodies = [
    ...(s.content_editor || s.description || []),
    'div.zone-container[contenteditable="true"]',
    'div.input-editor[contenteditable="true"]',
    ".ProseMirror",
    '[contenteditable="true"]',
    'textarea[placeholder*="简介"]',
  ];
  if (platform === "test") bodies.unshift("#body");
  if (payload.media?.length) {
    progress("上传媒体，等待页面处理");
    const video = payload.type === "video";
    const inputs = [
      ...(s[video ? "video_input" : "media_input"] || []),
      `input[type="file"][accept*="${video ? "video" : "image"}"]`,
      'input[type="file"]',
    ];
    const input = await find(page, inputs, false);
    if (!input) throw Error("找不到媒体上传入口，请人工打开编辑页或导出发布包");
    await input.setInputFiles(
      payload.media.map((m) => path.resolve("uploads", m.path)),
    );
    // Bilibili lists the file item as soon as upload *starts*; require the explicit done text.
    const complete = [
      ...(platform === "bilibili"
        ? []
        : s.upload_complete_status || s.upload_success || []),
      "text=上传成功",
      "text=重新上传",
      "text=上传完成",
      ...(platform === "xiaohongshu"
        ? [".img-preview img", ".image-list img", ".upload-success"]
        : []),
    ];
    let done = false;
    for (let i = 0; i < 300; i++) {
      if (await find(page, s.upload_error || []))
        throw Error("平台提示上传失败；请人工检查，不标记已填写");
      if (await find(page, complete)) {
        done = true;
        break;
      }
      await delay(1000);
    }
    if (!done) throw Error("未能可靠确认上传完成；请人工检查，不标记已填写");
  }
  if (payload.cover) {
    progress("设置用户选择的封面");
    let input = await find(page, s.cover_input || [], false);
    if (!input) {
      const trigger = await find(page, s.cover_trigger || []);
      if (trigger) {
        await trigger.click();
        input = await find(page, s.cover_input || [], false);
      }
    }
    if (!input)
      throw Error("未找到独立封面入口，请人工设置封面；不继续标记填写完成");
    await input.setInputFiles(path.resolve("uploads", payload.cover.path));
    // Upstream modal confirmation is confined to the cover dialog; never a page-level submit.
    const done = page
      .locator(".cover-editor, .bcc-dialog, .weui-desktop-dialog")
      .getByRole("button", { name: /^(完成|确定)$/ })
      .first();
    if (await done.isVisible().catch(() => false)) await done.click();
  }
  progress("填写标题、正文与话题并回读");
  let title = await find(page, titles),
    body = await find(page, bodies);
  if (!body)
    throw Error("未找到正文编辑器；公众号等平台请人工进入新建文章后重试");
  // Weibo and Kuaishou use one description field; preserve title in the body.
  const combined = !title || ["weibo", "kuaishou"].includes(platform);
  if (title) await title.fill(payload.title);
  const tags = await find(page, s.tag_input || []);
  const bodyValue =
    (combined ? payload.title + "\n" : "") +
    payload.body +
    (!tags && payload.tags ? "\n" + payload.tags : "");
  await body.fill(bodyValue);
  if (tags && payload.tags) {
    if (platform === "bilibili")
      for (const tag of payload.tags
        .split(/[\s#]+/)
        .filter(Boolean)
        .slice(0, 10)) {
        await tags.fill(tag);
        await tags.press("Enter");
      }
    else await tags.fill(payload.tags);
    if (platform === "bilibili")
      for (const tag of payload.tags
        .split(/[\s#]+/)
        .filter(Boolean)
        .slice(0, 10)) {
        if (!(await page.getByText(tag, { exact: true }).first().isVisible()))
          throw Error("标签未生成，请人工确认");
      }
  }
  const read = async (l) =>
    l.evaluate((e) => ("value" in e ? e.value : e.innerText));
  const readback = {
    title: title ? await read(title) : null,
    body: await read(body),
    tags: tags && platform !== "bilibili" ? await read(tags) : payload.tags,
    mediaCount: payload.media?.length || 0,
    mode: "PREPARE_ONLY",
    warnings: ["封面、分类、原创/AI声明及话题识别请人工审核；未点击最终提交"],
  };
  if (
    (title && readback.title !== payload.title) ||
    readback.body.replace(/\r/g, "") !== bodyValue.replace(/\r/g, "")
  )
    throw Error("表单回读与内容不一致，请人工检查");
  if (tags && platform !== "bilibili" && readback.tags !== payload.tags)
    throw Error("话题回读不一致");
  if (platform === "test")
    readback.finalSubmitClicked =
      (await page.locator("body").getAttribute("data-published")) === "true";
  return readback;
}
export async function executeBrowser(job, action, update, accountUpdate) {
  const cfg = catalog[job.platform],
    payload = JSON.parse(job.payload),
    headed = !!process.env.DISPLAY && job.platform !== "test";
  const profile = path.resolve("data/profiles", job.platform, job.account_id);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: browserExecutable(),
    headless: !headed,
    args: [
      "--disable-dev-shm-usage",
      ...(process.env.GEOLENS_CDP_PORT
        ? ["--remote-debugging-port=" + process.env.GEOLENS_CDP_PORT]
        : []),
    ],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(20000);
  try {
    await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (job.platform === "test")
      await page.waitForFunction(
        () => document.body.dataset.testReady === "true",
      );
    // Recover Bilibili login via home before returning to the upload frame, as upstream.
    const ready = () => isLoggedIn(page, context, job.platform);
    let logged = job.platform === "test" || (await ready());
    if (!logged) {
      accountUpdate("NEEDS_LOGIN");
      update({
        status: "NEEDS_LOGIN",
        progress: headed
          ? "请在云桌面浏览器登录，等待最多5分钟"
          : "无可交互桌面或登录态；请在有 DISPLAY 的环境登录，或下载人工发布包",
      });
      if (headed) {
        if (job.platform === "bilibili")
          await page.goto("https://member.bilibili.com/");
        for (let i = 0; i < 150; i++) {
          await delay(2000);
          if (await ready()) {
            logged = true;
            break;
          }
        }
        if (logged && job.platform === "bilibili")
          await page.goto(cfg.url, { waitUntil: "domcontentloaded" });
      }
    }
    if (!logged) return;
    accountUpdate("LOGGED_IN");
    if (action === "check" || action === "open") {
      update({
        status: "DRAFT",
        progress: "已检查账号；浏览器打开后可人工接管",
      });
    } else {
      update({ status: "FILLING", progress: "登录已确认，准备上传" });
      const readback = await prepare(page, job.platform, payload, (p) =>
        update({ progress: p }),
      );
      if (process.env.GEOLENS_SCREENSHOT_PREFIX) {
        const shot = path.resolve(
          "screenshots",
          `${process.env.GEOLENS_SCREENSHOT_PREFIX}-filled.png`,
        );
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        readback.screenshot = shot;
      }
      update({
        status: "FILLED_AWAITING_REVIEW",
        readback: JSON.stringify(readback),
        progress: "已回读校验，等待人工审核；封面/分类/声明请人工确认",
      });
    }
    if (headed) {
      update({
        progress:
          "浏览器保留15分钟供人工接管；请在云桌面操作。最终发布由你手动完成",
      });
      await waitForTakeover(context);
    }
  } finally {
    await context.close().catch(() => {});
  }
}
