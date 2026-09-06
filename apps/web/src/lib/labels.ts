/**
 * UX-CN：GeoLens 全站中文文案字典（唯一事实来源）
 *
 * 设计约束（重要）：
 * - DB enum / API 字段 / 模型名 / 版本标识 / 原始数据一律保持英文原值，
 *   只在 UI 层用这里的 formatter 转成中文展示，避免“数据库国际化污染”。
 * - 需要技术原值可追溯的地方，用 withRaw() 输出「中文（raw）」并列。
 * - 本文件为纯 TS（无 React 依赖），Server Component 与 Client Component 均可引入。
 */

type Dict = Record<string, string>;

const lookup = (dict: Dict, value: string | null | undefined): string | null => {
  if (!value) return null;
  return dict[value] ?? dict[value.toUpperCase()] ?? dict[value.toLowerCase()] ?? null;
};

/** 中文（英文原值）并列展示：用于需要保留技术事实的字段。 */
export const withRaw = (label: string, raw: string | null | undefined): string =>
  raw && raw !== label ? `${label}（${raw}）` : label;

const fallback = (label: string | null, raw: string | null | undefined): string =>
  label ?? (raw ? String(raw) : "未知");

/* ------------------------------------------------------------------ */
/* 运行状态 / 分析状态                                                   */
/* ------------------------------------------------------------------ */

const RUN_STATUS: Dict = {
  PENDING: "等待中",
  QUEUED: "已排队",
  RUNNING: "运行中",
  RETRYING: "重试中",
  SUCCEEDED: "成功",
  FAILED: "失败",
  PARTIAL: "部分完成",
  CANCELLED: "已取消",
};

const ANALYSIS_STATUS: Dict = {
  PENDING: "等待分析",
  QUEUED: "分析排队中",
  RUNNING: "分析中",
  RETRYING: "分析重试中",
  SUCCEEDED: "分析完成",
  FAILED: "分析失败",
  SKIPPED: "已跳过",
  MISSING: "缺少分析",
};

export const formatStatus = (value: string | null | undefined): string =>
  fallback(lookup(RUN_STATUS, value), value);

export const formatAnalysisStatus = (value: string | null | undefined): string =>
  fallback(lookup(ANALYSIS_STATUS, value), value);

/* ------------------------------------------------------------------ */
/* 里程碑 / Gate / 项目状态（Control Center 与项目卡片共用）              */
/* ------------------------------------------------------------------ */

const PROGRESS_STATUS: Dict = {
  DONE: "已完成",
  PASS: "通过",
  "N/A": "不适用",
  IN_PROGRESS: "进行中",
  NOT_STARTED: "未开始",
  BLOCKED: "已阻塞",
};

export const formatProgressStatus = (value: string | null | undefined): string =>
  fallback(lookup(PROGRESS_STATUS, value), value);

const PROJECT_STATUS: Dict = {
  ACTIVE: "已启用",
  ARCHIVED: "已归档",
  DRAFT: "草稿",
  DISABLED: "未启用",
};

export const formatProjectStatus = (value: string | null | undefined): string =>
  fallback(lookup(PROJECT_STATUS, value), value);

const ORG_ROLE: Dict = { OWNER: "拥有者", ADMIN: "管理员", MEMBER: "成员", VIEWER: "只读成员" };

export const formatRole = (value: string | null | undefined): string =>
  fallback(lookup(ORG_ROLE, value), value);

/* ------------------------------------------------------------------ */
/* 竞品发现（M6B）                                                       */
/* ------------------------------------------------------------------ */

const CANDIDATE_STATUS: Dict = {
  DISCOVERED: "待审核",
  APPROVED: "已确认",
  REJECTED: "已排除",
};

const COMPETITOR_TYPE: Dict = {
  UNKNOWN: "未分类",
  DIRECT: "直接竞品",
  ADJACENT: "相邻产品",
  SUBSTITUTE: "替代方案",
  NON_COMPETITOR: "非竞对",
};

const SET_STATUS: Dict = {
  DRAFT: "草稿",
  ACTIVE: "已启用",
  ARCHIVED: "已归档",
};

export const formatCandidateStatus = (value: string | null | undefined): string =>
  fallback(lookup(CANDIDATE_STATUS, value), value);

