import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@geo/database";
import {
  buildQueries, detectTargetContamination, guardQueryType, normalizeQueryText,
  type BuilderInput, type QuerySemanticType,
} from "@geo/core";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";

type JsonValue = Prisma.InputJsonValue;

/**
 * M8E — Target Entity & Query Workspace API。
 *
 * 设计决定（Gate A）：
 *   1) 监测对象（Target Profile）= 项目 primary Brand（brands[0]，与 worker
 *      snapshotEntities / Evidence.entitySnapshot 同源）；TargetEntityAlias 提供
 *      alias 粒度 aliasType + enabled 管理。新 Run 的 alias 以 Run 创建时冻结的
 *      brand.aliases 快照为准（Evidence immutable → 改 alias 不影响历史证据）。
 *   2) Query Set = BenchmarkSuite（版本化/可执行）；BenchmarkQuery = Query Set Item。
 *      不新增第二套 QuerySet/QuerySetItem —— 历史 Run/Report 快照全部不动。
 *   3) Builder preview / import preview 一律无副作用；只有显式 save 才写 DB。
 *   4) 所有保存都过 Target Contamination Detector（geo-core 纯函数）：
 *      DISCOVERY 含目标 ⇒ 拒绝；CUSTOM 含目标 ⇒ 警告但仍可（不计入主指标）。
 */

export interface TargetProfileView {
  projectId: string;
  brandId: string | null;
  canonicalName: string;
  entityType: string;
  productCategory: string | null;
  website: string | null;
  description: string | null;
  /** 启用的 alias（= 冻结进新 Evidence 的匹配集） */
  aliases: Array<{ id: string | null; alias: string; aliasType: string; enabled: boolean }>;
  status: string;
}

/** 共享的 alias 视图组合器：alias 表（enabled/disabled）+ legacy Brand.aliases（视为启用）。 */
export function composeTargetAliases(
  brandAliases: string[],
  rows: Array<{ id: string; alias: string; aliasType: string; enabled: boolean }>,
): Array<{ id: string | null; alias: string; aliasType: string; enabled: boolean }> {
  const enabled = rows.filter(r => r.enabled).map(r => ({ id: r.id, alias: r.alias, aliasType: r.aliasType, enabled: true }));
  const disabled = rows.filter(r => !r.enabled).map(r => ({ id: r.id, alias: r.alias, aliasType: r.aliasType, enabled: false }));
  // legacy brand.aliases 中未在 alias 表出现的 → 视为启用（历史兼容）
  const legacyEnabled = brandAliases.filter(a => !rows.some(r => normalizeQueryText(r.alias) === normalizeQueryText(a)))
    .map(alias => ({ id: null, alias, aliasType: "CUSTOM" as const, enabled: true }));
  return [...enabled, ...legacyEnabled, ...disabled];
}

