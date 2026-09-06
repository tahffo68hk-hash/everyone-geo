/**
 * M7C GEO Content Opportunities —— 确定性、Evidence-backed 内容机会引擎。
 *
 * 语义边界：
 *   - ContentOpportunity = 内容机会 / 内容任务 brief foundation，不是最终稿：
 *     titleDirection（标题方向）、suggested blocks（建议结构块 title+purpose）、
 *     建议资产类型（= opportunityType / alternativeAssetTypes）。绝不输出完整正文。
 *   - Opportunity ≠ 效果承诺：expectedSignals 只表示「后续应重点观察的信号」，
 *     不含 expectedDelta；真正效果必须经 M7D 复测验证。
 *   - 绝不凭空生成：每个 Opportunity 必须来自 ≥1 条 Recommendation（其本身
 *     Diagnosis-backed），并保留全部 source recommendation / finding / evidence
 *     链接与 query 快照。
 *   - Query clustering 只用已有 canonical 元数据（category/intent/locale）与
 *     归一化 queryText，不使用 embedding / 向量数据库；同组相似 Query 聚合为
 *     一个机会（Query Cluster → Content Asset），不做 1 Query → 1 页面。
 *   - DATA_COLLECTION 建议本质是「先补数据」，默认不产生普通内容机会。
 *   - 本模块为纯函数：不 import DB / HTTP / env / LLM。
 */
export const CONTENT_OPPORTUNITY_VERSION = 'geolens-content-opportunity-v1';

export type OpportunityType =
  | 'ENTITY_OVERVIEW' | 'PRODUCT_PAGE' | 'FEATURE_PAGE' | 'USE_CASE_PAGE'
  | 'COMPARISON_PAGE' | 'FAQ_PAGE' | 'GUIDE' | 'CASE_STUDY'
  | 'DATA_REFERENCE' | 'DOCUMENTATION' | 'CLARIFICATION_CONTENT'
  | 'CONTENT_REFRESH' | 'OTHER';

export const OPPORTUNITY_TYPES: readonly OpportunityType[] = [
  'ENTITY_OVERVIEW', 'PRODUCT_PAGE', 'FEATURE_PAGE', 'USE_CASE_PAGE',
  'COMPARISON_PAGE', 'FAQ_PAGE', 'GUIDE', 'CASE_STUDY',
  'DATA_REFERENCE', 'DOCUMENTATION', 'CLARIFICATION_CONTENT',
  'CONTENT_REFRESH', 'OTHER',
];

export type ContentIntent =
  | 'DISCOVERY' | 'RECOMMENDATION' | 'COMPARISON' | 'EVALUATION' | 'HOW_TO'
  | 'PROBLEM_SOLVING' | 'AUTHORITY' | 'CLARIFICATION' | 'INFORMATIONAL';

export const CONTENT_INTENTS: readonly ContentIntent[] = [
  'DISCOVERY', 'RECOMMENDATION', 'COMPARISON', 'EVALUATION', 'HOW_TO',
  'PROBLEM_SOLVING', 'AUTHORITY', 'CLARIFICATION', 'INFORMATIONAL',
];

export type OpportunityPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type OpportunityEffort = 'LOW' | 'MEDIUM' | 'HIGH';

export type ExpectedSignal =
  | 'VISIBILITY' | 'RECOMMENDATION' | 'MENTION_POSITION' | 'CITATION'
  | 'COMPETITOR_SOV' | 'ENTITY_UNDERSTANDING' | 'CATEGORY_COVERAGE';

// ---------------------------------------------------------------------------
// 输入事实（API 组装；engine 只读、不突变输入）
// ---------------------------------------------------------------------------

export interface OpportunityEngineFact {
  provider: string;
  engineKey: string;
  engineName: string;
  requestedModel: string | null;
  responseModel: string | null;
}

export interface OpportunityQueryFact {
  /** 生成时冻结的问题文本（来自 DiagnosisFindingEvidence.queryTextSnapshot） */
  queryText: string;
  /** BenchmarkRunQuery 快照对齐（生成时）；取不到为 null，不猜测 */
  category: string | null;
  intent: string | null;
  locale: string | null;
  /** 该 Evidence 回答中品牌是否缺席 */
  brandAbsent: boolean | null;
  /** 该 Evidence 是否出现已审核竞品正面/推荐信号 */
  competitorPositive: boolean | null;
  engine: OpportunityEngineFact;
  evidenceId: string;
  runId: string;
  reason: string; // 来源 Finding 链接 reason
}

export interface OpportunityFindingInput {
  id: string;
  findingType: string;
  severity: string;
  title: string;
  summary: string;
  category: string | null;
  competitorName: string | null;
  priorityScore: number;
}

export interface OpportunityRecommendationInput {
  id: string;
  recommendationType: string;
  title: string;
  summary: string;
  rationale: string;
  priority: string;
  priorityScore: number;
  category: string | null;
  competitorName: string | null;
  expectedSignal: string | null;
  effortLevel: string | null;
  findingIds: string[];
  findings: OpportunityFindingInput[];
  /** 该建议关联的 query/evidence 事实（每条 = 一条来源 FindingEvidence 链接） */
  queries: OpportunityQueryFact[];
}

