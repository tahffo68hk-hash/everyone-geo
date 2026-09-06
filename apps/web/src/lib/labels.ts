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
