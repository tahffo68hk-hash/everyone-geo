import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { TenantService } from "../common/tenant.service";
import {
  GenerateOutcomeComparisonsDto,
  ObservedOutcomeSummary,
  OutcomeDeltaSnapshot,
} from "./dto/outcome-comparison.dto";

export const DEFAULT_OUTCOME_VERSION = "m10c-outcome-v1";

@Injectable()
export class OutcomeComparisonService {
  private readonly logger = new Logger(OutcomeComparisonService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  /**
   * 从 Evidence 及其 Analysis/Mention/Citation 提取标准观察快照
   */
  private extractEvidenceSnapshot(evidence: any) {
    if (!evidence) return null;
    const analysis = evidence.analyses && evidence.analyses.length > 0 ? evidence.analyses[0] : null;

    const brandMentioned = analysis ? Boolean(analysis.brandMentioned) : false;
    const mentionPosition = analysis && typeof analysis.mentionPosition === "number" ? analysis.mentionPosition : null;
    const recommended = analysis ? Boolean(analysis.recommended) : false;
    const sentiment = analysis && analysis.sentiment ? String(analysis.sentiment) : "neutral";

    const citations = analysis && Array.isArray(analysis.citations) ? analysis.citations : [];
    const citationPresent = citations.length > 0;
    const citationCount = citations.length;
    const citationUrls = citations.map((c: any) => c.url);
    const citationDomains = [...new Set(citations.map((c: any) => c.domain))];

    const mentions = analysis && Array.isArray(analysis.mentions) ? analysis.mentions : [];
    const competitorMentions = mentions.filter((m: any) => m.entityType === "competitor");
    const competitorsMentioned = [
      ...new Set(competitorMentions.map((m: any) => m.canonicalName || m.displayName)),
    ].sort();

    return {
      evidenceId: evidence.id,
      queryText: evidence.queryText,
      provider: evidence.provider,
      engineKey: evidence.engineKey,
      engineName: evidence.engineName,
      model: evidence.model,
      requestedModel: evidence.requestedModel,
      responseModel: evidence.responseModel,
      retrievalMode: evidence.retrievalMode,
      sourceType: evidence.sourceType,
      capturedAt: evidence.createdAt ? new Date(evidence.createdAt).toISOString() : new Date().toISOString(),
      analysisVersion: analysis?.analysisVersion ?? null,
      brandMentioned,
      mentionPosition,
      recommended,
      sentiment,
      citationPresent,
      citationCount,
      citationUrls,
      citationDomains,
      competitorsMentioned,
    };
  }

  /**
   * 计算 Before vs After 的确定性变化快照 (Delta)
   */
  private computeDelta(before: any, after: any): OutcomeDeltaSnapshot {
    // 1. Brand Mention
    const bMention = Boolean(before.brandMentioned);
    const aMention = Boolean(after.brandMentioned);
    let mentionChange: "ABSENT_TO_PRESENT" | "PRESENT_TO_ABSENT" | "REMAINED_PRESENT" | "REMAINED_ABSENT";
    if (!bMention && aMention) mentionChange = "ABSENT_TO_PRESENT";
    else if (bMention && !aMention) mentionChange = "PRESENT_TO_ABSENT";
    else if (bMention && aMention) mentionChange = "REMAINED_PRESENT";
    else mentionChange = "REMAINED_ABSENT";

    // 2. Citation
    const bCitPresent = Boolean(before.citationPresent);
    const aCitPresent = Boolean(after.citationPresent);
    const bCitCount = typeof before.citationCount === "number" ? before.citationCount : 0;
    const aCitCount = typeof after.citationCount === "number" ? after.citationCount : 0;
    const countDelta = aCitCount - bCitCount;
    let citChange: "ABSENT_TO_PRESENT" | "PRESENT_TO_ABSENT" | "REMAINED_PRESENT" | "REMAINED_ABSENT";
    if (!bCitPresent && aCitPresent) citChange = "ABSENT_TO_PRESENT";
    else if (bCitPresent && !aCitPresent) citChange = "PRESENT_TO_ABSENT";
    else if (bCitPresent && aCitPresent) citChange = "REMAINED_PRESENT";
    else citChange = "REMAINED_ABSENT";

    // 3. Position (1 is better than 3)
    const bPos = typeof before.mentionPosition === "number" ? before.mentionPosition : null;
    const aPos = typeof after.mentionPosition === "number" ? after.mentionPosition : null;
    const positionDelta = bPos !== null && aPos !== null ? aPos - bPos : null;
    let direction: "IMPROVED" | "DECLINED" | "UNCHANGED" | "UNKNOWN";
    if (bPos === null && aPos === null) {
      direction = "UNKNOWN";
    } else if (bPos === null && aPos !== null) {
      direction = "IMPROVED";
    } else if (bPos !== null && aPos === null) {
      direction = "DECLINED";
    } else if (aPos! < bPos!) {
      direction = "IMPROVED";
    } else if (aPos! > bPos!) {
      direction = "DECLINED";
    } else {
      direction = "UNCHANGED";
    }

    // 4. Recommendation
    const bRec = Boolean(before.recommended);
    const aRec = Boolean(after.recommended);
    let recChange: "NOT_RECOMMENDED_TO_RECOMMENDED" | "RECOMMENDED_TO_NOT_RECOMMENDED" | "REMAINED_RECOMMENDED" | "REMAINED_NOT_RECOMMENDED";
    if (!bRec && aRec) recChange = "NOT_RECOMMENDED_TO_RECOMMENDED";
    else if (bRec && !aRec) recChange = "RECOMMENDED_TO_NOT_RECOMMENDED";
    else if (bRec && aRec) recChange = "REMAINED_RECOMMENDED";
    else recChange = "REMAINED_NOT_RECOMMENDED";

    // 5. Sentiment
    const bSent = String(before.sentiment || "neutral");
    const aSent = String(after.sentiment || "neutral");

    // 6. Competitor Presence
    const bComps = new Set<string>(before.competitorsMentioned || []);
    const aComps = new Set<string>(after.competitorsMentioned || []);
    const added = Array.from(aComps).filter((c) => !bComps.has(c)).sort();
    const removed = Array.from(bComps).filter((c) => !aComps.has(c)).sort();
    const persisted = Array.from(bComps).filter((c) => aComps.has(c)).sort();

    return {
      brandMention: {
        before: bMention,
        after: aMention,
        change: mentionChange,
        changed: bMention !== aMention,
      },
      citation: {
        beforePresent: bCitPresent,
        afterPresent: aCitPresent,
        beforeCount: bCitCount,
        afterCount: aCitCount,
        countDelta,
        change: citChange,
        changed: bCitPresent !== aCitPresent || countDelta !== 0,
      },
      position: {
        before: bPos,
        after: aPos,
        positionDelta,
        direction,
        changed: bPos !== aPos,
      },
      recommendation: {
        before: bRec,
        after: aRec,
        change: recChange,
        changed: bRec !== aRec,
      },
      sentiment: {
        before: bSent,
        after: aSent,
        changed: bSent !== aSent,
      },
      competitorPresence: {
        before: Array.from(bComps).sort(),
        after: Array.from(aComps).sort(),
        added,
        removed,
        persisted,
        changed: added.length > 0 || removed.length > 0,
      },
    };
  }

  /**
   * 生成确定性文字摘要（绝不调用外部 LLM）
   */
  private generateDeterministicSummary(delta: OutcomeDeltaSnapshot, warning?: string | null): string {
    const parts: string[] = [];

    const mBefore = delta.brandMention.before ? "出现" : "未出现";
    const mAfter = delta.brandMention.after ? "出现" : "未出现";
    parts.push(`品牌提及: ${mBefore} → ${mAfter}`);

    parts.push(`引用: ${delta.citation.beforeCount} → ${delta.citation.afterCount}`);

    if (delta.position.before !== null || delta.position.after !== null) {
      const pBefore = delta.position.before !== null ? `#${delta.position.before}` : "无排名";
      const pAfter = delta.position.after !== null ? `#${delta.position.after}` : "无排名";
      parts.push(`位置: ${pBefore} → ${pAfter} (${delta.position.direction})`);
    }

    const rBefore = delta.recommendation.before ? "推荐" : "未推荐";
    const rAfter = delta.recommendation.after ? "推荐" : "未推荐";
    parts.push(`推荐: ${rBefore} → ${rAfter}`);

    if (delta.sentiment.changed) {
      parts.push(`情感: ${delta.sentiment.before} → ${delta.sentiment.after}`);
    }

    const compParts: string[] = [];
    if (delta.competitorPresence.added.length > 0) {
      compParts.push(`新增竞对: ${delta.competitorPresence.added.join(",")}`);
    }
    if (delta.competitorPresence.removed.length > 0) {
      compParts.push(`退出竞对: ${delta.competitorPresence.removed.join(",")}`);
    }
    if (compParts.length > 0) {
      parts.push(compParts.join("; "));
    }

    if (warning) {
      parts.push(`[提示: ${warning}]`);
    }

    return parts.join("; ");
  }

  /**
   * 计算 Run 级别的聚合汇总（Observed Outcome Summary，无因果推断）
   */
  public computeRunAggregateSummary(outcomes: any[]): ObservedOutcomeSummary {
    const summary: ObservedOutcomeSummary = {
      totalItems: outcomes.length,
      comparableItems: 0,
      warningItems: 0,
      incompatibleItems: 0,
      missingBaselineItems: 0,
      missingRetestItems: 0,

      mentionAbsentToPresent: 0,
      mentionPresentToAbsent: 0,
      mentionRemainedPresent: 0,
      mentionRemainedAbsent: 0,

      citationAbsentToPresent: 0,
      citationPresentToAbsent: 0,
      citationCountDeltaTotal: 0,

      recommendationPositiveChanges: 0,
      recommendationNegativeChanges: 0,

      positionImproved: 0,
      positionDeclined: 0,
      positionUnchanged: 0,

      competitorsObservedChangeCount: 0,
    };

    for (const o of outcomes) {
      if (o.comparisonStatus === "COMPARABLE") {
        summary.comparableItems++;
      } else if (o.comparisonStatus === "COMPARABLE_WITH_WARNING") {
        summary.comparableItems++;
        summary.warningItems++;
      } else if (o.comparisonStatus === "INCOMPATIBLE") {
        summary.incompatibleItems++;
      } else if (o.comparisonStatus === "MISSING_BASELINE") {
        summary.missingBaselineItems++;
      } else if (o.comparisonStatus === "MISSING_RETEST_EVIDENCE") {
        summary.missingRetestItems++;
      }

      if (o.comparisonStatus === "COMPARABLE" || o.comparisonStatus === "COMPARABLE_WITH_WARNING") {
        const delta = o.deltaSnapshot as OutcomeDeltaSnapshot;
        if (delta?.brandMention) {
          if (delta.brandMention.change === "ABSENT_TO_PRESENT") summary.mentionAbsentToPresent++;
          else if (delta.brandMention.change === "PRESENT_TO_ABSENT") summary.mentionPresentToAbsent++;
          else if (delta.brandMention.change === "REMAINED_PRESENT") summary.mentionRemainedPresent++;
          else if (delta.brandMention.change === "REMAINED_ABSENT") summary.mentionRemainedAbsent++;
        }

        if (delta?.citation) {
          if (delta.citation.change === "ABSENT_TO_PRESENT") summary.citationAbsentToPresent++;
          else if (delta.citation.change === "PRESENT_TO_ABSENT") summary.citationPresentToAbsent++;
          summary.citationCountDeltaTotal += delta.citation.countDelta || 0;
        }

        if (delta?.recommendation) {
          if (delta.recommendation.change === "NOT_RECOMMENDED_TO_RECOMMENDED") summary.recommendationPositiveChanges++;
          else if (delta.recommendation.change === "RECOMMENDED_TO_NOT_RECOMMENDED") summary.recommendationNegativeChanges++;
        }

        if (delta?.position) {
          if (delta.position.direction === "IMPROVED") summary.positionImproved++;
          else if (delta.position.direction === "DECLINED") summary.positionDeclined++;
          else if (delta.position.direction === "UNCHANGED") summary.positionUnchanged++;
        }

        if (delta?.competitorPresence?.changed) {
          summary.competitorsObservedChangeCount++;
        }
      }
    }

    return summary;
  }

  /**
   * 为 RetestRun 生成或获取所有 RetestItem 的 Outcome Comparison (幂等)
   */
  async generateRetestOutcomes(
    userId: string,
    retestRunId: string,
    dto?: GenerateOutcomeComparisonsDto,
  ) {
    const retestRun = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      include: {
        publishedAsset: true,
        items: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!retestRun) {
      throw new NotFoundException("重测任务不存在");
    }

    // 严格 Service-level 权限校验（发生于任何计算/写库之前）
    await this.tenant.assertUserInProject(userId, retestRun.projectId);

    const version = dto?.comparisonVersion?.trim() || DEFAULT_OUTCOME_VERSION;
    const evidenceIdsToFetch = new Set<string>();

    for (const item of retestRun.items) {
      if (item.evidenceId) evidenceIdsToFetch.add(item.evidenceId);
      if (item.baselineEvidenceId) evidenceIdsToFetch.add(item.baselineEvidenceId);
    }

    const evidences = await this.db.client.evidence.findMany({
      where: { id: { in: Array.from(evidenceIdsToFetch) } },
      include: {
        analyses: {
          include: {
            mentions: true,
            citations: true,
          },
        },
      },
    });

    const evidenceMap = new Map<string, any>();
    for (const ev of evidences) {
      evidenceMap.set(ev.id, ev);
    }

    const createdOutcomes = [];

    for (const item of retestRun.items) {
      // 检查是否已有对应版本记录
      const existing = await this.db.client.outcomeComparison.findUnique({
        where: {
          retestItemId_comparisonVersion: {
            retestItemId: item.id,
            comparisonVersion: version,
          },
        },
      });

      // 如果已有且重测证据未变化（非初次 PENDING 后的后置完成更新），直接复用
      if (existing && existing.comparisonStatus !== "MISSING_RETEST_EVIDENCE") {
        createdOutcomes.push(existing);
        continue;
      }

      // 重测执行是否具备 Evidence
      if (!item.evidenceId || item.status !== "SUCCEEDED") {
        const row = await this.db.client.outcomeComparison.upsert({
          where: {
            retestItemId_comparisonVersion: {
              retestItemId: item.id,
              comparisonVersion: version,
            },
          },
          update: {},
          create: {
            organizationId: retestRun.organizationId,
            projectId: retestRun.projectId,
            publishedAssetId: retestRun.publishedAssetId,
            retestRunId: retestRun.id,
            retestItemId: item.id,
            queryId: item.queryId,
            queryText: item.queryText,
            baselineEvidenceId: item.baselineEvidenceId ?? null,
            retestEvidenceId: null,
            baselineCompatibility: item.baselineStatus || "MISSING_BASELINE",
            comparisonStatus: "MISSING_RETEST_EVIDENCE",
            comparisonVersion: version,
            beforeSnapshot: {},
            afterSnapshot: {},
            deltaSnapshot: {},
            summary: "重测证据尚未生成或执行未成功，无法进行对比",
            metadata: {},
            createdById: userId,
          },
        });
        createdOutcomes.push(row);
        continue;
      }

      const retestEvidence = evidenceMap.get(item.evidenceId);
      const baselineEvidence = item.baselineEvidenceId ? evidenceMap.get(item.baselineEvidenceId) : null;
      const afterSnapshot = this.extractEvidenceSnapshot(retestEvidence) || {};

      let baselineCompatibility = item.baselineStatus || "MISSING_BASELINE";
      let comparisonStatus: string;
      let beforeSnapshot: any = {};
      let deltaSnapshot: any = {};
      let summary: string;

      if (!baselineEvidence || item.baselineStatus === "MISSING_BASELINE") {
        baselineCompatibility = "MISSING_BASELINE";
        comparisonStatus = "MISSING_BASELINE";
        beforeSnapshot = {};
        deltaSnapshot = {};
        summary = "缺少基线证据，仅记录重测现状，不计算对比变化";
      } else if (item.baselineStatus === "INCOMPATIBLE") {
        baselineCompatibility = "INCOMPATIBLE";
        comparisonStatus = "INCOMPATIBLE";
        beforeSnapshot = this.extractEvidenceSnapshot(baselineEvidence) || {};
        deltaSnapshot = {};
        summary = `基线与重测环境不兼容（${item.baselineWarning || "配置不匹配"}），已终止对比计算以防产生误导性结果`;
      } else if (item.baselineStatus === "COMPARABLE_WITH_WARNING") {
        baselineCompatibility = "COMPARABLE_WITH_WARNING";
        comparisonStatus = "COMPARABLE_WITH_WARNING";
        beforeSnapshot = this.extractEvidenceSnapshot(baselineEvidence) || {};
        deltaSnapshot = this.computeDelta(beforeSnapshot, afterSnapshot);
        summary = this.generateDeterministicSummary(deltaSnapshot, item.baselineWarning);
      } else {
        baselineCompatibility = "EXACT_MATCH";
        comparisonStatus = "COMPARABLE";
        beforeSnapshot = this.extractEvidenceSnapshot(baselineEvidence) || {};
        deltaSnapshot = this.computeDelta(beforeSnapshot, afterSnapshot);
        summary = this.generateDeterministicSummary(deltaSnapshot);
      }

      const row = await this.db.client.outcomeComparison.upsert({
        where: {
          retestItemId_comparisonVersion: {
            retestItemId: item.id,
            comparisonVersion: version,
          },
        },
        update: {
          retestEvidenceId: item.evidenceId,
          baselineEvidenceId: item.baselineEvidenceId ?? null,
          baselineCompatibility,
          comparisonStatus,
          beforeSnapshot,
          afterSnapshot,
          deltaSnapshot,
          summary,
        },
        create: {
          organizationId: retestRun.organizationId,
          projectId: retestRun.projectId,
          publishedAssetId: retestRun.publishedAssetId,
          retestRunId: retestRun.id,
          retestItemId: item.id,
          queryId: item.queryId,
          queryText: item.queryText,
          baselineEvidenceId: item.baselineEvidenceId ?? null,
          retestEvidenceId: item.evidenceId,
          baselineCompatibility,
          comparisonStatus,
          comparisonVersion: version,
          beforeSnapshot,
          afterSnapshot,
          deltaSnapshot,
          summary,
          metadata: {},
          createdById: userId,
        },
      });

      createdOutcomes.push(row);
    }

    const summary = this.computeRunAggregateSummary(createdOutcomes);
    return {
      retestRunId: retestRun.id,
      publishedAssetId: retestRun.publishedAssetId,
      comparisonVersion: version,
      summary,
      items: createdOutcomes,
    };
  }

  /**
   * 查询指定 RetestRun 的所有 Outcome 对比记录与聚合摘要
   */
  async getRetestRunOutcomes(userId: string, retestRunId: string, version?: string) {
    const retestRun = await this.db.client.retestRun.findUnique({
      where: { id: retestRunId },
      include: { publishedAsset: true },
    });
    if (!retestRun) {
      throw new NotFoundException("重测任务不存在");
    }

    await this.tenant.assertUserInProject(userId, retestRun.projectId);

    // 确定查询版本：若指定则用指定版本，未指定则选择该 Run 最新生成的一版，默认 DEFAULT_OUTCOME_VERSION
    let activeVersion = version?.trim();
    if (!activeVersion) {
      const latest = await this.db.client.outcomeComparison.findFirst({
        where: { retestRunId },
        orderBy: { createdAt: "desc" },
        select: { comparisonVersion: true },
      });
      activeVersion = latest?.comparisonVersion || DEFAULT_OUTCOME_VERSION;
    }

    let outcomes = await this.db.client.outcomeComparison.findMany({
      where: { retestRunId, comparisonVersion: activeVersion },
      orderBy: { createdAt: "asc" },
    });

    // 若尚未生成，自动触发首次生成
    if (outcomes.length === 0) {
      const generated = await this.generateRetestOutcomes(userId, retestRunId, { comparisonVersion: activeVersion });
      return generated;
    }

    const summary = this.computeRunAggregateSummary(outcomes);
    return {
      retestRunId: retestRun.id,
      publishedAssetId: retestRun.publishedAssetId,
      comparisonVersion: activeVersion,
      summary,
      items: outcomes,
    };
  }

  /**
   * 查询指定 RetestItem 的 Outcome 结果
   */
  async getRetestItemOutcome(userId: string, retestItemId: string, version?: string) {
    const item = await this.db.client.retestItem.findUnique({
      where: { id: retestItemId },
      include: { retestRun: true },
    });
    if (!item) {
      throw new NotFoundException("重测条目不存在");
    }

    await this.tenant.assertUserInProject(userId, item.retestRun.projectId);

    let outcome = await this.db.client.outcomeComparison.findFirst({
      where: {
        retestItemId,
        ...(version?.trim() ? { comparisonVersion: version.trim() } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!outcome) {
      // 触发该 Run 的生成
      const gen = await this.generateRetestOutcomes(userId, item.retestRunId, {
        comparisonVersion: version?.trim() || DEFAULT_OUTCOME_VERSION,
      });
      outcome = gen.items.find((it: any) => it.retestItemId === retestItemId) || null;
    }

    if (!outcome) {
      throw new NotFoundException("未找到对应的对比结果");
    }

    return outcome;
  }

  /**
   * 查询 PublishedAsset 维度的所有 Retest Outcome 历史记录
   */
  async listAssetOutcomes(userId: string, publishedAssetId: string) {
    const asset = await this.db.client.publishedAsset.findUnique({
      where: { id: publishedAssetId },
    });
    if (!asset) {
      throw new NotFoundException("发布资产不存在");
    }

    await this.tenant.assertUserInProject(userId, asset.projectId);

    const outcomes = await this.db.client.outcomeComparison.findMany({
      where: { publishedAssetId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const summary = this.computeRunAggregateSummary(outcomes);

    return {
      publishedAssetId: asset.id,
      totalOutcomes: outcomes.length,
      summary,
      items: outcomes,
    };
  }

  /**
   * 按 Outcome ID 直接查询单个记录
   */
  async getOutcomeById(userId: string, outcomeId: string) {
    const outcome = await this.db.client.outcomeComparison.findUnique({
      where: { id: outcomeId },
    });
    if (!outcome) {
      throw new NotFoundException("对比结果不存在");
    }

    await this.tenant.assertUserInProject(userId, outcome.projectId);
    return outcome;
  }
}
