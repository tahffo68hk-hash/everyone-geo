/**
 * M9A - AI Content Strategy & Planning Domain Engine
 *
 * 核心职责：
 * 1. 围绕 GEO 诊断、优化建议与内容机会，深度回答 9 大战略问题：
 *    - geoGap (当前 GEO 缺口)
 *    - priorityQuestions (最值得通过内容解决的问题)
 *    - targetAudience (目标受众)
 *    - perceptionGoal (内容应建立的心智认知)
 *    - keyThemes (核心覆盖主题 - 支持多 Opportunity 聚类)
 *    - platformPriorities (平台优先级与角色分工 - 经过平台准入门禁)
 *    - contentFormats (推荐内容形式)
 *    - evidenceRequired (所需事实与依据 - 杜绝虚构事实)
 *    - validationMetrics (成功验证指标 - 杜绝无来源硬编码百分比)
 * 2. 生成多平台落地内容计划项 (ContentPlanItem)：
 *    - 平台准入过滤与可解释理由 (platformEligibilityReason)
 *    - 事实就绪判断 (FACT_INPUT_REQUIRED / READY)
 *    - 素材物料依赖声明 (ASSET_INPUT_REQUIRED / VIDEO_ASSET)
 * 3. 闭环支持：一键从计划项派生带有完整大纲与事实依据的 ContentDraft。
 */

export interface StrategyOpportunityInput {
  id: string;
  titleDirection?: string | null;
  summary?: string | null;
  rationale?: string | null;
  opportunityType?: string | null;
  priority?: string | null;
  category?: string | null;
  assetType?: string | null;
  contentIntent?: string | null;
  representativeQuery?: string | null;
  targetEngines?: unknown;
  targetCompetitors?: any;
  expectedSignals?: any;
  queries?: Array<{
    queryTextSnapshot: string;
    category?: string | null;
    intent?: string | null;
    brandAbsent?: boolean | null;
    competitorPositive?: boolean | null;
  }>;
  blocks?: Array<{
    title: string;
    purpose: string;
    blockType: string;
  }>;
}

export interface StrategyEngineInput {
  targetEntity: string;
  projectName: string;
  industry?: string | null;
  customGuidance?: string;
  opportunity?: StrategyOpportunityInput | null;
  opportunities?: StrategyOpportunityInput[];
  recommendation?: {
    id: string;
    title: string;
    summary?: string | null;
    rationale?: string | null;
    impactArea?: string | null;
    competitorName?: string | null;
  } | null;
  diagnosisRun?: {
    id: string;
    reportId?: string | null;
  } | null;
  verifiedFacts?: Array<{
    claim: string;
    factType: string;
    status: string;
    sourceRef?: string | null;
  }>;
  availableAssets?: Array<{
    id: string;
    assetType: string;
    url?: string;
    name?: string;
  }>;
  baselineMetrics?: {
    citationRate?: number | null;
    brandAbsentRate?: number | null;
    source?: string;
  } | null;
  targetMetrics?: {
    citationRateTarget?: number | null;
    brandAbsentRateTarget?: number | null;
    source?: string;
  } | null;
}

export interface StrategicPriorityQuestion {
  question: string;
  intent: string;
  urgency: "P0" | "P1" | "P2";
  targetEngines: string[];
  rationale: string;
}

export interface StrategicKeyTheme {
  theme: string;
  focus: string;
  outlinePoints: string[];
  sourceOpportunityIds?: string[];
}

export interface StrategicPlatformPriority {
  platform: string;
  platformLabel: string;
  priority: number;
  role: string;
  rationale: string;
  shareOfVoiceTarget: string;
}

export interface StrategicContentFormat {
  platform: string;
  format: string;
  recommendedLength: string;
  structuralTemplate: string;
  tone: string;
}

export interface StrategicEvidenceItem {
  claim: string;
  evidenceType: string;
  verified: boolean;
  status?: string;
  sourceRef?: string;
}

export interface StrategicValidationMetric {
  metric: string;
  target: string;
  evaluationMethod: string;
  timeframe: string;
  source: "USER_CONFIGURED" | "PROJECT_BASELINE" | "EXPERIMENT_TARGET" | "BUSINESS_RULE" | "QUALITATIVE_TARGET";
  baseline?: string | number | null;
  targetValue?: string | number | null;
}

export interface PlanAssetRequirement {
  type: "VIDEO_ASSET" | "COVER_IMAGE" | "PRODUCT_IMAGE" | "INFOGRAPHIC";
  status: "REQUIRED" | "RECOMMENDED";
  description: string;
}

export interface PlanFactRequirement {
  name: string;
  importance: "REQUIRED" | "OPTIONAL";
  status: "SATISFIED" | "MISSING";
}

export interface GeneratedPlanItem {
  title: string;
  platform: string;
  format: string;
  objective: string;
  geoTarget: string;
  targetQueries: string[];
  keyClaims: string[];
  status: "PLANNED" | "FACT_INPUT_REQUIRED" | "ASSET_INPUT_REQUIRED" | "READY";
  sortOrder: number;
  metadata: {
    platformEligibilityReason: string;
    assetRequirements: PlanAssetRequirement[];
    missingAssets: string[];
    requiredFacts: PlanFactRequirement[];
    missingFacts: string[];
    sourceOpportunityIds: string[];
    opportunityCount: number;
  };
}

