import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
export function openStore(file = process.env.GEOLENS_DB || "data/geolens.db") {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS publisher_accounts(id TEXT PRIMARY KEY,owner TEXT NOT NULL,platform TEXT NOT NULL,label TEXT NOT NULL,login_status TEXT DEFAULT 'UNKNOWN',checked_at TEXT);
 CREATE TABLE IF NOT EXISTS publisher_jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,content_id TEXT NOT NULL,platform TEXT NOT NULL,account_id TEXT NOT NULL,mode TEXT NOT NULL DEFAULT 'PREPARE_ONLY' CHECK(mode='PREPARE_ONLY'),status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','FILLING','FILLED_AWAITING_REVIEW','NEEDS_LOGIN','FAILED','PUBLISHED_VERIFIED')),payload TEXT NOT NULL,is_mock INTEGER NOT NULL,progress TEXT DEFAULT '',error TEXT,readback TEXT,url TEXT,verification TEXT,pid INTEGER,heartbeat INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE UNIQUE INDEX IF NOT EXISTS publisher_active_account ON publisher_jobs(account_id) WHERE status='FILLING';`);
  return db;
}
export function patch(db, id, values) {
  const keys = Object.keys(values);
  db.prepare(
    `UPDATE publisher_jobs SET ${keys.map((k) => k + "=?").join(",")} WHERE id=?`,
  ).run(...Object.values(values), id);
}
export function recover(db) {
  for (const j of db
    .prepare(
      "SELECT id,pid,heartbeat,status FROM publisher_jobs WHERE pid IS NOT NULL OR status='FILLING'",
    )
    .all()) {
    let alive = false;
    try {
      if (j.pid) {
        process.kill(j.pid, 0);
        alive = true;
      }
    } catch {}
    const age = Date.now() - (j.heartbeat || 0);
    if ((!alive && age > 15000) || age > 30000) {
      const values = { pid: null };
      if (j.status === "FILLING")
        Object.assign(values, {
          status: "FAILED",
          error: "执行进程已退出；内容与账号会话保留，可重试",
        });
      patch(db, j.id, values);
    }
  }
}