export const formatCompetitorType = (value: string | null | undefined): string =>
  fallback(lookup(COMPETITOR_TYPE, value), value);

export const formatSetStatus = (value: string | null | undefined): string =>
  fallback(lookup(SET_STATUS, value), value);

/** 竞品类型可选值（Approve 时必须人工显式选择） */
export const COMPETITOR_TYPE_OPTIONS = [
  { value: "DIRECT", label: COMPETITOR_TYPE.DIRECT },
  { value: "ADJACENT", label: COMPETITOR_TYPE.ADJACENT },
  { value: "SUBSTITUTE", label: COMPETITOR_TYPE.SUBSTITUTE },
] as const;

/* ------------------------------------------------------------------ */
/* 数据来源 / 检索模式 / 运行类型（保留 raw 值可并列）                     */
/* ------------------------------------------------------------------ */

const SOURCE_TYPE: Dict = {
  official_api: "官方 API",
  browser: "浏览器",
  third_party_api: "第三方 API",
  manual: "手工录入",
  mock: "模拟数据",
  estimated: "估算数据",
  demo: "演示数据",
  unknown: "未知",
};

const RETRIEVAL_MODE: Dict = {
  api_plain: "API 普通对话（非联网搜索）",
  web_search: "联网搜索",
  unknown: "未知",
};

const RUN_TYPE: Dict = { DEMO: "演示", REAL: "真实" };

const METRIC_SOURCE: Dict = { demo: "演示数据", real: "真实数据", mixed: "混合数据" };

export const formatSourceType = (value: string | null | undefined): string =>
  fallback(lookup(SOURCE_TYPE, value), value);

export const formatRetrievalMode = (value: string | null | undefined): string =>
  fallback(lookup(RETRIEVAL_MODE, value), value);

export const formatRunType = (value: string | null | undefined): string =>
  fallback(lookup(RUN_TYPE, value), value);

export const formatMetricSource = (value: string | null | undefined): string =>
  fallback(lookup(METRIC_SOURCE, value), value);

export const isMockEvidence = (sourceType: string | null | undefined): boolean =>
  String(sourceType ?? "").toLowerCase() === "mock" || String(sourceType ?? "").toLowerCase() === "demo";

/* ------------------------------------------------------------------ */
/* Benchmark 场景分类                                                    */
/* ------------------------------------------------------------------ */

const CATEGORY: Dict = {
  "tool-discovery": "工具发现",
  comparison: "比较选择",
  workflow: "任务流程",
  recommendation: "明确推荐",
  "pain-point": "痛点驱动",
  competition: "赛事场景",
  "sanity-control": "品牌控制检查",
};

export const formatCategory = (value: string | null | undefined): string =>
  fallback(lookup(CATEGORY, value), value);

/* ------------------------------------------------------------------ */
/* 指标名称 / 情感 / 实体类型                                             */
/* ------------------------------------------------------------------ */

const METRICS: Dict = {
  visibilityRate: "品牌可见率",
  recommendationRate: "推荐率",
  averageMentionPosition: "平均提及位置",
  shareOfVoice: "AI 声量份额",
  citationCount: "引用次数",
  citationDomainCount: "引用域名数",
  sentimentDistribution: "情感分布",
  mentionPosition: "提及位置",
  brandMentioned: "是否提及品牌",
  recommended: "是否被推荐",
  totalRuns: "运行总数",
  successfulRuns: "成功运行数",
  failedRuns: "失败运行数",
  cancelledRuns: "取消运行数",
  analyzedRuns: "已分析运行数",
  analysisMissingRuns: "缺少分析数",
  queryEligibleCount: "有效问题数",
  queryMentionedCount: "被提及问题数",
  eligibleEvidence: "可用证据数",
  evidenceCount: "证据数",
  queryCount: "问题覆盖数",
  mentionCount: "提及次数",
  recommendationCount: "推荐次数",
};

const SENTIMENT: Dict = {
  positive: "正面",
  neutral: "中性",
  negative: "负面",
  unknown: "未知",
};

const ENTITY_TYPE: Dict = { brand: "品牌", competitor: "竞品", competitor_candidate: "候选竞品" };

export const formatMetricName = (value: string | null | undefined): string =>
  fallback(lookup(METRICS, value), value);

export const formatSentiment = (value: string | null | undefined): string =>
  fallback(lookup(SENTIMENT, value), value);