export interface GeneratedStrategyOutput {
  title: string;
  geoGap: string;
  priorityQuestions: StrategicPriorityQuestion[];
  targetAudience: string;
  perceptionGoal: string;
  keyThemes: StrategicKeyTheme[];
  platformPriorities: StrategicPlatformPriority[];
  contentFormats: StrategicContentFormat[];
  evidenceRequired: StrategicEvidenceItem[];
  validationMetrics: StrategicValidationMetric[];
  planItems: GeneratedPlanItem[];
  metadata?: Record<string, unknown>;
}

export interface OpportunityCluster {
  clusterKey: string;
  clusterTitle: string;
  primaryOpportunity: StrategyOpportunityInput;
  allOpportunities: StrategyOpportunityInput[];
  allQueries: Array<{
    queryTextSnapshot: string;
    category?: string | null;
    intent?: string | null;
    brandAbsent?: boolean | null;
    competitorPositive?: boolean | null;
  }>;
  sourceOpportunityIds: string[];
  assetType: string;
  contentIntent: string;
}

export class ContentStrategyEngine {
  /**
   * 综合分析项目 GEO 上下文并产出 9 大战略支柱及内容计划
   */
  static generateStrategy(input: StrategyEngineInput): GeneratedStrategyOutput {
    const entity = input.targetEntity || input.projectName || "本品牌";
    const rec = input.recommendation;

    // 1. 整理与聚类 Opportunities (AG-M9A-04)
    const rawOpps: StrategyOpportunityInput[] = [];
    if (input.opportunities && input.opportunities.length > 0) {
      rawOpps.push(...input.opportunities);
    } else if (input.opportunity) {
      rawOpps.push(input.opportunity);
    }

    const clusters = this.clusterOpportunities(rawOpps, entity, rec?.title);
    const primaryCluster = clusters[0];
    const opp = primaryCluster.primaryOpportunity;
    const allOpportunityIds = Array.from(new Set(rawOpps.map((o) => o.id).filter(Boolean)));
    if (allOpportunityIds.length === 0 && opp?.id) {
      allOpportunityIds.push(opp.id);
    }

    // 解析核心主题与代表性意图
    const topic = primaryCluster.clusterTitle;
    const repQuery =
      opp?.representativeQuery ||
      primaryCluster.allQueries[0]?.queryTextSnapshot ||
      `${topic} 怎么样`;

    // 提取目标引擎与竞品
    const engines = this.extractItems(opp?.targetEngines, []);
    const competitors = this.extractItems(opp?.targetCompetitors, []);

    // ==========================================
    // AG-M9A-01: 事实核验与证据提取（杜绝虚构事实）
    // ==========================================
    const hasRealVerifiedFacts = Array.isArray(input.verifiedFacts) && input.verifiedFacts.length > 0;
    let evidenceRequired: StrategicEvidenceItem[] = [];
    let requiredFactDimensions: PlanFactRequirement[] = [];

    // 根据品类/行业/资产类型确定该内容所需的事实维度（只声明需要什么事实，不编造具体数值）
    const isTechDocumentation =
      primaryCluster.assetType === "DOCUMENTATION" ||
      primaryCluster.assetType === "API_REFERENCE" ||
      primaryCluster.assetType === "WHITE_PAPER" ||
      input.industry?.includes("IT") ||
      input.industry?.includes("软件") ||
      input.industry?.includes("科技") ||
      topic.includes("数据库") ||
      topic.includes("SaaS") ||
      topic.includes("架构");

    const isEducationOrService =
      input.industry?.includes("教育") ||
      input.industry?.includes("服务") ||
      input.industry?.includes("培训") ||
      primaryCluster.assetType === "SERVICE_GUIDE";

    if (isTechDocumentation) {
      requiredFactDimensions = [
        { name: "产品部署架构与环境依赖要求", importance: "REQUIRED", status: "MISSING" },
        { name: "核心性能吞吐与系统实测参数", importance: "REQUIRED", status: "MISSING" },
        { name: "支持的数据源、兼容接口与协议规范", importance: "REQUIRED", status: "MISSING" },
        { name: "服务可用性与故障恢复保障标准 (SLA)", importance: "OPTIONAL", status: "MISSING" },
      ];
    } else if (isEducationOrService) {
      requiredFactDimensions = [
        { name: "课程/服务交付标准与具体流程", importance: "REQUIRED", status: "MISSING" },
        { name: "资质认证、师资背景与权威背书", importance: "REQUIRED", status: "MISSING" },
        { name: "真实学员/客户成效反馈与履约保障", importance: "REQUIRED", status: "MISSING" },
        { name: "客观准入条件与服务退改政策", importance: "OPTIONAL", status: "MISSING" },
      ];
    } else {
      // 消费电子 / 宠物科技 / 硬件产品 / 通用
      requiredFactDimensions = [
        { name: "核心技术规格与工作电气/机械参数", importance: "REQUIRED", status: "MISSING" },
        { name: "接触材料安全性与执行国家/行业标准", importance: "REQUIRED", status: "MISSING" },
        { name: "第三方权威实测报告或质检凭证", importance: "REQUIRED", status: "MISSING" },
        { name: "正确操作规范与适用/禁忌场景清单", importance: "OPTIONAL", status: "MISSING" },
      ];
    }

    if (hasRealVerifiedFacts) {
      evidenceRequired = input.verifiedFacts!.map((f) => ({
        claim: f.claim,
        evidenceType: f.factType || "TECHNICAL_SPEC",
        verified: f.status === "VERIFIED",
        status: f.status,
        sourceRef: f.sourceRef || undefined,
      }));

      // 对比真实事实，标记已满足的事实维度
      for (const req of requiredFactDimensions) {
        const satisfied = input.verifiedFacts!.some((vf) => {
          const text = `${vf.claim} ${vf.factType} ${vf.sourceRef || ""}`.toLowerCase();
          const reqKeywords = req.name.replace(/[与、或\(\)]/g, " ").split(/\s+/).filter(Boolean);
          return reqKeywords.some((kw) => text.includes(kw.toLowerCase()));
        });
        if (satisfied) {
          req.status = "SATISFIED";
        }
      }
    } else {
      // 无任何可用已核验事实：只返回未核验占位提示，严禁注入特定行业虚构参数！
      evidenceRequired = [
        {
          claim: "暂无可用的结构化核验事实，请补充真实产品参数、检测报告或可信资料。",
          evidenceType: "UNVERIFIED_OR_EMPTY",
          verified: false,
          status: "UNVERIFIED_OR_EMPTY",
          sourceRef: "待录入官方核实事实库",
        },
      ];
    }

    // 检查是否有必需事实缺失
    const missingRequiredFacts = requiredFactDimensions
      .filter((r) => r.importance === "REQUIRED" && r.status === "MISSING")
      .map((r) => r.name);

    // ==========================================
    // AG-M9A-02: 成功验证指标（杜绝无来源硬编码 KPI）
    // ==========================================
    const validationMetrics: StrategicValidationMetric[] = [];
    const baseline = input.baselineMetrics;
    const target = input.targetMetrics;

    if (baseline?.citationRate !== undefined && baseline?.citationRate !== null) {
      const source = (baseline.source as any) || "PROJECT_BASELINE";
      const targetRate = target?.citationRateTarget ?? Number(baseline.citationRate);
      validationMetrics.push({
        metric: "GEO AI 引擎引用率 (Citation Rate)",
        target: `以用户设定的 ${targetRate}% 作为观察目标，不代表结果承诺`,
        evaluationMethod: "通过 GeoLens 自动化基准测试与诊断 Run 定期追踪",
        timeframe: "发布后 14-30 天",
        source,
        baseline: baseline.citationRate,
        targetValue: targetRate,
      });
    } else {
      validationMetrics.push({
        metric: "GEO AI 引擎品牌提及与推荐召回率",
        target: `使用同一问题集观察“${entity}”的提及和推荐情况；记录变化，不预设提升幅度`,
        evaluationMethod: "通过相同 Benchmark Suite 复测并对照报告",
        timeframe: "发布后 14-30 天",
        source: "QUALITATIVE_TARGET",
      });
    }

    if (baseline?.brandAbsentRate !== undefined && baseline?.brandAbsentRate !== null) {
      const source = (baseline.source as any) || "PROJECT_BASELINE";
      const targetAbsent = target?.brandAbsentRateTarget ?? Number(baseline.brandAbsentRate);
      validationMetrics.push({
        metric: "Brand Absent (未提及品牌) 比例改善",
        target: `以用户设定的 ${targetAbsent}% 作为观察目标，不代表结果承诺`,
        evaluationMethod: "对比优化前后 Benchmark 诊断报告中的 Brand Absent 变化",
        timeframe: "发布后 30 天",
        source,
        baseline: baseline.brandAbsentRate,
        targetValue: targetAbsent,
      });
    } else {
      validationMetrics.push({
        metric: "AI 检索未提及品牌 (Brand Absent) 比例改善",
        target: "用同一问题集比较未提及比例并记录波动，不预设下降幅度或索引结果",
        evaluationMethod: "对比同一 Benchmark Suite 的前后报告",
        timeframe: "发布后 30 天",
        source: "QUALITATIVE_TARGET",
      });
    }

    validationMetrics.push(
      {
        metric: "全网事实锚定准确度 (Grounding Accuracy)",
        target: `抽查【${entity}】相关内容是否忠实于已核实资料，缺失信息由人工复核`,
        evaluationMethod: "逐条对照企业已核实事实与最终发布稿",
        timeframe: "发布后持续监控",
        source: "QUALITATIVE_TARGET",
      },
      {
        metric: "核心知识载体在搜索引擎与大模型长尾收录率",
        target: "如能取得公开页面和平台数据，再观察收录与引用；不承诺被索引或引用",
        evaluationMethod: "人工核对可访问页面，并与后续同题测量结果对照",
        timeframe: "发布后 7-14 天",
        source: "QUALITATIVE_TARGET",
      },
    );

    // 1. GEO 缺口 (geoGap)
    const measuredQueries = primaryCluster.allQueries;
    const absentQueries = measuredQueries.filter((query) => query.brandAbsent === true);
    const measurementContext = measuredQueries.length > 0
      ? `本轮问答测试关联 ${measuredQueries.length} 个问题，其中 ${absentQueries.length} 个来源回答记录为未提及品牌${absentQueries.length > 0 ? `（例如“${absentQueries.slice(0, 2).map((query) => query.queryTextSnapshot).join("；")}”）` : ""}。`
      : "当前内容机会没有附带问题级测量记录，不能据此判断品牌提及情况。";
    const competitorContext = competitors.length > 0
      ? `来源机会列出的比较对象为：${competitors.join("、")}；这不等于竞品占优或市场份额结论。`
      : "未提供已审核竞品信息，本策略不判断竞品推荐位置或市场份额。";
    const geoGap = `${measurementContext}内容方向围绕“${repQuery}”展开，先回答用户问题，再说明【${entity}】已确认的服务范围与地域信息。${competitorContext}价格、资质、案例、设备、周期和效果等未确认信息应留给商家核实，不把内容建设假设写成检测结论。`;

    // 2. 核心优先问题 (priorityQuestions)
    const priorityQuestions: StrategicPriorityQuestion[] = [];
    if (primaryCluster.allQueries.length > 0) {
      for (const q of primaryCluster.allQueries.slice(0, 3)) {
        priorityQuestions.push({
          question: q.queryTextSnapshot,
          intent: q.intent || "INFORMATIONAL",
          urgency: q.brandAbsent ? "P0" : "P1",
          targetEngines: engines.slice(0, 3),
          rationale: q.brandAbsent
            ? "本轮来源回答记录为未提及品牌；可围绕该问题补充可核实信息并在同一问题集复测。"
            : "该问题已关联内容机会；发布前需核对商家事实和适用边界。",
        });
      }
    }
    if (priorityQuestions.length < 2) {
      priorityQuestions.push({
        question: `发布与“${repQuery}”有关的内容前，需要核实哪些服务信息？`,
        intent: "INFORMATIONAL",
        urgency: "P1",
        targetEngines: engines.slice(0, 3),
        rationale: "补足来源问题未包含的核实环节；不预设性能、资质或效果。",
      });
    }

    // 3. 目标受众 (targetAudience)
    const targetAudience = `这份内容面向正在查找“${repQuery}”答案的用户。受众描述只根据本次问题集推定；年龄、车型、预算和维修决策习惯尚未得到商家确认。`;

    // 4. 心智目标 (perceptionGoal)
    const perceptionGoal = `把【${entity}】已确认的服务项目、服务地域和到店前信息说明清楚；对价格范围、施工流程、资质、案例和效果等尚未确认的内容标注待核实。该表达目标不代表搜索收录、AI 推荐或排名承诺。`;

    // 5. 核心主题 (keyThemes - 聚类多 Opportunity 整合)
    const keyThemes: StrategicKeyTheme[] = clusters.map((c) => ({
      theme: c.clusterTitle,
      focus: `针对来源问题“${c.allQueries.map((q) => q.queryTextSnapshot).slice(0, 2).join("、") || topic}”整理直接回答和已核实资料`,
      outlinePoints: [
        "直接回应来源问题",
        `说明与问题相关且已确认的${entity}资料`,
        "把缺少的事实列为待商家确认，不补造案例或参数",
      ],
      sourceOpportunityIds: c.sourceOpportunityIds,
    }));

    if (keyThemes.length < 3) {
      keyThemes.push(
        {
          theme: `${topic}与资料核实`,
          focus: "整理当前已有信息，区分已确认事实和缺失资料",
          outlinePoints: [
            "直接回答用户提出的问题",
            "列出已有资料支持的服务内容",
            "将参数、案例和效果等缺失信息留待确认",
          ],
          sourceOpportunityIds: allOpportunityIds,
        },
        {
          theme: `全流程实操与场景化指引`,
          focus: "说明用户下一步可以核实什么，以及商家需要补充哪些信息",
          outlinePoints: [
            "整理到店或咨询前要确认的问题",
            "明确目前资料无法回答的部分",
            "商家确认后再补充流程和服务边界",
          ],
          sourceOpportunityIds: allOpportunityIds,
        },
      );
    }

    // ==========================================
    // AG-M9A-03: 平台准入门禁 (Platform Eligibility Gate)
    // ==========================================
    const eligiblePlatforms = this.evaluatePlatformEligibility({
      assetType: primaryCluster.assetType,
      contentIntent: primaryCluster.contentIntent,
      topic,
      repQuery,
      allQueries: primaryCluster.allQueries,
    });

    const platformPriorities: StrategicPlatformPriority[] = eligiblePlatforms.map((ep, idx) => ({
      platform: ep.platform,
      platformLabel: ep.label,
      priority: idx + 1,
      role: ep.role,
      rationale: ep.eligibilityReason,
      shareOfVoiceTarget: ep.shareOfVoiceTarget,
    }));

    const contentFormats: StrategicContentFormat[] = eligiblePlatforms.map((ep) => ep.formatConfig);

    // ==========================================
    // AG-M9A-05 & AG-M9A-06: 生产落地计划项 (ContentPlanItems)
    // ==========================================
    const hasVideoAsset = (input.availableAssets || []).some((a) =>
      a.assetType?.toUpperCase().includes("VIDEO"),
    );

    const planItems: GeneratedPlanItem[] = eligiblePlatforms.map((ep, idx) => {
      const isVideoPlatform =
        ep.platform === "DOUYIN" ||
        ep.platform === "BILIBILI" ||
        ep.formatConfig.format.includes("视频") ||
        ep.formatConfig.format.includes("脚本");

      const assetRequirements: PlanAssetRequirement[] = [];
      const missingAssets: string[] = [];

      if (isVideoPlatform) {
        assetRequirements.push({
          type: "VIDEO_ASSET",
          status: "REQUIRED",
          description: "需要实拍中长视频或短视频原始分镜素材",
        });
        if (!hasVideoAsset) {
          missingAssets.push("VIDEO_ASSET");
        }
      } else if (ep.platform === "XIAOHONGSHU") {
        assetRequirements.push(
          { type: "COVER_IMAGE", status: "REQUIRED", description: "小红书吸睛封面卡片 (3:4)" },
          { type: "PRODUCT_IMAGE", status: "RECOMMENDED", description: "痛点与对比实拍图集" },
        );
      } else if (ep.platform === "WECHAT_OFFICIAL_ACCOUNT") {
        assetRequirements.push(
          { type: "COVER_IMAGE", status: "RECOMMENDED", description: "微信公众号封面大图 (2.35:1)" },
          { type: "INFOGRAPHIC", status: "RECOMMENDED", description: "架构与流程长图配图" },
        );
      } else if (ep.platform === "WEIBO") {
        assetRequirements.push(
          { type: "INFOGRAPHIC", status: "RECOMMENDED", description: "核心事实或长图卡片" },
        );
      }

      // 决定计划项状态 (AG-M9A-05 & AG-M9A-06)
      let status: GeneratedPlanItem["status"] = "READY";
      if (!hasRealVerifiedFacts) {
        status = "FACT_INPUT_REQUIRED";
      } else if (missingAssets.length > 0) {
        status = "ASSET_INPUT_REQUIRED";
      }

      const planMissingFacts = !hasRealVerifiedFacts
        ? requiredFactDimensions.map((r) => r.name)
        : missingRequiredFacts;

      const keyClaims = hasRealVerifiedFacts
        ? evidenceRequired.slice(0, 3).map((e) => e.claim)
        : ["待知识库补充官方核实参数与检测证据后再行写作"];

      return {
        title: ep.generateTitle(topic),
        platform: ep.platform,
        format: ep.formatConfig.format,
        objective: ep.objective(topic, entity),
        geoTarget: ep.geoTarget(repQuery),
        targetQueries: ep.targetQueries(repQuery, topic),
        keyClaims,
        status,
        sortOrder: idx + 1,
        metadata: {
          platformEligibilityReason: ep.eligibilityReason,
          assetRequirements,
          missingAssets,
          requiredFacts: requiredFactDimensions,
          missingFacts: planMissingFacts,
          sourceOpportunityIds: allOpportunityIds,
          opportunityCount: allOpportunityIds.length,
        },
      };
    });

    const strategyTitle = input.customGuidance
      ? `${topic} - GEO 内容战略与生产计划（专项定制）`
      : `${topic} - GEO 内容战略与生产计划`;

    return {
      title: strategyTitle,
      geoGap,
      priorityQuestions,
      targetAudience,
      perceptionGoal,
      keyThemes,
      platformPriorities,
      contentFormats,
      evidenceRequired,
      validationMetrics,
      planItems,
      metadata: {
        sourceOpportunityIds: allOpportunityIds,
        opportunityCount: allOpportunityIds.length,
        clusterCount: clusters.length,
        factReadiness: {
          hasVerifiedFacts: hasRealVerifiedFacts,
          missingRequiredFacts,
        },
      },
    };
  }

