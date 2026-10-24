/**
 * GeoLens M3 - 双租户 Seed
 * 创建：
 *   Org A  geolens-dev  —— User A alice@geolens.local (OWNER) / Project A "ProjectMentor Research"（含品牌/竞对/QuerySet/Query）
 *   Org B  acme-dev     —— User B bob@geolens.local (OWNER) / Project B "Acme Product Research"
 * 兼容 M2 verify.ts：dev@geolens.local 保留为 Org A 成员，Org A 仅有 1 个 Project（projects[0] 稳定）。
 * 密码统一为 Password123!（仅本地开发 seed）。
 */
import { PrismaClient, OrgRole } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();
const DEV_PASSWORD = "Password123!";

async function main() {
  console.log("[seed] 开始写入双租户测试数据...");
  const passwordHash = await argon2.hash(DEV_PASSWORD);

  // ===================== Org A / User A =====================
  const userA = await prisma.user.upsert({
    where: { email: "alice@geolens.local" },
    update: { passwordHash },
    create: {
      email: "alice@geolens.local",
      name: "Alice Owner",
      passwordHash,
      status: "ACTIVE",
    },
  });

  const orgA = await prisma.organization.upsert({
    where: { slug: "geolens-dev" },
    update: {},
    create: { name: "GeoLens Dev Org", slug: "geolens-dev" },
  });

  await prisma.organizationMember.upsert({
    where: {
      userId_organizationId: { userId: userA.id, organizationId: orgA.id },
    },
    update: { role: OrgRole.OWNER },
    create: { userId: userA.id, organizationId: orgA.id, role: OrgRole.OWNER },
  });

  // 兼容 M2 verify.ts：dev 用户保留为 Org A 成员
  const dev = await prisma.user.upsert({
    where: { email: "dev@geolens.local" },
    update: {},
    create: {
      email: "dev@geolens.local",
      name: "Dev User",
      passwordHash: null,
      status: "ACTIVE",
    },
  });
  await prisma.organizationMember.upsert({
    where: {
      userId_organizationId: { userId: dev.id, organizationId: orgA.id },
    },
    update: {},
    create: { userId: dev.id, organizationId: orgA.id, role: OrgRole.OWNER },
  });

  // Project A（子数据仅在新建时写入，幂等）
  const existingProjA = await prisma.project.findFirst({
    where: { organizationId: orgA.id, name: "ProjectMentor Research" },
  });
  if (!existingProjA) {
    const projectA = await prisma.project.create({
      data: {
        organizationId: orgA.id,
        name: "ProjectMentor Research",
        description: "ProjectMentor 品牌 GEO 监测研发项目（开发 seed）",
        industry: "SaaS / EdTech",
        region: "global",
        targetAudience: "AI 产品用户与开发者",
        status: "ACTIVE",
      },
    });

    await prisma.brand.create({
      data: {
        projectId: projectA.id,
        name: "ProjectMentor",
        website: "https://projectmentor.example.com",
        description: "AI 项目助理产品（开发演示品牌）",
        products: ["Project Mentor", "PMentor Suite"],
        aliases: ["Project Mentor", "项目导师", "PMentor"],
      },
    });

    const competitors = [
      { name: "Competitor A", website: "https://comp-a.example.com", description: "竞对 A（开发占位）", aliases: ["CompA"] },
      { name: "Competitor B", website: "https://comp-b.example.com", description: "竞对 B（开发占位）", aliases: ["CompB"] },
      { name: "Competitor C", website: "https://comp-c.example.com", description: "竞对 C（开发占位）", aliases: ["CompC"] },
    ];
    for (const c of competitors) {
      await prisma.competitor.create({ data: { projectId: projectA.id, ...c } });
    }

    const qsRecommended = await prisma.querySet.create({
      data: { projectId: projectA.id, name: "核心推荐词", description: "围绕核心推荐/使用场景的高价值 Query" },
    });
    const qsComparison = await prisma.querySet.create({
      data: { projectId: projectA.id, name: "品牌比较", description: "品牌与竞对对比类 Query" },
    });
    const queries = [
      { text: "最好的 AI 项目助理工具有哪些", type: "RECOMMENDATION", querySetId: qsRecommended.id },
      { text: "推荐一个适合开发者的 AI 项目管理工具", type: "RECOMMENDATION", querySetId: qsRecommended.id },
      { text: "ProjectMentor 怎么样", type: "BRAND", querySetId: qsRecommended.id },
      { text: "ProjectMentor 是否值得购买", type: "PURCHASE_INTENT", querySetId: qsRecommended.id },
      { text: "如何用 AI 规划软件开发项目", type: "PROBLEM_SOLVING", querySetId: qsRecommended.id },
      { text: "AI 项目助理有哪些痛点", type: "PROBLEM_SOLVING", querySetId: qsRecommended.id },
      { text: "ProjectMentor 和 Competitor A 哪个好", type: "COMPARISON", querySetId: qsComparison.id },
      { text: "ProjectMentor 与 Competitor B 对比", type: "COMPARISON", querySetId: qsComparison.id },
      { text: "同类 AI 项目工具横向对比", type: "COMPARISON", querySetId: qsComparison.id },
      { text: "2026 年 AI 项目助理行业趋势", type: "INDUSTRY", querySetId: qsComparison.id },
    ];
    for (const q of queries) {
      await prisma.query.create({
        data: {
          projectId: projectA.id,
          text: q.text,
          type: q.type as never,
          source: "MANUAL",
          status: "ACTIVE",
          language: "zh-CN",
          region: "cn",
          querySetId: q.querySetId,
        },
      });
    }
    console.log("[seed] Project A 已创建（含子数据）");
  } else {
    console.log("[seed] Project A 已存在，跳过子数据写入");
  }

  // ===================== Org B / User B =====================
  const userB = await prisma.user.upsert({
    where: { email: "bob@geolens.local" },
    update: { passwordHash },
    create: {
      email: "bob@geolens.local",
      name: "Bob Owner",
      passwordHash,
      status: "ACTIVE",
    },
  });

  const orgB = await prisma.organization.upsert({
    where: { slug: "acme-dev" },
    update: {},
    create: { name: "Acme Test Org", slug: "acme-dev" },
  });

  await prisma.organizationMember.upsert({
    where: {
      userId_organizationId: { userId: userB.id, organizationId: orgB.id },
    },
    update: { role: OrgRole.OWNER },
    create: { userId: userB.id, organizationId: orgB.id, role: OrgRole.OWNER },
  });

  const existingProjB = await prisma.project.findFirst({
    where: { organizationId: orgB.id, name: "Acme Product Research" },
  });
  if (!existingProjB) {
    await prisma.project.create({
      data: {
        organizationId: orgB.id,
        name: "Acme Product Research",
        description: "Acme 产品线 GEO 监测研究（开发 seed）",
        industry: "Hardware",
        region: "global",
        targetAudience: "智能硬件消费者",
        status: "ACTIVE",
      },
    });
    console.log("[seed] Project B 已创建");
  }

  const counts = {
    users: await prisma.user.count(),
    organizations: await prisma.organization.count(),
    members: await prisma.organizationMember.count(),
    projects: await prisma.project.count(),
    brands: await prisma.brand.count(),
    competitors: await prisma.competitor.count(),
    querySets: await prisma.querySet.count(),
    queries: await prisma.query.count(),
  };
  console.log("[seed] 完成，数据量：", counts);
  console.log("[seed] 开发账号 alice@geolens.local / bob@geolens.local，密码均为 " + DEV_PASSWORD);
}

main()
  .catch((e) => {
    console.error("[seed] 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
