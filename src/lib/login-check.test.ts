import { it, expect } from "vitest";
import { chromium } from "playwright";
import {
  onLoginPage,
  hasSessionCookies,
  isLoggedIn,
  browserExecutable,
} from "../../scripts/publisher/executor.mjs";

it("treats passport.bilibili.com as logged out", () => {
  expect(
    onLoginPage("bilibili", "https://passport.bilibili.com/login?gourl=x"),
  ).toBe(true);
  expect(
    onLoginPage(
      "bilibili",
      "https://member.bilibili.com/platform/upload/video/frame",
    ),
  ).toBe(false);
  expect(
    onLoginPage("bilibili", "https://evil-passport.bilibili.com.example/"),
  ).toBe(false);
});

it("requires live SESSDATA and DedeUserID cookies for bilibili", () => {
  const future = Date.now() / 1000 + 3600;
  expect(hasSessionCookies("bilibili", [])).toBe(false);
  expect(
    hasSessionCookies("bilibili", [
      { name: "SESSDATA", value: "x", expires: future },
    ]),
  ).toBe(false);
  expect(
    hasSessionCookies("bilibili", [
      { name: "SESSDATA", value: "x", expires: future },
      { name: "DedeUserID", value: "1", expires: future },
    ]),
  ).toBe(true);
  expect(
    hasSessionCookies("bilibili", [
      { name: "SESSDATA", value: "x", expires: 1 },
      { name: "DedeUserID", value: "1", expires: future },
    ]),
  ).toBe(false);
  expect(hasSessionCookies("xiaohongshu", [])).toBe(true);
});

it("passport-like page with upload inputs but no cookies is not logged in", async () => {
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    // The old check returned true here because input[type=file] / avatar-like nodes exist.
    await page.setContent(
      `<input type="file"><a href="https://space.bilibili.com/1">x</a>`,
    );
    expect(await isLoggedIn(page, context, "bilibili")).toBe(false);
    await context.addCookies([
      {
        name: "SESSDATA",
        value: "x",
        domain: ".bilibili.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
      },
      {
        name: "DedeUserID",
        value: "1",
        domain: ".bilibili.com",
        path: "/",
        expires: Date.now() / 1000 + 3600,
      },
    ]);
    expect(await isLoggedIn(page, context, "bilibili")).toBe(true);
    await page.setContent(
      `<div class="login-box">扫码登录</div><input type="file">`,
    );
    expect(await isLoggedIn(page, context, "bilibili")).toBe(false);
  } finally {
    await browser.close();
  }
}, 60000);
