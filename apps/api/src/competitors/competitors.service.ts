import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  analyzeResponse,
  candidateTokens,
  createDiscoveryLexicon,
  discoverCandidates,
  findAliasOccurrences,
  judgeRecommendationSignal,
  RuleJudge,
  tokensAreSuffix,
  tokensKey,
  type DiscoveredCandidate,
} from "@geo/core";
import type { Prisma } from "@geo/database";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import { ReviewCandidateDto } from "./dto/review-candidate.dto";
import { CreateCompetitorSetDto } from "./dto/create-competitor-set.dto";

/**
 * M6B Competitor Discovery —— REAL Evidence → Candidate → 人工评审 →
 * 版本化 Competitor Set → local re-analysis（m6b-competitors-v1）→ SoV。
 *
 * 关键约束：
 *   - 只消费 REAL Evidence（sourceType ∈ official_api/browser/third_party_api/manual，
 *     provider ≠ mock）；mock/demo/estimated 一律排除 —— M6A Demo Benchmark Evidence
 *     （mock）绝不进入真实竞对输入。
 *   - Mentioned Brand ≠ Competitor：Discovery 只产 DISCOVERED/UNKNOWN 候选；
 *     DIRECT/ADJACENT/SUBSTITUTE 只能由人工 Approve 显式选择。
 *   - CandidateEvidence 只存溯源快照（不复制 Evidence）；Evidence 仍是唯一事实源且不可变。
 *   - CompetitorSet 一旦 ACTIVE 即冻结（Entry 为快照、无修改端点）；改配置 = 新建 v2。
 *   - re-analysis 为本地确定性词法（RuleJudge）复用，0 次 DeepSeek 请求；
 *     旧 m4-rule-v1 Analysis 永不删除，只新增/替换 m6b-competitors-v1 分析行。
 */

export const M6B_ANALYSIS_VERSION = "m6b-competitors-v1";
export const DISCOVERY_EXTRACTOR = "m6b-discovery-v1";

const REAL_SOURCE_TYPES = new Set(["official_api", "browser", "third_party_api", "manual"]);
const LEGACY_PLACEHOLDER = /^Competitor\s+[A-C]$/i;
const APPROVAL_TYPES = ["DIRECT", "ADJACENT", "SUBSTITUTE"] as const;
type ApprovalType = (typeof APPROVAL_TYPES)[number];
type JsonValue = Prisma.InputJsonValue;

interface EligibleEvidence {
  id: string; createdAt: Date; queryText: string; rawResponse: string;
  provider: string; sourceType: string; runId: string;
}

interface EvidenceHit {
  evidenceId: string; runId: string; queryText: string; createdAt: Date;
  mentionText: string; position: number; occurrenceCount: number; recommended: boolean;
}

interface PendingGroup {
  keyTokens: string[];
  variants: Map<string, number>;
  byEvidence: Map<string, EvidenceHit>;
}

@Injectable()
export class CompetitorsService {
  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  // ---------------------------------------------------------------
  // Discovery（candidates）
  // ---------------------------------------------------------------

