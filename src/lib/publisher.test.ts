import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { openStore, patch, recover } from "../../scripts/publisher/store.mjs";
import {
  prepare,
  browserExecutable,
} from "../../scripts/publisher/executor.mjs";

it("headless upload/fill/readback stops before submit; durable recovery preserves independent tasks", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "geolens-publish-"));
  const store = openStore(path.join(dir, "test.db"));
  const browser = await chromium.launch({
    executablePath: browserExecutable(),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<input id="media" type="file" multiple onchange="document.querySelector('#upload-done').hidden=false"><p id="upload-done" hidden>上传完成</p><input id="title"><textarea id="body"></textarea><input id="tags"><button onclick="document.body.dataset.published='true'">发布</button>`,
    );
    const file = path.join(dir, "test.png");
    await writeFile(
      file,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4fcAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    const payload = {
      title: "测试标题",
      body: "测试正文",
      tags: "#测试",
      type: "image",
      media: [{ path: file }],
    };
    const result = await prepare(page, "test", payload);
    expect(result.title).toBe(payload.title);
    expect(result.body).toBe(payload.body);
    expect(result.tags).toBe(payload.tags);
    expect(result.mediaCount).toBe(1);
    expect(
      await page.locator("#media").evaluate((e: any) => e.files.length),
    ).toBe(1);
    expect(
      await page.locator("body").getAttribute("data-published"),
    ).toBeNull();
    store
      .prepare(
        "INSERT INTO publisher_accounts(id,owner,platform,label) VALUES(?,?,?,?)",
      )
      .run("account", "owner", "test", "测试账号");
    store
      .prepare(
        "INSERT INTO publisher_jobs(id,owner,content_id,platform,account_id,payload,is_mock,status) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        "job",
        "owner",
        "content",
        "test",
        "account",
        JSON.stringify(payload),
        1,
        "FILLING",
      );
    patch(store, "job", { heartbeat: Date.now() - 30000, pid: 2147483647 });
    recover(store);
    expect(
      (store.prepare("SELECT status FROM publisher_jobs").get() as any).status,
    ).toBe("FAILED");
    store
      .prepare(
        "INSERT INTO publisher_jobs(id,owner,content_id,platform,account_id,payload,is_mock) VALUES(?,?,?,?,?,?,?)",
      )
      .run("other", "owner", "content", "douyin", "other-account", "{}", 1);
    expect(
      (
        store
          .prepare("SELECT status FROM publisher_jobs WHERE id='other'")
          .get() as any
      ).status,
    ).toBe("DRAFT");
    expect(() =>
      store
        .prepare("UPDATE publisher_jobs SET mode='PUBLISH' WHERE id='other'")
        .run(),
    ).toThrow();
  } finally {
    await browser.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
