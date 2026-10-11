import { api } from "./api";

export type AttributionStatusType =
  | "LIKELY_RELATED"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFOUNDED"
  | "NO_OBSERVED_CHANGE";

export type ObservedChangeDirection = "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL" | "NO_CHANGE";

export type BaselineCompatibilityType =
  | "EXACT_MATCH"
  | "COMPARABLE_WITH_WARNING"
  | "INCOMPATIBLE"
  | "MISSING_BASELINE"
  | "MISSING_RETEST_EVIDENCE";

export interface VerificationAssetListItem {
  id: string;
  platform: string;
  title: string;
  externalAssetId: string | null;
  canonicalUrl: string | null;
  publishedAt: string;
  verificationStatus: string;
  verificationNote: string | null;
  createdAt: string;
  draft: { id: string; title: string; topic: string | null } | null;
  publication: { id: string; channel: string; status: string } | null;
  campaign: { id: string; name: string } | null;
  latestRetest: {
    id: string;
    sequence: number;
    status: string;
    provider: string;
    model: string;
    requestedAt: string;
    completedAt: string | null;
    totalItems: number;
    completedItems: number;
  } | null;
  comparableQueryCount: number;
  changedQueryCount: number;
  attributionDistribution: {
    likelyRelated: number;
    insufficientEvidence: number;
    confounded: number;
    noObservedChange: number;
    total: number;
  };
}

export interface VerificationAssetsResponse {
  projectId: string;
  total: number;
  items: VerificationAssetListItem[];
}

export interface QueryOutcomeRow {
  id: string;
  retestItemId: string;
  queryId: string;
  queryText: string;
  queryType?: string;
  sanity: boolean;
  status: string;
  baselineStatus: string;
  baselineWarning?: string;
  outcome: {
    id: string;
    baselineCompatibility: string;
    comparisonStatus: string;
    comparisonVersion: string;
    beforeSnapshot: any;
    afterSnapshot: any;
    deltaSnapshot: any;
    summary: string;
    comparabilityWarning?: string;
  } | null;
  attribution: {
    id: string;
    attributionVersion: string;
    status: AttributionStatusType;
    observedChangeType: ObservedChangeDirection;
    signalsSnapshot: any;
    confoundersSnapshot: any;
    reasons: string[];
    explanation: string;
  } | null;
  beforeEvidence: {
    id: string;
    provider: string;
    engineName: string;
    model: string;
    retrievalMode: string;
    sourceType: string;
    rawPrompt: string;
    rawResponse: string;
    createdAt: string;
  } | null;
  afterEvidence: {
    id: string;
    provider: string;
    engineName: string;
    model: string;
    retrievalMode: string;
    sourceType: string;
    rawPrompt: string;
    rawResponse: string;
    createdAt: string;
  } | null;
}

export interface AssetOutcomeWorkspace {
  asset: {
    id: string;
    platform: string;
    title: string;
    canonicalUrl: string | null;
    externalAssetId: string | null;
    publishedAt: string;
    verificationStatus: string;
    verificationNote: string | null;
    draft: { id: string; title: string; topic: string | null } | null;
    publication: { id: string; channel: string; status: string } | null;
    campaign: { id: string; name: string; objective: string } | null;
    planItem: {
      id: string;
      title: string;
      targetQueries: string[];
      geoTarget?: string;
      objective?: string;
    } | null;
  };
  retestRuns: Array<{
    id: string;
    sequence: number;
    status: string;
    provider: string;
    engineKey: string;
    engineName: string;
    model: string;
    retrievalMode: string;
    sourceType: string;
    requestedAt: string;
    completedAt: string | null;
    totalItems: number;
    completedItems: number;
  }>;
  activeRetestRun: {
    id: string;
    sequence: number;
    status: string;
    provider: string;
    engineKey: string;
    engineName: string;
    model: string;
    retrievalMode: string;
    sourceType: string;
    requestedAt: string;
    completedAt: string | null;
    totalItems: number;
    completedItems: number;
    comparabilitySummary: {
      totalItems: number;
      comparableItems: number;
      warningItems: number;
      incompatibleItems: number;
      missingBaselineItems: number;
      missingRetestItems: number;
    };
    observedChangesSummary: {
      mentionAbsentToPresent: number;
      mentionPresentToAbsent: number;
      citationCountDeltaTotal: number;
      recommendationPositiveChanges: number;
      positionImproved: number;
      positionWorsened: number;
    };
    attributionSummary: {
      totalOutcomes: number;
      likelyRelatedCount: number;
      insufficientEvidenceCount: number;
      confoundedCount: number;
      noObservedChangeCount: number;
      positiveObservedChangeCount: number;
      negativeObservedChangeCount: number;
      directAssetCitationCount: number;
    };
    activeComparisonVersion?: string;
    activeAttributionVersion?: string;
    availableComparisonVersions?: string[];
    availableAttributionVersions?: string[];
    queryRows: QueryOutcomeRow[];
  } | null;
}

