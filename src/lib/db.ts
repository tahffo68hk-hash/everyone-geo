import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
const g = globalThis as unknown as { geoDb?: DatabaseSync };
export function db() {
  if (!g.geoDb) {
    mkdirSync("data", { recursive: true });
    g.geoDb = new DatabaseSync(path.resolve("data/geolens.db"));
    g.geoDb.exec(readFileSync(path.resolve("scripts/schema.sql"), "utf8"));
    g.geoDb
      .prepare(
        "UPDATE runs SET status='FAILED',error='服务重启中断检测；已保存证据保留，请新建检测' WHERE status='RUNNING'",
      )
      .run();
  }
  return g.geoDb;
}
export function row(sql: string, ...args: string[]) {
  return db()
    .prepare(sql)
    .get(...args) as Record<string, any> | undefined;
}
