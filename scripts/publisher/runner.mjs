import { openStore, patch } from "./store.mjs";
import { executeBrowser } from "./executor.mjs";
const [id, action = "fill"] = process.argv.slice(2),
  db = openStore();
const job = db.prepare("SELECT * FROM publisher_jobs WHERE id=?").get(id);
if (!job) process.exit(1);
patch(db, id, { pid: process.pid, heartbeat: Date.now() });
const timer = setInterval(() => patch(db, id, { heartbeat: Date.now() }), 3000);
try {
  await executeBrowser(
    job,
    action,
    (v) => patch(db, id, v),
    (status) =>
      db
        .prepare(
          "UPDATE publisher_accounts SET login_status=?,checked_at=? WHERE id=?",
        )
        .run(status, new Date().toISOString(), job.account_id),
  );
} catch (e) {
  patch(db, id, {
    status: "FAILED",
    error:
      "浏览器准备失败：" +
      String(e.message || "未知错误").slice(0, 500) +
      "；可导出人工包，未执行发布。",
  });
} finally {
  clearInterval(timer);
  patch(db, id, { pid: null });
  db.close();
}
