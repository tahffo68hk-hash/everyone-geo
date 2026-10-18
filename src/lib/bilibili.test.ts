import { it, expect } from "vitest";
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  browserExecutable,
  bilibiliCover,
  bilibiliDeclaration,
  pickDeclaration,
  tagOutcome,
} from "../../scripts/publisher/executor.mjs";
const executable = browserExecutable() || chromium.executablePath();
it("rejects invalid declarations", () => {
  expect(pickDeclaration({})).toBe("内容无需标注");
  expect(() => pickDeclaration({ declaration: "invalid" })).toThrow(
    "创作声明无效",
  );
});
for (const user of [true, false])
  it.skipIf(!existsSync(executable))(
    `verifies ${user ? "user cover" : "recommended frame"} and declaration without publishing`,
    async () => {
      const browser = await chromium.launch({
        executablePath: executable,
        headless: true,
        args: ["--no-sandbox"],
      });
      let directory = "";
      try {
        await mkdir("uploads", { recursive: true });
        directory = await mkdtemp(path.resolve("uploads", "fixture-"));
        // Keep file directly under uploads, matching production path validation.
        const file = path.resolve("uploads", path.basename(directory) + ".png");
        try {
          await writeFile(
            file,
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
              "base64",
            ),
          );
          const page = await browser.newPage();
          await page.setContent(
            await readFile("src/lib/fixtures/bilibili.html", "utf8"),
          );
          const payload = {
            ...(user ? { cover: { path: path.basename(file) } } : {}),
            declaration: user ? "含AI生成内容" : "内容无需标注",
            selfMadeAuth: user,
          };
          expect(await bilibiliCover(page, payload)).toEqual({
            source: user ? "user" : "recommended",
            set: true,
          });
          expect(await bilibiliDeclaration(page, payload)).toBe(
            payload.declaration,
          );
          expect(await page.locator("body").getAttribute("data-ai")).toBeNull();
          expect(
            await page.locator("body").getAttribute("data-published"),
          ).toBeNull();
          expect(await page.locator("body").getAttribute("data-auth")).toBe(
            user ? "true" : null,
          );
          expect(await page.locator("#commercial").isChecked()).toBe(false);
          expect(await page.locator("body").getAttribute("data-uploaded")).toBe(
            user ? "true" : null,
          );
        } finally {
          await rm(file, { force: true });
        }
      } finally {
        await browser.close();
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    },
    20000,
  );

it("tolerates partially dropped bilibili tags but not all", () => {
  expect(tagOutcome(["a", "b"], ["a"]).dropped).toEqual(["b"]);
  expect(tagOutcome(["a"], ["a"]).dropped).toEqual([]);
  expect(() => tagOutcome(["a", "b"], [])).toThrow("标签全部未生成");
});
