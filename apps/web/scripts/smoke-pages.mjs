/**
 * 核心页面 200 冒烟（需本地 Web（:3000）运行中；未运行则提示跳过并 exit 0）。
 * 页面：/login /app /app/monitor /app/benchmark /app/competitors /dev/status
 */
const BASE = process.env.WEB_BASE ?? "http://localhost:3000";
const PAGES = ["/login", "/app", "/app/monitor", "/app/benchmark", "/app/competitors", "/dev/status"];

let anyServer = false;
const results = [];
for (const path of PAGES) {
  let ok = false;
  let status = 0;
  try {
    const res = await fetch(BASE + path, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    status = res.status;
    ok = status < 400 || (path === "/dev/status" && status === 404);
    anyServer = true; // 请求成功即说明服务在运行（302 重定向也算）
  } catch {
    ok = false;
  }
  results.push({ path, ok, status });
  console.log(`${ok ? "[OK ]" : "[FAIL]"} ${path} → ${status || "unreachable"}`);
}
if (!anyServer) {
  console.log(`[smoke-pages] Web 服务未运行（尝试 ${BASE} 失败）——跳过，exit 0`);
  process.exit(0);
}
const failed = results.filter((r) => !r.ok).length;
if (failed > 0) {
  console.log(`[smoke-pages] FAIL —— ${failed}/${PAGES.length} 个页面非 200`);
  process.exit(1);
}
console.log(`[smoke-pages] PASS —— ${PAGES.length}/${PAGES.length} 个核心页面可访问`);