  /**
   * 多 Opportunity 聚类分析 (AG-M9A-04)
   */
  private static clusterOpportunities(
    opps: StrategyOpportunityInput[],
    entity: string,
    recTitle?: string,
  ): OpportunityCluster[] {
    if (opps.length === 0) {
      const fallbackTitle = recTitle || `${entity} 核心方案与专业实践`;
      return [
        {
          clusterKey: "default",
          clusterTitle: fallbackTitle,
          primaryOpportunity: {
            id: "",
            titleDirection: fallbackTitle,
            assetType: "COMPARISON_PAGE",
            contentIntent: "INFORMATIONAL",
          },
          allOpportunities: [],
          allQueries: [],
          sourceOpportunityIds: [],
          assetType: "COMPARISON_PAGE",
          contentIntent: "INFORMATIONAL",
        },
      ];
    }

    if (opps.length === 1) {
      const single = opps[0];
      const title = single.titleDirection || single.summary || `${entity} 核心方案`;
      return [
        {
          clusterKey: single.id || "single",
          clusterTitle: title,
          primaryOpportunity: single,
          allOpportunities: [single],
          allQueries: single.queries || [],
          sourceOpportunityIds: [single.id].filter(Boolean),
          assetType: single.assetType || "COMPARISON_PAGE",
          contentIntent: single.contentIntent || "INFORMATIONAL",
        },
      ];
    }

    // 多 Opportunity 语义聚类：提取关键词与意图相似度
    const clusters: OpportunityCluster[] = [];

    for (const opp of opps) {
      const title = opp.titleDirection || opp.summary || "";
      const text = `${title} ${opp.category || ""} ${opp.contentIntent || ""} ${(opp.queries || []).map((q) => q.queryTextSnapshot).join(" ")}`.toLowerCase();
      const oppKeywords = this.extractKeywords(text);

      let matchedCluster: OpportunityCluster | null = null;

      for (const cluster of clusters) {
        const clusterText = `${cluster.clusterTitle} ${cluster.allQueries.map((q) => q.queryTextSnapshot).join(" ")}`.toLowerCase();
        const clusterKeywords = this.extractKeywords(clusterText);

        const intersection = oppKeywords.filter((k) => clusterKeywords.includes(k));
        const union = Array.from(new Set([...oppKeywords, ...clusterKeywords]));
        const jaccard = union.length > 0 ? intersection.length / union.length : 0;

        // 若关键词交集达到 2 个以上，或 Jaccard 相似度 > 0.2，或分类与意图一致且有交集
        const sameIntent = opp.contentIntent && cluster.contentIntent && opp.contentIntent === cluster.contentIntent;
        if (jaccard >= 0.2 || intersection.length >= 2 || (sameIntent && intersection.length >= 1)) {
          matchedCluster = cluster;
          break;
        }
      }

      if (matchedCluster) {
        matchedCluster.allOpportunities.push(opp);
        matchedCluster.sourceOpportunityIds.push(opp.id);
        if (opp.queries && opp.queries.length > 0) {
          for (const q of opp.queries) {
            if (!matchedCluster.allQueries.some((mq) => mq.queryTextSnapshot === q.queryTextSnapshot)) {
              matchedCluster.allQueries.push(q);
            }
          }
        }
      } else {
        clusters.push({
          clusterKey: opp.id,
          clusterTitle: title || `${entity} 优化主题`,
          primaryOpportunity: opp,
          allOpportunities: [opp],
          allQueries: opp.queries ? [...opp.queries] : [],
          sourceOpportunityIds: [opp.id].filter(Boolean),
          assetType: opp.assetType || "COMPARISON_PAGE",
          contentIntent: opp.contentIntent || "INFORMATIONAL",
        });
      }
    }

    return clusters;
  }