const encode = (id: string) => encodeURIComponent(id);

export const listVerificationAssets = (projectId: string) =>
  api<VerificationAssetsResponse>(`/projects/${encode(projectId)}/verification-assets`);

export const getAssetOutcomeWorkspace = (
  assetId: string,
  retestRunId?: string,
  comparisonVersion?: string,
  attributionVersion?: string
) => {
  const params = new URLSearchParams();
  if (retestRunId) params.set("retestRunId", retestRunId);
  if (comparisonVersion) params.set("comparisonVersion", comparisonVersion);
  if (attributionVersion) params.set("attributionVersion", attributionVersion);
  const qs = params.toString();
  return api<AssetOutcomeWorkspace>(
    `/published-assets/${encode(assetId)}/outcome-workspace${qs ? `?${qs}` : ""}`
  );
};

export const createRetestRun = (assetId: string, forceNew = false, autoExecute = true, queryIds?: string[]) =>
  api<{ id: string; status?: string }>(`/published-assets/${encode(assetId)}/retests`, {
    method: "POST",
    body: JSON.stringify({ forceNew, autoExecute, queryIds }),
  });

export const processRetestRun = (retestRunId: string) =>
  api<any>(`/retests/${encode(retestRunId)}/process`, {
    method: "POST",
  });

export const generateRetestOutcomes = (retestRunId: string) =>
  api<any>(`/retests/${encode(retestRunId)}/outcomes`, {
    method: "POST",
    body: JSON.stringify({}),
  });

export const generateOutcomeAttribution = (outcomeId: string) =>
  api<any>(`/outcomes/${encode(outcomeId)}/attribution`, {
    method: "POST",
    body: JSON.stringify({}),
  });

// ---- 统一确定性文案与状态格式化映射 (UX-CN 优先) ----

export function formatAttributionStatus(status?: string): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (status) {
    case "LIKELY_RELATED":
      return {
        label: "可能相关",
        badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300",
        description: "当前证据支持存在关联，但不代表严格因果关系。",
      };
    case "INSUFFICIENT_EVIDENCE":
      return {
        label: "证据不足",
        badgeClass: "bg-slate-100 text-slate-700 border-slate-300",
        description: "未满足推断关联所需的核心证据条件。",
      };
    case "CONFOUNDED":
      return {
        label: "存在混杂因素",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-300",
        description: "检测到同问题多内容发布或测试配置漂移等混杂因素。",
      };
    case "NO_OBSERVED_CHANGE":
      return {
        label: "未观察到明显变化",
        badgeClass: "bg-sky-50 text-sky-700 border-sky-300",
        description: "在本次复测中各项指标保持平稳，未观察到显著正负向变化。",
      };
    default:
      return {
        label: "待分析",
        badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
        description: "尚未完成关联判断分析。",
      };
  }
}

