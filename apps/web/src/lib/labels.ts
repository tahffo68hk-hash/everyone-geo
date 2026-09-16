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

/** Contract version may already include one or more legacy `v` prefixes. */
export const formatVersion = (value: string | null | undefined): string => {
  const normalized = value?.trim().replace(/^v+/i, "") ?? "";
  return `v${normalized || "—"}`;
};

const TOAST_CODE: Dict = {
  DRAFT: "草稿",
  ACTIVE: "已启用",
  ARCHIVED: "已归档",
  APPROVED: "已确认",
  REJECTED: "已排除",
  "mock/demo": "演示或模拟证据",
  estimated: "估算证据",
};

/** Toasts never expose unknown backend enum/code values. */
export const formatToastCode = (value: string | null | undefined, unknown = "操作已完成"): string =>
  lookup(TOAST_CODE, value) ?? unknown;

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
  const code = raw.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/)?.[0];
  if (code === "NO_ENGINE_AVAILABLE") return "当前没有可用的 AI 引擎";
  if (code === "REAL_PROVIDER_UNAVAILABLE") return "当前 Provider 暂不可用";
  if (code === "FACT_CHECK_REQUIRED") {
    return raw.replace(/^FACT_CHECK_REQUIRED:\s*/, "");
  }
  if (code || /^\s*[\[{]/.test(raw) || /\bat\s+\S+\s*\([^)]*:\d+:\d+\)/.test(raw)) {
    if (typeof console !== "undefined") console.warn("[GeoLens] 原始错误信息：", raw);
    return "操作失败，请稍后重试。";
  }
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

/* ---------------------------------------------------------------
 * M7D — 优化实验与复测（Experiment / Retest / Evaluation）
 * ---------------------------------------------------------------- */
export const EXPERIMENT_VERSION_LABEL = "geolens-experiment-v1";
export const EVALUATION_VERSION_LABEL = "geolens-experiment-evaluation-v1";

export const EXPERIMENT_STATUS: Dict = {
  PLANNED: "已规划",
  EXECUTION_RECORDED: "已记录执行",
  RETEST_READY: "待复测",
  RETEST_RUNNING: "复测中",
  READY_FOR_EVALUATION: "待评估",
  EVALUATED: "已评估",
  CANCELLED: "已取消",
};
export const formatExperimentStatus = (value: string | null | undefined): string =>
  fallback(lookup(EXPERIMENT_STATUS, value), value);

export const EXECUTION_TYPE: Dict = {
  MANUAL_CONTENT_UPDATE: "内容更新",
  MANUAL_PAGE_CREATE: "新建页面",
  MANUAL_FAQ_UPDATE: "FAQ 更新",
  MANUAL_DOCUMENTATION_UPDATE: "文档更新",
  MANUAL_OTHER: "其他",
};
export const formatExecutionType = (value: string | null | undefined): string =>
  fallback(lookup(EXECUTION_TYPE, value), value);

export const OUTCOME: Dict = {
  IMPROVED_SIGNALS: "观察到改善",
  MIXED_SIGNALS: "结果混合",
  NO_CLEAR_CHANGE: "未观察到明确变化",
  REGRESSED_SIGNALS: "观察到下降",
  INCONCLUSIVE: "暂无法判断",
};
export const formatOutcome = (value: string | null | undefined): string =>
  fallback(lookup(OUTCOME, value), value);

export const EXPERIMENT_VERDICT: Dict = {
  CONTROLLED_COMPARABLE: "可比（受控）",
  PARTIALLY_COMPARABLE: "部分可比",
  NOT_COMPARABLE: "不可比",
};
export const formatExperimentVerdict = (value: string | null | undefined): string =>
  fallback(lookup(EXPERIMENT_VERDICT, value), value);

export const QUERY_TRANSITION: Dict = {
  GAINED_VISIBILITY: "新增可见",
  LOST_VISIBILITY: "失去可见",
  GAINED_RECOMMENDATION: "新增推荐",
  LOST_RECOMMENDATION: "失去推荐",
  POSITION_IMPROVED: "位置改善",
  POSITION_DECLINED: "位置下降",
  CITATION_GAINED: "引用增加",
  CITATION_LOST: "引用减少",
  UNCHANGED: "无变化",
  MULTIPLE_CHANGES: "多重变化",
  NOT_EVALUABLE: "不可评估",
};
export const formatQueryTransition = (value: string | null | undefined): string =>
  fallback(lookup(QUERY_TRANSITION, value), value);

export const DELTA_DIRECTION: Dict = { IMPROVED: "改善", DECLINED: "下降", NEUTRAL: "无变化" };
export const formatDeltaDirection = (value: string | null | undefined): string =>
  fallback(lookup(DELTA_DIRECTION, value), value);

export const MEANINGFUL: Dict = { MEANINGFUL: "明显", SMALL: "轻微", NEUTRAL: "无" };
export const formatMeaningful = (value: string | null | undefined): string =>
  fallback(lookup(MEANINGFUL, value), value);

/** Evaluation 警告码 → 中文（保留 code 并列便于溯源） */
export const COMPATIBILITY_WARNING: Dict = {
  QUERY_SET_CHANGED: "测试集已变化",
  PROVIDER_CHANGED: "Provider 已变化",
  REQUESTED_MODEL_CHANGED: "请求模型已变化",
  MODEL_DRIFT_WARNING: "模型响应身份变化",
  ANALYSIS_VERSION_CHANGED: "分析规则版本变化",
  COMPETITOR_SET_CHANGED: "竞品集版本变化",
  METRIC_SOURCE_CHANGED: "数据类型变化",
  SUCCESS_COVERAGE_CHANGED: "样本完整性变化",
  EXECUTION_TIME_INVALID: "执行时序无效",
  EXECUTION_MISSING: "执行未记录",
  PARTIAL_RUN: "部分完成",
  UNKNOWN_MODEL_IDENTITY: "模型身份未知",
};
export const formatWarningCode = (code: string | null | undefined, rawMessage?: string | null): string => {
  const zh = fallback(lookup(COMPATIBILITY_WARNING, code), null);
  return zh ? `${zh}${rawMessage ? `：${rawMessage}` : ""}` : rawMessage || code || "未知";
};

/* 指标值/Δ 展示辅助（pp / 位 / count；严禁相对 %） */
export const formatMetricPercent = (value: number | null | undefined): string =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const formatMetricPosition = (value: number | null | undefined): string =>
  value == null ? "—" : `${value} 位`;
export const formatMetricCount = (value: number | null | undefined): string =>
  value == null ? "—" : String(value);

export function formatMetricValue(metricName: string, value: number | null | undefined): string {
  if (metricName === "averageMentionPosition") return formatMetricPosition(value);
  if (metricName === "citationCount" || metricName === "citationDomainCount") return formatMetricCount(value);
  return formatMetricPercent(value);
}

export function formatDeltaText(metricName: string, delta: number | null | undefined, unit: string | null | undefined): string {
  if (delta == null) return "无数据";
  const signed = delta > 0 ? `+${Math.round(delta * 100) / 100}` : `${Math.round(delta * 100) / 100}`;
  if (metricName === "averageMentionPosition") {
    const abs = Math.round(Math.abs(delta) * 10) / 10;
    return delta < 0 ? `提升 ${abs} 位` : delta > 0 ? `后移 ${abs} 位` : "无变化";
  }
  if (unit === "pp") return `${signed}pp`;
  return `${signed}${unit ?? ""}`;
}

export const EXPERIMENT_NAV = {
  list: "优化实验",
  detail: "优化实验详情",
  generate: "创建优化实验",
  view: "查看实验",
  noneHint: "该内容机会还没有优化实验。",
  backToOpportunities: "← 返回内容机会",
  hypothesis: "实验假设",
  baseline: "基线（Before）",
  execution: "执行记录",
  retestPlan: "复测计划",
  observedOutcome: "观察结果",
  beforeAfterKpi: "复测前后关键指标",
  queryDeltaTable: "Query 变化",
  evidenceAB: "证据对照（A/B）",
  attribution: "归因说明",
  attributionDisclaimer:
    "GeoLens 展示的是执行前后复测观察到的变化。生成式 AI 模型、Provider、互联网内容及其他外部因素可能同时发生变化。除非有更严格的控制实验设计，否则这些变化不应被解释为单一优化动作的严格因果证明。",
  observedNotProven: "Observed change ≠ proven causal effect",
  planTitle: "准备复测",
  executionHint: "GeoLens 当前仅记录该执行信息，不会自动修改或验证外部页面。",
  assetReferenceLabel: "执行对象（用户记录）",
  userConfirmed: "执行记录由用户确认。",
  recordExecution: "记录已执行",
  startRetest: "开始复测",
  startDemoRetest: "开始演示复测",
  confirmRealRetest: "确认并开始真实复测",
  noExecutionFirst: "请先记录已完成的优化动作，再开始复测。",
  demoLabel: "演示实验 —— 不伪装真实优化提升",
  realLabel: "真实数据实验",
  demoTip: "演示数据（Mock）—— 结果仅验证闭环，不代表真实 GEO 提升。",
  emptyExperiments: "暂无优化实验",
  emptyHint: "从一个内容机会创建优化实验：先绑定基线报告，再记录执行，最后做同口径 Frozen 复测与评估。",
  evaluationNote: "以下评估为 deterministic rules 生成的观察结果（Observed Outcome），不构成严格因果证明；效果应结合多次 Re-test 与正式验收判断。",
  kpi: {
    visibilityRate: "品牌可见率",
    recommendationRate: "推荐率",
    averageMentionPosition: "平均提及位置",
    shareOfVoice: "AI 声量份额",
    citationCount: "引用次数",
    citationDomainCount: "引用域名数",
  },
  warningsLabel: "口径告警",
  primaryLabel: "主信号",
  secondaryLabel: "次信号",
  notEvaluableLabel: "数据不可用（不等于品牌缺席）",
  latestFirst: "最新在前",
} as const;


/* ---------------------------------------------------------------
 * M8 — 测量有效性 / 站点资产 / 变更计划 / 真实试点
 * ---------------------------------------------------------------- */
export const MEASUREMENT_VERSION_LABEL = "geolens-measurement-v1";
export const CHANGE_PLAN_VERSION_LABEL = "geolens-change-plan-v1";
export const PILOT_REVIEW_VERSION_LABEL = "geolens-pilot-review-v1";

export const MEASUREMENT_VERDICT: Dict = {
  VALID_FOR_WEB_CHANGE: "可验证网页变化",
  PARTIALLY_VALID: "部分有效",
  INVALID_FOR_WEB_CHANGE: "不可验证网页变化",
  UNKNOWN: "未知",
};
export const formatMeasurementVerdict = (value: string | null | undefined): string =>
  fallback(lookup(MEASUREMENT_VERDICT, value), value ?? "未知");

export const MEASUREMENT_MODE: Dict = {
  WEB_VALIDATED: "网页检索已验证",
  MANUAL_VERIFIED: "人工验证（官方 AI Web UI）",
  MODEL_BEHAVIOR_ONLY: "仅模型 API 行为",
  UNKNOWN: "未知",
};
export const formatMeasurementMode = (value: string | null | undefined): string =>
  fallback(lookup(MEASUREMENT_MODE, value), value ?? "未知");

export const TARGET_CHANGE_TYPE: Dict = {
  WEB_CONTENT: "验证网页内容变化",
  MODEL_BEHAVIOR: "观测模型行为",
  UNSPECIFIED: "未指定",
};
export const formatTargetChangeType = (value: string | null | undefined): string =>
  fallback(lookup(TARGET_CHANGE_TYPE, value), value ?? "未指定");

export const SITE_ASSET_STATUS: Dict = { KNOWN: "已知", REMOVED: "已移除", UNKNOWN: "未知" };
export const formatSiteAssetStatus = (value: string | null | undefined): string =>
  fallback(lookup(SITE_ASSET_STATUS, value), value ?? "");

export const SITE_ASSET_SOURCE: Dict = { MANUAL: "人工登记", SITEMAP: "站点地图", CRAWLER: "抓取", IMPORTED: "导入" };
export const formatSiteAssetSource = (value: string | null | undefined): string =>
  fallback(lookup(SITE_ASSET_SOURCE, value), value ?? "");

export const SNAPSHOT_TYPE: Dict = {
  BEFORE_CHANGE: "变更前", AFTER_CHANGE: "变更后", OBSERVED: "观察", MANUAL_IMPORT: "人工录入",
};
export const formatSnapshotType = (value: string | null | undefined): string =>
  fallback(lookup(SNAPSHOT_TYPE, value), value ?? "");

export const ASSET_MAPPING_TYPE: Dict = {
  UPDATE_EXISTING: "更新已有页面",
  CREATE_NEW: "建议新建页面",
  UNKNOWN: "尚未确认目标页面",
};
export const formatAssetMappingType = (value: string | null | undefined): string =>
  fallback(lookup(ASSET_MAPPING_TYPE, value), value ?? "");

export const CHANGE_PLAN_STATUS: Dict = {
  DRAFT: "草稿", APPROVED: "已批准", EXECUTED_MANUALLY: "已执行", CANCELLED: "已取消",
};
export const formatChangePlanStatus = (value: string | null | undefined): string =>
  fallback(lookup(CHANGE_PLAN_STATUS, value), value ?? "");

export const CHANGE_TYPE: Dict = {
  ADD_SECTION: "新增板块",
  UPDATE_SECTION: "更新板块",
  CLARIFY_ENTITY: "澄清实体信息",
  ADD_USE_CASE: "补充用例场景",
  ADD_FAQ: "补充 FAQ",
  ADD_COMPARISON_INFO: "补充对比信息",
  ADD_VERIFIABLE_FACT: "补充可验证事实",
  ADD_SOURCE_REFERENCE: "补充来源引用",
  UPDATE_TITLE: "更新标题",
  UPDATE_METADATA: "更新元数据",
  OTHER: "其他",
};
export const formatChangeType = (value: string | null | undefined): string =>
  fallback(lookup(CHANGE_TYPE, value), value ?? "");

export const PILOT_EXECUTION_VALIDITY: Dict = {
  CHANGE_VERIFIED: "变更已证实",
  CHANGE_NOT_OBSERVED: "未观察到变更",
  NOT_RECORDED: "未记录执行",
};
export const formatExecutionValidity = (value: string | null | undefined): string =>
  fallback(lookup(PILOT_EXECUTION_VALIDITY, value), value ?? "");

export const PILOT_OUTCOME: Dict = {
  VALIDATED_OBSERVATION: "观察到改善",
  MIXED_OBSERVATION: "结果混合",
  NO_CLEAR_OBSERVATION: "未观察到明确变化",
  NEGATIVE_OBSERVATION: "观察到下降",
  INCONCLUSIVE: "暂无法判断",
  INVALID_MEASUREMENT: "测量无效（不可作为网页验证）",
  CHANGE_NOT_VERIFIED: "变更未证实",
};
export const formatPilotOutcome = (value: string | null | undefined): string =>
  fallback(lookup(PILOT_OUTCOME, value), value ?? "");

export const ATTRIBUTION_CONFIDENCE: Dict = { LOW: "低", MEDIUM: "中" };
export const formatAttributionConfidence = (value: string | null | undefined): string =>
  fallback(lookup(ATTRIBUTION_CONFIDENCE, value), value ?? "");

export const PILOT_LESSON_CATEGORY: Dict = {
  PRODUCT: "产品", DIAGNOSIS: "诊断", RECOMMENDATION: "建议",
  CONTENT_OPPORTUNITY: "内容机会", MEASUREMENT: "测量", UX: "体验", DATA: "数据", EXECUTION: "执行", ATTRIBUTION: "归因",
};

export const SITE_NAV = {
  title: "站点资产",
  createSite: "登记站点",
  addAsset: "登记页面",
  captureSnapshot: "抓取快照",
  manualSnapshot: "人工录入快照",
  beforeChange: "记录变更前",
  afterChange: "记录变更后",
  noSite: "还没有站点",
  noSiteHint: "先登记你的站点，再维护页面清单（可手动登记或从 sitemap 导入）。",
  noAsset: "还没有页面资产",
  noAssetHint: "人工登记目标页面，或通过 sitemap 导入站点页面清单。",
  importSitemap: "从站点地图导入",
  columns: { url: "页面", assetType: "资产类型", source: "来源", title: "标题", lastObserved: "最后观察", snapshots: "快照", mappings: "关联机会" },
  urlSafeNote: "仅读取同一站点域名的公开页面；禁止内网/私网/元数据地址。",
  createNew: "建议新建页面",
  updateExisting: "更新已有页面",
  unknown: "尚未确认目标页面",
  manualSnapshotHint: "不抓取页面时，可人工录入变更前后的文本/标题（用于验证变更 hash）。",
  back: "← 返回",
} as const;

export const CHANGE_PLAN_NAV = {
  title: "变更计划",
  create: "创建变更计划",
  noPlan: "暂无变更计划",
  noPlanHint: "从内容机会的建议结构生成编辑说明（不会自动修改或发布网站）。",
  noAutoPublish: "此计划不会自动修改或发布网站。",
  draft: "草稿",
  approved: "已批准",
  executed: "已执行",
  cancelled: "已取消",
  item: "编辑项",
  section: "区域",
  changeType: "动作",
  instruction: "编辑说明",
  reason: "原因",
  source: "来源建议",
  notFinalText: "变更计划是编辑说明，不是最终正文；请人工核验真实事实后执行。",
} as const;

export const PILOT_NAV = {
  title: "真实优化试点",
  measurementValidity: "测量有效性",
  measurementWarning: "当前测量模式无法证明模型读取了公开网页变化（api_plain 不等价于产品 Web 检索）。",
  noVerifyWebButton: "禁止将结果标为“网页优化已验证”",
  recordModelChange: "仅记录模型行为变化",
  baseline: "基线测量",
  execution: "执行与变更核实",
  changeNotObserved: "AFTER 快照与 BEFORE 一致 —— 变更尚未被证实。",
  pilotReview: "试点评审",
  reviewVersion: "评审版本",
  attribution: "归因置信",
  attributionLOW: "单次 Before/After 观察归因置信低：不构成因果证明。",
  observedNotCausal: "观察到变化 ≠ 已证明因果（Observed change ≠ proven causal effect）",
  lessons: "学习记录",
  createReview: "生成试点评审",
  reviewGenerated: "试点评审已生成",
  reviewVersionLabel: "评审版本",
  contentHashChanged: "页面内容已变化（hash 不一致）",
  demoLabel: "演示试点 —— 不伪装真实 Pilot",
  realPilotPending: "真实试点待用户授权（REAL_PILOT_PENDING_USER_APPROVAL）",
  realPilotBlocked: "真实试点因测量路径无效受阻（REAL_PILOT_BLOCKED_BY_MEASUREMENT）",
} as const;


/* ---------------------------------------------------------------
 * M8E — 监测对象 / 问题集 / 问题生成器 / 品牌认知测试
 * ---------------------------------------------------------------- */
export const TARGET_ENTITY_TYPE: Dict = {
  BRAND: "品牌", PRODUCT: "产品", SERVICE: "服务", ORGANIZATION: "组织", OTHER: "其他",
};
export const formatTargetEntityType = (value: string | null | undefined): string =>
  fallback(lookup(TARGET_ENTITY_TYPE, value), value ?? "");

export const ALIAS_TYPE: Dict = {
  OFFICIAL: "官方", PRODUCT: "产品名", ABBREVIATION: "缩写", LOCALIZED: "本地化", CUSTOM: "自定义",
};
export const formatAliasType = (value: string | null | undefined): string =>
  fallback(lookup(ALIAS_TYPE, value), value ?? "");

export const QUERY_TYPE_LABEL: Dict = {
  DISCOVERY: "自然发现", BRANDED_SANITY: "品牌认知测试", CUSTOM: "自定义",
};
export const formatQueryType = (value: string | null | undefined): string =>
  fallback(lookup(QUERY_TYPE_LABEL, value), value ?? "未分类");

export const QUERY_SOURCE_LABEL: Dict = {
  MANUAL: "手动添加", BUILDER: "问题生成器", IMPORT: "批量导入", SEED: "示例/种子",
};
export const formatQuerySource = (value: string | null | undefined): string =>
  fallback(lookup(QUERY_SOURCE_LABEL, value), value ?? "");

export const TARGET_CHECK_LABEL: Dict = {
  CLEAN: "✓ 未包含目标品牌", TARGET_MENTIONED: "含目标品牌", POSSIBLE_TARGET_MENTION: "可能含目标（URL 内）",
};
export const formatTargetCheck = (value: string | null | undefined): string =>
  fallback(lookup(TARGET_CHECK_LABEL, value), value ?? "—");

export const QUERY_INTENT_LABEL: Dict = {
  RECOMMEND: "推荐", HOW_TO: "怎么做", COMPARE: "对比", PROBLEM_SOLVING: "问题解决", INFORMATIONAL: "了解",
};
export const formatQueryIntent = (value: string | null | undefined): string =>
  fallback(lookup(QUERY_INTENT_LABEL, value), value ?? "");

export const TARGET_NAV = {
  title: "监测对象",
  empty: "还没有设置监测对象",
  emptyHint: "请先设置监测对象（品牌/产品名称与产品类别），之后才能开始 GEO 检测。",
  canonicalName: "监测名称",
  entityType: "实体类型",
  productCategory: "产品类别",
  productCategoryHint: "这个产品属于什么类别？如：大学生创新创业 AI 工具、CRM SaaS、洗地机。（自由文本）",
  website: "官网地址",
  description: "简介（可选）",
  aliases: "品牌别名",
  aliasesHint: "别名用于识别 AI 回答中出现的品牌（如 Acme Flow / AcmeFlow CRM）。",
  addAlias: "添加别名",
  aliasType: "别名类型",
  save: "保存监测对象",
  historyNote: "修改只影响之后的新检测。历史 Evidence、Analysis 和报告不会重新计算。",
  noAlias: "暂无别名",
} as const;

export const QUERY_WORKSPACE_NAV = {
  title: "监测问题",
  pageHint: "把这些真实用户问题发给所选 AI，并检测回答中是否自然出现你的品牌。",
  empty: "还没有监测问题集",
  emptyHint: "创建问题集后，GeoLens 会把这些真实用户问题发送给所选 AI，并检测回答中是否自然出现你的品牌。",
  create: "创建问题集",
  discoveryNote: "自然发现问题不包含目标品牌，用于衡量 AI 是否会自然提及或推荐你的品牌。",
  queryBuilder: "问题生成器",
  builderNote: "根据场景和用户意图组合问题（确定性模板，不调用 AI）。",
  importText: "批量导入",
  importNote: "每行一个问题；导入前先预览与品牌检查。",
  addQuery: "添加问题",
  tableColumns: { query: "问题", type: "类型", category: "类目", intent: "意图", locale: "语言", weight: "权重", source: "来源", targetCheck: "品牌检查", enabled: "启用" },
  runBenchmark: "开始 GEO 检测",
  cloneVersion: "复制为新版本",
  runPreflight: "开始检测前请确认",
  discoveryQueries: "自然发现问题",
  sanityQueries: "品牌认知测试",
  engines: "AI 模型",
  plannedRuns: "计划运行",
  realDemo: "真实 / 演示",
  preflightNote: "运行 AI 检测 ≠ 联网搜索；检索模式取决于所选引擎（api_plain 不联网）。",
} as const;

export const TARGET_LEAK_ERROR = "该问题包含当前监测品牌，会使自然可见度指标偏高。请移除品牌名，或改为品牌认知测试。";
export const CONTAMINATION = {
  targetPresentInDiscovery: "该问题包含当前监测品牌，会使自然可见度指标偏高。请移除品牌名，或改为品牌认知测试。",
  customContainsTarget: "自定义问题含监测品牌，不计入自然可见度主指标（如需品牌测试请用品牌认知测试类型）。",
  sanityNoBrand: "品牌认知测试通常应包含品牌名；若该问题不含品牌，请确认是否作为品牌认知测试保留。",
} as const;

/* ---------------------------------------------------------------
 * M8C-R0 — 人工 Web UI 检测（Manual Verified Measurement）
 * ---------------------------------------------------------------- */
export const MANUAL_NAV = {
  entry: "人工 Web UI 检测",
  entryHint: "在官方 AI Web 产品（Qwen / DeepSeek）中逐条发送问题，并把完整回答粘贴回来。GeoLens 负责分析，不会调用任何模型 API。",
  aiRun: "运行 AI 检测",
  manualRun: "人工 Web UI 检测",
  aiRunHint: "自动调用所选 AI 模型 API（api_plain 不联网）。",
  aiRunVsManual: "两种检测不同：自动 = 调用模型 API；人工 = 你在官方 Web 界面执行并粘贴结果。",
  createManual: "创建人工检测",
  product: "AI 产品",
  products: { "qwen-web": "Qwen 官方 Web", "deepseek-web": "DeepSeek 官方 Web", "custom-web": "其他官方 Web" },
  displayedModel: "界面显示模型（可选）",
  runType: "数据性质",
  realType: "真实测量",
  demoType: "演示数据",
  workspaceTitle: "人工 Web UI 检测",
  awaitingInput: "待人工录入",
  submitted: "已提交",
  skippedLabel: "已跳过",
  progressOf: "进度",
  total: "共",
  submittedCount: "已提交",
  remainingCount: "待录入",
  skippedCount: "已跳过",
  copyQuery: "复制问题",
  copied: "已复制",
  step1: "在官方 AI Web 产品中打开新会话，原样发送上面的问题（不要添加品牌名）。",
  step2: "将完整回答复制并粘贴到下方。",
  rawResponse: "完整回答",
  rawResponseHint: "请粘贴 AI 的完整原文回答（非摘要）。",
  retrievalConfirm: "是否确认此次回答使用了网页/联网检索？",
  retrievalYes: "是，确认联网",
  retrievalNo: "无法确认",
  howConfirm: "你如何确认？（可多选/补充）",
  signals: { uiSearch: "界面显示联网搜索", webSource: "显示网页来源", citation: "显示引用链接", other: "其他" },
  notes: "验证说明",
  observedAt: "实际查询时间",
  observedAtHint: "建议填写实际查询时间；不填默认当前时间。",
  citations: "可见引用 URL（每行一个，可选）",
  submitEvidence: "提交证据",
  skipThis: "跳过此题",
  skipReason: "跳过原因（可选）",
  skipNote: "跳过表示该题本次未能完成（如 AI 无法回答）。跳过 ≠ 品牌未出现。",
  analysisNote: "以下为自动分析结果（不可修改）：",
  notConfirmedWarning: "该回答可用于模型行为观察，但不能作为网页内容变更验证证据。",
  confirmedBadge: "人工验证联网",
  unknownBadge: "未确认联网",
  manualSourceBadge: "人工 Web UI",
  complete: "人工检测完成",
  viewMetrics: "查看指标",
  generateReport: "生成报告",
  evidenceNotEditable: "Evidence 一经提交不可修改；录错需新建 replacement Run。",
  demoBadge: "演示数据",
  realBadge: "真实测量",
} as const;

export const formatManualProduct = (value: string | null | undefined): string =>
  fallback(lookup(MANUAL_NAV.products, value), value ?? "");

/* ---------------------------------------------------------------
 * R2 — 统一任务中心（Activity Center）
 * 类型 / 状态的 UI 中文映射（DB 与 API 保持英文原值，仅在 UI 层转中文）。
 * ---------------------------------------------------------------- */
export const ACTIVITY_TYPE_LABEL: Dict = {
  MONITOR: "监测",
  BENCHMARK: "基准测试",
  MANUAL: "手动测量",
  EXPERIMENT: "实验",
  RETEST: "复测",
};
export const formatActivityType = (value: string | null | undefined): string =>
  fallback(lookup(ACTIVITY_TYPE_LABEL, value), value ?? "未知");

export const ACTIVITY_TYPE_OPTIONS = [
  { value: "MONITOR", label: "监测" },
  { value: "BENCHMARK", label: "基准测试" },
  { value: "MANUAL", label: "手动测量" },
  { value: "EXPERIMENT", label: "实验" },
  { value: "RETEST", label: "复测" },
] as const;

/** 任务中心状态筛选（Run / Experiment 两级状态机的并集，与后端 ACTIVITY 聚合语义一致） */
export const ACTIVITY_STATUS_OPTIONS = [
  { value: "PENDING", label: "等待中" },
  { value: "QUEUED", label: "排队中" },
  { value: "RUNNING", label: "运行中" },
  { value: "SUCCEEDED", label: "已完成" },
  { value: "PARTIAL", label: "部分完成" },
  { value: "FAILED", label: "失败" },
  { value: "CANCELLED", label: "已取消" },
  { value: "AWAITING_MANUAL_INPUT", label: "等待人工录入" },
  { value: "SKIPPED", label: "已跳过" },
  { value: "PLANNED", label: "已规划" },
  { value: "EXECUTION_RECORDED", label: "已记录执行" },
  { value: "RETEST_READY", label: "待复测" },
  { value: "RETEST_RUNNING", label: "复测中" },
  { value: "READY_FOR_EVALUATION", label: "待评估" },
  { value: "EVALUATED", label: "已评估" },
] as const;

export const ACTIVITY_NAV = {
  title: "任务中心",
  pageHint: "统一查看监测、基准测试、手动测量、实验与复测的执行状态与结果入口。",
  refresh: "刷新",
  searchPlaceholder: "搜索任务 / 项目 / 问题集…",
  search: "搜索",
  type: "类型",
  status: "状态",
  all: "全部",
  columns: {
    task: "任务",
    project: "项目",
    suite: "问题集",
    engine: "AI 方式",
    status: "状态",
    progress: "进度",
    time: "时间",
    result: "结果",
  },
  emptyTitle: "暂无任务记录",
  emptyHint: "切换筛选条件，或先在「GEO 基准测试」「监测」「手动测量」「优化实验」中创建任务，这里会汇总展示。",
  result: {
    continueInput: "继续录入",
    viewMissing: "查看缺失项",
    viewResult: "查看结果",
    view: "查看",
  },
  loadError: "任务中心加载失败",
} as const;
