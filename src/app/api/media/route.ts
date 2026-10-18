import { NextRequest, NextResponse } from "next/server";
import { session } from "@/lib/session";
import { row, db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    if (
      req.headers.get("origin") &&
      req.headers.get("origin") !== req.nextUrl.origin
    )
      return NextResponse.json({ error: "不允许跨站请求" }, { status: 403 });
    const s = await session();
    if (Number(req.headers.get("content-length") || 0) > 26 * 1024 * 1024)
      throw Error("文件上限25MB");
    const form = await req.formData(),
      contentId = String(form.get("contentId") || ""),
      file = form.get("file");
    if (
      !row(
        "SELECT c.id FROM contents c JOIN reports p ON p.id=c.report_id JOIN runs r ON r.id=p.run_id WHERE c.id=? AND r.owner=?",
        contentId,
        s.id,
      )
    )
      throw Error("草稿不存在");
    if (!(file instanceof File) || !file.size || file.size > 25 * 1024 * 1024)
      throw Error("请选择25MB以内的图片或MP4");
    const data = Buffer.from(await file.arrayBuffer());
    const mime = data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png"
      : data[0] === 255 && data[1] === 216 && data[2] === 255
        ? "image/jpeg"
        : data.toString("ascii", 0, 4) === "RIFF" &&
            data.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : data.toString("ascii", 4, 8) === "ftyp" &&
              /^(isom|iso[2-6]|mp4[12]|avc1|M4V )$/.test(
                data.toString("ascii", 8, 12),
              )
            ? "video/mp4"
            : "";
    if (!mime) throw Error("仅支持PNG、JPEG、WebP和MP4；文件格式需匹配");
    const id = randomUUID(),
      ext = mime.split("/")[1],
      name = `${id}.${ext}`;
    await mkdir(path.resolve("uploads"), { recursive: true });
    await writeFile(path.resolve("uploads", name), data, { flag: "wx" });
    db()
      .prepare(
        "INSERT INTO media(id,content_id,path,mime,is_demo) VALUES(?,?,?,?,0)",
      )
      .run(id, contentId, name, mime);
    return NextResponse.json({
      id,
      url: "/api/media/" + id,
      mime,
      is_demo: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "上传失败" },
      { status: 400 },
    );
  }
}
export async function GET(req: NextRequest) {
  const s = await session(),
    contentId = req.nextUrl.searchParams.get("contentId") || "";
  return NextResponse.json(
    {
      media: db()
        .prepare(
          "SELECT m.id,m.mime,m.is_demo FROM media m JOIN contents c ON c.id=m.content_id JOIN reports p ON p.id=c.report_id JOIN runs r ON r.id=p.run_id WHERE c.id=? AND r.owner=?",
        )
        .all(contentId, s.id),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