export interface ApprovedCompetitorInput {
  canonicalName: string;
  competitorType: string | null;
}

export interface OpportunityEngineInput {
  opportunityVersion: string;
  recommendationRun: { id: string; recommendationVersion: string; metricSource?: string | null };
  recommendations: OpportunityRecommendationInput[];
  /** 已审核竞品语义（来自来源 Report 的 Competitor Set entries） */
  approvedCompetitors: ApprovedCompetitorInput[];
  /** 诊断含 HIGH/MEDIUM DATA_QUALITY_WARNING 时 true（service 判定，规则同 M7B） */
  hasDataQualityIssue: boolean;
}

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

export interface OpportunityQueryLink {
  queryText: string; // 原样 snapshot
  category: string | null;
  intent: string | null;
  locale: string | null;
  brandAbsent: boolean | null;
  competitorPositive: boolean | null;
  sourceEvidenceCount: number;
  engines: OpportunityEngineFact[];
  evidenceIds: string[];
  runIds: string[];
  reasons: string[];
}

export interface ContentBlockCandidate {
  blockType: string;
  title: string;
  purpose: string;
  sortOrder: number;
}

export interface OpportunityCandidate {
  opportunityType: OpportunityType;
  contentIntent: ContentIntent;
  assetType: OpportunityType;
  alternativeAssetTypes: OpportunityType[];
  titleDirection: string;
  summary: string;
  rationale: string;
  priority: OpportunityPriority;
  priorityScore: number;
  category: string | null;
  effortLevel: OpportunityEffort;
  expectedSignals: ExpectedSignal[];
  representativeQuery: string | null;
  targetQueryCount: number;
  targetEngineCount: number;
  targetCompetitorCount: number;
  evidenceCount: number;
  recommendationCount: number;
  recommendationIds: string[];
  findingIds: string[];
  queries: OpportunityQueryLink[];
  engines: OpportunityEngineFact[];
  competitors: Array<{ canonicalName: string; competitorType: string | null }>;
  blocks: ContentBlockCandidate[];
  dataQualityLimited: boolean;
  metadata: Record<string, unknown>;
}

export interface OpportunityRunSummary {
  opportunityCount: number;
  priorityCounts: Record<OpportunityPriority, number>;
  queryLinkCount: number;
  evidenceLinkCount: number;
  recommendationSourceCount: number;
  targetEngineCount: number;
  targetCompetitorCount: number;
  dataQualityLimited: boolean;   // 是否存在 DQ 降级/阻断（含 DATA_COLLECTION 跳过）
  blockedByDataQuality: boolean; // 是否因 DQ 未生成任何普通内容机会
  directions: string[];
}

export interface OpportunityEngineOutput {
  opportunities: OpportunityCandidate[];
  summary: OpportunityRunSummary;
}

// ---------------------------------------------------------------------------
// 集中配置（internal heuristic；非行业标准）
// ---------------------------------------------------------------------------

/** Recommendation → Opportunity 映射（§16）。DATA_COLLECTION 不映射（不生成普通机会）。 */
interface RecMapping {
  primary: OpportunityType;
  alts: OpportunityType[];
  intent: ContentIntent;
}

export const RECOMMENDATION_TO_OPPORTUNITY: Record<string, RecMapping> = {
  ENTITY_CLARITY: { primary: 'ENTITY_OVERVIEW', alts: ['PRODUCT_PAGE'], intent: 'INFORMATIONAL' },
  POSITIONING_CLARITY: { primary: 'PRODUCT_PAGE', alts: ['CONTENT_REFRESH'], intent: 'RECOMMENDATION' },
  CATEGORY_COVERAGE: { primary: 'USE_CASE_PAGE', alts: ['GUIDE'], intent: 'DISCOVERY' },
  QUERY_COVERAGE: { primary: 'USE_CASE_PAGE', alts: ['FAQ_PAGE', 'GUIDE'], intent: 'INFORMATIONAL' },
  RECOMMENDATION_READINESS: { primary: 'USE_CASE_PAGE', alts: ['COMPARISON_PAGE'], intent: 'RECOMMENDATION' },
  COMPETITOR_DIFFERENTIATION: { primary: 'COMPARISON_PAGE', alts: [], intent: 'COMPARISON' },
  CITATION_READINESS: { primary: 'DATA_REFERENCE', alts: ['CASE_STUDY', 'DOCUMENTATION'], intent: 'AUTHORITY' },
  PROVIDER_COVERAGE: { primary: 'ENTITY_OVERVIEW', alts: ['PRODUCT_PAGE'], intent: 'INFORMATIONAL' },
  SENTIMENT_RESPONSE: { primary: 'CLARIFICATION_CONTENT', alts: ['FAQ_PAGE'], intent: 'CLARIFICATION' },
  STRUCTURED_INFORMATION: { primary: 'FAQ_PAGE', alts: ['DOCUMENTATION'], intent: 'INFORMATIONAL' },
  // DATA_COLLECTION：本质是「先补数据」，不生成内容任务（单独 guard）。
};