export function formatBaselineStatus(status?: string): {
  label: string;
  badgeClass: string;
  description: string;
} {
  switch (status) {
    case "EXACT_MATCH":
    case "COMPARABLE":
      return {
        label: "条件一致",
        badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300",
        description: "测试模型、引擎与检索模式等实验参数完全一致。",
      };
    case "COMPARABLE_WITH_WARNING":
      return {
        label: "可比较（存在差异）",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-300",
        description: "实验参数存在细微变动，可参考对比但需注意提示。",
      };
    case "INCOMPATIBLE":
      return {
        label: "不建议直接比较",
        badgeClass: "bg-rose-50 text-rose-800 border-rose-300",
        description: "关键测试配置发生变化，差值已隐藏避免误导。",
      };
    case "MISSING_BASELINE":
      return {
        label: "缺少发布前基线",
        badgeClass: "bg-slate-100 text-slate-600 border-slate-300",
        description: "未检索到资产发布时间前的基准评测证据。",
      };
    case "MISSING_RETEST_EVIDENCE":
      return {
        label: "缺少复测结果",
        badgeClass: "bg-slate-100 text-slate-600 border-slate-300",
        description: "本次复测尚未产生有效响应结果。",
      };
    default:
      return {
        label: "未知条件",
        badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
        description: "未获取到比较条件信息。",
      };
  }
}

export function formatVerificationStatus(status?: string): {
  label: string;
  badgeClass: string;
} {
  switch (status) {
    case "PLATFORM_CONFIRMED":
      return {
        label: "平台已确认",
        badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300",
      };
    case "MANUAL_VERIFIED":
      return {
        label: "人工已核验",
        badgeClass: "bg-blue-50 text-blue-800 border-blue-300",
      };
    case "UNVERIFIED":
      return {
        label: "未核验",
        badgeClass: "bg-slate-100 text-slate-600 border-slate-300",
      };
    default:
      return {
        label: "未知状态",
        badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
      };
  }
}

export function formatObservedChangeType(type?: string): {
  label: string;
  badgeClass: string;
} {
  switch (type) {
    case "POSITIVE":
      return {
        label: "正向变化",
        badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300",
      };
    case "NEGATIVE":
      return {
        label: "负向变化",
        badgeClass: "bg-rose-50 text-rose-800 border-rose-300",
      };
    case "MIXED":
      return {
        label: "变化方向不一致",
        badgeClass: "bg-amber-50 text-amber-800 border-amber-300",
      };
    case "NEUTRAL":
      return {
        label: "中性变化",
        badgeClass: "bg-slate-100 text-slate-700 border-slate-300",
      };
    case "NO_CHANGE":
      return {
        label: "无明显变化",
        badgeClass: "bg-slate-50 text-slate-600 border-slate-200",
      };
    default:
      return {
        label: "未知变化",
        badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
      };
  }
}