export const formatEntityType = (value: string | null | undefined): string =>
  fallback(lookup(ENTITY_TYPE, value), value);

export const formatBoolean = (value: boolean | null | undefined): string =>
  value == null ? "—" : value ? "是" : "否";

/* ------------------------------------------------------------------ */
/* Control Center 系统状态（技术名 Web/API/Worker/PID 保留）             */
/* ------------------------------------------------------------------ */

const SYSTEM_STATE: Dict = {
  running: "运行中",
  healthy: "正常",
  ready: "就绪",
  starting: "启动中",
  pass: "通过",
  fail: "未通过",
  configured: "已配置",
  not_configured: "未配置",
  enabled: "已启用",
  disabled: "未启用",
  down: "已停止",
  unknown: "未知",
};

export const formatSystemState = (value: string | null | undefined): string =>
  fallback(lookup(SYSTEM_STATE, value), value);

/* ------------------------------------------------------------------ */
/* 空状态 / 错误提示                                                     */
/* ------------------------------------------------------------------ */

export const EMPTY_TEXT = {
  runs: "暂无检测记录",
  evidence: "暂无证据",
  benchmarkRuns: "暂无基准测试记录",
  candidates: "暂未发现候选竞品",
  activeSet: "尚未启用竞品集合",
  projects: "暂无可访问的项目",
  queries: "该项目暂无检测问题",
  engines: "暂无可用的检测引擎",
  analyses: "暂无已分析结果",
  sets: "暂无竞品集合",
} as const;

const ERROR_MAP: Array<[RegExp, string]> = [
  [/invalid credentials|unauthorized|未授权|401/i, "邮箱或密码错误，或登录状态已失效"],
  [/forbidden|403/i, "无权访问该资源"],
  [/not found|404/i, "请求的数据不存在或无权访问"],
  [/bad request|400/i, "请求参数有误，请检查后重试"],
  [/internal server error|500/i, "服务器内部错误，请稍后重试"],
  [/network|fetch failed|econnrefused|timeout/i, "网络或服务不可用，请稍后重试"],
  [/tenant|organization|project.*denied/i, "无权访问该项目"],
];

/**
 * 用户可见错误：英文原样技术信息保留到控制台（便于排查），
 * UI 只展示中文友好文案，但不吞掉原始信息。
 */
export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return "操作失败，请稍后重试。";
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw; // 后端已给中文
  for (const [pattern, text] of ERROR_MAP) {
    if (pattern.test(raw)) {
      if (typeof console !== "undefined") console.warn("[GeoLens] 原始错误信息：", raw);
      return text;
    }
  }
  if (typeof console !== "undefined") console.warn("[GeoLens] 原始错误信息：", raw);
  return "操作失败，请稍后重试。";
}

/* ------------------------------------------------------------------ */
/* 导航                                                                  */
/* ------------------------------------------------------------------ */

export const NAV_LABELS = {
  dashboard: "工作台",
  monitor: "GEO 监测",
  benchmark: "GEO 基准测试",
  competitors: "竞品分析",
  evidence: "证据",
  project: "项目",
  logout: "退出登录",
  settings: "设置",
  backToDashboard: "← 返回工作台",
} as const;

/* ---------------------------------------------------------------
 * M7A — GEO 问题诊断（Diagnosis / Finding / Severity 中文映射）
 * ---------------------------------------------------------------- */
export const DIAGNOSIS_VERSION_LABEL = "geolens-diagnosis-v1";

export const FINDING_TYPE: Dict = {
  LOW_VISIBILITY: "品牌整体可见度偏低",
  LOW_RECOMMENDATION: "品牌推荐表现偏弱",
  CATEGORY_GAP: "场景缺口",
  QUERY_GAP: "问题缺口",
  PROVIDER_GAP: "模型表现差异",
  COMPETITOR_DOMINANCE: "竞品曝光优势明显",
  COMPETITOR_RECOMMENDED_TARGET_ABSENT: "竞品被推荐但品牌缺席",
  POOR_MENTION_POSITION: "品牌提及位置偏后",
  CITATION_GAP: "引用信号不足",
  SENTIMENT_RISK: "情感风险",
  DATA_QUALITY_WARNING: "数据质量提示",
};
export const formatFindingType = (value: string | null | undefined): string =>
  fallback(lookup(FINDING_TYPE, value), value);