/**
 * 在基础映射上做确定性细化（internal heuristic，见 docs/m7-content-opportunities.md）：
 *  CITATION_READINESS 覆盖 Query ≥ 6 时建议的「可引用内容中心」偏向大型文档
 *  （DOCUMENTATION，effort HIGH）；否则建议轻量 DATA_REFERENCE。其余类型不变。
 */
export function resolveRecommendationMapping(type: string, distinctQueryCount: number): RecMapping {
  const base = RECOMMENDATION_TO_OPPORTUNITY[type];
  if (!base) return base;
  if (type === 'CITATION_READINESS' && distinctQueryCount >= 6) {
    return { primary: 'DOCUMENTATION', alts: ['DATA_REFERENCE', 'CASE_STUDY'], intent: base.intent };
  }
  return base;
}

/** Opportunity Type 自身启发式：effort / 建议观察信号（≠ expectedDelta）。 */
interface OpportunityTypeSpec {
  effort: OpportunityEffort;
  signals: ExpectedSignal[];
}

const OPPORTUNITY_TYPE_RULES: Record<OpportunityType, OpportunityTypeSpec> = {
  ENTITY_OVERVIEW: { effort: 'LOW', signals: ['ENTITY_UNDERSTANDING', 'VISIBILITY', 'RECOMMENDATION'] },
  PRODUCT_PAGE: { effort: 'MEDIUM', signals: ['ENTITY_UNDERSTANDING', 'VISIBILITY', 'RECOMMENDATION'] },
  FEATURE_PAGE: { effort: 'MEDIUM', signals: ['ENTITY_UNDERSTANDING', 'VISIBILITY'] },
  USE_CASE_PAGE: { effort: 'MEDIUM', signals: ['VISIBILITY', 'RECOMMENDATION', 'CATEGORY_COVERAGE'] },
  COMPARISON_PAGE: { effort: 'MEDIUM', signals: ['VISIBILITY', 'RECOMMENDATION', 'COMPETITOR_SOV'] },
  FAQ_PAGE: { effort: 'LOW', signals: ['VISIBILITY', 'RECOMMENDATION'] },
  GUIDE: { effort: 'MEDIUM', signals: ['VISIBILITY', 'RECOMMENDATION'] },
  CASE_STUDY: { effort: 'MEDIUM', signals: ['RECOMMENDATION', 'CITATION', 'VISIBILITY'] },
  DATA_REFERENCE: { effort: 'LOW', signals: ['CITATION', 'ENTITY_UNDERSTANDING'] },
  DOCUMENTATION: { effort: 'HIGH', signals: ['CITATION', 'ENTITY_UNDERSTANDING'] },
  CLARIFICATION_CONTENT: { effort: 'LOW', signals: ['RECOMMENDATION', 'ENTITY_UNDERSTANDING'] },
  CONTENT_REFRESH: { effort: 'MEDIUM', signals: ['ENTITY_UNDERSTANDING', 'VISIBILITY'] },
  OTHER: { effort: 'MEDIUM', signals: ['VISIBILITY'] },
};

/** category canonical → 中文展示（title direction 用；与 UI labels.CATEGORY 保持同步）。 */
const CATEGORY_CN: Record<string, string> = {
  'tool-discovery': '工具发现',
  comparison: '比较选择',
  workflow: '任务流程',
  recommendation: '明确推荐',
  'pain-point': '痛点驱动',
  competition: '赛事场景',
};

// 标题方向模板（仅「方向」，非最终发布标题）
const TITLE_DIRECTION: Record<OpportunityType, string> = {
  ENTITY_OVERVIEW: '品牌实体与能力总览内容',
  PRODUCT_PAGE: '产品定位与核心价值说明内容',
  FEATURE_PAGE: '产品功能与能力边界说明内容',
  USE_CASE_PAGE: '使用场景与任务覆盖内容',
  COMPARISON_PAGE: '竞品对比与选择参考内容',
  FAQ_PAGE: '常见问题解答内容（FAQ）',
  GUIDE: '使用指南内容',
  CASE_STUDY: '可验证案例与成效说明内容',
  DATA_REFERENCE: '可引用事实与数据参考内容',
  DOCUMENTATION: '产品说明与文档内容',
  CLARIFICATION_CONTENT: '易误解信息澄清说明内容',
  CONTENT_REFRESH: '现有内容更新与口径统一',
  OTHER: '其他内容方向',
};

// ---------------------------------------------------------------------------
// 建议结构块（仅 title + purpose；禁止完整正文）—— §23
// ---------------------------------------------------------------------------
interface BlockTemplate { blockType: string; title: string; purpose: string }

