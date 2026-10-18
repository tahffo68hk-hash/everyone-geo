import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { mention, metrics } from "../src/lib/metrics.ts";

const runId = process.argv[2];
if (!runId || process.argv.length !== 3) {
  console.error("Usage: node scripts/rescore-run.mjs <runId>");
  process.exit(1);
}

const db = new DatabaseSync(
  fileURLToPath(new URL("../data/geolens.db", import.meta.url)),
  { open: true, readOnly: false },
);
try {
  db.exec("BEGIN IMMEDIATE");
  const brand = db
    .prepare(
      "SELECT b.name,b.context FROM runs r JOIN brands b ON b.id=r.brand_id WHERE r.id=?",
    )
    .get(runId);
  if (!brand) throw new Error("Run not found");
  const context = JSON.parse(brand.context);
  const userCompetitors = String(context.competitors || "")
    .split(/[,，、\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
  const candidates = userCompetitors.length
    ? userCompetitors
    : Array.isArray(context.inferred_competitors)
      ? context.inferred_competitors
      : [];
  const rows = db
    .prepare(
      "SELECT id,kind,raw_answer,brand_mentioned,mention_position,competitors FROM responses WHERE run_id=?",
    )
    .all(runId);
  const counts = (items) => {
    const result = metrics(items);
    return {
      total: result.total,
      mentioned: result.mentioned,
      discovery: {
        total: result.discovery.total,
        mentioned: result.discovery.mentioned,
      },
      branded: {
        total: result.branded.total,
        mentioned: result.branded.mentioned,
      },
      competitor_mentions: Object.values(result.competitors).reduce(
        (sum, count) => sum + count,
        0,
      ),
    };
  };
  const before = counts(rows);
  const update = db.prepare(
    "UPDATE responses SET brand_mentioned=?,mention_position=?,competitors=? WHERE id=? AND run_id=?",
  );
  let changed = 0;
  for (const row of rows) {
    const match = mention(row.raw_answer, brand.name);
    const competitors = JSON.stringify(
      candidates.filter(
        (name) =>
          typeof name === "string" &&
          name &&
          mention(row.raw_answer, name).mentioned,
      ),
    );
    if (
      row.brand_mentioned !== +match.mentioned ||
      row.mention_position !== match.position ||
      row.competitors !== competitors
    )
      changed++;
    row.brand_mentioned = +match.mentioned;
    row.mention_position = match.position;
    row.competitors = competitors;
    update.run(
      row.brand_mentioned,
      row.mention_position,
      competitors,
      row.id,
      runId,
    );
  }
  const reportUpdate = db
    .prepare("UPDATE reports SET metrics=? WHERE run_id=?")
    .run(JSON.stringify(metrics(rows)), runId);
  db.exec("COMMIT");
  console.log(
    JSON.stringify(
      {
        before,
        after: counts(rows),
        changed_responses: changed,
        updated_reports: Number(reportUpdate.changes),
      },
      null,
      2,
    ),
  );
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