export const SEVERITY_LABEL: Dict = {
  HIGH: "高优先级",
  MEDIUM: "中优先级",
  LOW: "低优先级",
  INFO: "提示",
};
export const formatSeverity = (value: string | null | undefined): string =>
  fallback(lookup(SEVERITY_LABEL, value), value);

export const SEVERITY_BADGE: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800",
  MEDIUM: "bg-amber-100 text-amber-800",
  LOW: "bg-blue-100 text-blue-800",
  INFO: "bg-slate-100 text-slate-600",
};

export const DIAGNOSIS_NAV = {
  reports: "GEO 基准测试报告",
  diagnosis: "问题诊断",
  generate: "生成 GEO 问题诊断",
  view: "查看问题诊断",
  list: "GEO 问题诊断",
  detail: "GEO 问题诊断详情",
  project: "项目",
  sourceReport: "来源报告",
  diagnosisVersion: "诊断版本",
  dataType: "数据类型",
  generatedAt: "生成时间",
  prioritySummary: "问题优先级分布",
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
  info: "提示",
  findingCount: "诊断项",
  noDiagnosis: "暂无问题诊断",
  emptyHint: "选择一个已完成报告并点击「生成 GEO 问题诊断」。",
  internalPriority: "GeoLens 内部优先级评分（0–100，确定性规则）",
  demoDiagnosis: "演示诊断",
  viewEvidence: "查看证据",
  internalHeuristic: "阈值属 GeoLens internal heuristic，非行业标准、非 LLM 因果推断。",
} as const;

/* ---------------------------------------------------------------
 * M7B — GEO 优化建议（Optimization Recommendations / Action Items）
 * ---------------------------------------------------------------- */
export const RECOMMENDATION_VERSION_LABEL = "geolens-recommendation-v1";

export const RECOMMENDATION_TYPE: Dict = {
  ENTITY_CLARITY: "品牌实体清晰度",
  POSITIONING_CLARITY: "产品定位清晰度",
  CATEGORY_COVERAGE: "场景覆盖",
  QUERY_COVERAGE: "用户问题覆盖",
  RECOMMENDATION_READINESS: "可推荐性准备",
  COMPETITOR_DIFFERENTIATION: "竞品差异化",
  CITATION_READINESS: "可引用信息准备",
  STRUCTURED_INFORMATION: "信息结构优化",
  PROVIDER_COVERAGE: "模型覆盖优化",
  SENTIMENT_RESPONSE: "情感风险处理",
  DATA_COLLECTION: "数据补充",
};
export const formatRecommendationType = (value: string | null | undefined): string =>
  fallback(lookup(RECOMMENDATION_TYPE, value), value);

export const RECOMMENDATION_PRIORITY: Dict = { HIGH: "高", MEDIUM: "中", LOW: "低" };
export const formatRecommendationPriority = (value: string | null | undefined): string =>
  fallback(lookup(RECOMMENDATION_PRIORITY, value), value);

export const RECOMMENDATION_STATUS: Dict = {
  PROPOSED: "待处理", ACCEPTED: "已采纳", DISMISSED: "已忽略",
};
export const formatRecommendationStatus = (value: string | null | undefined): string =>
  fallback(lookup(RECOMMENDATION_STATUS, value), value);

export const ACTION_STATUS: Dict = {
  TODO: "待办", IN_PROGRESS: "进行中", DONE: "已完成", SKIPPED: "已跳过",
};
export const formatActionStatus = (value: string | null | undefined): string =>
  fallback(lookup(ACTION_STATUS, value), value);

export const ACTION_TYPE: Dict = {
  UPDATE_PRODUCT_DEFINITION: "更新产品定义",
  CLARIFY_TARGET_AUDIENCE: "明确目标用户",
  CLARIFY_CORE_USE_CASES: "明确核心使用场景",
  ADD_SCENARIO_COVERAGE: "补充场景覆盖",
  ADD_COMPARISON_INFORMATION: "补充比较信息",
  ADD_FAQ_STRUCTURE: "补充 FAQ 结构",
  ADD_EVIDENCE_AND_PROOF: "补充证据与案例",
  ADD_SOURCE_ATTRIBUTION: "补充来源归属",
  ADD_ENTITY_CONSISTENCY: "补充实体一致性",
  ADD_COMPETITOR_DIFFERENTIATION: "补充竞品差异化",
  ADD_PROVIDER_RELEVANT_CONTENT: "补充模型相关场景内容",
  REVIEW_NEGATIVE_SIGNAL: "复核负面信号",
  COLLECT_MORE_DATA: "补充更多数据",
};
export const formatActionType = (value: string | null | undefined): string =>
  fallback(lookup(ACTION_TYPE, value), value);

