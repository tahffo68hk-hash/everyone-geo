import { NextRequest, NextResponse } from "next/server";
import { session } from "@/lib/session";
import { row } from "@/lib/db";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const s = await session(),
    { id } = await ctx.params;
  const m = row(
    "SELECT m.* FROM media m JOIN contents c ON c.id=m.content_id JOIN reports p ON p.id=c.report_id JOIN runs r ON r.id=p.run_id WHERE m.id=? AND r.owner=?",
    id,
    s.id,
  );
  if (!m || !/^[0-9a-f-]+\.(png|jpeg|webp|mp4)$/.test(m.path))
    return new NextResponse(null, { status: 404 });
  try {
    const root = await realpath(path.resolve("uploads")),
      file = await realpath(path.join(root, m.path));
    if (path.dirname(file) !== root)
      return new NextResponse(null, { status: 403 });
    const data = await readFile(file);
    const headers = {
      "Content-Type": m.mime,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };
    const range = req.headers.get("range");
    if (range) {
      const parts = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!parts) return new NextResponse(null, { status: 416 });
      const start = Number(parts[1]),
        end = parts[2] ? Number(parts[2]) : data.length - 1;
      if (start > end || end >= data.length)
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${data.length}` },
        });
      return new NextResponse(data.subarray(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${data.length}`,
          "Content-Length": String(end - start + 1),
        },
      });
    }
    return new NextResponse(data, {
      headers: { ...headers, "Content-Length": String(data.length) },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