const BLOCK_TEMPLATES: Record<OpportunityType, BlockTemplate[]> = {
  ENTITY_OVERVIEW: [
    { blockType: 'ENTITY_DEFINITION', title: '品牌与实体定义', purpose: '让 AI 可稳定获取「品牌是什么、属于哪一类」的明确表述。' },
    { blockType: 'TARGET_AUDIENCE', title: '适用对象', purpose: '说明主要服务对象与适用人群边界。' },
    { blockType: 'CORE_CAPABILITIES', title: '核心能力', purpose: '明确能完成的任务类型与能力边界，避免模糊和夸大。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证事实', purpose: '提供可以被引用的公开事实（不堆砌关键词）。' },
  ],
  PRODUCT_PAGE: [
    { blockType: 'VALUE_PROPOSITION', title: '核心价值', purpose: '把「解决什么问题、为什么值得选」写清楚。' },
    { blockType: 'TARGET_AUDIENCE', title: '适用人群与条件', purpose: '哪些人、什么条件下适合选择。' },
    { blockType: 'CORE_CAPABILITIES', title: '能力与边界', purpose: '能力与局限都清楚，避免被泛化误判。' },
    { blockType: 'USAGE_FLOW', title: '使用流程', purpose: '说明如何上手与典型路径。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证事实', purpose: '公开案例/指标/说明，供模型判断推荐理由。' },
  ],
  FEATURE_PAGE: [
    { blockType: 'FEATURE_DEFINITION', title: '功能定义', purpose: '说明该功能是什么、解决什么问题。' },
    { blockType: 'CORE_TASKS', title: '核心任务', purpose: '覆盖该功能可完成的典型任务。' },
    { blockType: 'USAGE_FLOW', title: '使用流程', purpose: '说明使用方式与前置条件。' },
    { blockType: 'BOUNDARIES', title: '边界与限制', purpose: '明确不适用场景，避免夸大。' },
  ],
  USE_CASE_PAGE: [
    { blockType: 'USER_SCENARIO', title: '用户场景', purpose: '说明用户为什么会寻找这类工具。' },
    { blockType: 'CORE_TASKS', title: '核心任务', purpose: '该场景下用户要完成的任务分类。' },
    { blockType: 'TARGET_AUDIENCE', title: '适用对象', purpose: '说明该场景适合谁、不适合谁。' },
    { blockType: 'CORE_CAPABILITIES', title: '产品能力', purpose: '明确品牌在该场景能完成什么。' },
    { blockType: 'USAGE_FLOW', title: '使用流程', purpose: '给出从需求到使用的典型路径。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证事实', purpose: '提供可以被引用的公开事实。' },
    { blockType: 'FAQ', title: '常见问题', purpose: '直接覆盖该场景的高频疑问。' },
  ],
  COMPARISON_PAGE: [
    { blockType: 'COMPARISON_SCOPE', title: '对比范围', purpose: '说明对比对象与比较前提。' },
    { blockType: 'TARGET_AUDIENCE', title: '适用人群', purpose: '什么情况下该看这份对比。' },
    { blockType: 'COMPARISON_DIMENSIONS', title: '功能维度', purpose: '按公开可验证维度说明差异。' },
    { blockType: 'USE_SCENARIOS', title: '使用场景', purpose: '各自更适合什么任务。' },
    { blockType: 'DIFFERENCE_NOTES', title: '差异说明', purpose: '真实差异（不编造竞品缺点、不贬低竞品）。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证证据', purpose: '可核实的公开信息与出处。' },
    { blockType: 'SELECTION_ADVICE', title: '选择建议', purpose: '帮助用户按自身条件判断。' },
    { blockType: 'FAQ', title: '常见问题', purpose: '覆盖对比类高频疑问。' },
  ],
  FAQ_PAGE: [
    { blockType: 'BASIC_DEFINITION', title: '基础定义', purpose: '回答「是什么」类问题。' },
    { blockType: 'USE_SCENARIOS', title: '适用场景', purpose: '回答「什么时候用」类问题。' },
    { blockType: 'BOUNDARIES', title: '功能边界', purpose: '回答「能不能 / 不能做什么」类问题。' },
    { blockType: 'USAGE_FLOW', title: '使用流程', purpose: '回答「怎么用」类问题。' },
    { blockType: 'COMMON_QUESTIONS', title: '常见疑问', purpose: '覆盖用户高频追问。' },
    { blockType: 'FACT_SOURCES', title: '事实来源', purpose: '每条回答可对应可验证来源。' },
  ],
  GUIDE: [
    { blockType: 'USER_SCENARIO', title: '用户场景', purpose: '说明指南面向的问题与人群。' },
    { blockType: 'STEP_BY_STEP', title: '分步流程', purpose: '从准备到完成的步骤。' },
    { blockType: 'CORE_CAPABILITIES', title: '产品能力', purpose: '过程中会用到哪些能力。' },
    { blockType: 'TIPS_AND_BOUNDARIES', title: '技巧与边界', purpose: '常见误区与不适用情形。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证事实', purpose: '可核实的公开信息。' },
  ],
  CASE_STUDY: [
    { blockType: 'CASE_BACKGROUND', title: '背景与目标', purpose: '真实场景描述（不编造）。' },
    { blockType: 'PROCESS', title: '过程与方法', purpose: '做了什么、怎么做的。' },
    { blockType: 'VERIFIABLE_OUTCOMES', title: '可验证结果', purpose: '可核实的公开结果数据。' },
    { blockType: 'FACT_SOURCES', title: '信息来源', purpose: '稳定 URL 与来源归属。' },
  ],
  DATA_REFERENCE: [
    { blockType: 'FACT_DEFINITION', title: '事实定义', purpose: '明确该事实/数据的定义与口径。' },
    { blockType: 'DATA_SOURCES', title: '数据来源', purpose: '来源可追溯、可访问。' },
    { blockType: 'METHOD_NOTES', title: '方法说明', purpose: '数据如何得出。' },
    { blockType: 'VERIFIABLE_DATA', title: '可验证数据', purpose: '具体数值与更新状态。' },
    { blockType: 'UPDATE_TIME', title: '更新时间', purpose: '说明时效与下次更新安排。' },
    { blockType: 'CITATION_FORMAT', title: '引用方式', purpose: '说明如何正确引用本页。' },
  ],
  DOCUMENTATION: [
    { blockType: 'OVERVIEW', title: '概览', purpose: '说明文档范围与目标读者。' },
    { blockType: 'QUICKSTART', title: '快速开始', purpose: '最快上手路径。' },
    { blockType: 'CORE_CAPABILITIES', title: '能力说明', purpose: '逐项说明能力与边界。' },
    { blockType: 'REFERENCE', title: '参考信息', purpose: '参数/字段/配置等可验证参考。' },
    { blockType: 'FAQ', title: '常见问题', purpose: '覆盖文档相关高频疑问。' },
  ],
  CLARIFICATION_CONTENT: [
    { blockType: 'MISCONCEPTION', title: '易误解点', purpose: '明确需要澄清的表述/误解。' },
    { blockType: 'ACCURATE_STATEMENT', title: '准确说明', purpose: '基于真实事实的准确表述。' },
    { blockType: 'BOUNDARIES', title: '边界与限制', purpose: '避免绝对化与夸大。' },
    { blockType: 'FACT_SOURCES', title: '事实来源', purpose: '可验证出处。' },
  ],
  CONTENT_REFRESH: [
    { blockType: 'CURRENT_STATE', title: '现状说明', purpose: '现有内容待更新的口径点。' },
    { blockType: 'TARGET_STATE', title: '目标口径', purpose: '统一后的实体/能力/场景表述。' },
    { blockType: 'ENTITY_CONSISTENCY', title: '实体一致性', purpose: '关键页面复用一致的品牌全称与类别词。' },
  ],
  OTHER: [
    { blockType: 'CONTENT_DIRECTION', title: '内容方向说明', purpose: '说明该机会要覆盖的信息类型。' },
    { blockType: 'VERIFIABLE_FACTS', title: '可验证事实', purpose: '提供可引用的真实信息。' },
  ],
};

