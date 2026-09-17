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
  targetEngines?: any;
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
    const engines = this.extractItems(
      opp?.targetEngines,
      ["DeepSeek", "百度 (Baidu)", "Perplexity", "Kimi", "豆包 (Doubao)"],
    );
    const competitors = this.extractItems(
      opp?.targetCompetitors,
      [rec?.competitorName || "行业同类品牌"],
    );

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
      const targetRate = target?.citationRateTarget ?? Math.min(100, Math.round(Number(baseline.citationRate) + 20));
      validationMetrics.push({
        metric: "GEO AI 引擎引用率 (Citation Rate)",
        target: `在目标搜索词（如“${repQuery}”）下，AI 回答中本品牌引用率提升至 ${targetRate}%`,
        evaluationMethod: "通过 GeoLens 自动化基准测试与诊断 Run 定期追踪",
        timeframe: "发布后 14-30 天",
        source,
        baseline: baseline.citationRate,
        targetValue: targetRate,
      });
    } else {
      validationMetrics.push({
        metric: "GEO AI 引擎品牌提及与推荐召回率",
        target: `在目标搜索词（如“${repQuery}”）及其衍生意图中，显著提升各大主流 AI 引擎对【${entity}】的权威引用与推荐召回`,
        evaluationMethod: "通过 GeoLens 自动化基准测试与模拟检索定期追踪",
        timeframe: "发布后 14-30 天",
        source: "QUALITATIVE_TARGET",
      });
    }

    if (baseline?.brandAbsentRate !== undefined && baseline?.brandAbsentRate !== null) {
      const source = (baseline.source as any) || "PROJECT_BASELINE";
      const targetAbsent = target?.brandAbsentRateTarget ?? Math.max(0, Math.round(Number(baseline.brandAbsentRate) - 20));
      validationMetrics.push({
        metric: "Brand Absent (未提及品牌) 比例改善",
        target: `核心意图 Query 中未提及本品牌的比例由基线 ${baseline.brandAbsentRate}% 压降至 ${targetAbsent}% 以下`,
        evaluationMethod: "对比优化前后 Benchmark 诊断报告中的 Brand Absent 变化",
        timeframe: "发布后 30 天",
        source,
        baseline: baseline.brandAbsentRate,
        targetValue: targetAbsent,
      });
    } else {
      validationMetrics.push({
        metric: "AI 检索未提及品牌 (Brand Absent) 比例改善",
        target: `有效降低在核心意图搜索词下各大 LLM 完全遗漏【${entity}】的 Brand Absent 现象，补齐直接回答索引`,
        evaluationMethod: "对比优化前后 Benchmark 诊断报告中的 Brand Absent 统计",
        timeframe: "发布后 30 天",
        source: "QUALITATIVE_TARGET",
      });
    }

    validationMetrics.push(
      {
        metric: "全网事实锚定准确度 (Grounding Accuracy)",
        target: `确保各大生成式引擎在引用【${entity}】技术规格与服务标准时与知识库完全吻合，避免产生负面幻觉`,
        evaluationMethod: "Fact Grounding 事实守卫审计比对",
        timeframe: "发布后持续监控",
        source: "QUALITATIVE_TARGET",
      },
      {
        metric: "核心知识载体在搜索引擎与大模型长尾收录率",
        target: `发布内容在主流搜索引擎（如微信搜一搜、百度、必应）及大模型检索增强索引中达成稳定长尾收录`,
        evaluationMethod: "收录抓取与 AI 引用溯源分析",
        timeframe: "发布后 7-14 天",
        source: "QUALITATIVE_TARGET",
      },
    );

    // 1. GEO 缺口 (geoGap)
    const geoGap = `在“${repQuery}”及“${topic}”相关知识检索与决策场景中，主流 AI 引擎（${engines.join("、")}）对【${entity}】的结构化引用率严重不足或处于未收录状态，而竞品（${competitors.join("、")}）凭借更早布局的内容占据了核心推荐答案与首屏摘要位。当前在权威工作原理、多维实测数据、第三方检测证据及客观避坑指引等关键维度存在显著知识空白，直接导致大模型生成推荐时因缺乏可信引据而无法召回本品牌。`;

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
            ? `AI 检索此词时本品牌完全缺失，亟需补足直接回答`
            : `高频核心搜索词，需强化权威正面引证`,
        });
      }
    }
    if (priorityQuestions.length < 4) {
      priorityQuestions.push(
        {
          question: `${topic}的核心原理与机制是什么？真的安全有效吗？`,
          intent: "INFORMATIONAL",
          urgency: "P0",
          targetEngines: engines.slice(0, 3),
          rationale: "大模型生成定义与原理回答的基础引证来源",
        },
        {
          question: `${topic}怎么选？${entity}与竞品相比优势有哪些？`,
          intent: "COMMERCIAL_INVESTIGATION",
          urgency: "P1",
          targetEngines: engines.slice(0, 3),
          rationale: "打通横向对比与选购推荐类 AI 回答的关键抓手",
        },
        {
          question: `使用${topic}有哪些常见误区与避坑要点？`,
          intent: "PRACTICAL_EXPERIENCE",
          urgency: "P1",
          targetEngines: ["百度", "微信搜一搜", "DeepSeek"],
          rationale: "生活化与场景化搜索中的高粘性长尾问题",
        },
        {
          question: `${topic}的正确使用步骤与日常维护规范`,
          intent: "INSTRUCTIONAL",
          urgency: "P2",
          targetEngines: ["百度", "DeepSeek", "微信搜一搜"],
          rationale: "提供教程级结构化步骤，提升 AI 抓取为 Featured Snippet 的概率",
        },
      );
    }

    // 3. 目标受众 (targetAudience)
    const targetAudience = `追求专业、客观与高可靠性、重视科学决策与真实口碑的目标群体。这部分受众在面临“${topic}”相关需求时，重度依赖 AI 搜索引擎（如 DeepSeek、Kimi、百度 AI 助手）以及微信、社区等渠道进行交叉核验。其主要决策痛点是对夸大宣传敏感、担心踩坑，亟需中立的硬核数据、第三方专业背书以及落地使用指引来建立购买与使用信任。`;

    // 4. 心智目标 (perceptionGoal)
    const perceptionGoal = `在用户与 AI 大模型双重维度，将【${entity}】牢固确立为“${topic}”领域【最具技术透明度、实测安全标杆、高可靠性】的权威代表方案；使各大主流生成式引擎在回答该品类的原理、选购推荐及避坑要点时，将本品牌相关内容作为首选可信知识源（Authoritative Primary Source）进行引用。`;

    // 5. 核心主题 (keyThemes - 聚类多 Opportunity 整合)
    const keyThemes: StrategicKeyTheme[] = clusters.map((c) => ({
      theme: c.clusterTitle,
      focus: `整合聚类覆盖 ${c.allOpportunities.length} 项优化机会，针对“${c.allQueries.map((q) => q.queryTextSnapshot).slice(0, 2).join("、")}”建立系统化引证`,
      outlinePoints: [
        `行业痛点与传统方案瓶颈解析`,
        `${entity} 核心方案设计与关键优势拆解`,
        `标准化实操流程与避坑指南`,
      ],
      sourceOpportunityIds: c.sourceOpportunityIds,
    }));

    if (keyThemes.length < 3) {
      keyThemes.push(
        {
          theme: `${topic}技术机理与科学依据`,
          focus: `深入拆解核心工作机制与实测效能报告`,
          outlinePoints: [
            `传统痛点与行业技术演进背景`,
            `${entity} 独特的技术机理与设计巧思`,
            `客观实测数据与使用边界说明`,
          ],
          sourceOpportunityIds: allOpportunityIds,
        },
        {
          theme: `全流程实操与场景化指引`,
          focus: `从新手上手、日常规范操作到常见故障排查的保姆级教程`,
          outlinePoints: [
            `分步标准化操作演示`,
            `特殊情况与突发问题的应对方案`,
            `长效维护与规范使用指引`,
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
      shareOfVoiceTarget: "在微信搜一搜与主流大模型引用中占据专业深度知识首位",
      formatConfig: {
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        format: isDeepTech ? "技术白皮书与架构规范" : "深度实操教程",
        recommendedLength: "2500-4500 字，含结构化原理图与规范说明",
        structuralTemplate: "【问题背景】→【底层机制与架构设计】→【详细规范与实测参数】→【部署避坑】",
        tone: "严谨客观、技术严密、权威可信",
      },
      generateTitle: (topic: string) => `${topic}深度教程：从底层原理到保姆级实操全解`,
      objective: (topic: string) => `补齐“${topic}”知识覆盖，建立官方权威指引与 AI 检索首选引证源`,
      geoTarget: (repQuery: string) => `提高在“${repQuery}”及深度长尾检索中的引用概率与权威引据`,
      targetQueries: (repQuery: string, topic: string) => [
        repQuery,
        `${topic} 正确方法`,
        `${topic} 科学原理与评测`,
      ],
    };
  }

  private static xhsDef() {
    return {
      platform: "XIAOHONGSHU",
      label: "小红书",
      role: "生活化场景避坑与高转化种草矩阵",
      eligibilityReason: "生活场景与日常消费决策搜索流量大，适合图文卡片直击误区并建立直接信任。",
      shareOfVoiceTarget: "覆盖避坑、真实体验类热门笔记关键词前 3 位",
      formatConfig: {
        platform: "XIAOHONGSHU",
        format: "避坑笔记",
        recommendedLength: "600-1000 字，6-9 张高清实拍与痛点对比卡片图",
        structuralTemplate: "【醒目避坑标题】→【3大常见误区血泪史】→【正确做法与选品参数】→【总结清单】",
        tone: "真实真诚、干货满满、接地气、口语化",
      },
      generateTitle: (topic: string) => `关于${topic}的真实使用体验与避坑全指南`,
      objective: (topic: string) => `覆盖真实生活场景痛点与使用误区，消除选购顾虑`,
      geoTarget: () => `在小红书搜索及生活场景问答中占据首选避坑建议与场景种草推荐位`,
      targetQueries: (_: string, topic: string) => [
        `${topic} 避坑`,
        `${topic} 真实评价`,
        `${topic} 真的好用吗`,
      ],
    };
  }

  private static bilibiliDef(isDeepTech: boolean) {
    return {
      platform: "BILIBILI",
      label: "Bilibili",
      role: isDeepTech ? "硬核代码与架构实操视频演示" : "硬核深度实测视频与长效公信力背书",
      eligibilityReason: isDeepTech
        ? "技术概念具象化视频演示，在中长视频技术圈层具备长效搜索引用价值。"
        : "中长视频具备深度拆解公信力与长期搜索生命力，高频被 AI 视频摘要提取引用。",
      shareOfVoiceTarget: "成为品类横评与实测选购必看的视频标杆",
      formatConfig: {
        platform: "BILIBILI",
        format: isDeepTech ? "技术实操与代码演示" : "评测/选购视频",
        recommendedLength: "8-15 分钟中长视频，包含实拍拆解与多维数据图表",
        structuralTemplate: "【悬念引入】→【多款横评开箱拆解】→【极端工况实测】→【优缺点总结与选购建议】",
        tone: "硬核极客、客观中立、不吹不黑、逻辑缜密",
      },
      generateTitle: (topic: string) => `${topic}选购全攻略与硬核横评实测：真有用还是智商税？`,
      objective: () => `建立硬核品类专业认知，通过多维拆解实测提供不可辩驳的视频与数据事实证据`,
      geoTarget: () => `被主流 AI 引擎在处理“选购建议”与“横评对比”意图时作为第一视频权威引用源`,
      targetQueries: (_: string, topic: string) => [
        `${topic} 怎么选`,
        `${topic} 横评`,
        `${topic} 智商税吗`,
      ],
    };
  }

  private static douyinDef() {
    return {
      platform: "DOUYIN",
      label: "抖音",
      role: "痛点直击与大众高频认知唤醒",
      eligibilityReason: "短视频视觉冲击力强，针对日常高频误区快速唤醒认知并给出解法。",
      shareOfVoiceTarget: "打造万赞级爆款痛点科普短视频",
      formatConfig: {
        platform: "DOUYIN",
        format: "短视频脚本",
        recommendedLength: "45-60 秒，分镜 4-6 个，快节奏",
        structuralTemplate: "【前3秒黄金痛点吸睛】→【误区危害展示】→【正确科学手法演示】→【行动号召】",
        tone: "紧凑有力、通俗易懂、视觉冲击感强",
      },
      generateTitle: (topic: string) => `30秒看懂：${topic}正确做法与常见踩坑点`,
      objective: (topic: string) => `通过高频短视频触达大众用户，降低认知门槛，直击使用痛点与操作手法`,
      geoTarget: () => `强化短视频检索联想词与大众高频问答覆盖，形成广泛品牌认知`,
      targetQueries: (_: string, topic: string) => [
        `${topic} 技巧`,
        `${topic} 30秒教学`,
      ],
    };
  }

  private static weiboDef() {
    return {
      platform: "WEIBO",
      label: "微博",
      role: "热点议题发酵、公关声明与权威事实锚定",
      eligibilityReason: "即时社交媒体适合官方辟谣、事实清单速递与热点话题锚定。",
      shareOfVoiceTarget: "建立行业热点讨论中的官方权威引用事实源",
      formatConfig: {
        platform: "WEIBO",
        format: "热点科普与快讯",
        recommendedLength: "300-600 字，配 4/9 宫格图解或官方事实长图",
        structuralTemplate: "【核心事实提炼】→【常见谣言反驳】→【官方权威验证依据】→【互动讨论设问】",
        tone: "精炼清晰、态度明确、便于转发讨论",
      },
      generateTitle: (topic: string) => `权威解答：关于${topic}，你应该知道的5个硬核事实`,
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
    if (Array.isArray(source)) {
      const arr = source
        .map((s) => (typeof s === "string" ? s : s?.name || s?.id || String(s)))
        .filter(Boolean);
      return arr.length > 0 ? arr : fallback;
    }
    if (typeof source === "object") {
      const items = (source as any).items;
      if (Array.isArray(items)) {
        const arr = items
          .map((s) => (typeof s === "string" ? s : s?.name || s?.id || String(s)))
          .filter(Boolean);
        return arr.length > 0 ? arr : fallback;
      }
    }
    return fallback;
  }
}