export function formatReasonCode(code: string): string {
  const map: Record<string, string> = {
    MISSING_BASELINE: "缺少发布前的有效基线证据，无法进行前后比较",
    MISSING_RETEST_EVIDENCE: "缺少有效复测证据，无法进行归因评估",
    INCOMPATIBLE_BASELINE: "基线与复测的关键测试条件不兼容，不能直接比较",
    UNVERIFIED_ASSET: "落地资产尚未完成平台或人工核验",
    NO_OBSERVED_CHANGE: "本次复测未观察到明显指标变化",
    INVALID_TEMPORAL_ORDER: "基线、发布与复测的时间先后顺序不符合要求",
    VERIFIED_PUBLICATION: "发布落地资产已完成核验（不代表已被检索）",
    QUERY_EXPLICITLY_TARGETED: "该问题被明确列为本次内容发布的目标问题",
    QUERY_STRATEGY_TARGETED: "该问题被内容策略列为目标问题",
    QUERY_NOT_TARGETED: "该问题未被列为本次发布或策略的目标问题",
    QUERY_TARGETED: "该问题未被明确标记为非目标问题（目标关系可能未知）",
    MODEL_CHANGED: "基线与复测使用的模型发生变化",
    RETRIEVAL_MODE_CHANGED: "基线与复测的检索模式发生变化（不代表实际检索）",
    NO_DIRECT_ASSET_CITATION: "回答中未检测到对本次发布资产的直接引用",
    EXACT_BASELINE: "Before / After 测试条件完全一致",
    DIRECT_ASSET_CITATION: "发布后回答直接引用了本次发布资产",
    SAME_DOMAIN_OTHER_PAGE: "发布后回答引用了同域名其他页面（非本落地资产）",
    NO_ASSET_CITATION: "回答中未检测到该资产或相关链接",
    TEMPORAL_ORDER_VALID: "复测时间晚于内容发布时间",
    TEMPORAL_ORDER_INVALID: "复测时间早于发布时间，时间序列不成立",
    TARGETED_QUERY: "该问题属于内容策划时的目标定向问题",
    NON_TARGETED_QUERY: "该问题非内容策划目标问题",
    ASSET_VERIFIED: "发布落地资产已通过核验（凭证有效）",
    ASSET_UNVERIFIED: "发布落地资产尚未完成核验",
    NO_INTERVENTIONS_DETECTED: "观察窗口内未检测到其他针对相同问题的发布干预",
    MULTIPLE_INTERVENTIONS: "同一观察窗口内存在其他针对该问题的发布内容",
    NO_OBSERVED_DELTA: "在基线与复测之间未观察到显著数值变化",
    NEGATIVE_DELTA_OBSERVED: "观察到负向变化（品牌提及/引用下降或位次后移）",
    INSUFFICIENT_EVIDENCE_REASONS: "当前证据条件不足以支撑关联推断",
  };
  return map[code] ?? code;
}

export function formatRetestStatus(status?: string): { label: string; badgeClass: string } {
  switch (status) {
    case "COMPLETED":
    case "SUCCEEDED":
      return { label: "已完成", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-300" };
    case "RUNNING":
      return { label: "进行中", badgeClass: "bg-teal-50 text-teal-800 border-teal-300" };
    case "FAILED":
      return { label: "执行失败", badgeClass: "bg-rose-50 text-rose-800 border-rose-300" };
    case "PARTIAL":
      return { label: "部分完成", badgeClass: "bg-amber-50 text-amber-800 border-amber-300" };
    case "CANCELLED":
      return { label: "已取消", badgeClass: "bg-slate-100 text-slate-600 border-slate-300" };
    case "PENDING":
    case "QUEUED":
      return { label: "排队中", badgeClass: "bg-slate-100 text-slate-700 border-slate-300" };
    default:
      return { label: "未知状态", badgeClass: "bg-slate-50 text-slate-500 border-slate-200" };
  }
}

export function formatConfounderCode(code: string): string {
  const normalized = code.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  const map: Record<string, string> = {
    MULTIPLE_INTERVENTIONS: "同一观察窗口内有多篇针对该问题的发布内容同时生效",
    MODEL_CHANGED: "前后两次测试所用模型不一致",
    RETRIEVAL_MODE_CHANGED: "前后两次测试的检索模式不一致",
    PROVIDER_CHANGED: "基线与复测使用的模型服务提供方发生变化",
    SOURCE_TYPE_CHANGED: "基线与复测的证据来源类型发生变化",
    BASELINE_WARNING: "基线与复测存在可比性提示，解读结果需谨慎",
    UNVERIFIED_ASSET: "该落地资产尚未完成平台或人工核验",
  };
  return map[normalized] ?? map[code] ?? code;
}

export function formatPlatform(platform?: string): string {
  const map: Record<string, string> = {
    WECHAT_OFFICIAL_ACCOUNT: "微信公众号",
    WECHAT: "微信",
    XIAOHONGSHU: "小红书",
    BILIBILI: "Bilibili",
    DOUYIN: "抖音",
    WEIBO: "微博",
    BAIDU: "百度",
    OTHER: "其他平台",
  };
  return map[platform ?? ""] ?? (platform || "未指定平台");
}