export const EXPECTED_SIGNAL: Dict = {
  VISIBILITY: "品牌可见率",
  RECOMMENDATION: "推荐率",
  MENTION_POSITION: "平均提及位置",
  CITATION: "引用信号",
  COMPETITOR_SOV: "竞品 AI 声量份额",
  ENTITY_UNDERSTANDING: "实体理解",
  CATEGORY_COVERAGE: "场景覆盖",
};
export const formatExpectedSignal = (value: string | null | undefined): string =>
  fallback(lookup(EXPECTED_SIGNAL, value), value);

export const TARGET_ASSET: Dict = {
  HOMEPAGE: "首页",
  PRODUCT_PAGE: "产品页",
  FEATURE_PAGE: "功能页",
  USE_CASE_PAGE: "用例页",
  FAQ: "FAQ",
  CASE_STUDY: "案例页",
  COMPARISON_PAGE: "对比页",
  ABOUT_PAGE: "关于页",
  DOCUMENTATION: "文档",
  STRUCTURED_DATA: "结构化信息",
  OTHER: "其他",
};
export const formatTargetAsset = (value: string | null | undefined): string =>
  fallback(lookup(TARGET_ASSET, value), value);

export const IMPACT_AREA: Dict = {
  ENTITY: "实体理解",
  POSITIONING: "产品定位",
  CONTENT_COVERAGE: "场景覆盖",
  RECOMMENDATION: "推荐能力",
  COMPETITIVE: "竞品差异化",
  CITATION: "引用准备",
  STRUCTURE: "信息结构",
  PROVIDER: "模型覆盖",
  SENTIMENT: "情感风险",
  DATA_QUALITY: "数据质量",
};
export const formatImpactArea = (value: string | null | undefined): string =>
  fallback(lookup(IMPACT_AREA, value), value);

export const EFFORT_LEVEL: Dict = { LOW: "低", MEDIUM: "中", HIGH: "高" };
export const formatEffortLevel = (value: string | null | undefined): string =>
  fallback(lookup(EFFORT_LEVEL, value), value);

export const RECOMMENDATION_NAV = {
  list: "GEO 优化建议",
  detail: "优化建议详情",
  generate: "生成优化建议",
  view: "查看优化建议",
  noRun: "暂无优化建议",
  emptyHint: "先在 GEO 问题诊断中为报告生成诊断，再基于诊断生成优化建议。",
  summary: "建议优先级分布",
  directions: "主要优化方向",
  rationale: "为什么",
  findingCount: "来源诊断数",
  evidenceCount: "证据数",
  impactArea: "影响方向",
  targetAsset: "优化对象",
  expectedSignal: "预期影响指标",
  effort: "工作量",
  status: "状态",
  actionItems: "行动项",
  actionCount: "行动项数",
  viewBasis: "查看依据",
  viewActions: "查看行动项",
  accept: "采纳",
  dismiss: "忽略",
  factLabel: "事实诊断",
  recLabel: "优化建议",
  disclaimer: "以下建议基于 GeoLens 确定性规则与当前诊断结果生成，属于优化假设（非因果证明、非效果承诺），需要后续通过复测验证效果。",
  internalScore: "GeoLens 内部优先级评分（0–100，确定性规则）",
  verification: "验证方式",
} as const;

/* ---------------------------------------------------------------
 * M7C — 内容机会（Content Opportunity / 标题方向 / 结构块 / Intent）
 * ---------------------------------------------------------------- */
export const OPPORTUNITY_VERSION_LABEL = "geolens-content-opportunity-v1";