// ---------------------------------------------------------------------------
// 归一化 / helpers（deterministic）
// ---------------------------------------------------------------------------

/** NFKC + trim + case fold（英文适用）；仅用于 dedup 键，不改原 snapshot。 */
export function canonicalQueryKey(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase();
}

function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function priorityLabelOf(score: number): OpportunityPriority {
  return score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
}

function engineKeyOf(e: OpportunityEngineFact): string {
  return `${e.provider}|${e.engineKey}|${e.requestedModel ?? ''}|${e.responseModel ?? ''}`;
}

function dedupeEngines(list: OpportunityEngineFact[]): OpportunityEngineFact[] {
  const out: OpportunityEngineFact[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const key = engineKeyOf(e);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...e });
  }
  out.sort((a, b) => (a.provider ?? '').localeCompare(b.provider ?? '') || (a.engineKey ?? '').localeCompare(b.engineKey ?? ''));
  return out;
}

/** 竞品信号分：member finding 中竞品相关 severity 权重（不含 DQ）。 */
function competitorSignalScore(findings: OpportunityFindingInput[], competitorTargeted: boolean): number {
  const severityWeight: Record<string, number> = { HIGH: 100, MEDIUM: 70, LOW: 40, INFO: 10 };
  let max = competitorTargeted ? 60 : 0;
  for (const f of findings) {
    if (!/COMPETITOR/.test(f.findingType)) continue;
    max = Math.max(max, severityWeight[f.severity] ?? 30);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Core：build opportunities（deterministic clustering + dedup + priority）
// ---------------------------------------------------------------------------
export function buildContentOpportunities(input: OpportunityEngineInput): OpportunityEngineOutput {
  const recs = input.recommendations.map(r => ({ ...r, findings: r.findings.map(f => ({ ...f })), queries: r.queries.map(q => ({ ...q, engine: { ...q.engine } })) }));
  const approved = new Map<string, string | null>(
    (input.approvedCompetitors ?? []).map(c => [c.canonicalName.toLowerCase(), c.competitorType ?? null]),
  );
  const empty: OpportunityRunSummary = {
    opportunityCount: 0,
    priorityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    queryLinkCount: 0,
    evidenceLinkCount: 0,
    recommendationSourceCount: 0,
    targetEngineCount: 0,
    targetCompetitorCount: 0,
    dataQualityLimited: false,
    blockedByDataQuality: false,
    directions: [],
  };
  if (recs.length === 0) return { opportunities: [], summary: empty };

  // ---- Step 1：DataQualityGuard + DATA_COLLECTION 拦截 ----
  const hasDq = Boolean(input.hasDataQualityIssue);
  const clusters = new Map<string, Cluster>();
  let skippedDataCollection = 0;
  const eligibleRecs: OpportunityRecommendationInput[] = [];
  for (const rec of recs) {
    if (rec.recommendationType === 'DATA_COLLECTION') { skippedDataCollection += 1; continue; }
    const distinctQueryCount = new Set(rec.queries.map(q => canonicalQueryKey(q.queryText))).size;
    const mapping = resolveRecommendationMapping(rec.recommendationType, distinctQueryCount);
    if (!mapping) { skippedDataCollection += 1; continue; } // 未映射类型不硬造内容任务
    eligibleRecs.push(rec);
    const key = clusterKey(mapping.primary, rec.category ?? null, rec.competitorName ?? null, mapping.intent);
    const existing = clusters.get(key);
    if (existing) {
      existing.recIds.push(rec.id);
      existing.alts = [...new Set([...existing.alts, ...mapping.alts])].sort();
    }
    else clusters.set(key, {
      primary: mapping.primary, intent: mapping.intent, alts: mapping.alts,
      category: rec.category ?? null, competitor: rec.competitorName ?? null, recIds: [rec.id],
    });
  }

  const candidates: OpportunityCandidate[] = [];
  for (const cluster of clusters.values()) {
    const members = cluster.recIds
      .map(id => eligibleRecs.find(r => r.id === id))
      .filter((r): r is OpportunityRecommendationInput => Boolean(r));
    if (members.length === 0) continue;
    const candidate = buildCandidate(cluster, members, approved, hasDq);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) =>
    b.priorityScore - a.priorityScore || a.opportunityType.localeCompare(b.opportunityType) || a.titleDirection.localeCompare(b.titleDirection));

  const allBlocked = candidates.length === 0 && (skippedDataCollection > 0 || hasDq);
  const anyLimited = hasDq || skippedDataCollection > 0 || candidates.some(c => c.dataQualityLimited);
  const summary: OpportunityRunSummary = {
    opportunityCount: candidates.length,
    priorityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 },
    queryLinkCount: candidates.reduce((s, c) => s + c.queries.length, 0),
    evidenceLinkCount: candidates.reduce((s, c) => s + c.evidenceCount, 0),
    recommendationSourceCount: eligibleRecs.length,
    targetEngineCount: dedupeEngines(candidates.flatMap(c => c.engines)).length,
    targetCompetitorCount: new Set(candidates.flatMap(c => c.competitors.map(x => x.canonicalName.toLowerCase()))).size,
    dataQualityLimited: anyLimited,
    blockedByDataQuality: allBlocked,
    directions: [...new Set(candidates.map(c => c.opportunityType))].sort(),
  };
  for (const c of candidates) summary.priorityCounts[c.priority] += 1;
  return { opportunities: candidates, summary };
}