@Injectable()
export class QueryWorkspaceService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  // ---------------------------------------------------------------
  // Target Profile（primary Brand + alias 管理）
  // ---------------------------------------------------------------

  /** 项目 primary Brand（无则 null）—— worker snapshotEntities 同源取法。 */
  private async primaryBrand(userId: string, projectId: string) {
    await this.tenant.assertUserInProject(userId, projectId);
    const brands = await this.db.client.brand.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1,
    });
    return brands[0] ?? null;
  }

  private async aliasesFor(brandId: string) {
    return this.db.client.targetEntityAlias.findMany({
      where: { brandId },
      orderBy: [{ enabled: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  /** legacy Brand.aliases（历史记录，未进 alias 表的低配别名）并入 enabled 列表。 */
  private async presentTarget(userId: string, projectId: string): Promise<TargetProfileView | null> {
    const brand = await this.primaryBrand(userId, projectId);
    if (!brand) return null;
    const rows = await this.aliasesFor(brand.id);
    return {
      projectId,
      brandId: brand.id,
      canonicalName: brand.name,
      entityType: brand.entityType,
      productCategory: brand.productCategory,
      website: brand.website,
      description: brand.description,
      aliases: composeTargetAliases(brand.aliases ?? [], rows),
      status: brand.entityType ? "ACTIVE" : "UNKNOWN",
    };
  }

  /** 汇总监测目标启用的别名（alias 表 + legacy Brand.aliases），供竞品集合快照/序列化复用。 */
  private async aliasesForTarget(brand: { id: string; aliases: string[] }): Promise<string[]> {
    const rows = await this.aliasesFor(brand.id);
    return composeTargetAliases(brand.aliases ?? [], rows)
      .filter(a => a.enabled)
      .map(a => a.alias);
  }

  async getTarget(userId: string, projectId: string) {
    return this.presentTarget(userId, projectId);
  }

  /** 创建/更新 primary Brand（canonical/entityType/productCategory/website/description）。 */
  async upsertTarget(userId: string, projectId: string, dto: {
    canonicalName: string; entityType?: string; productCategory?: string | null;
    website?: string | null; description?: string | null;
  }) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const canonical = dto.canonicalName.trim();
    if (canonical.length < 1 || canonical.length > 120) throw new BadRequestException("canonicalName 必须为 1–120 字符");
    if (dto.entityType && !["BRAND", "PRODUCT", "SERVICE", "ORGANIZATION", "OTHER"].includes(dto.entityType)) {
      throw new BadRequestException("entityType 只允许 BRAND / PRODUCT / SERVICE / ORGANIZATION / OTHER");
    }
    let brand = await this.primaryBrand(userId, projectId);
    if (!brand) {
      brand = await this.db.client.brand.create({
        data: {
          projectId: project.id,
          name: canonical,
          entityType: dto.entityType ?? "BRAND",
          productCategory: dto.productCategory ?? null,
          website: dto.website ?? null,
          description: dto.description ?? null,
          products: [],
        },
      });
    } else {
      brand = await this.db.client.brand.update({
        where: { id: brand.id },
        data: {
          name: canonical,
          entityType: dto.entityType ?? brand.entityType,
          productCategory: dto.productCategory ?? brand.productCategory,
          website: dto.website ?? brand.website,
          description: dto.description ?? brand.description,
        },
      });
    }
    return this.presentTarget(userId, projectId);
  }

  async addAlias(userId: string, projectId: string, dto: { alias: string; aliasType?: string }) {
    const target = await this.getTarget(userId, projectId);
    if (!target || !target.brandId) {
      throw new BadRequestException("请先设置监测对象（canonicalName），再添加品牌别名。");
    }
    const alias = dto.alias.trim();
    if (alias.length < 1 || alias.length > 120) throw new BadRequestException("alias 必须为 1–120 字符");
    if (normalizeQueryText(alias) === normalizeQueryText(target.canonicalName)) {
      throw new BadRequestException("alias 不能与 canonicalName 相同（直接使用监测名称即可）。");
    }
    if (dto.aliasType && !["OFFICIAL", "PRODUCT", "ABBREVIATION", "LOCALIZED", "CUSTOM"].includes(dto.aliasType)) {
      throw new BadRequestException("aliasType 只允许 OFFICIAL / PRODUCT / ABBREVIATION / LOCALIZED / CUSTOM");
    }
    const existing = await this.db.client.targetEntityAlias.findFirst({
      where: { brandId: target.brandId, alias: normalizeQueryText(alias) },
    });
    if (existing) {
      if (!existing.enabled) {
        await this.db.client.targetEntityAlias.update({ where: { id: existing.id }, data: { enabled: true } });
      }
      return this.presentTarget(userId, projectId);
    }
    await this.db.client.targetEntityAlias.create({
      data: { brandId: target.brandId, alias, aliasType: dto.aliasType ?? "CUSTOM" },
    });
    return this.presentTarget(userId, projectId);
  }

  async updateAlias(userId: string, aliasId: string, dto: { aliasType?: string; enabled?: boolean; alias?: string }) {
    const row = await this.db.client.targetEntityAlias.findFirst({
      where: { id: aliasId, brand: { project: { organization: { members: { some: { userId } } } } } },
      include: { brand: { select: { projectId: true } } },
    });
    if (!row) throw new NotFoundException("品牌别名不存在或无权访问");
    const data: Prisma.TargetEntityAliasUpdateInput = {};
    if (dto.aliasType) data.aliasType = dto.aliasType;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.alias !== undefined) {
      const alias = dto.alias.trim();
      if (alias.length < 1 || alias.length > 120) throw new BadRequestException("alias 必须为 1–120 字符");
      data.alias = alias;
    }
    await this.db.client.targetEntityAlias.update({ where: { id: row.id }, data });
    return this.presentTarget(userId, row.brand.projectId);
  }

  async deleteAlias(userId: string, aliasId: string) {
    const row = await this.db.client.targetEntityAlias.findFirst({
      where: { id: aliasId, brand: { project: { organization: { members: { some: { userId } } } } } },
      include: { brand: { select: { projectId: true } } },
    });
    if (!row) throw new NotFoundException("品牌别名不存在或无权访问");
    await this.db.client.targetEntityAlias.delete({ where: { id: row.id } });
    return this.presentTarget(userId, row.brand.projectId);
  }

  // ---------------------------------------------------------------
  // Query Builder（无副作用 preview）+ 批量保存
  // ---------------------------------------------------------------

  /** Builder preview（无 DB 写）；支持任意 category/scenario/intent/audience/modifier。 */
  async builderPreview(userId: string, projectId: string, input: BuilderInput) {
    const target = await this.getTarget(userId, projectId);
    const identity = target ? { canonicalName: target.canonicalName, aliases: target.aliases.filter(a => a.enabled).map(a => a.alias) } : { canonicalName: "__NO_TARGET__" };
    const rows = buildQueries(input, identity);
    return {
      estimated: rows.length,
      targetContaminated: rows.filter(r => r.contamination.status === "TARGET_MENTIONED").length,
      rows: rows.map(r => ({
        text: r.text, category: r.category, intent: r.intent,
        queryType: r.queryType,
        targetCheck: r.contamination.status,
        matchedAlias: r.contamination.matchedAlias,
      })),
      note: "Builder 为确定性模板（无 LLM、0 调用）；预览无副作用，保存前请人工逐条确认。",
    };
  }

  /** Import preview：多行文本 → 逐条 contamination 检查；无副作用。 */
  async importPreview(userId: string, projectId: string, dto: { lines: string[] }) {
    const target = await this.getTarget(userId, projectId);
    const identity = target ? { canonicalName: target.canonicalName, aliases: target.aliases.filter(a => a.enabled).map(a => a.alias) } : { canonicalName: "__NO_TARGET__" };
    const seen = new Set<string>();
    const rows: Array<{ text: string; queryType: QuerySemanticType; targetCheck: string; matchedAlias: string | null }> = [];
    for (const raw of dto.lines) {
      const text = raw.replace(/\s+/gu, " ").trim();
      if (!text) continue;
      const key = normalizeQueryText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      const c = detectTargetContamination(text, identity);
      rows.push({ text, queryType: c.status === "TARGET_MENTIONED" ? "BRANDED_SANITY" : "DISCOVERY", targetCheck: c.status, matchedAlias: c.matchedAlias });
    }
    return {
      total: dto.lines.length, unique: rows.length,
      targetContaminated: rows.filter(r => r.targetCheck === "TARGET_MENTIONED").length,
      rows,
      note: "Import 预览无副作用；含目标的 query 默认建议 BRANDED_SANITY。",
    };
  }

  /**
   * 把一组 query（builder/import/manual 产出的 preview row）保存进现有 Query Set。
   * 幂等按 queryText 去重（同 suite 已有 text 跳过）。DISCOVERY 含目标 → 拒绝整批。
   */
  async saveQueries(userId: string, suiteId: string, dto: {
    rows: Array<{ text: string; category?: string; intent?: string; queryType: QuerySemanticType; locale?: string; enabled?: boolean }>;
  }) {
    const suite = await this.db.client.benchmarkSuite.findFirst({
      where: { id: suiteId, project: { organization: { members: { some: { userId } } } } },
      include: { queries: { orderBy: { sortOrder: "asc" } } },
    });
    if (!suite) throw new NotFoundException("Query Set 不存在或无权访问");
    const projectId = suite.projectId;
    const target = await this.getTarget(userId, projectId);
    const identity = target ? { canonicalName: target.canonicalName, aliases: target.aliases.filter(a => a.enabled).map(a => a.alias) } : { canonicalName: "__NO_TARGET__" };

    const existingTexts = new Set(suite.queries.map(q => normalizeQueryText(q.queryText)));
    let nextOrder = suite.queries.reduce((max, q) => Math.max(max, q.sortOrder), -1) + 1;
    const seenText = new Set<string>();
    const toCreate: Array<{ text: string; category: string; intent: string; queryType: QuerySemanticType; locale: string; enabled: boolean; order: number; source: string }> = [];

    for (const row of dto.rows) {
      const text = row.text.replace(/\s+/gu, " ").trim();
      if (!text) continue;
      if (text.length > 500) throw new BadRequestException(`Query 超过 500 字符：${text.slice(0, 60)}…`);
      if (existingTexts.has(normalizeQueryText(text))) continue; // 幂等跳过
      if (seenText.has(normalizeQueryText(text))) continue;
      seenText.add(normalizeQueryText(text));
      const g = guardQueryType(row.queryType, text, identity);
      if (!g.allowed) {
        throw new BadRequestException(`无法保存为 ${row.queryType}：「${text.slice(0, 60)}…」——${g.message}`);
      }
      toCreate.push({
        text, category: row.category || "custom", intent: row.intent || "自定义",
        queryType: row.queryType, locale: row.locale ?? "zh-CN",
        enabled: row.enabled ?? true, order: nextOrder++, source: "MANUAL",
      });
    }
    if (toCreate.length === 0) return { suiteId, added: 0, addedQueries: [] };

    const querySet = await this.db.client.querySet.upsert({
      where: { projectId_name: { projectId, name: `Benchmark Auto: ${suite.name} v${suite.version}` } },
      update: {},
      create: { projectId, name: `Benchmark Auto: ${suite.name} v${suite.version}`, description: "Benchmark 自动镜像查询" },
    });
    const created: Array<Record<string, unknown>> = [];
    await this.db.client.$transaction(async tx => {
      for (const row of toCreate) {
        const queryRow = await tx.query.create({
          data: {
            projectId, querySetId: querySet.id, text: row.text,
            type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: row.locale, region: "cn",
          },
        });
        const contamination = detectTargetContamination(row.text, identity);
        const createdQuery = await tx.benchmarkQuery.create({
          data: {
            suiteId: suite.id, projectQueryId: queryRow.id, queryText: row.text,
            category: row.category, intent: row.intent, locale: row.locale,
            enabled: row.enabled, sanity: row.queryType === "BRANDED_SANITY",
            sortOrder: row.order, queryType: row.queryType, source: row.source,
            contamination: { status: contamination.status, matchedAlias: contamination.matchedAlias } as JsonValue,
          },
        });
        created.push({ id: createdQuery.id, queryText: createdQuery.queryText, queryType: createdQuery.queryType, sortOrder: createdQuery.sortOrder });
      }
    });
    return { suiteId, added: created.length, addedQueries: created };
  }

  /** 复制 Query Set 为新版本（v1 → v2；旧版只读快照不变）。 */
  async cloneSuite(userId: string, suiteId: string, newVersion: string) {
    const suite = await this.db.client.benchmarkSuite.findFirst({
      where: { id: suiteId, project: { organization: { members: { some: { userId } } } } },
      include: { queries: { orderBy: { sortOrder: "asc" } } },
    });
    if (!suite) throw new NotFoundException("Query Set 不存在或无权访问");
    const existing = await this.db.client.benchmarkSuite.findUnique({
      where: { projectId_name_version: { projectId: suite.projectId, name: suite.name, version: newVersion } },
    });
    if (existing) throw new BadRequestException(`「${suite.name} v${newVersion}」已存在；请换新版本号。`);
    const target = await this.getTarget(userId, suite.projectId);
    const identity = target ? { canonicalName: target.canonicalName, aliases: target.aliases.filter(a => a.enabled).map(a => a.alias) } : { canonicalName: "__NO_TARGET__" };

    const cloned = await this.db.client.$transaction(async tx => {
      const querySet = await tx.querySet.upsert({
        where: { projectId_name: { projectId: suite.projectId, name: `Benchmark Auto: ${suite.name} v${newVersion}` } },
        update: {},
        create: { projectId: suite.projectId, name: `Benchmark Auto: ${suite.name} v${newVersion}`, description: "Benchmark 自动镜像查询" },
      });
      // R2：归档（软删除）query 不进入克隆副本——克隆即重建工作副本，只带活跃 query
      const cloneable = suite.queries.filter(q => !q.archived);
      return tx.benchmarkSuite.create({
        data: {
          projectId: suite.projectId, name: suite.name, version: newVersion,
          description: suite.description ? `${suite.description}（${suite.version} → ${newVersion} 复制）` : `${suite.version} → ${newVersion} 复制`,
          queries: { create: cloneable.map(q => ({
            queryText: q.queryText, category: q.category, intent: q.intent,
            locale: q.locale, weight: q.weight, enabled: q.enabled, sanity: q.sanity,
            sortOrder: q.sortOrder,
            queryType: q.queryType ?? (q.sanity ? "BRANDED_SANITY" : null),
            source: q.source ?? "MANUAL",
            contamination: detectTargetContamination(q.queryText, identity) as unknown as JsonValue,
            projectQuery: { create: {
              projectId: suite.projectId, querySetId: querySet.id, text: q.queryText,
              type: "CUSTOM", source: "IMPORTED", status: "PAUSED", language: q.locale, region: "cn",
            } },
          })) },
        },
        include: { queries: { orderBy: { sortOrder: "asc" } } },
      });
    });
    return { clonedId: cloned.id, name: cloned.name, version: cloned.version, queryCount: cloned.queries.length };
  }

  // ---------------------------------------------------------------
  // R2 · Query 运营（服务端分页 / 搜索 / 筛选 / 排序 + 批量启停移 + Cost Preflight 占位）
  // ---------------------------------------------------------------

  /**
   * 服务端分页查询当前项目 Query 集。默认隐藏已归档（软删除）行；
   * archived=true 时仅返回已归档行（用于「回收站」视图）。全部条件服务端重新校验租户。
   */
  async listQueries(userId: string, projectId: string, filters: {
    q?: string; status?: "enabled" | "disabled"; type?: "DISCOVERY" | "BRANDED_SANITY" | "CUSTOM";
    contamination?: "CLEAN" | "TARGET_MENTIONED" | "POSSIBLE_TARGET_MENTION";
    suiteId?: string; archived?: boolean;
    sort?: "createdAt" | "queryText" | "queryType" | "status"; order?: "asc" | "desc";
    page?: number; pageSize?: number;
  }) {
    await this.tenant.assertUserInProject(userId, projectId);
    if (filters.suiteId) {
      const suite = await this.db.client.benchmarkSuite.findFirst({ where: { id: filters.suiteId, projectId } });
      if (!suite) throw new NotFoundException("Query Set 不存在或不属于该项目");
    }

    const where: Prisma.BenchmarkQueryWhereInput = {
      suite: { projectId },
      ...(filters.suiteId ? { suiteId: filters.suiteId } : {}),
      ...(filters.archived === true
        ? { archived: true } // 回收站视图：只返回已归档（软删除）行
        : { archived: false }),
      ...(filters.q?.trim() ? { queryText: { contains: filters.q.trim(), mode: "insensitive" } } : {}),
    };
    if (filters.status === "enabled") where.enabled = true;
    else if (filters.status === "disabled") where.enabled = false;
    if (filters.type) where.queryType = filters.type;
    if (filters.contamination) where.contamination = { path: ["status"], equals: filters.contamination };

    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 20));
    const order: "asc" | "desc" = filters.order === "desc" ? "desc" : "asc";
    const orderBy: Prisma.BenchmarkQueryOrderByWithRelationInput[] =
      filters.sort === "queryText" ? [{ queryText: order }, { createdAt: "desc" }, { id: "asc" }]
        : filters.sort === "queryType" ? [{ queryType: order }, { createdAt: "desc" }, { id: "asc" }]
          : filters.sort === "status" ? [{ enabled: order }, { createdAt: "desc" }, { id: "asc" }]
            : [{ createdAt: order }, { id: "asc" }];

    const [total, rows] = await Promise.all([
      this.db.client.benchmarkQuery.count({ where }),
      this.db.client.benchmarkQuery.findMany({
        where, orderBy,
        skip: (page - 1) * pageSize, take: pageSize,
        include: { suite: { select: { id: true, name: true, version: true, projectId: true } } },
      }),
    ]);

    return {
      page, pageSize, total,
      items: rows.map(q => ({
        id: q.id,
        suiteId: q.suiteId,
        suiteName: q.suite.name,
        suiteVersion: q.suite.version,
        queryText: q.queryText,
        category: q.category,
        intent: q.intent,
        locale: q.locale,
        enabled: q.enabled,
        archived: q.archived,
        sanity: q.sanity,
        queryType: q.queryType ?? (q.sanity ? "BRANDED_SANITY" : null),
        source: q.source ?? "MANUAL",
        contamination: q.contamination,
        sortOrder: q.sortOrder,
        createdAt: q.createdAt,
        updatedAt: q.updatedAt,
      })),
    };
  }

  /**
   * 批量操作：enable / disable / archive（软删）/ move（移动至同项目另一 Query Set）。
   * - 跨 Project 的 query 一律视为无权访问（404），不泄露存在性。
   * - archive 只置 archived=true，不影响历史 Run/Report/Evidence 快照（immutability）。
   * - 兼容历史调用：body 含 rows 时退化为 saveQueries 语义（批量新增到 targetSuiteId）。
   */
  async batchQueries(userId: string, projectId: string, dto: {
    operation?: "enable" | "disable" | "archive" | "move";
    queryIds?: string[]; targetSuiteId?: string;
    rows?: Array<{ text: string; category?: string; intent?: string; queryType: QuerySemanticType; locale?: string; enabled?: boolean }>;
  }) {
    await this.tenant.assertUserInProject(userId, projectId);

    // 历史调用形态：rows → 批量新增（退化到 saveQueries）
    if (dto.rows && dto.rows.length > 0) {
      if (!dto.targetSuiteId) throw new BadRequestException("rows 批量新增必须指定 targetSuiteId");
      const suite = await this.db.client.benchmarkSuite.findFirst({ where: { id: dto.targetSuiteId, projectId } });
      if (!suite) throw new NotFoundException("Query Set 不存在或不属于该项目");
      const added = await this.saveQueries(userId, suite.id, { rows: dto.rows });
      return { operation: "save", suiteId: suite.id, added: added.added, addedQueries: added.addedQueries };
    }

    const operation = dto.operation;
    const queryIds = dto.queryIds ?? [];
    if (!operation || !["enable", "disable", "archive", "move"].includes(operation)) {
      throw new BadRequestException("operation 必填：enable / disable / archive / move");
    }
    if (operation === "move" && !dto.targetSuiteId) {
      throw new BadRequestException("move 操作必须指定 targetSuiteId");
    }
    if (queryIds.length === 0) throw new BadRequestException("queryIds 不能为空");

    const queries = await this.db.client.benchmarkQuery.findMany({
      where: { id: { in: queryIds }, suite: { projectId } },
      select: { id: true, suiteId: true, sortOrder: true, enabled: true, archived: true },
    });
    const found = new Set(queries.map(q => q.id));
    const missing = queryIds.filter(id => !found.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`部分 query 不存在或无权访问（${missing.length} 个）；跨项目一律按 404 处理`);
    }

    await this.db.client.$transaction(async tx => {
      switch (operation) {
        case "enable":
          await tx.benchmarkQuery.updateMany({ where: { id: { in: queryIds }, suite: { projectId } }, data: { enabled: true } });
          break;
        case "disable":
          await tx.benchmarkQuery.updateMany({ where: { id: { in: queryIds }, suite: { projectId } }, data: { enabled: false } });
          break;
        case "archive":
          // 软删除：只影响未来执行；历史 Run/Report/Evidence 快照 immutability 不变
          await tx.benchmarkQuery.updateMany({ where: { id: { in: queryIds }, suite: { projectId } }, data: { archived: true } });
          break;
        case "move": {
          const target = await tx.benchmarkSuite.findFirst({ where: { id: dto.targetSuiteId, projectId } });
          if (!target) throw new NotFoundException("目标 Query Set 不存在或不属于该项目");
          const max = await tx.benchmarkQuery.aggregate({ where: { suiteId: target.id }, _max: { sortOrder: true } });
          let next = (max._max.sortOrder ?? -1) + 1;
          // 逐条搬家，避免 [suiteId, sortOrder] 唯一冲突；保留同一 queryType/enabled 语义
          for (const q of queries) {
            await tx.benchmarkQuery.update({ where: { id: q.id }, data: { suiteId: target.id, sortOrder: next++ } });
          }
          break;
        }
      }
    });

    return {
      operation,
      affected: queries.length,
      queryIds: queries.map(q => q.id),
      ...(operation === "move" ? {
        fromSuites: [...new Set(queries.map(q => q.suiteId))],
        toSuiteId: dto.targetSuiteId,
      } : {}),
      ...(operation === "archive" ? { note: "已软删除（归档）：仅影响未来执行，历史快照不变" } : {}),
    };
  }

  /**
   * R2 · Cost Preflight（纯占位）。不调真实 Provider、不读价格表：
   * 只回显 启用 query × 启用 engine 的估算调用次数；pricing/currency 恒为 null，
   * 前端显示「暂不可估算」，严禁硬编码价格。
   */
  async costPreflight(userId: string, projectId: string, dto: { queryIds?: string[]; engineIds?: string[] }) {
    await this.tenant.assertUserInProject(userId, projectId);
    const queryIds = dto.queryIds ?? [];
    const engineIds = dto.engineIds ?? [];
    const queryBase: Prisma.BenchmarkQueryWhereInput = { suite: { projectId }, enabled: true, archived: false };
    const [queryCount, engineCount] = await Promise.all([
      queryIds.length > 0
        ? this.db.client.benchmarkQuery.count({ where: { ...queryBase, id: { in: queryIds } } })
        : this.db.client.benchmarkQuery.count({ where: queryBase }),
      engineIds.length > 0
        ? this.db.client.engine.count({ where: { id: { in: engineIds }, enabled: true } })
        : this.db.client.engine.count({ where: { enabled: true } }),
    ]);
    return {
      queryIds: queryIds.length > 0 ? queryIds : undefined,
      engineIds: engineIds.length > 0 ? engineIds : undefined,
      queryCount,
      engineCount,
      estimatedCalls: queryCount * engineCount,
      pricing: null,
      currency: null,
      note: "暂不可估算（未接入价格表）",
      demo: true,
    };
  }
}