/** Opportunity Type（内容机会类型 ≈ 建议资产类型；中文映射归本字典） */
export const OPPORTUNITY_TYPE: Dict = {
  ENTITY_OVERVIEW: "实体总览内容",
  PRODUCT_PAGE: "产品页内容",
  FEATURE_PAGE: "功能页内容",
  USE_CASE_PAGE: "用例页内容",
  COMPARISON_PAGE: "对比页内容",
  FAQ_PAGE: "FAQ 内容",
  GUIDE: "指南内容",
  CASE_STUDY: "案例内容",
  DATA_REFERENCE: "数据参考内容",
  DOCUMENTATION: "文档内容",
  CLARIFICATION_CONTENT: "澄清说明内容",
  CONTENT_REFRESH: "内容更新",
  OTHER: "其他内容",
};
export const formatOpportunityType = (value: string | null | undefined): string =>
  fallback(lookup(OPPORTUNITY_TYPE, value), value);

/** 建议资产类型（opportunityType 也视为 assetType；覆盖 TARGET_ASSET 未含值） */
export const OPPORTUNITY_ASSET: Dict = {
  ...OPPORTUNITY_TYPE,
  HOMEPAGE: "首页",
  ABOUT_PAGE: "关于页",
  STRUCTURED_DATA: "结构化信息",
};
export const formatOpportunityAsset = (value: string | null | undefined): string =>
  fallback(lookup(OPPORTUNITY_ASSET, value), value);

/** Content Intent（内容意图；DB 英文原值，UI 中文） */
export const CONTENT_INTENT: Dict = {
  DISCOVERY: "工具发现",
  RECOMMENDATION: "推荐选择",
  COMPARISON: "横向对比",
  EVALUATION: "决策评估",
  HOW_TO: "使用方法",
  PROBLEM_SOLVING: "问题解决",
  AUTHORITY: "权威信息",
  CLARIFICATION: "事实澄清",
  INFORMATIONAL: "信息说明",
};
export const formatContentIntent = (value: string | null | undefined): string =>
  fallback(lookup(CONTENT_INTENT, value), value);

export const OPPORTUNITY_STATUS: Dict = {
  PROPOSED: "待评估",
  APPROVED: "已规划",
  DISMISSED: "已忽略",
};
export const formatOpportunityStatus = (value: string | null | undefined): string =>
  fallback(lookup(OPPORTUNITY_STATUS, value), value);

export const formatOpportunityPriority = (value: string | null | undefined): string =>
  formatRecommendationPriority(value);

export const OPPORTUNITY_NAV = {
  list: "内容机会",
  detail: "内容机会详情",
  generate: "生成内容机会",
  view: "查看内容机会",
  titleDirectionHint: "标题方向（非最终发布标题）",
  empty: "还没有内容机会",
  emptyHint: "请先从 GEO 优化建议生成内容机会，系统会根据 Query 缺口、竞品信号和 Evidence 整理可执行的内容方向。",
  emptyDataLimited: "当前诊断数据不足，建议先补充真实检测样本，再决定高成本内容建设。",
  backToRecommendations: "← 返回优化建议",
  sourceRecommendations: "来源优化建议",
  sourceFindings: "来源诊断",
  why: "为什么这是一个机会？",
  whyHint: "以下内容机会由 GeoLens 根据当前诊断与优化建议确定性生成，用于指导后续内容建设。它并不保证 GEO 指标提升，实际效果需要在 M7D 使用相同 Benchmark 复测验证。",
  targetQueries: "目标 Query",
  suggestedStructure: "建议内容结构",
  suggestedStructureHint: "仅为建议结构块（标题 + 用途），不是正文。",
  evidenceSection: "证据",
  viewRawEvidence: "查看原始证据",
  viewSourceRecommendation: "查看来源建议",
  demoLabel: "演示内容机会 —— 不伪装真实客户策略",
  realLabel: "真实数据内容机会",
  internalScore: "GeoLens 内部优先级评分（0–100，确定性规则）",
  blockPurpose: "用途",
  queryColumns: {
    question: "监测问题",
    category: "场景",
    intent: "Intent",
    engines: "涉及模型",
    brandAbsent: "品牌是否缺席",
    competitorSignal: "竞品信号",
    evidenceCount: "证据数",
  },
  noCompetitor: "无已审核竞品关联",
  noCitation: "当前证据未观察到引用",
  experimentHint: "实验与复测将在下一阶段（M7D）开放",
  generateFirst: "生成内容机会",
  noneHint: "该优化建议还没有内容机会。",
} as const;