interface Cluster {
  primary: OpportunityType;
  intent: ContentIntent;
  alts: OpportunityType[];
  category: string | null;
  competitor: string | null;
  recIds: string[];
}

function clusterKey(type: OpportunityType, category: string | null, competitor: string | null, intent: ContentIntent): string {
  return `${type}|${category ?? ''}|${competitor ?? ''}|${intent}`;
}

function buildCandidate(
  cluster: Cluster,
  members: OpportunityRecommendationInput[],
  approved: Map<string, string | null>,
  hasDq: boolean,
): OpportunityCandidate | null {
  const spec = OPPORTUNITY_TYPE_RULES[cluster.primary];
  const alts = [...cluster.alts];

  // ---- queries：跨成员 dedup（canonical），保留全部 evidence links ----
  const byCanonical = new Map<string, {
    link: OpportunityQueryLink;
  }>();
  for (const rec of members) {
    for (const q of rec.queries) {
      const key = canonicalQueryKey(q.queryText);
      const existing = byCanonical.get(key);
      if (existing) {
        existing.link.sourceEvidenceCount += 1;
        if (!existing.link.evidenceIds.includes(q.evidenceId)) existing.link.evidenceIds.push(q.evidenceId);
        if (!existing.link.runIds.includes(q.runId)) existing.link.runIds.push(q.runId);
        if (!existing.link.reasons.includes(q.reason)) existing.link.reasons.push(q.reason);
        const engines = dedupeEngines([...existing.link.engines, q.engine]);
        existing.link.engines = engines;
        existing.link.brandAbsent = mergeNullable(existing.link.brandAbsent, q.brandAbsent, true);
        existing.link.competitorPositive = mergeNullable(existing.link.competitorPositive, q.competitorPositive, true);
      } else {
        byCanonical.set(key, {
          link: {
            queryText: q.queryText,
            category: q.category,
            intent: q.intent,
            locale: q.locale,
            brandAbsent: q.brandAbsent,
            competitorPositive: q.competitorPositive,
            sourceEvidenceCount: 1,
            engines: dedupeEngines([q.engine]),
            evidenceIds: [q.evidenceId],
            runIds: [q.runId],
            reasons: [q.reason],
          },
        });
      }
    }
  }
  const queries = [...byCanonical.values()].map(v => v.link);
  queries.sort((a, b) =>
    b.sourceEvidenceCount - a.sourceEvidenceCount || canonicalQueryKey(a.queryText).localeCompare(canonicalQueryKey(b.queryText)));

  // ---- evidence 聚合（去重）----
  const evidenceSeen = new Set<string>();
  let evidenceCount = 0;
  for (const q of queries) {
    for (const id of q.evidenceIds) {
      if (evidenceSeen.has(id)) continue;
      evidenceSeen.add(id);
      evidenceCount += 1;
    }
  }

  const engines = dedupeEngines(queries.flatMap(q => q.engines));
  const targetQueryCount = queries.length;
  const findingIds = [...new Set(members.flatMap(r => r.findingIds))];

  // ---- competitors：只来自已审核语义 ----
  const competitorNames = new Set<string>();
  for (const r of members) {
    if (r.competitorName && approved.has(r.competitorName.toLowerCase())) competitorNames.add(r.competitorName);
    for (const f of r.findings) {
      if (f.competitorName && approved.has(f.competitorName.toLowerCase())) competitorNames.add(f.competitorName);
    }
  }
  const competitors = [...competitorNames]
    .map(name => ({ canonicalName: name, competitorType: approved.get(name.toLowerCase()) ?? null }))
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));

  const categoryLabel = cluster.category ? CATEGORY_CN[cluster.category] ?? cluster.category : null;
  const titleDirection = buildTitleDirection(cluster, categoryLabel, competitors.length > 0 ? competitors[0].canonicalName : null);
  const representativeQuery = queries.length > 0
    ? queries.reduce((best, q) => q.sourceEvidenceCount > best.sourceEvidenceCount || (q.sourceEvidenceCount === best.sourceEvidenceCount && canonicalQueryKey(q.queryText).localeCompare(canonicalQueryKey(best.queryText)) < 0) ? q : best, queries[0]).queryText
    : null;

  // ---- priority（§28 公式；weights 集中）----
  const recScore = avg(members.map(r => Math.max(0, Math.min(100, r.priorityScore))));
  const coverageScore = clampScore(targetQueryCount * 12.5); // 8 个 Query → 100
  const competitorScore = competitorSignalScore(members.flatMap(r => r.findings), competitors.length > 0);
  const engineScore = engines.length >= 2 ? 100 : engines.length === 1 ? 60 : 0;
  let score = clampScore(Math.round(recScore * 0.45 + coverageScore * 0.25 + competitorScore * 0.15 + engineScore * 0.15));
  let dataQualityLimited = false;
  if (hasDq && spec.effort === 'HIGH') { score = Math.min(score, 49); dataQualityLimited = true; }
  const priority = priorityLabelOf(score);

  const signals = unionSignals(spec.signals, members.map(r => r.expectedSignal).filter((s): s is ExpectedSignal => Boolean(s)));
  const rationale = buildRationale(members, targetQueryCount, evidenceCount, engines, competitors, categoryLabel, dataQualityLimited);
  const summary = buildSummary(cluster.primary, categoryLabel, members, targetQueryCount, competitors.length);

  return {
    opportunityType: cluster.primary,
    contentIntent: cluster.intent,
    assetType: cluster.primary,
    alternativeAssetTypes: alts,
    titleDirection,
    summary,
    rationale,
    priority,
    priorityScore: score,
    category: cluster.category,
    effortLevel: spec.effort,
    expectedSignals: signals,
    representativeQuery,
    targetQueryCount,
    targetEngineCount: engines.length,
    targetCompetitorCount: competitors.length,
    evidenceCount,
    recommendationCount: members.length,
    recommendationIds: members.map(r => r.id).sort(),
    findingIds,
    queries,
    engines,
    competitors,
    blocks: BLOCK_TEMPLATES[cluster.primary].map((b, i) => ({ ...b, sortOrder: i })),
    dataQualityLimited,
    metadata: {
      alternativeAssetTypes: alts,
      blockedByDataQuality: false,
      dampedByDataQuality: dataQualityLimited,
      sourceRecommendationTypes: [...new Set(members.map(r => r.recommendationType))].sort(),
    },
  };
}

