/**
 * 一次性回填：为 m6a_benchmark_run_query_snapshot migration 之前创建的
 * BenchmarkRun 补齐 BenchmarkRunQuery 语义快照。
 *
 * 安全前提：历史 Run 对应 suite 的 BenchmarkQuery 从未被编辑（M6A 期无编辑 API），
 * 因此从「当前」BenchmarkQuery 复制即为创建时刻的真实语义。
 *
 * 幂等：只处理 runQueries 为空的 run；按 (benchmarkRunId, projectQueryId) 去重。
 *
 * 用法：DATABASE_URL=<target> npx tsx scripts/backfill-benchmark-run-queries.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const runs = await prisma.benchmarkRun.findMany({
    where: { runQueries: { none: {} } },
    include: { suite: { include: { queries: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`runs-without-snapshot=${runs.length}`);
  let created = 0;
  let skipped = 0;
  for (const run of runs) {
    const rows = run.suite.queries
      .filter(query => query.enabled && query.projectQueryId)
      .map(query => ({
        benchmarkRunId: run.id,
        benchmarkQueryId: query.id,
        projectQueryId: query.projectQueryId!,
        queryText: query.queryText,
        category: query.category,
        intent: query.intent,
        locale: query.locale,
        weight: query.weight,
        sortOrder: query.sortOrder,
        sanity: query.sanity,
      }));
    if (rows.length === 0) { skipped += 1; continue; }
    const res = await prisma.benchmarkRunQuery.createMany({
      data: rows,
      skipDuplicates: true,
    });
    created += res.count;
  }
  console.log(`backfilled=${created} skipped-empty-runs=${skipped}`);
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