  /**
   * 平台准入过滤与可解释理由 (AG-M9A-03)
   */
  private static evaluatePlatformEligibility(ctx: {
    assetType: string;
    contentIntent: string;
    topic: string;
    repQuery: string;
    allQueries: Array<{ queryTextSnapshot: string; intent?: string | null }>;
  }): Array<{
    platform: string;
    label: string;
    role: string;
    eligibilityReason: string;
    shareOfVoiceTarget: string;
    formatConfig: StrategicContentFormat;
    generateTitle: (topic: string) => string;
    objective: (topic: string, entity: string) => string;
    geoTarget: (repQuery: string) => string;
    targetQueries: (repQuery: string, topic: string) => string[];
  }> {
    const isDeepTech =
      ctx.assetType === "DOCUMENTATION" ||
      ctx.assetType === "API_REFERENCE" ||
      ctx.assetType === "WHITE_PAPER";

    const isNewsOrPR =
      ctx.assetType === "NEWS" ||
      ctx.assetType === "HOT_TOPIC" ||
      ctx.contentIntent === "NAVIGATIONAL";

    const hasInstructionalQuery = ctx.allQueries.some(
      (q) =>
        q.intent === "INSTRUCTIONAL" ||
        q.queryTextSnapshot.includes("教程") ||
        q.queryTextSnapshot.includes("实操") ||
        q.queryTextSnapshot.includes("步骤") ||
        q.queryTextSnapshot.includes("怎么"),
    );

    const candidates: Array<ReturnType<typeof ContentStrategyEngine.wechatDef>> = [];

    // 1. 微信公众号 (WECHAT_OFFICIAL_ACCOUNT)
    if (isDeepTech || !isNewsOrPR) {
      candidates.push(this.wechatDef(isDeepTech));
    }

    // 2. 小红书 (XIAOHONGSHU) - 排除纯技术文档
    if (!isDeepTech) {
      candidates.push(this.xhsDef());
    }

    // 3. Bilibili - 深度实测/视频讲解（若是纯技术文档，仅在有明确教程/实操意图时纳入）
    if (!isDeepTech || hasInstructionalQuery) {
      candidates.push(this.bilibiliDef(isDeepTech));
    }

    // 4. 抖音 (DOUYIN) - 排除纯技术文档
    if (!isDeepTech && !isNewsOrPR) {
      candidates.push(this.douyinDef());
    }

    // 5. 微博 (WEIBO) - 适合热点、快讯、公关与大众消费品；排除深度技术参考文档
    if (!isDeepTech) {
      candidates.push(this.weiboDef());
    }

    return candidates;
  }

