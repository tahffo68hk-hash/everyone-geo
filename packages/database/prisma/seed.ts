/**
 * GeoLens M2 - 最小测试数据 Seed
 * 创建：1 User / 1 Organization / 1 OrganizationMember(OWNER) /
 *       1 Project / 1 Brand / 3 Competitors / 2 QuerySets / 10 Queries
 * 品牌使用开发占位名 ProjectMentor（仅作为开发 seed，不用于生产）。
 */
import { PrismaClient, OrgRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] 开始写入最小测试数据...");

  // 幂等：已存在则跳过
  const existing = await prisma.organization.findUnique({
    where: { slug: "geolens-dev" },
  });
  if (existing) {
    console.log("[seed] 已存在 geolens-dev 组织，跳过（可用 prisma migrate reset 重建）");
    return;
  }

  const user = await prisma.user.upsert({
    where: { email: "dev@geolens.local" },
    update: {},
    create: {
      email: "dev@geolens.local",
      name: "Dev User",
      passwordHash: null, // M2 不做认证
      status: "ACTIVE",
    },
  });

  const org = await prisma.organization.create({
    data: {
      name: "GeoLens Dev Org",
      slug: "geolens-dev",
    },
  });

  await prisma.organizationMember.create({
    data: {
      userId: user.id,
      organizationId: org.id,
      role: OrgRole.OWNER,
    },
  });

  const project = await prisma.project.create({
    data: {
      organizationId: org.id,
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
      projectId: project.id,
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
    await prisma.competitor.create({ data: { projectId: project.id, ...c } });
  }

  // QuerySets
  const qsRecommended = await prisma.querySet.create({
    data: {
      projectId: project.id,
      name: "核心推荐词",
      description: "围绕核心推荐/使用场景的高价值 Query",
    },
  });
  const qsComparison = await prisma.querySet.create({
    data: {
      projectId: project.id,
      name: "品牌比较",
      description: "品牌与竞对对比类 Query",
    },
  });

  // 10 Queries
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
        projectId: project.id,
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

  // 汇总
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
}

main()
  .catch((e) => {
    console.error("[seed] 失败：", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
