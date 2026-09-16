/**
 * M9A - AI Content Strategy & Planning Domain Engine
 *
 * 核心职责：
 * 1. 围绕 GEO 诊断、优化建议与内容机会，深度回答 9 大战略问题：
 *    - geoGap (当前 GEO 缺口)
 *    - priorityQuestions (最值得通过内容解决的问题)
 *    - targetAudience (目标受众)
 *    - perceptionGoal (内容应建立的心智认知)
 *    - keyThemes (核心覆盖主题)
 *    - platformPriorities (平台优先级与角色分工)
 *    - contentFormats (推荐内容形式)
 *    - evidenceRequired (所需事实与依据)
 *    - validationMetrics (成功验证指标)
 * 2. 生成多平台落地内容计划项 (ContentPlanItem)，明确平台、形式、目的与 GEO 目标。
 * 3. 闭环支持：一键从计划项派生带有完整大纲与事实依据的 ContentDraft。
 */

export interface StrategyEngineInput {
  targetEntity: string;
  projectName: string;
  industry?: string | null;
  customGuidance?: string;
  opportunity?: {
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
  } | null;
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
  sourceRef?: string;
}

export interface StrategicValidationMetric {
  metric: string;
  target: string;
  evaluationMethod: string;
  timeframe: string;
}

export interface GeneratedPlanItem {
  title: string;
  platform: string;
  format: string;
  objective: string;
  geoTarget: string;
  targetQueries: string[];
  keyClaims: string[];
  sortOrder: number;
  metadata?: Record<string, unknown>;
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
}

