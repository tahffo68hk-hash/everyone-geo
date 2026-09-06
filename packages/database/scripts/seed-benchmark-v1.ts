/**
 * M6A - Seed ProjectMentor GEO Benchmark v1（幂等，可重复执行）。
 *
 * 用法（从 packages/database 目录，注入 DATABASE_URL）：
 *   DATABASE_URL=$(python -c "..." ) npx tsx scripts/seed-benchmark-v1.ts
 *
 * 行为：
 *   1. 定位目标项目（默认 org slug=geolens-dev、project name=ProjectMentor Research，
 *      可用 BENCHMARK_ORG_SLUG / BENCHMARK_PROJECT_NAME 覆盖）。
 *   2. Upsert BenchmarkSuite（@@unique[projectId,name,version]）。
 *   3. Upsert 每条 BenchmarkQuery（@@unique[suiteId,sortOrder]），并把每条镜像为
 *      项目 Query 行（source=IMPORTED / status=PAUSED，避免污染手动监测 UI），
 *      以 projectQueryId 关联 —— Run/Evidence/Analysis 管线完整复用，Evidence 仍是唯一事实源。
 *
 * 该脚本只写 Benchmark 域数据，不改动任何既有项目/品牌/竞对/监测数据。
 */
import { PrismaClient } from "@prisma/client";

const client = new PrismaClient();

const DEFAULT_ORG_SLUG = "geolens-dev";
const DEFAULT_PROJECT_NAME = "ProjectMentor Research";
const MIRROR_QUERYSET_NAME = "GEO Benchmark（自动，勿手动编辑）";

async function main() {
  const orgSlug = process.env.BENCHMARK_ORG_SLUG ?? DEFAULT_ORG_SLUG;
  const projectName = process.env.BENCHMARK_PROJECT_NAME ?? DEFAULT_PROJECT_NAME;

  // 延迟 import：该数据文件是纯常量，先校验 env 再拉取。
  const { BENCHMARK_V1_QUERIES, BENCHMARK_V1_SUITE } = await import("./benchmark-queries");

  const org = await client.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new Error(`组织不存在：slug=${orgSlug}（请先运行 db:seed）`);
  const project = await client.project.findFirst({ where: { organizationId: org.id, name: projectName } });
  if (!project) throw new Error(`项目不存在：${projectName}（请先运行 db:seed）`);

  const suite = await client.benchmarkSuite.upsert({
    where: { projectId_name_version: { projectId: project.id, name: BENCHMARK_V1_SUITE.name, version: BENCHMARK_V1_SUITE.version } },
    update: { description: BENCHMARK_V1_SUITE.description, status: "ACTIVE" },
    create: {
      projectId: project.id,
      name: BENCHMARK_V1_SUITE.name,
      version: BENCHMARK_V1_SUITE.version,
      description: BENCHMARK_V1_SUITE.description,
      status: "ACTIVE",
    },
  });

  // 镜像 QuerySet（每个项目一个，name 唯一）
  const querySet = await client.querySet.upsert({
    where: { projectId_name: { projectId: project.id, name: MIRROR_QUERYSET_NAME } },
    update: {},
    create: { projectId: project.id, name: MIRROR_QUERYSET_NAME, description: "Benchmark 自动镜像查询（status=PAUSED，仅供 Benchmark Run 内部使用）" },
  });

  let created = 0;
  let updated = 0;
  for (const seed of BENCHMARK_V1_QUERIES) {
    const existing = await client.benchmarkQuery.findUnique({
      where: { suiteId_sortOrder: { suiteId: suite.id, sortOrder: seed.sortOrder } },
    });
    if (existing) {
      // 补齐可能缺失的镜像（例如人工删除 Query 后 projectQueryId 被 SetNull）
      let projectQueryId = existing.projectQueryId;
      if (!projectQueryId) {
        const mirror = await client.query.create({
          data: {
            projectId: project.id, querySetId: querySet.id, text: seed.queryText,
            type: "CUSTOM", source: "IMPORTED", status: "PAUSED",
            language: seed.locale, region: "cn",
          },
        });
        projectQueryId = mirror.id;
        created += 1;
      }
      await client.benchmarkQuery.update({
        where: { id: existing.id },
        data: {
          queryText: seed.queryText, category: seed.category, intent: seed.intent,
          locale: seed.locale, weight: seed.weight, enabled: seed.enabled,
          sanity: seed.sanity, projectQueryId,
        },
      });
      updated += 1;
      continue;
    }
    const mirror = await client.query.create({
      data: {
        projectId: project.id, querySetId: querySet.id, text: seed.queryText,
        type: "CUSTOM", source: "IMPORTED", status: "PAUSED",
        language: seed.locale, region: "cn",
      },
    });
    await client.benchmarkQuery.create({
      data: {
        suiteId: suite.id, sortOrder: seed.sortOrder, queryText: seed.queryText,
        category: seed.category, intent: seed.intent, locale: seed.locale,
        weight: seed.weight, enabled: seed.enabled, sanity: seed.sanity,
        projectQueryId: mirror.id,
      },
    });
    created += 1;
  }

  const total = await client.benchmarkQuery.count({ where: { suiteId: suite.id } });
  const enabled = await client.benchmarkQuery.count({ where: { suiteId: suite.id, enabled: true } });
  console.log(JSON.stringify({
    event: "benchmark_v1_seeded", suiteId: suite.id, projectId: project.id,
    suite: `${BENCHMARK_V1_SUITE.name} v${BENCHMARK_V1_SUITE.version}`,
    queries: total, enabledMain: enabled, created, updated,
  }));
}

main()
  .catch((error) => {
    console.error("[seed-benchmark-v1] 失败：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.$disconnect();
  });
