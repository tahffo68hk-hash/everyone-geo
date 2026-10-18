import { redeemClaim } from "../../../../../scripts/publisher/claims.mjs";
import { pickDeclaration } from "../../../../../scripts/publisher/executor.mjs";
import { NextRequest, NextResponse } from "next/server";
import { session } from "@/lib/session";
import { db, row } from "@/lib/db";
import {
  openStore,
  recover,
  patch,
} from "../../../../../scripts/publisher/store.mjs";
import catalog from "../../../../../scripts/publisher/platforms.json";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { readFile, realpath } from "node:fs/promises";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const claimAttempts = new Map<string, { count: number; until: number }>();
const platforms: Record<string, any> = catalog;
export const GET = handle,
  POST = handle;
async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ action: string[] }> },
) {
  const s = await session();
  db();
  const store = openStore();
  try {
    if (
      req.method === "POST" &&
      req.headers.get("origin") &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      throw Error("不允许跨站请求");
    const [action, id] = (await ctx.params).action,
      b = req.method === "POST" ? await req.json() : {};
    const out = (v: any) =>
      NextResponse.json(v, { headers: { "Cache-Control": "no-store" } });
    recover(store);
    if (action === "claim" && req.method === "POST") {
      const now = Date.now();
      for (const [owner, entry] of claimAttempts)
        if (entry.until <= now) claimAttempts.delete(owner);
      const entry = claimAttempts.get(s.id) || {
        count: 0,
        until: now + 600000,
      };
      claimAttempts.set(s.id, entry);
      if (++entry.count > 10) throw Error("绑定尝试过多，请10分钟后重试");
      if (typeof b.code !== "string" || b.code.length > 40)
        throw Error("绑定码无效");
      return out(redeemClaim(store, b.code, s.id, now));
    }
    if (action === "workspace" && req.method === "GET")
      return out({
        platforms: Object.entries(platforms).map(([id, p]) => ({
          id,
          label: p.label,
          url: p.url,
          types: p.types,
          validation: id === "test" ? "本地流程验证" : "未真实验证",
        })),
        contents: db()
          .prepare(
            "SELECT c.*,g.evidence_mock FROM contents c LEFT JOIN content_generations g ON g.content_id=c.id JOIN reports p ON p.id=c.report_id JOIN runs r ON r.id=p.run_id WHERE r.owner=? ORDER BY c.rowid DESC",
          )
          .all(s.id),
        accounts: store
          .prepare("SELECT * FROM publisher_accounts WHERE owner=?")
          .all(s.id),
        jobs: store
          .prepare(
            "SELECT * FROM publisher_jobs WHERE owner=? ORDER BY rowid DESC",
          )
          .all(s.id),
        display: !!process.env.DISPLAY,
      });
    if (action === "accounts" && req.method === "POST") {
      if (
        !Object.hasOwn(platforms, b.platform) ||
        typeof b.label !== "string" ||
        !b.label.trim()
      )
        throw Error("请选择平台并填写账号名称");
      const id = randomUUID();
      store
        .prepare(
          "INSERT INTO publisher_accounts(id,owner,platform,label) VALUES(?,?,?,?)",
        )
        .run(id, s.id, b.platform, b.label.slice(0, 80));
      return out({ id });
    }
    if (action === "create" && req.method === "POST") {
      const c = row(
        "SELECT c.*,g.evidence_mock FROM contents c LEFT JOIN content_generations g ON g.content_id=c.id JOIN reports p ON p.id=c.report_id JOIN runs r ON r.id=p.run_id WHERE c.id=? AND r.owner=?",
        String(b.contentId),
        s.id,
      );
      if (!c) throw Error("请选择当前会话草稿");
      c.is_mock = +(!!c.is_mock || !!c.evidence_mock);
      if (
        !Array.isArray(b.targets) ||
        !b.targets.length ||
        b.targets.length > 12
      )
        throw Error("请选择1–12个平台");
      const planned = [];
      for (const t of b.targets) {
        const p = platforms[t.platform],
          a = store
            .prepare(
              "SELECT * FROM publisher_accounts WHERE id=? AND owner=? AND platform=?",
            )
            .get(t.accountId, s.id, t.platform);
        if (!p || !a || !p.types.includes(t.type))
          throw Error("平台、内容类型或账号无效");
        if (
          !t.title?.trim() ||
          !t.body?.trim() ||
          t.title.length > 300 ||
          t.body.length > 30000 ||
          typeof t.tags !== "string" ||
          t.tags.length > 3000
        )
          throw Error("请检查标题、正文和话题长度");
        if (!Array.isArray(t.mediaIds) || t.mediaIds.length > 20)
          throw Error("素材选择无效");
        const media = t.mediaIds.map((mid: string) => {
          const m = row(
            "SELECT * FROM media WHERE id=? AND content_id=?",
            mid,
            c.id,
          );
          if (
            !m ||
            m.is_demo ||
            !/^[-a-f0-9]+\.(png|jpeg|webp|mp4)$/.test(m.path)
          )
            throw Error("只能选择草稿所属的真实上传素材");
          return m;
        });
        if (
          media.some((m: any) =>
            t.type === "video"
              ? !m.mime.startsWith("video/")
              : !m.mime.startsWith("image/"),
          )
        )
          throw Error("媒体格式与发布类型不匹配");
        const cover = t.coverId
          ? row(
              "SELECT * FROM media WHERE id=? AND content_id=?",
              t.coverId,
              c.id,
            )
          : null;
        if (
          t.coverId &&
          (!cover || cover.is_demo || !cover.mime.startsWith("image/"))
        )
          throw Error("封面必须是草稿所属用户图片");
        if (t.selfMadeAuth !== undefined && typeof t.selfMadeAuth !== "boolean")
          throw Error("自制授权须为布尔值");
        const declaration = pickDeclaration(t);
        if (
          t.platform === "bilibili" &&
          (t.type !== "video" ||
            media.length !== 1 ||
            media[0].mime !== "video/mp4")
        )
          throw Error("B站任务须选择一个MP4视频");
        const source = JSON.parse(c.body);
        planned.push({
          id: randomUUID(),
          t,
          payload: JSON.stringify({
            title: t.title,
            body: t.body,
            tags: t.tags,
            type: t.type,
            media,
            cover,
            declaration,
            selfMadeAuth: t.selfMadeAuth ?? false,
            coverSuggestion: source.coverSuggestion,
            is_mock: !!c.is_mock,
            provenance: c.is_mock
              ? "模拟数据/未真实验证"
              : "生成内容/平台未真实验证",
          }),
        });
      }
      store.exec("BEGIN");
      try {
        for (const { id, t, payload } of planned)
          store
            .prepare(
              "INSERT INTO publisher_jobs(id,owner,content_id,platform,account_id,payload,is_mock) VALUES(?,?,?,?,?,?,?)",
            )
            .run(id, s.id, c.id, t.platform, t.accountId, payload, c.is_mock);
        store.exec("COMMIT");
      } catch (e) {
        store.exec("ROLLBACK");
        throw e;
      }
      return out({ ids: planned.map((x) => x.id) });
    }
    const job = store
      .prepare("SELECT * FROM publisher_jobs WHERE id=? AND owner=?")
      .get(id || "", s.id) as any;
    if (!job) throw Error("任务不存在");
    if (action === "status" && req.method === "GET") return out({ job });
    if (action === "export" && req.method === "GET") {
      const payload = JSON.parse(job.payload),
        zip = archiver("zip"),
        stream = new PassThrough();
      zip.on("error", () => stream.destroy());
      zip.pipe(stream);
      zip.append(
        JSON.stringify(
          { ...payload, mode: "PREPARE_ONLY", platform: job.platform },
          null,
          2,
        ),
        { name: "manifest.json" },
      );
      zip.append(payload.title, { name: "title.txt" });
      zip.append(payload.body, { name: "body.txt" });
      zip.append(payload.tags, { name: "tags.txt" });
      zip.append(
        "人工发布包。请审核内容、封面、分类与声明；不包含自动提交功能。" +
          payload.provenance,
        { name: "README.txt" },
      );
      for (const m of [
        ...payload.media,
        ...(payload.cover ? [payload.cover] : []),
      ]) {
        const root = await realpath("uploads"),
          file = await realpath(path.resolve("uploads", m.path));
        if (path.dirname(file) !== root) throw Error("素材路径无效");
        zip.append(await readFile(file), {
          name: "media/" + path.basename(file),
        });
      }
      void zip.finalize();
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="geolens-${job.platform}-${job.id}.zip"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (req.method !== "POST") throw Error("请求方式无效");
    if (action === "confirm") {
      if (b.confirmed !== true) throw Error("请明确确认已人工核实");
      const url = new URL(String(b.url));
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error("请输入有效的发布链接");
      if (job.platform === "test") throw Error("本地测试不能登记真实发布");
      if (job.pid) throw Error("请先关闭接管浏览器，再登记发布结果");
      patch(store, id, {
        status: "PUBLISHED_VERIFIED",
        url: url.href,
        verification: JSON.stringify({
          source: "USER_PROVIDED_URL",
          confirmedAt: new Date().toISOString(),
          note: "人工确认链接；服务端未独立验证公开可访问性",
        }),
      });
      return out({ ok: true });
    }
    if (action === "review") {
      if (job.status !== "FILLED_AWAITING_REVIEW" || b.confirmed !== true)
        throw Error("请在已填写后确认人工审核");
      patch(store, id, {
        verification: JSON.stringify({
          source: "MANUAL_REVIEW",
          at: new Date().toISOString(),
        }),
        progress: "人工已审核，仍未登记公开发布",
      });
      return out({ ok: true });
    }
    if (["fill", "check", "open"].includes(action)) {
      if (job.status === "PUBLISHED_VERIFIED" || job.pid)
        throw Error("任务已发布或浏览器仍运行；请先关闭浏览器");
      if (
        store
          .prepare(
            "SELECT id FROM publisher_jobs WHERE account_id=? AND pid IS NOT NULL",
          )
          .get(job.account_id)
      )
        throw Error("该账号有浏览器运行中，请先关闭");
      if (job.platform === "wordpress")
        throw Error("WordPress 请使用创建 REST 草稿按钮");
      if (
        action === "fill" &&
        ["video", "image"].includes(JSON.parse(job.payload).type) &&
        !JSON.parse(job.payload).media.length
      )
        throw Error("请先选择真实媒体并重新创建任务");
      patch(store, id, {
        status: "FILLING",
        error: null,
        progress: "启动独立浏览器执行器",
        heartbeat: Date.now(),
      });
      const child = spawn(
        process.execPath,
        [path.resolve("scripts/publisher/runner.mjs"), id, action],
        {
          cwd: process.cwd(),
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        },
      );
      patch(store, id, { pid: child.pid || null });
      child.on("error", () =>
        patch(store, id, {
          status: "FAILED",
          pid: null,
          error: "无法启动执行器",
        }),
      );
      child.unref();
      return out({ ok: true });
    }
    if (action === "wordpress") {
      if (
        job.platform !== "wordpress" ||
        job.status !== "DRAFT" ||
        b.confirmed !== true
      )
        throw Error("请确认创建 WordPress 草稿");
      const url = new URL(String(b.site));
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error("请输入 HTTPS WordPress 站点");
      if (!b.username || !b.password)
        throw Error("请输入用户名和应用密码；凭据仅用于本次后端请求");
      const payload = JSON.parse(job.payload),
        escape = (s: string) =>
          s.replace(
            /[&<>"']/g,
            (c) =>
              ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
              })[c]!,
          );
      const res = await fetch(
        url.href.replace(/\/$/, "") + "/wp-json/wp/v2/posts",
        {
          method: "POST",
          redirect: "error",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(b.username + ":" + b.password).toString("base64"),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: payload.title,
            content:
              "<p>" + escape(payload.body).replace(/\n/g, "<br>") + "</p>",
            status: "draft",
          }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (!res.ok) throw Error("WordPress 草稿请求失败，HTTP " + res.status);
      const data = await res.json();
      if (data.status !== "draft" || !data.id)
        throw Error("WordPress 未返回可确认的 draft");
      patch(store, id, {
        status: "FILLED_AWAITING_REVIEW",
        readback: JSON.stringify({ id: data.id, status: data.status }),
        progress: "WordPress 已创建草稿；未公开发布；媒体/分类请在后台编辑",
      });
      return out({ ok: true });
    }
    throw Error("未知操作");
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "操作失败" },
      { status: 400 },
    );
  } finally {
    store.close();
  }
}