  private static wechatDef(isDeepTech: boolean) {
    return {
      platform: "WECHAT_OFFICIAL_ACCOUNT",
      label: "微信公众号",
      role: isDeepTech
        ? "权威技术白皮书与架构深度参考基座"
        : "权威知识基座与 AI 搜索引擎抓取核心源",
      eligibilityReason: isDeepTech
        ? "该 Query 为深度技术解释/技术规范型，适合长文知识载体承载完整架构与技术依据，排除短平快娱乐/生活化社区。"
        : "公众号长图文具备极高 GEO 权威引证权重，适合系统化阐述机制并作为首选引证源。",
      shareOfVoiceTarget: "发布后用同一问题集观察服务信息是否被提及，不设排名目标",
      formatConfig: {
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        format: isDeepTech ? "技术白皮书与架构规范" : "深度实操教程",
        recommendedLength: "2500-4500 字，含结构化原理图与规范说明",
        structuralTemplate: "【用户问题】→【直接回答】→【已确认的服务信息】→【待商家确认事项】",
        tone: "严谨客观、技术严密、权威可信",
      },
      generateTitle: (topic: string) => `${topic}说明：服务范围与需要确认的信息`,
      objective: (topic: string) => `直接回答“${topic}”相关问题，并把已知信息与待确认事项分开说明`,
      geoTarget: (repQuery: string) => `检查内容是否清楚回答“${repQuery}”；不承诺搜索或 AI 引用结果`,
      targetQueries: (repQuery: string, topic: string) => [
        repQuery,
        `${topic} 服务范围需要确认什么`,
      ],
    };
  }