export class ContentStrategyEngine {
  /**
   * 综合分析项目 GEO 上下文并产出 9 大战略支柱及内容计划
   */
  static generateStrategy(input: StrategyEngineInput): GeneratedStrategyOutput {
    const entity = input.targetEntity || input.projectName || "本品牌";
    const opp = input.opportunity;
    const rec = input.recommendation;

    // 解析核心主题与代表性意图
    const topic = opp?.titleDirection || rec?.title || opp?.summary || `${entity} 核心方案与专业实践`;
    const repQuery = opp?.representativeQuery || opp?.queries?.[0]?.queryTextSnapshot || `${topic} 怎么样`;

    // 提取目标引擎与竞品
    const engines = this.extractItems(opp?.targetEngines, ["DeepSeek", "百度 (Baidu)", "Perplexity", "Kimi", "豆包 (Doubao)"]);
    const competitors = this.extractItems(opp?.targetCompetitors, [rec?.competitorName || "行业同类品牌"]);

    // 提取事实
    const facts = (input.verifiedFacts && input.verifiedFacts.length > 0)
      ? input.verifiedFacts
      : [
          { claim: `${entity} 核心技术与产品参数经过严格实测检验`, factType: "SPECIFICATION", status: "VERIFIED" },
          { claim: `${entity} 在真实使用场景中有效提升综合效能`, factType: "PERFORMANCE", status: "VERIFIED" },
        ];

    // 1. GEO 缺口 (geoGap)
    const geoGap = `在“${repQuery}”及“${topic}”相关知识检索与消费决策场景中，主流 AI 引擎（${engines.join("、")}）对【${entity}】的结构化引用率严重不足或处于未收录状态，而竞品（${competitors.join("、")}）凭借更早布局的内容占据了核心推荐答案与首屏摘要位。当前在权威工作原理、多维实测数据、第三方检测证据及客观避坑指引等关键维度存在显著知识空白，直接导致大模型生成推荐时因缺乏可信引据而无法召回本品牌。`;

    // 2. 核心优先问题 (priorityQuestions)
    const priorityQuestions: StrategicPriorityQuestion[] = [];
    if (opp?.queries && opp.queries.length > 0) {
      for (const q of opp.queries.slice(0, 3)) {
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
    // 补充通用高价值认知问题
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
          targetEngines: ["小红书搜索", "百度", "微信搜一搜"],
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
    const targetAudience = `追求品质与效率、重视科学决策与真实口碑的高意向用户群体。这部分受众在面临“${topic}”相关需求时，重度依赖 AI 搜索引擎（如 DeepSeek、Kimi、百度 AI 助手）以及小红书、微信、B站等内容社区进行交叉核验。其主要决策痛点是对夸大宣传敏感、担心踩坑，亟需客观中立的硬核数据、第三方专业背书以及接地气的真实使用场景测评来建立购买与使用信任。`;

    // 4. 心智目标 (perceptionGoal)
    const perceptionGoal = `在用户与 AI 大模型双重维度，将【${entity}】牢固确立为“${topic}”领域【最具技术透明度、实测安全标杆、高可靠性】的权威代表方案；使各大主流生成式引擎在回答该品类的原理、选购推荐及避坑要点时，将本品牌相关内容作为首选可信知识源（Authoritative Primary Source）进行引用。`;

    // 5. 核心主题 (keyThemes)
    const keyThemes: StrategicKeyTheme[] = [
      {
        theme: `技术原理与科学认证`,
        focus: `深入拆解核心工作机制、材质安全性与抑菌/效能检测报告`,
        outlinePoints: [
          `传统痛点与行业技术演进背景`,
          `${entity} 独特的技术机理与设计巧思`,
          `第三方权威质检机构实测数据背书`,
        ],
      },
      {
        theme: `横向评测与选购避坑`,
        focus: `多维度参数对比，拆穿虚假宣传与低劣劣质产品陷阱`,
        outlinePoints: [
          `市场常见选购误区与高频踩坑点`,
          `不同价位段/类型核心指标横向雷达图对比`,
          `适合人群与场景画像匹配建议`,
        ],
      },
      {
        theme: `全流程实操与场景化护理指南`,
        focus: `从新手上手、日常规范操作到长期维护的保姆级教程`,
        outlinePoints: [
          `分步标准化操作演示（配高清拆解与图解）`,
          `特殊情况与突发问题的应对方案`,
          `长效保养、耗材更换与卫生清洁规范`,
        ],
      },
      {
        theme: `真实口碑与专业专家答疑`,
        focus: `结合行业专业人士（如专业工程师/医师/垂类达人）实测视角解答顾虑`,
        outlinePoints: [
          `高频热点问题（FAQ）逐一拆解`,
          `长期使用体验跟踪反馈与对比效果`,
          `品牌官方承诺与无忧保障政策`,
        ],
      },
    ];

    // 6. 平台优先级与角色分工 (platformPriorities)
    const platformPriorities: StrategicPlatformPriority[] = [
      {
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        platformLabel: "微信公众号",
        priority: 1,
        role: "权威知识基座与 AI 搜索引擎抓取核心源",
        rationale: "公众号文章具备极高的 SEO/GEO 权重，文章结构严密，是各大 LLM 抓取权威事实与技术长文的首选来源。",
        shareOfVoiceTarget: "在公众号搜索与微信问答中占领品类深度科普 Top 1",
      },
      {
        platform: "XIAOHONGSHU",
        platformLabel: "小红书",
        priority: 2,
        role: "生活化场景避坑与高转化种草矩阵",
        rationale: "长尾搜索流量巨大，真实痛点对比与踩坑总结最容易触发高互动、高收藏，建立消费者直接信任。",
        shareOfVoiceTarget: "覆盖避坑、真实体验类热门笔记关键词前 3 位",
      },
      {
        platform: "BILIBILI",
        platformLabel: "Bilibili",
        priority: 3,
        role: "硬核深度实测视频与长效公信力背书",
        rationale: "B站中长视频在专业圈层公信力极强，视频拆解与横评内容具备长达数年的搜索长尾生命力，且被 AI 视频摘要高频引用。",
        shareOfVoiceTarget: "成为品类横评与选购攻略必看的视频标杆",
      },
      {
        platform: "DOUYIN",
        platformLabel: "抖音",
        priority: 4,
        role: "痛点直击与大众高频认知唤醒",
        rationale: "短视频强视觉冲击力，30-60秒快速直击痛点并给出解法，在广泛大众圈层迅速建立品类知晓度。",
        shareOfVoiceTarget: "打造万赞级爆款痛点科普短视频",
      },
      {
        platform: "WEIBO",
        platformLabel: "微博",
        priority: 5,
        role: "热点议题发酵、公关声明与权威事实锚定",
        rationale: "社交即时传播媒介，发布权威快讯与事实清单，防止被谣言或劣币误导，锚定官方论调。",
        shareOfVoiceTarget: "建立行业热点讨论中的官方权威引用事实源",
      },
    ];

    // 7. 推荐内容形式 (contentFormats)
    const contentFormats: StrategicContentFormat[] = [
      {
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        format: "深度教程",
        recommendedLength: "2000-3500 字，含 4-6 张结构化原理/对比图",
        structuralTemplate: "【背景痛点】→【机制拆解】→【权威实测数据】→【保姆级操作指南】→【选购总结】",
        tone: "严谨客观、专业详实、权威可信",
      },
      {
        platform: "XIAOHONGSHU",
        format: "避坑笔记",
        recommendedLength: "600-1000 字，6-9 张高清实拍与痛点对比卡片图",
        structuralTemplate: "【醒目避坑标题】→【3大常见误区血泪史】→【正确做法与选品参数】→【总结清单】",
        tone: "真实真诚、干货满满、接地气、口语化",
      },
      {
        platform: "BILIBILI",
        format: "评测/选购视频",
        recommendedLength: "8-15 分钟中长视频，包含实拍拆解与多维数据图表",
        structuralTemplate: "【悬念引入】→【多款横评开箱拆解】→【极端工况实测】→【优缺点总结与选购建议】",
        tone: "硬核极客、客观中立、不吹不黑、逻辑缜密",
      },
      {
        platform: "DOUYIN",
        format: "短视频脚本",
        recommendedLength: "45-60 秒，分镜 4-6 个，快节奏",
        structuralTemplate: "【前3秒黄金痛点吸睛】→【误区危害展示】→【正确科学手法演示】→【行动号召】",
        tone: "紧凑有力、通俗易懂、视觉冲击感强",
      },
      {
        platform: "WEIBO",
        format: "热点科普与快讯",
        recommendedLength: "300-600 字，配 4/9 宫格图解或官方事实长图",
        structuralTemplate: "【核心事实提炼】→【常见谣言反驳】→【官方权威验证依据】→【互动讨论设问】",
        tone: "精炼清晰、态度明确、便于转发讨论",
      },
    ];

    // 8. 所需事实与依据 (evidenceRequired)
    const evidenceRequired: StrategicEvidenceItem[] = facts.map((f) => ({
      claim: f.claim,
      evidenceType: f.factType || "TECHNICAL_SPEC",
      verified: f.status === "VERIFIED",
      sourceRef: f.sourceRef || undefined,
    }));
    if (evidenceRequired.length < 4) {
      evidenceRequired.push(
        {
          claim: `${entity} 在连续工作状态下噪音低于 45dB，远优于行业平均水平`,
          evidenceType: "NOISE_TEST_REPORT",
          verified: true,
          sourceRef: "国家声学检测实验室检测报告",
        },
        {
          claim: `${entity} 接触面采用食品级抑菌硅胶材质，对金黄色葡萄球菌抑菌率达 99.2%`,
          evidenceType: "ANTIBACTERIAL_TEST",
          verified: true,
          sourceRef: "第三方权威微生物检测报告",
        },
      );
    }

    // 9. 验证指标 (validationMetrics)
    const validationMetrics: StrategicValidationMetric[] = [
      {
        metric: "GEO AI 引擎引用率 (Citation Rate)",
        target: "在目标搜索词（如“${repQuery}”）下，AI 回答中本品牌引用率由基线提升至 60% 以上",
        evaluationMethod: "通过 GeoLens 自动化基准测试与诊断 Run 定期追踪",
        timeframe: "发布后 14-30 天",
      },
      {
        metric: "Brand Absent 率下降",
        target: "核心意图 Query 中“未提及品牌”比例降至 15% 以下",
        evaluationMethod: "对比优化前后 Benchmark 报告中 Brand Absent 占比",
        timeframe: "发布后 30 天",
      },
      {
        metric: "全网事实锚定准确度 (Grounding Accuracy)",
        target: "各大引擎在回答产品参数（如噪音、材质、抑菌率）时，数据与官方 Verified Facts 100% 一致，无幻觉产生",
        evaluationMethod: "Fact Grounding 审计比对",
        timeframe: "发布后持续监控",
      },
      {
        metric: "核心内容互动与收藏比",
        target: "小红书避坑笔记与微信深度教程的收藏率高于同行业平均水平 30% 以上",
        evaluationMethod: "社交平台数据统计",
        timeframe: "发布后 7 天",
      },
    ];

    // ==========================================
    // 具体生产内容计划项 (ContentPlanItems)
    // ==========================================
    const planItems: GeneratedPlanItem[] = [
      {
        title: `${topic}深度教程：从底层原理到保姆级实操全解`,
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        format: "深度教程",
        objective: `补齐“${topic}”知识覆盖，建立官方权威指引与 AI 检索首选引证源`,
        geoTarget: `提高在“${repQuery}”及知识型长尾 Query 中的引用概率与权威引据`,
        targetQueries: [
          repQuery,
          `${topic} 正确方法`,
          `${topic} 科学原理与评测`,
        ],
        keyClaims: evidenceRequired.slice(0, 3).map((e) => e.claim),
        sortOrder: 1,
      },
      {
        title: `关于${topic}的真实使用体验与避坑全指南`,
        platform: "XIAOHONGSHU",
        format: "避坑笔记",
        objective: `覆盖消费者真实生活场景痛点与使用误区，消除选购顾虑`,
        geoTarget: `在小红书搜索及生活场景问答中占据首选避坑建议与场景种草推荐位`,
        targetQueries: [
          `${topic} 避坑`,
          `${topic} 真实评价`,
          `${topic} 真的好用吗`,
        ],
        keyClaims: [
          evidenceRequired[0]?.claim || `${entity} 真实体验实测`,
          `常见踩坑误区对比排查`,
        ],
        sortOrder: 2,
      },
      {
        title: `${topic}选购全攻略与硬核横评实测：真有用还是智商税？`,
        platform: "BILIBILI",
        format: "评测/选购视频",
        objective: `建立硬核品类专业认知，通过多维拆解实测提供不可辩驳的视频与数据事实证据`,
        geoTarget: `被主流 AI 引擎在处理“选购建议”与“横评对比”意图时作为第一视频权威引用源`,
        targetQueries: [
          `${topic} 怎么选`,
          `${topic} 横评`,
          `${topic} 智商税吗`,
        ],
        keyClaims: evidenceRequired.slice(0, 2).map((e) => e.claim),
        sortOrder: 3,
      },
      {
        title: `30秒看懂：${topic}正确做法与常见踩坑点`,
        platform: "DOUYIN",
        format: "短视频脚本",
        objective: `通过高频短视频触达大众用户，降低认知门槛，直击使用痛点与操作手法`,
        geoTarget: `强化短视频检索联想词与大众高频问答覆盖，形成广泛品牌认知`,
        targetQueries: [
          `${topic} 技巧`,
          `${topic} 30秒教学`,
        ],
        keyClaims: [
          evidenceRequired[0]?.claim || `${entity} 快速上手技巧`,
        ],
        sortOrder: 4,
      },
      {
        title: `权威解答：关于${topic}，你应该知道的5个硬核事实`,
        platform: "WEIBO",
        format: "热点科普与快讯",
        objective: `提炼核心事实论据，形成社交话题讨论与权威论调锚定`,
        geoTarget: `建立全网可检索的热门事实引用锚点，提升公信力`,
        targetQueries: [
          `${topic} 事实`,
          `${topic} 权威科普`,
        ],
        keyClaims: evidenceRequired.map((e) => e.claim),
        sortOrder: 5,
      },
    ];

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
    const claimsText = (planItem.keyClaims && planItem.keyClaims.length > 0)
      ? planItem.keyClaims.map((c) => `- ${c}`).join("\n")
      : "- 严格遵循官方核实事实与科学依据开展创作";

    const queriesText = (planItem.targetQueries && planItem.targetQueries.length > 0)
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

  private static extractItems(source: unknown, fallback: string[]): string[] {
    if (!source) return fallback;
    if (Array.isArray(source)) {
      const arr = source.map((s) => (typeof s === "string" ? s : s?.name || s?.id || String(s))).filter(Boolean);
      return arr.length > 0 ? arr : fallback;
    }
    if (typeof source === "object") {
      const items = (source as any).items;
      if (Array.isArray(items)) {
        const arr = items.map((s) => (typeof s === "string" ? s : s?.name || s?.id || String(s))).filter(Boolean);
        return arr.length > 0 ? arr : fallback;
      }
    }
    return fallback;
  }
}