function mergeNullable(current: boolean | null, incoming: boolean | null, optimistic: boolean): boolean | null {
  if (current === null) return incoming;
  if (incoming === null) return current;
  return optimistic ? current || incoming : current && incoming;
}

function buildTitleDirection(cluster: Cluster, categoryLabel: string | null, competitor: string | null): string {
  switch (cluster.primary) {
    case 'USE_CASE_PAGE':
      return categoryLabel ? `${categoryLabel}类场景内容覆盖` : TITLE_DIRECTION.USE_CASE_PAGE;
    case 'FAQ_PAGE':
      return categoryLabel ? `${categoryLabel}相关问题解答内容` : TITLE_DIRECTION.FAQ_PAGE;
    case 'GUIDE':
      return categoryLabel ? `${categoryLabel}使用指南内容` : TITLE_DIRECTION.GUIDE;
    case 'COMPARISON_PAGE':
      return competitor ? `与 ${competitor} 的适用场景差异内容` : TITLE_DIRECTION.COMPARISON_PAGE;
    case 'ENTITY_OVERVIEW':
      return categoryLabel ? `${categoryLabel}场景中的品牌实体说明内容` : TITLE_DIRECTION.ENTITY_OVERVIEW;
    case 'CONTENT_REFRESH':
      return categoryLabel ? `${categoryLabel}内容更新与口径统一` : TITLE_DIRECTION.CONTENT_REFRESH;
    case 'CLARIFICATION_CONTENT':
      return categoryLabel ? `${categoryLabel}相关误解的澄清说明内容` : TITLE_DIRECTION.CLARIFICATION_CONTENT;
    default:
      return TITLE_DIRECTION[cluster.primary];
  }
}