  private static xhsDef() {
    return {
      platform: "XIAOHONGSHU",
      label: "小红书",
      role: "生活场景问题说明与实用信息整理",
      eligibilityReason: "短段落和图文卡片适合呈现用户问题、服务说明与到店前确认事项。",
      shareOfVoiceTarget: "发布后用同一问题集观察内容与目标问题的匹配情况，不设排名目标",
      formatConfig: {
        platform: "XIAOHONGSHU",
        format: "避坑笔记",
        recommendedLength: "600-1000 字，6-9 张高清实拍与痛点对比卡片图",
        structuralTemplate: "【用户问题】→【适用场景说明】→【可执行的确认清单】→【待商家确认项】",
        tone: "真实真诚、干货满满、接地气、口语化",
      },
      generateTitle: (topic: string) => `${topic}：到店或咨询前可以先确认的事项`,
      objective: (topic: string) => `围绕“${topic}”整理用户关心的信息和服务边界，不虚构体验`,
      geoTarget: () => "检查图文是否直接回应目标问题，不承诺推荐排名",
      targetQueries: (_: string, topic: string) => [
        `${topic} 到店前确认事项`,
      ],
    };
  }

  private static bilibiliDef(isDeepTech: boolean) {
    return {
      platform: "BILIBILI",
      label: "Bilibili",
      role: isDeepTech ? "技术主题讲解视频" : "服务问题与项目差异讲解视频",
      eligibilityReason: isDeepTech
        ? "技术概念具象化视频演示，在中长视频技术圈层具备长效搜索引用价值。"
        : "中长视频可分段解释概念和服务项目；是否被搜索或引用需发布后另行验证。",
      shareOfVoiceTarget: "发布后观察目标问题覆盖情况，不设播放量或排名承诺",
      formatConfig: {
        platform: "BILIBILI",
        format: isDeepTech ? "技术实操与代码演示" : "评测/选购视频",
        recommendedLength: "8-15 分钟中长视频，包含实拍拆解与多维数据图表",
        structuralTemplate: "【问题引入】→【概念或项目差异】→【已有资料说明】→【待确认信息与总结】",
        tone: "硬核极客、客观中立、不吹不黑、逻辑缜密",
      },
      generateTitle: (topic: string) => `${topic}怎么选？先看项目差异和待确认信息`,
      objective: (topic: string) => `分段解释“${topic}”相关概念；没有实测素材时不输出测试结论`,
      geoTarget: () => "发布后观察视频是否覆盖目标问题，不承诺 AI 引用或推荐",
      targetQueries: (_: string, topic: string) => [
        `${topic} 怎么选，需要问清什么`,
      ],
    };
  }