  /** 项目自身品牌 + legacy 占位竞对 → 供提取器排除/命中。 */
  private async discoveryLexicons(projectId: string) {
    const [brand, competitorRows] = await Promise.all([
      this.db.client.brand.findFirst({ where: { projectId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      this.db.client.competitor.findMany({ where: { projectId } }),
    ]);
    const ownBrandAliases = brand ? [brand.name, ...brand.aliases] : [];
    // A/B/C = legacy placeholder：新 competitor analysis 不得再使用；历史行不动。
    const legacyNames = competitorRows
      .filter(row => LEGACY_PLACEHOLDER.test(row.name) || row.aliases.some(a => LEGACY_PLACEHOLDER.test(a)))
      .flatMap(row => [row.name, ...row.aliases]);
    return { ownBrandAliases, legacyNames };
  }

  async runDiscovery(userId: string, projectId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const { ownBrandAliases, legacyNames } = await this.discoveryLexicons(project.id);

    const rows = await this.db.client.evidence.findMany({
      where: { run: { status: "SUCCEEDED", monitorTask: { projectId: project.id } } },
      select: {
        id: true, createdAt: true, queryText: true, rawResponse: true,
        provider: true, sourceType: true,
        run: { select: { id: true, engine: { select: { provider: true } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    const eligible: EligibleEvidence[] = [];
    const excluded: Record<string, number> = {};
    for (const row of rows) {
      const realSource = REAL_SOURCE_TYPES.has(row.sourceType);
      const realProvider = row.provider !== "mock" && row.run.engine.provider !== "mock";
      if (realSource && realProvider) {
        eligible.push({
          id: row.id, createdAt: row.createdAt, queryText: row.queryText,
          rawResponse: row.rawResponse, provider: row.provider,
          sourceType: row.sourceType, runId: row.run.id,
        });
      } else {
        const key = row.sourceType === "mock" || row.provider === "mock" ? "mock/demo"
          : row.sourceType === "estimated" ? "estimated"
            : `${row.sourceType}:${row.provider}`;
        excluded[key] = (excluded[key] ?? 0) + 1;
      }
    }

    // 逐条 Evidence 处理，lexicon 跨 Evidence 归并候选身份
    const lexicon = createDiscoveryLexicon();
    const pending = new Map<string, PendingGroup>();
    const groupFor = (keyTokens: string[]) => {
      for (const group of pending.values()) {
        if (tokensAreSuffix(group.keyTokens, keyTokens) || tokensAreSuffix(keyTokens, group.keyTokens)) return group;
      }
      const group: PendingGroup = { keyTokens, variants: new Map(), byEvidence: new Map() };
      pending.set(tokensKey(keyTokens), group);
      return group;
    };

    for (const evidence of eligible) {
      const candidates = discoverCandidates(evidence.rawResponse, {
        ownBrandAliases,
        excludeNames: legacyNames,
      }, lexicon);
      if (candidates.length === 0) continue;

      // 供词法推荐归属：全部候选 + 自身品牌 offset
      const allOccurrences: Array<{ entityId: string; startOffset: number; endOffset: number }> = [];
      for (const candidate of candidates) {
        for (const occ of candidate.occurrences) {
          allOccurrences.push({ entityId: tokensKey(candidate.keyTokens), startOffset: occ.start, endOffset: occ.end });
        }
      }
      for (const brandHit of findAliasOccurrences(evidence.rawResponse, ownBrandAliases)) {
        allOccurrences.push({ entityId: "brand", startOffset: brandHit.start, endOffset: brandHit.end });
      }

      candidates.forEach((candidate, index) => {
        const group = groupFor(candidate.keyTokens);
        const occurrenceCount = candidate.occurrences.length;
        const first = candidate.occurrences[0];
        if (!first) return;
        const evidenceHit: EvidenceHit = {
          evidenceId: evidence.id, runId: evidence.runId, queryText: evidence.queryText,
          createdAt: evidence.createdAt, mentionText: candidate.canonicalName,
          position: index + 1, occurrenceCount,
          recommended: judgeRecommendationSignal(
            evidence.rawResponse,
            tokensKey(candidate.keyTokens),
            allOccurrences,
          ),
        };
        // 同一 (candidate,evidence) 可能重复（合并后的重叠 run）→ 合并计数
        const existing = group.byEvidence.get(evidence.id);
        if (existing) {
          existing.occurrenceCount += occurrenceCount;
          if (!existing.recommended) existing.recommended = evidenceHit.recommended;
          return;
        }
        group.byEvidence.set(evidence.id, evidenceHit);
        group.variants.set(candidate.canonicalName, (group.variants.get(candidate.canonicalName) ?? 0) + 1);
      });
    }

    // canonical/aliases 以 extractor 跨 Evidence 累积后的最终词表为准：逐条 Evidence
    // 处理期间归并状态会随计数翻转（如 ChatGPT ↔ chatgpt），不得作为最终命名依据。
    for (const group of pending.values()) {
      const finalGroup = [...lexicon.byKey.values()].find(g =>
        tokensAreSuffix(g.keyTokens, group.keyTokens) || tokensAreSuffix(group.keyTokens, g.keyTokens));
      if (finalGroup) group.variants = new Map(finalGroup.variantCounts);
    }

    const { created, updated, skippedRejected, deleted } = await this.persistDiscovery(project.id, pending);

    return {
      runAt: new Date().toISOString(),
      extractor: DISCOVERY_EXTRACTOR,
      scope: "real-evidence-only",
      note: "Mentioned Brand ≠ Competitor —— 结果仅为 Candidate（DISCOVERED/UNKNOWN），竞争类型需人工审核。",
      eligibility: {
        totalSucceededEvidence: rows.length,
        realEvidenceEligible: eligible.length,
        excludedEvidence: excluded,
      },
      outcome: { candidatesDiscovered: created.length, candidatesRefreshed: updated, candidatesSkippedRejected: skippedRejected, candidatesPruned: deleted },
      candidates: created.map(row => ({ id: row.id, canonicalName: row.canonicalName, status: row.status, competitorType: row.competitorType })),
    };
  }

  /** 把本次 run 的 pending 候选持久化（幂等 refresh：DISCOVERED/APPROVED 重建信号计数）。 */
  private async persistDiscovery(projectId: string, pending: Map<string, PendingGroup>) {
    const existingRows = await this.db.client.competitorCandidate.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const rejectedKeys = existingRows
      .filter(row => row.status === "REJECTED")
      .map(row => row.normalizedName.split(" "))
      .filter(Boolean);

    let skippedRejected = 0;
    const activeGroups: Array<{ group: PendingGroup; existingId: string | null }> = [];
    for (const group of pending.values()) {
      if (rejectedKeys.some(key => tokensAreSuffix(key, group.keyTokens))) { skippedRejected += 1; continue; }
      const matched = existingRows.find(row =>
        row.status !== "REJECTED" &&
        (tokensAreSuffix(row.normalizedName.split(" "), group.keyTokens) ||
          tokensAreSuffix(group.keyTokens, row.normalizedName.split(" "))));
      activeGroups.push({ group, existingId: matched?.id ?? null });
    }

    const refreshedRowIds = new Set<string>();
    const now = new Date();
    const upserts: Array<{
      keyTokens: string[]; canonicalName: string; aliases: string[];
      links: EvidenceHit[]; existingId: string | null; firstSeenAt: Date; lastSeenAt: Date;
    }> = [];

    for (const { group, existingId } of activeGroups) {
      const links = [...group.byEvidence.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      if (links.length === 0) continue;
      const existing = existingRows.find(row => row.id === existingId);
      const variants = [...group.variants.entries()];
      const sortedVariants = variants.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]));
      const discoveredCanonical = sortedVariants[0]?.[0] ?? links[0].mentionText;
      const discoveredAliases = sortedVariants.map(([text]) => text);
      const humanName = existing && (existing.status === "APPROVED" || (existing.metadata as Record<string, unknown>)?.manuallyEdited === true)
        ? existing.canonicalName : null;
      const humanAliases = existing && (existing.status === "APPROVED" || (existing.metadata as Record<string, unknown>)?.manuallyEdited === true)
        ? existing.aliases : [];
      upserts.push({
        keyTokens: group.keyTokens,
        canonicalName: humanName ?? discoveredCanonical,
        aliases: humanName ? [...new Set([...humanAliases, ...discoveredAliases])] : discoveredAliases,
        links,
        existingId: existing?.id ?? null,
        firstSeenAt: links[0].createdAt,
        lastSeenAt: links[links.length - 1].createdAt,
      });
      if (existingId) refreshedRowIds.add(existingId);
    }

    // DISCOVERED 且本次 0 命中 → 清理（保留人工编辑过或已批准的历史）
    const pruned: string[] = [];
    const prunedIds: string[] = [];
    for (const row of existingRows) {
      if (row.status === "DISCOVERED" && !refreshedRowIds.has(row.id) &&
        (row.metadata as Record<string, unknown>)?.manuallyEdited !== true) {
        prunedIds.push(row.id);
        pruned.push(row.id);
      }
    }
    if (prunedIds.length > 0) {
      await this.db.client.competitorCandidateEvidence.deleteMany({ where: { candidateId: { in: prunedIds } } });
      await this.db.client.competitorCandidate.deleteMany({ where: { id: { in: prunedIds } } });
    }

    const created: Array<{ id: string; canonicalName: string; status: string; competitorType: string }> = [];
    let updated = 0;
    for (const item of upserts) {
      const payload = {
        canonicalName: item.canonicalName,
        normalizedName: tokensKey(item.keyTokens),
        aliases: item.aliases,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        evidenceCount: item.links.length,
        queryCount: new Set(item.links.map(link => link.queryText)).size,
        mentionCount: item.links.reduce((sum, link) => sum + link.occurrenceCount, 0),
        recommendationCount: item.links.filter(link => link.recommended).length,
      };
      if (item.existingId) {
        await this.db.client.competitorCandidate.update({ where: { id: item.existingId }, data: payload });
        updated += 1;
        await this.db.client.competitorCandidateEvidence.deleteMany({ where: { candidateId: item.existingId } });
        if (item.links.length > 0) {
          await this.db.client.competitorCandidateEvidence.createMany({
            data: item.links.map(link => ({
              candidateId: item.existingId!,
              evidenceId: link.evidenceId,
              runId: link.runId,
              queryText: link.queryText,
              mentionText: link.mentionText,
              mentionPosition: link.position,
              occurrenceCount: link.occurrenceCount,
              recommended: link.recommended,
            })),
          });
        }
      } else {
        const row = await this.db.client.competitorCandidate.create({
          data: {
            id: randomUUID(),
            projectId,
            ...payload,
            status: "DISCOVERED",
            competitorType: "UNKNOWN",
            metadata: { discoveredBy: DISCOVERY_EXTRACTOR, discoveredAt: now.toISOString() } as JsonValue,
          },
        });
        created.push({ id: row.id, canonicalName: row.canonicalName, status: "DISCOVERED", competitorType: "UNKNOWN" });
        await this.db.client.competitorCandidateEvidence.createMany({
          data: item.links.map(link => ({
            candidateId: row.id,
            evidenceId: link.evidenceId,
            runId: link.runId,
            queryText: link.queryText,
            mentionText: link.mentionText,
            mentionPosition: link.position,
            occurrenceCount: link.occurrenceCount,
            recommended: link.recommended,
          })),
        });
      }
    }

    return {
      created: created.filter(item => item.status === "DISCOVERED"),
      updated,
      skippedRejected,
      deleted: pruned.length,
    };
  }

  // ---------------------------------------------------------------
  // Candidates 查询 / 人工评审
  // ---------------------------------------------------------------

  async listCandidates(userId: string, projectId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const rows = await this.db.client.competitorCandidate.findMany({
      where: { projectId: project.id },
      include: { evidenceLinks: { orderBy: { createdAt: "asc" }, take: 1 } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    });
    return rows.map(row => this.presentCandidate(row, row.evidenceLinks[0]));
  }

  async getCandidate(userId: string, id: string) {
    const row = await this.candidateForUser(userId, id);
    const links = await this.db.client.competitorCandidateEvidence.findMany({
      where: { candidateId: row.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const counts = this.aggregateLinkCounts(links);
    return { ...this.presentCandidate(row), evidenceLinks: links.map(link => ({
      id: link.id, evidenceId: link.evidenceId, runId: link.runId,
      queryText: link.queryText, mentionText: link.mentionText,
      mentionPosition: link.mentionPosition, occurrenceCount: link.occurrenceCount,
      recommended: link.recommended, createdAt: link.createdAt,
    })), counts };
  }

  async reviewCandidate(userId: string, id: string, dto: ReviewCandidateDto) {
    const row = await this.candidateForUser(userId, id);
    const data: Record<string, unknown> = {};
    const previousMetadata = (row.metadata as Record<string, unknown>) ?? {};

    if (dto.status === "APPROVED") {
      const type = dto.competitorType ?? (row.competitorType !== "UNKNOWN" && row.competitorType !== "NON_COMPETITOR" ? row.competitorType : null);
      if (!type || !APPROVAL_TYPES.includes(type as ApprovalType)) {
        throw new BadRequestException("Approve 时必须显式选择 DIRECT / ADJACENT / SUBSTITUTE（不得自动推断为 DIRECT）");
      }
      data.status = "APPROVED";
      data.competitorType = type;
    } else if (dto.status === "REJECTED") {
      data.status = "REJECTED";
      data.competitorType = "NON_COMPETITOR";
    } else if (dto.competitorType !== undefined) {
      // 已 APPROVED 候选可调整类型（DTO 已排除 UNKNOWN/NON_COMPETITOR 手动设置）
      if (dto.competitorType === "NON_COMPETITOR") throw new BadRequestException("NON_COMPETITOR 只能通过 Reject 设置");
      if (!APPROVAL_TYPES.includes(dto.competitorType as ApprovalType)) {
        throw new BadRequestException("competitorType 非法");
      }
      if (row.status !== "APPROVED") throw new BadRequestException("只有 APPROVED 候选可调整 competitorType");
      data.competitorType = dto.competitorType;
    }

    if (dto.canonicalName !== undefined && dto.canonicalName !== row.canonicalName) {
      const newTokens = candidateTokens(dto.canonicalName);
      if (newTokens.length === 0) throw new BadRequestException("canonicalName 不能为空");
      const clash = await this.db.client.competitorCandidate.findFirst({
        where: { projectId: row.projectId, normalizedName: tokensKey(newTokens), id: { not: row.id }, status: { not: "REJECTED" } },
      });
      if (clash) throw new BadRequestException(`候选「${dto.canonicalName}」与已存在候选冲突，请先 Reject 旧候选`);
      data.canonicalName = dto.canonicalName;
      data.normalizedName = tokensKey(newTokens);
    }
    if (dto.aliases !== undefined) {
      data.aliases = dto.aliases;
    }
    if (dto.canonicalName !== undefined || dto.aliases !== undefined || dto.status !== undefined || dto.competitorType !== undefined) {
      data.metadata = { ...previousMetadata, manuallyEdited: true, editedBy: "user", editedAt: new Date().toISOString() } as JsonValue;
    }
    if (Object.keys(data).length === 0) throw new BadRequestException("没有可更新的字段");

    const updated = await this.db.client.competitorCandidate.update({ where: { id: row.id }, data });
    return this.presentCandidate(updated);
  }

  // ---------------------------------------------------------------
  // Competitor Set（版本化冻结）
  // ---------------------------------------------------------------

  async listSets(userId: string, projectId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const sets = await this.db.client.competitorSet.findMany({
      where: { projectId: project.id },
      include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return sets.map(set => this.presentSet(set));
  }

  async getSet(userId: string, id: string) {
    const set = await this.setForUser(userId, id);
    return this.presentSet(set);
  }

  async createSet(userId: string, projectId: string, dto: CreateCompetitorSetDto) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const existing = await this.db.client.competitorSet.findUnique({
      where: { projectId_name_version: { projectId: project.id, name: dto.name, version: dto.version } },
    });
    if (existing) throw new BadRequestException(`Competitor Set「${dto.name} v${dto.version}」已存在；请递增 version 或改名。`);

    let sourceIds: Array<{ candidateId: string; sortOrder: number }>;
    if (dto.entries) {
      sourceIds = dto.entries.map((entry, index) => ({ candidateId: entry.candidateId, sortOrder: entry.sortOrder ?? index }));
    } else {
      const approved = await this.db.client.competitorCandidate.findMany({
        where: { projectId: project.id, status: "APPROVED" },
        orderBy: [{ canonicalName: "asc" }, { id: "asc" }],
      });
      sourceIds = approved.map((candidate, index) => ({ candidateId: candidate.id, sortOrder: index }));
    }
    const seen = new Set<string>();
    for (const entry of sourceIds) {
      if (seen.has(entry.candidateId)) throw new BadRequestException("entries 中存在重复 candidateId");
      seen.add(entry.candidateId);
    }
    const candidates = await this.db.client.competitorCandidate.findMany({
      where: { id: { in: sourceIds.map(entry => entry.candidateId) }, projectId: project.id },
    });
    if (candidates.length !== sourceIds.length) {
      throw new BadRequestException("存在不在该项目内的候选（跨租户候选不可入集）");
    }
    for (const entry of sourceIds) {
      const candidate = candidates.find(item => item.id === entry.candidateId)!;
      if (candidate.status !== "APPROVED") {
        throw new BadRequestException(`候选「${candidate.canonicalName}」尚未 Approve，不能进入 Competitor Set`);
      }
      if (candidate.competitorType === "UNKNOWN" || candidate.competitorType === "NON_COMPETITOR") {
        throw new BadRequestException(`候选「${candidate.canonicalName}」缺少有效竞争类型（需人工 Approve 时选择）`);
      }
    }
    if (sourceIds.length === 0) throw new BadRequestException("Competitor Set 至少需要一个已 APPROVED 候选");

    const created = await this.db.client.competitorSet.create({
      data: {
        projectId: project.id, name: dto.name, version: dto.version, status: "DRAFT",
        entries: {
          create: sourceIds.map(entry => {
            const candidate = candidates.find(item => item.id === entry.candidateId)!;
            return {
              candidateId: candidate.id,
              canonicalName: candidate.canonicalName,
              aliases: candidate.aliases,
              competitorType: candidate.competitorType as never,
              sortOrder: entry.sortOrder,
            };
          }),
        },
      },
      include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    return this.presentSet(created);
  }

  async activateSet(userId: string, id: string) {
    const set = await this.setForUser(userId, id);
    if (set.status === "ACTIVE") throw new BadRequestException(`Set「${set.name} v${set.version}」已 ACTIVE（激活即冻结，如需修改请创建新版本）`);
    if (set.status === "ARCHIVED") throw new BadRequestException("ARCHIVED 的 Set 不可重新激活");
    if (set.entries.length === 0) throw new BadRequestException("空 Set 不可激活");

    const activated = await this.db.client.$transaction(async tx => {
      // 同一 name 其他 ACTIVE 版本自动归档（历史语义冻结保留）
      await tx.competitorSet.updateMany({
        where: { projectId: set.projectId, name: set.name, status: "ACTIVE", id: { not: set.id } },
        data: { status: "ARCHIVED" },
      });
      return tx.competitorSet.update({
        where: { id: set.id },
        data: { status: "ACTIVE", activatedAt: new Date() },
        include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
    });
    return this.presentSet(activated);
  }

  // ---------------------------------------------------------------
  // Re-analysis（m6b-competitors-v1，本地词法，0 次 DeepSeek）
  // ---------------------------------------------------------------

  async reanalyze(userId: string, projectId: string, competitorSetId: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    const set = await this.db.client.competitorSet.findFirst({
      where: { id: competitorSetId, projectId: project.id },
      include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    if (!set) throw new NotFoundException("Competitor Set 不存在或无权访问");
    if (set.status !== "ACTIVE") throw new BadRequestException("Re-analysis 需要先 Activate 冻结 Competitor Set（激活后不可变）");

    const brand = await this.db.client.brand.findFirst({ where: { projectId: project.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const entities = [
      ...(brand ? [{ id: brand.id, canonicalName: brand.name, aliases: brand.aliases, entityType: "brand" as const }] : []),
      ...set.entries.map(entry => ({
        id: entry.candidateId, canonicalName: entry.canonicalName,
        aliases: entry.aliases, entityType: "competitor" as const,
      })),
    ];

    const evidenceRows = await this.db.client.evidence.findMany({
      where: { run: { status: "SUCCEEDED", monitorTask: { projectId: project.id } } },
      select: { id: true, rawResponse: true, provider: true, sourceType: true, run: { select: { engine: { select: { provider: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    const eligible = evidenceRows.filter(row =>
      REAL_SOURCE_TYPES.has(row.sourceType) && row.provider !== "mock" && row.run.engine.provider !== "mock");

    let reanalyzed = 0;
    let skippedExisting = 0;
    const judge = new RuleJudge(M6B_ANALYSIS_VERSION);
    for (const evidence of eligible) {
      const existing = await this.db.client.analysis.findUnique({
        where: { evidenceId_analysisVersion: { evidenceId: evidence.id, analysisVersion: M6B_ANALYSIS_VERSION } },
      });
      if (existing?.competitorSetId === set.id) { skippedExisting += 1; continue; }
      const result = analyzeResponse({ rawResponse: evidence.rawResponse, entities }, judge);
      await this.db.client.$transaction(async tx => {
        // Evidence immutable：只替换 m6b 分析行（旧 m4-rule-v1 永不删除）
        await tx.analysis.deleteMany({ where: { evidenceId: evidence.id, analysisVersion: M6B_ANALYSIS_VERSION } });
        await tx.analysis.create({
          data: {
            evidenceId: evidence.id, analysisVersion: M6B_ANALYSIS_VERSION,
            competitorSetId: set.id, competitorSetVersion: set.version,
            brandMentioned: result.brandMentioned, mentionPosition: result.mentionPosition,
            recommended: result.recommended, sentiment: result.sentiment,
            mentions: { create: result.mentions }, citations: { create: result.citations },
          },
        });
      });
      reanalyzed += 1;
    }

    return {
      analysisVersion: M6B_ANALYSIS_VERSION,
      competitorSet: { id: set.id, name: set.name, version: set.version, status: set.status },
      scope: "real-evidence-only",
      evidenceEligible: eligible.length,
      reanalyzed,
      skippedExisting,
      note: "本地确定性词法 re-analysis（RuleJudge 复用），0 次 DeepSeek 请求；Evidence 未修改，m4-rule-v1 Analysis 保留。",
    };
  }

  // ---------------------------------------------------------------
  // Share of Voice（显式绑定 Competitor Set version）
  // ---------------------------------------------------------------

  async getShareOfVoice(userId: string, projectId: string, competitorSetId?: string) {
    const project = await this.tenant.assertUserInProject(userId, projectId);
    let set;
    if (competitorSetId) {
      set = await this.db.client.competitorSet.findFirst({
        where: { id: competitorSetId, projectId: project.id },
        include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
      });
      if (!set) throw new NotFoundException("Competitor Set 不存在或无权访问");
    } else {
      set = await this.db.client.competitorSet.findFirst({
        where: { projectId: project.id, status: "ACTIVE" },
        include: { entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
        orderBy: [{ activatedAt: "desc" }, { createdAt: "desc" }],
      });
    }
    if (!set || set.status === "DRAFT") {
      return {
        status: "pending", reason: "no-active-competitor-set",
        note: "尚无 ACTIVE 的 Competitor Set —— SoV 需要先人工评审并激活版本化竞对集。",
      };
    }

    const analyses = await this.db.client.analysis.findMany({
      where: { competitorSetId: set.id, analysisVersion: M6B_ANALYSIS_VERSION },
      include: {
        mentions: { where: { entityType: "competitor" } },
        evidence: { select: { queryText: true, id: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    if (analyses.length === 0) {
      return {
        status: "pending", reason: "not-reanalyzed",
        competitorSet: { id: set.id, name: set.name, version: set.version, status: set.status, activatedAt: set.activatedAt },
        note: `Competitor Set v${set.version} 已激活但尚未运行 m6b-competitors-v1 re-analysis。`,
      };
    }

    const byCandidate = new Map<string, { candidateId: string; mentionCount: number; evidenceCount: number; queryCount: number; recommendationCount: number }>();
    const seenEvidence = new Set<string>();
    const seenQuery = new Set<string>();
    for (const analysis of analyses) {
      for (const mention of analysis.mentions) {
        const entry = byCandidate.get(mention.entityId) ?? {
          candidateId: mention.entityId, mentionCount: 0, evidenceCount: 0, queryCount: 0, recommendationCount: 0,
        };
        entry.mentionCount += 1;
        if (!seenEvidence.has(`${mention.entityId}:${analysis.evidenceId}`)) {
          seenEvidence.add(`${mention.entityId}:${analysis.evidenceId}`);
          entry.evidenceCount += 1;
        }
        if (!seenQuery.has(`${mention.entityId}:${analysis.evidence.queryText}`)) {
          seenQuery.add(`${mention.entityId}:${analysis.evidence.queryText}`);
          entry.queryCount += 1;
        }
        byCandidate.set(mention.entityId, entry);
      }
    }
    const mentionTotal = [...byCandidate.values()].reduce((sum, entry) => sum + entry.mentionCount, 0);
    const competitors = set.entries.map(entry => {
      const found = byCandidate.get(entry.candidateId);
      return {
        candidateId: entry.candidateId,
        canonicalName: entry.canonicalName,
        competitorType: entry.competitorType,
        mentionCount: found?.mentionCount ?? 0,
        evidenceCount: found?.evidenceCount ?? 0,
        queryCount: found?.queryCount ?? 0,
        shareOfVoice: mentionTotal ? (found?.mentionCount ?? 0) / mentionTotal : null,
      };
    });

    return {
      status: "ready",
      competitorSet: { id: set.id, name: set.name, version: set.version, status: set.status, activatedAt: set.activatedAt },
      analysisVersion: M6B_ANALYSIS_VERSION,
      scope: "real-evidence-only",
      pool: {
        eligibleEvidence: analyses.length,
        note: "Small evidence base / discovery signal only —— 不代表稳定行业结论",
      },
      competitors,
      note: `Competitor Set: ${set.name} v${set.version}；Analysis Version: ${M6B_ANALYSIS_VERSION}。未激活/未 re-analysis 前不出正式 SoV。`,
    };
  }

  // ---------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------

  private async candidateForUser(userId: string, id: string) {
    const row = await this.db.client.competitorCandidate.findUnique({
      where: { id },
      include: { project: { select: { organizationId: true } } },
    });
    if (!row) throw new NotFoundException("候选不存在或无权访问");
    await this.tenant.assertUserInOrganization(userId, row.project.organizationId);
    return row;
  }

  private async setForUser(userId: string, id: string) {
    const set = await this.db.client.competitorSet.findUnique({
      where: { id },
      include: { project: { select: { organizationId: true } }, entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] } },
    });
    if (!set) throw new NotFoundException("Competitor Set 不存在或无权访问");
    await this.tenant.assertUserInOrganization(userId, set.project.organizationId);
    return set;
  }

  private aggregateLinkCounts(links: Array<{ queryText: string; occurrenceCount: number; recommended: boolean }>) {
    return {
      evidenceCount: links.length,
      queryCount: new Set(links.map(link => link.queryText)).size,
      mentionCount: links.reduce((sum, link) => sum + link.occurrenceCount, 0),
      recommendationCount: links.filter(link => link.recommended).length,
    };
  }

  private presentCandidate(row: {
    id: string; canonicalName: string; normalizedName: string; aliases: string[];
    status: string; competitorType: string; firstSeenAt: Date; lastSeenAt: Date;
    evidenceCount: number; queryCount: number; mentionCount: number; recommendationCount: number;
    metadata: unknown; createdAt: Date; updatedAt: Date;
  }, exampleLink?: { queryText: string; mentionText: string; evidenceId: string; runId: string; recommended: boolean } | null) {
    return {
      id: row.id, canonicalName: row.canonicalName, normalizedName: row.normalizedName,
      aliases: row.aliases, status: row.status, competitorType: row.competitorType,
      firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt,
      evidenceCount: row.evidenceCount, queryCount: row.queryCount,
      mentionCount: row.mentionCount, recommendationCount: row.recommendationCount,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
      exampleEvidence: exampleLink ? {
        queryText: exampleLink.queryText, mentionText: exampleLink.mentionText,
        evidenceId: exampleLink.evidenceId, runId: exampleLink.runId,
        recommended: exampleLink.recommended,
      } : null,
    };
  }

  private presentSet(set: {
    id: string; name: string; version: string; status: string;
    createdAt: Date; updatedAt: Date; activatedAt: Date | null;
    entries: Array<{ id: string; candidateId: string; canonicalName: string; aliases: string[]; competitorType: string; sortOrder: number }>;
  }) {
    return {
      id: set.id, name: set.name, version: set.version, status: set.status,
      createdAt: set.createdAt, updatedAt: set.updatedAt, activatedAt: set.activatedAt,
      entryCount: set.entries.length,
      entries: set.entries.map(entry => ({
        id: entry.id, candidateId: entry.candidateId, canonicalName: entry.canonicalName,
        aliases: entry.aliases, competitorType: entry.competitorType, sortOrder: entry.sortOrder,
      })),
    };
  }
}

/** 辅助类型（避免 service 中 DTO 与模型混用） */
export type { DiscoveredCandidate };
