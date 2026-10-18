import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/geolens.db");
db.exec(readFileSync("scripts/schema.sql", "utf8"));
db.close();
console.log("SQLite schema ready");
