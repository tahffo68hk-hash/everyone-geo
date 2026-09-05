/**
 * GeoLens M2 验收脚本
 * 验证：
 *  1) User → Organization → Project → Brand 关系
 *  2) Project → Competitors
 *  3) Project → QuerySets → Queries
 *  4) 唯一约束：Organization.slug、OrganizationMember(userId+organizationId)、Project(organizationId+name)
 *  5) FK 删除策略：Organization 存在 Project 时禁止删除(Restrict)；
 *     QuerySet 删除 → Query.querySetId 置空(SetNull)；Project 删除 → Brand/QuerySet/Query 级联(Cascade)
 *
 * 注意：PostgreSQL 事务中一旦发生约束错误即进入 aborted 状态，后续命令被忽略；
 *       故「预期破坏约束」的用例必须独立语句执行（单条失败自动回滚），
 *       不能在同一个交互式事务内 catch 后继续。
 */
import { prisma } from "../src";

let allPass = true;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} | ${name}${detail ? ` | ${detail}` : ""}`);
  if (!ok) allPass = false;
}
async function expectError(name: string, fn: () => Promise<unknown>, codes: string[]) {
  try {
    await fn();
    check(name, false, "未抛错");
  } catch (e: any) {
    if (e?.code && codes.includes(e.code)) {
      check(name, true, `约束生效 (${e.code})`);
    } else {
      check(name, false, `错误码 ${e?.code} 不在预期 ${codes.join("/")}`);
    }
  }
}

async function main() {
  // ---------- 1. 关系链完整性 ----------
  const user = await prisma.user.findUnique({
    where: { email: "dev@geolens.local" },
    include: {
      memberships: {
        include: {
          organization: {
            include: {
              projects: {
                include: { brands: true, competitors: true, querySets: { include: { queries: true } } },
              },
            },
          },
        },
      },
    },
  });
  check("seed User 存在", !!user);
  const member = user?.memberships[0];
  check("User → OrganizationMember", !!member, member ? `role=${member.role}` : "");
  check("OrganizationMember → Organization", !!member?.organization);
  const project = member?.organization.projects[0];
  check("Organization → Project", !!project, project ? project.name : "");
  check("Project → Brand(1)", project?.brands.length === 1, `count=${project?.brands.length}`);
  check("Project → Competitors(3)", project?.competitors.length === 3, `count=${project?.competitors.length}`);
  check("Project → QuerySets(2)", project?.querySets.length === 2, `count=${project?.querySets.length}`);
  const totalQueries = project?.querySets.reduce((s, qs) => s + qs.queries.length, 0) ?? 0;
  check("QuerySets → Queries(10)", totalQueries === 10, `count=${totalQueries}`);

  // ---------- 2. 唯一约束（独立语句，逐条验证） ----------
  await expectError("Organization.slug 唯一约束",
    () => prisma.organization.create({ data: { name: "dup", slug: "geolens-dev" } }), ["P2002"]);
  await expectError("OrganizationMember(userId+organizationId) 唯一约束",
    () => prisma.organizationMember.create({
      data: { userId: user!.id, organizationId: member!.organizationId, role: "MEMBER" },
    }), ["P2002"]);
  await expectError("Project(organizationId+name) 唯一约束",
    () => prisma.project.create({
      data: { organizationId: member!.organizationId, name: project!.name },
    }), ["P2002"]);

  // ---------- 3. FK Restrict（独立语句） ----------
  await expectError("Organization 删除被 Restrict（有 Project）",
    () => prisma.organization.delete({ where: { id: member!.organizationId } }), ["P2003"]);

  // ---------- 4. SetNull + Cascade（交互式事务，全程正常操作，末尾回滚） ----------
  await prisma.$transaction(async (tx) => {
    const tempProject = await tx.project.create({
      data: { organizationId: member!.organizationId, name: "__tmp_verify_project" },
    });
    const tmpQs = await tx.querySet.create({
      data: { projectId: tempProject.id, name: "__tmp_qs" },
    });
    const qBound = await tx.query.create({
      data: { projectId: tempProject.id, querySetId: tmpQs.id, text: "__tmp_bound_query" },
    });
    const qFree = await tx.query.create({
      data: { projectId: tempProject.id, text: "__tmp_free_query" },
    });
    await tx.querySet.delete({ where: { id: tmpQs.id } });
    const qAfter = await tx.query.findUnique({ where: { id: qBound.id } });
    check("QuerySet 删除 → Query.querySetId 置空(SetNull)", qAfter?.querySetId === null);

    const tmpBrand = await tx.brand.create({
      data: { projectId: tempProject.id, name: "Tmp Brand" },
    });
    await tx.project.delete({ where: { id: tempProject.id } });
    const remainBrand = await tx.brand.count({ where: { id: tmpBrand.id } });
    const remainQuery = await tx.query.count({ where: { id: qFree.id } });
    check("Project 删除 → Brand 级联删除(Cascade)", remainBrand === 0, `remain=${remainBrand}`);
    check("Project 删除 → Query 级联删除(Cascade)", remainQuery === 0, `remain=${remainQuery}`);
    throw new Error("ROLLBACK");
  }).catch((e: any) => {
    if (e.message !== "ROLLBACK") throw e;
  });

  // ---------- 汇总 ----------
  console.log("\n========== M2 验证结果 ==========");
  if (allPass) {
    console.log("全部通过");
  } else {
    console.log("存在失败项");
    process.exitCode = 1;
  }
}

main()
  .catch((e: any) => {
    console.error("验证失败 TYPE:", e?.constructor?.name);
    console.error("验证失败 CODE:", e?.code);
    console.error("验证失败 MSG:", JSON.stringify(e?.message));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