  private static douyinDef() {
    return {
      platform: "DOUYIN",
      label: "抖音",
      role: "痛点直击与大众高频认知唤醒",
      eligibilityReason: "短视频视觉冲击力强，针对日常高频误区快速唤醒认知并给出解法。",
      shareOfVoiceTarget: "发布后观察目标问题覆盖情况，不承诺播放量或排名",
      formatConfig: {
        platform: "DOUYIN",
        format: "短视频脚本",
        recommendedLength: "45-60 秒，分镜 4-6 个，快节奏",
        structuralTemplate: "【前几秒提出用户问题】→【口播直接回答】→【画面辅助说明】→【待确认事项】",
        tone: "紧凑有力、通俗易懂、视觉冲击感强",
      },
      generateTitle: (topic: string) => `${topic}先别急着修：到店前先问清哪些信息`,
      objective: (topic: string) => `用自然口播回答“${topic}”相关问题，并明确哪些细节仍需商家确认`,
      geoTarget: () => "核对口播是否直接回应目标问题，不承诺播放、推荐或排名结果",
      targetQueries: (_: string, topic: string) => [
        `${topic} 到店前需要确认什么`,
      ],
    };
  }

  private static weiboDef() {
    return {
      platform: "WEIBO",
      label: "微博",
      role: "热点议题发酵、公关声明与权威事实锚定",
      eligibilityReason: "即时社交媒体适合官方辟谣、事实清单速递与热点话题锚定。",
      shareOfVoiceTarget: "发布后检查事实表述是否准确，不设热度或引用目标",
      formatConfig: {
        platform: "WEIBO",
        format: "热点科普与快讯",
        recommendedLength: "300-600 字，配 4/9 宫格图解或官方事实长图",
        structuralTemplate: "【核心事实提炼】→【常见谣言反驳】→【官方权威验证依据】→【互动讨论设问】",
        tone: "精炼清晰、态度明确、便于转发讨论",
      },
      generateTitle: (topic: string) => `${topic}信息整理：已知事项与待确认内容`,
      objective: () => `提炼核心事实论据，形成社交话题讨论与权威论调锚定`,
      geoTarget: () => `建立全网可检索的热门事实引用锚点，提升公信力`,
      targetQueries: (_: string, topic: string) => [
        `${topic} 事实`,
        `${topic} 权威科普`,
      ],
    };
  }