function unionSignals(base: ExpectedSignal[], extra: ExpectedSignal[]): ExpectedSignal[] {
  const set = new Set<ExpectedSignal>(base);
  for (const e of extra) if (e) set.add(e);
  return [...set].sort();
}

function buildRationale(
  members: OpportunityRecommendationInput[],
  targetQueryCount: number,
  evidenceCount: number,
  engines: OpportunityEngineFact[],
  competitors: Array<{ canonicalName: string; competitorType: string | null }>,
  categoryLabel: string | null,
  dataQualityLimited: boolean,
): string {
  const types = [...new Set(members.map(r => r.recommendationType))].sort();
  const engineText = engines.map(e => e.engineName || e.engineKey).join(' / ') || '暂无模型证据';
  const competitorText = competitors.length > 0
    ? `关联已审核竞品：${competitors.map(c => c.canonicalName).join('、')}`
    : '当前无已审核竞品关联';
  const memberFacts = members.slice(0, 3).map(r => `「${r.title}」：${truncate(r.summary, 56)}`).join('；');
  return `该内容机会来自 ${members.length} 条优化建议（${types.join(' / ')}），` +
    (categoryLabel ? `围绕「${categoryLabel}」场景，` : '') +
    `覆盖 ${targetQueryCount} 个测试问题，关联 ${evidenceCount} 条证据；涉及模型：${engineText}；${competitorText}。` +
    (memberFacts ? ` 建议依据：${memberFacts}` : '') +
    (dataQualityLimited ? ' 注意：当前诊断含数据质量提示，本机会为高成本内容，已被系统降级（不建议在小样本上自动优先）。' : '') +
    '（该机会为内容任务 brief，不保证指标提升；实际效果需在 M7D 以相同 Benchmark 复测验证。）';
}

function buildSummary(
  type: OpportunityType,
  categoryLabel: string | null,
  members: OpportunityRecommendationInput[],
  targetQueryCount: number,
  competitorCount: number,
): string {
  const scope = categoryLabel ? `「${categoryLabel}」场景` : '相关场景';
  const coverage = `${targetQueryCount} 个测试问题`;
  const competitorPart = competitorCount > 0 ? `，对照 ${competitorCount} 个已审核竞品的信号` : '';
  const head = members[0];
  switch (type) {
    case 'USE_CASE_PAGE':
    case 'GUIDE':
      return `${scope}存在内容/问题覆盖缺口：建议建设能直接回答“何时该用、能完成什么任务”的说明型内容，覆盖 ${coverage}${competitorPart}。`;
    case 'COMPARISON_PAGE':
      return `建议基于已审核竞品信号建设对比型内容，以真实差异（适用对象/专用场景/能力边界）帮助 AI 识别品牌为可选方案，关联 ${coverage}。`;
    case 'ENTITY_OVERVIEW':
    case 'PRODUCT_PAGE':
      return `建议以稳定的实体与能力表述建设说明型内容，让 AI 可一致理解品牌是什么、服务谁、能完成什么任务，覆盖 ${coverage}。`;
    case 'FAQ_PAGE':
      return `建议按相似问题聚类补充问答结构，直接覆盖 ${coverage} 中反复出现的用户问题类型，而非逐条机械建页。`;
    case 'DATA_REFERENCE':
    case 'DOCUMENTATION':
    case 'CASE_STUDY':
      return `建议准备稳定可引用的事实/案例/说明资产（含来源与更新时间），供模型在合适上下文引用；覆盖 ${coverage}。`;
    case 'CLARIFICATION_CONTENT':
      return `建议针对 ${scope} 中出现的易误解信息补充准确澄清说明（基于真实事实，不自动发布公关内容）。`;
    case 'CONTENT_REFRESH':
      return `建议对 ${scope} 相关既有内容做口径更新与实体表述统一，覆盖 ${coverage}。`;
    default:
      return head ? truncate(head.summary, 120) : `${scope}内容机会（覆盖 ${coverage}）。`;
  }
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