  /**
   * 从计划项一键生成草稿主体内容
   */
  static generateDraftBody(planItem: {
    title: string;
    platform: string;
    format: string;
    objective: string;
    geoTarget: string;
    targetQueries: string[];
    keyClaims: string[];
  }): string {
    const claimsText =
      planItem.keyClaims && planItem.keyClaims.length > 0
        ? planItem.keyClaims.map((c) => `- ${c}`).join("\n")
        : "- 严格遵循官方核实事实与科学依据开展创作";

    const queriesText =
      planItem.targetQueries && planItem.targetQueries.length > 0
        ? planItem.targetQueries.map((q) => `\`${q}\``).join("、")
        : "核心品类高频词";

    return `# ${planItem.title}

> **内容形式**：${planItem.format}
> **发布平台**：${planItem.platform}
> **内容目的**：${planItem.objective}
> **GEO 目标**：${planItem.geoTarget}
> **目标搜索词**：${queriesText}

---

## 核心核实事实与依据 (Verified Facts)
${claimsText}

---

## 结构化内容大纲与正文规划

### 1. 场景切入与核心痛点唤醒
- 描述用户在日常真实环境中所面临的高频痛点与常见疑惑。
- 指出市场上常见的不当操作或误导性宣传所带来的潜在危害。

### 2. 机制解析与硬核事实阐释
- 深入拆解科学工作机制，以客观数据阐述为何该方案更有效、更安全。
- 引用已核实的技术参数与检测依据，杜绝夸大虚假宣传。

### 3. 分步保姆级实操 / 避坑要点指引
- 提供清晰明确、易执行的动作指南或选型参数核对表。
- 针对用户最关心的踩坑场景逐一给出专业防范建议。

### 4. 权威总结与行动建议
- 给出简明精炼的结论清单。
- 引导用户关注后续深度科普或官方合规服务通道。
`;
  }

  private static extractKeywords(text: string): string[] {
    const cleaned = text.replace(/[\s\p{P}]+/gu, " ").trim();
    const words = cleaned.split(" ").filter((w) => w.length >= 2);
    // 简易中文 2-4 字切分支持
    const ngrams: string[] = [...words];
    for (let i = 0; i < text.length - 1; i++) {
      const sub = text.slice(i, i + 2);
      if (/[\u4e00-\u9fa5]{2}/.test(sub)) {
        ngrams.push(sub);
      }
    }
    return Array.from(new Set(ngrams));
  }

  private static extractItems(source: unknown, fallback: string[]): string[] {
    if (!source) return fallback;
    const toLabel = (item: unknown): string => {
      if (typeof item === "string") return item.trim();
      if (typeof item !== "object" || item === null) return "";
      const value = item as Record<string, unknown>;
      for (const key of ["engineName", "displayName", "canonicalName", "name", "label", "provider", "model"]) {
        if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
      }
      return "";
    };
    if (Array.isArray(source)) {
      const arr = source.map(toLabel).filter(Boolean);
      return arr.length > 0 ? arr : fallback;
    }
    if (typeof source === "object") {
      const items = (source as any).items;
      if (Array.isArray(items)) {
        const arr = items.map(toLabel).filter(Boolean);
        return arr.length > 0 ? arr : fallback;
      }
    }
    return fallback;
  }
}
