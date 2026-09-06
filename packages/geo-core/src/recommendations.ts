/**
 * M7B GEO Optimization Recommendations —— 确定性、Diagnosis-backed 优化建议引擎。
 *
 * 语义边界：
 *   - Recommendation = 优化假设 / 行动建议（hypothesis-backed action），不是事实、
 *     不是因果证明、不是效果承诺；效果必须经 M7D 复测验证。
 *   - 绝不凭空生成：每条 Recommendation 必须绑定 ≥1 个 DiagnosisFinding
 *     （Recommendation→RecommendationFinding→DiagnosisFinding→FindingEvidence→Evidence）。
 *   - Finding→Strategy 映射、clustering/dedup、priority/effort/expectedSignal、
 *     ActionItems 全部确定性规则；不引入 LLM、不 import DB/HTTP/env、不读当前项目。
 *   - 集中常量与集中配置（RECOMMENDATION_VERSION / TYPE 中文映射归 UI labels）。
 */
export const RECOMMENDATION_VERSION = 'geolens-recommendation-v1';

export type RecommendationType =
  | 'ENTITY_CLARITY' | 'POSITIONING_CLARITY' | 'CATEGORY_COVERAGE' | 'QUERY_COVERAGE'
  | 'RECOMMENDATION_READINESS' | 'COMPETITOR_DIFFERENTIATION' | 'CITATION_READINESS'
  | 'STRUCTURED_INFORMATION' | 'PROVIDER_COVERAGE' | 'SENTIMENT_RESPONSE' | 'DATA_COLLECTION';

export type ActionType =
  | 'UPDATE_PRODUCT_DEFINITION' | 'CLARIFY_TARGET_AUDIENCE' | 'CLARIFY_CORE_USE_CASES'
  | 'ADD_SCENARIO_COVERAGE' | 'ADD_COMPARISON_INFORMATION' | 'ADD_FAQ_STRUCTURE'
  | 'ADD_EVIDENCE_AND_PROOF' | 'ADD_SOURCE_ATTRIBUTION' | 'ADD_ENTITY_CONSISTENCY'
  | 'ADD_COMPETITOR_DIFFERENTIATION' | 'ADD_PROVIDER_RELEVANT_CONTENT'
  | 'REVIEW_NEGATIVE_SIGNAL' | 'COLLECT_MORE_DATA';

export type RecommendationFindingType =
  | 'LOW_VISIBILITY' | 'LOW_RECOMMENDATION' | 'CATEGORY_GAP' | 'QUERY_GAP'
  | 'PROVIDER_GAP' | 'COMPETITOR_DOMINANCE' | 'COMPETITOR_RECOMMENDED_TARGET_ABSENT'
  | 'POOR_MENTION_POSITION' | 'CITATION_GAP' | 'SENTIMENT_RISK' | 'DATA_QUALITY_WARNING';

export type PriorityLabel = 'HIGH' | 'MEDIUM' | 'LOW';
export type EffortLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RecommendationFindingFact {
  id: string;
  findingType: RecommendationFindingType;
  severity: string; // HIGH/MEDIUM/LOW/INFO
  title: string;
  summary: string;
  category: string | null;
  competitorName: string | null;
  priorityScore: number;
  queryCount: number;
  evidenceCount: number;
}

export interface RecommendationInput {
  recommendationVersion: string;
  diagnosis: { id: string; diagnosisVersion: string; metricSource?: string };
  findings: RecommendationFindingFact[];
}

export interface ActionCandidate {
  actionType: ActionType;
  title: string;
  description: string;
  sortOrder: number;
  effortLevel: EffortLevel;
  verificationMethod: string | null;
}

export interface RecommendationCandidate {
  recommendationType: RecommendationType;
  title: string;
  summary: string;
  rationale: string;
  priority: PriorityLabel;
  priorityScore: number;
  impactArea: string;
  targetAssetType: string | null;
  expectedSignal: string | null;
  effortLevel: EffortLevel | null;
  category: string | null;
  competitorName: string | null;
  findingCount: number;
  evidenceCount: number;
  findingIds: string[];
  actions: ActionCandidate[];
}

export interface RecommendationSummary {
  priorityCounts: Record<PriorityLabel, number>;
  recommendationCount: number;
  actionItemCount: number;
  directions: string[]; // 主要优化方向（impactArea 中文在 UI 映射）
  dataQualityDamped: boolean;
}

const DEFAULT_VERIFY = '完成后使用相同 Benchmark Suite 复测对应测试问题（M7D 验证），不承诺固定提升幅度。';

// ---------------------------------------------------------------------------
// 集中配置（内部启发式；非行业标准）
// ---------------------------------------------------------------------------
interface TypeSpec {
  impactArea: string;
  targetAssetType: string | null;
  expectedSignal: string | null;
  effort: EffortLevel;
  weight: number; // priority 权重 0-100
}

export const RECOMMENDATION_TYPE_RULES: Record<RecommendationType, TypeSpec> = {
  ENTITY_CLARITY: { impactArea: 'ENTITY', targetAssetType: 'PRODUCT_PAGE', expectedSignal: 'ENTITY_UNDERSTANDING', effort: 'LOW', weight: 55 },
  POSITIONING_CLARITY: { impactArea: 'POSITIONING', targetAssetType: 'HOMEPAGE', expectedSignal: 'RECOMMENDATION', effort: 'LOW', weight: 45 },
  CATEGORY_COVERAGE: { impactArea: 'CONTENT_COVERAGE', targetAssetType: 'USE_CASE_PAGE', expectedSignal: 'CATEGORY_COVERAGE', effort: 'MEDIUM', weight: 60 },
  QUERY_COVERAGE: { impactArea: 'CONTENT_COVERAGE', targetAssetType: 'FAQ', expectedSignal: 'VISIBILITY', effort: 'MEDIUM', weight: 55 },
  RECOMMENDATION_READINESS: { impactArea: 'RECOMMENDATION', targetAssetType: 'PRODUCT_PAGE', expectedSignal: 'RECOMMENDATION', effort: 'MEDIUM', weight: 58 },
  COMPETITOR_DIFFERENTIATION: { impactArea: 'COMPETITIVE', targetAssetType: 'COMPARISON_PAGE', expectedSignal: 'COMPETITOR_SOV', effort: 'MEDIUM', weight: 62 },
  CITATION_READINESS: { impactArea: 'CITATION', targetAssetType: 'CASE_STUDY', expectedSignal: 'CITATION', effort: 'LOW', weight: 40 },
  STRUCTURED_INFORMATION: { impactArea: 'STRUCTURE', targetAssetType: 'STRUCTURED_DATA', expectedSignal: 'ENTITY_UNDERSTANDING', effort: 'MEDIUM', weight: 42 },
  PROVIDER_COVERAGE: { impactArea: 'PROVIDER', targetAssetType: 'FEATURE_PAGE', expectedSignal: 'VISIBILITY', effort: 'MEDIUM', weight: 50 },
  SENTIMENT_RESPONSE: { impactArea: 'SENTIMENT', targetAssetType: 'PRODUCT_PAGE', expectedSignal: null, effort: 'LOW', weight: 48 },
  DATA_COLLECTION: { impactArea: 'DATA_QUALITY', targetAssetType: null, expectedSignal: null, effort: 'LOW', weight: 45 },
};

/** Finding → Strategy 确定性映射（含可能的多策略与聚类上下文）。 */
interface MappingEntry { type: RecommendationType; categoryKey: 'finding.category' | 'overall'; competitorKey: 'finding.competitor' | null }
const FINDING_TO_STRATEGY: Record<RecommendationFindingType, MappingEntry[]> = {
  LOW_VISIBILITY: [{ type: 'ENTITY_CLARITY', categoryKey: 'overall', competitorKey: null }, { type: 'CATEGORY_COVERAGE', categoryKey: 'overall', competitorKey: null }],
  LOW_RECOMMENDATION: [{ type: 'RECOMMENDATION_READINESS', categoryKey: 'overall', competitorKey: null }],
  CATEGORY_GAP: [{ type: 'CATEGORY_COVERAGE', categoryKey: 'finding.category', competitorKey: null }],
  QUERY_GAP: [{ type: 'QUERY_COVERAGE', categoryKey: 'finding.category', competitorKey: null }],
  PROVIDER_GAP: [{ type: 'PROVIDER_COVERAGE', categoryKey: 'overall', competitorKey: null }],
  COMPETITOR_DOMINANCE: [{ type: 'COMPETITOR_DIFFERENTIATION', categoryKey: 'overall', competitorKey: 'finding.competitor' }],
  COMPETITOR_RECOMMENDED_TARGET_ABSENT: [
    { type: 'COMPETITOR_DIFFERENTIATION', categoryKey: 'overall', competitorKey: null },
    { type: 'RECOMMENDATION_READINESS', categoryKey: 'overall', competitorKey: null },
  ],
  POOR_MENTION_POSITION: [{ type: 'POSITIONING_CLARITY', categoryKey: 'overall', competitorKey: null }],
  CITATION_GAP: [{ type: 'CITATION_READINESS', categoryKey: 'overall', competitorKey: null }],
  SENTIMENT_RISK: [{ type: 'SENTIMENT_RESPONSE', categoryKey: 'overall', competitorKey: null }],
  DATA_QUALITY_WARNING: [{ type: 'DATA_COLLECTION', categoryKey: 'overall', competitorKey: null }],
};

// 各类型行动项模板（checklist，不直接执行；sortOrder 确定性）
const ACTION_TEMPLATES: Record<RecommendationType, Array<{ actionType: ActionType; title: string; description: string; effortLevel: EffortLevel }>> = {
  ENTITY_CLARITY: [
    { actionType: 'UPDATE_PRODUCT_DEFINITION', title: '明确产品一句话定义', description: '让 AI 可稳定获取「ProjectMentor 是什么」的明确表述（品牌实体与类别归属）。', effortLevel: 'LOW' },
    { actionType: 'CLARIFY_TARGET_AUDIENCE', title: '明确目标用户', description: '说明主要服务对象与适用人群边界。', effortLevel: 'LOW' },
    { actionType: 'CLARIFY_CORE_USE_CASES', title: '明确 3–5 个核心使用场景', description: '覆盖可完成的任务类型，帮助模型建立场景-品牌映射。', effortLevel: 'LOW' },
    { actionType: 'ADD_ENTITY_CONSISTENCY', title: '保证关键页面实体描述一致', description: '首页/产品页/功能页复用一致的品牌全称、类别词与能力表述。', effortLevel: 'LOW' },
    { actionType: 'ADD_EVIDENCE_AND_PROOF', title: '补充可验证产品事实', description: '事实类描述（能力/边界/可验证指标），不堆砌关键词。', effortLevel: 'MEDIUM' },
  ],
  POSITIONING_CLARITY: [
    { actionType: 'CLARIFY_CORE_USE_CASES', title: '明确任务范围与核心价值', description: '把「解决什么问题、为什么值得选」写清楚，帮助 AI 判断推荐理由。', effortLevel: 'LOW' },
    { actionType: 'ADD_COMPARISON_INFORMATION', title: '给出直接价值声明', description: '在关键页面明确产品相对通用方案的价值（真实、可验证）。', effortLevel: 'LOW' },
    { actionType: 'ADD_EVIDENCE_AND_PROOF', title: '补充证明材料', description: '公开案例/指标/说明，增强可推荐性与排序依据。', effortLevel: 'MEDIUM' },
  ],
  CATEGORY_COVERAGE: [
    { actionType: 'ADD_SCENARIO_COVERAGE', title: '补充该场景的说明型内容资产', description: '针对缺失场景（如工具发现）建立能直接回答「何时该用、能完成什么任务」的页面/章节。', effortLevel: 'MEDIUM' },
    { actionType: 'CLARIFY_TARGET_AUDIENCE', title: '明确该场景适用对象', description: '说明该场景下适合谁、不适合谁（边界清晰，不机械铺量）。', effortLevel: 'LOW' },
    { actionType: 'ADD_FAQ_STRUCTURE', title: '建立场景 FAQ 结构', description: '覆盖高频疑问句，提高被检索并直接作答的概率。', effortLevel: 'MEDIUM' },
    { actionType: 'ADD_ENTITY_CONSISTENCY', title: '保持场景内实体描述一致', description: '该场景相关页面统一品牌与能力表述。', effortLevel: 'LOW' },
  ],
  QUERY_COVERAGE: [
    { actionType: 'ADD_FAQ_STRUCTURE', title: '覆盖缺失用户问题的 FAQ 结构', description: '按相似问题类型聚合（如商业计划书/项目策划/市场分析），避免逐条机械建页。', effortLevel: 'MEDIUM' },
    { actionType: 'CLARIFY_CORE_USE_CASES', title: '说明问题与产品任务的对应关系', description: '让 AI 能将该类问题映射到可用产品能力。', effortLevel: 'LOW' },
    { actionType: 'ADD_SCENARIO_COVERAGE', title: '补齐场景说明', description: '针对高频缺失问题提供场景化信息，不做关键词堆砌。', effortLevel: 'MEDIUM' },
  ],
  RECOMMENDATION_READINESS: [
    { actionType: 'CLARIFY_TARGET_AUDIENCE', title: '说明适用人群与条件', description: '哪些人、什么条件下适合选择，帮助 AI 给出有依据的推荐。', effortLevel: 'LOW' },
    { actionType: 'CLARIFY_CORE_USE_CASES', title: '说明核心能力与适用边界', description: '能力与局限都清楚，避免被泛化误判。', effortLevel: 'LOW' },
    { actionType: 'ADD_EVIDENCE_AND_PROOF', title: '补充可验证案例与价值证据', description: '案例/数据/使用流程等支持推荐判断的事实。', effortLevel: 'MEDIUM' },
  ],
  COMPETITOR_DIFFERENTIATION: [
    { actionType: 'ADD_COMPETITOR_DIFFERENTIATION', title: '明确与竞品/通用方案的差异', description: '适用人群、核心差异、专用场景与不可替代价值（真实差异，不贬低竞品、不编造数据）。', effortLevel: 'MEDIUM' },
    { actionType: 'ADD_COMPARISON_INFORMATION', title: '补可比较信息', description: '让 AI 在该任务下能识别品牌是一个可选方案：适用对象/流程/输出/与通用 AI 差异。', effortLevel: 'MEDIUM' },
    { actionType: 'ADD_SCENARIO_COVERAGE', title: '补场景表达', description: '覆盖竞品常被推荐的场景中的品牌表达。', effortLevel: 'MEDIUM' },
  ],
  CITATION_READINESS: [
    { actionType: 'ADD_SOURCE_ATTRIBUTION', title: '建立稳定可引用的信息资产', description: '明确事实/可验证数据/公开案例/产品说明，配稳定 URL 与来源归属。', effortLevel: 'LOW' },
    { actionType: 'ADD_EVIDENCE_AND_PROOF', title: '补充可验证证据', description: '供模型在合适上下文引用；不做「域名权威度不足」式因果断言。', effortLevel: 'MEDIUM' },
  ],
  STRUCTURED_INFORMATION: [
    { actionType: 'ADD_FAQ_STRUCTURE', title: '结构化常见问答', description: '让实体关系与问答结构更清晰，便于模型抽取。', effortLevel: 'MEDIUM' },
    { actionType: 'ADD_ENTITY_CONSISTENCY', title: '结构化品牌实体信息', description: '统一品牌/能力/场景的机器可读表述（结构化信息，非最终 Schema 输出）。', effortLevel: 'MEDIUM' },
  ],
  PROVIDER_COVERAGE: [
    { actionType: 'ADD_PROVIDER_RELEVANT_CONTENT', title: '检查弱势模型环境中的高频问题覆盖', description: '核对品牌实体表述、场景覆盖与竞品共同特征在弱势 Provider 中的表现，不声称“模型偏见”。', effortLevel: 'MEDIUM' },
    { actionType: 'ADD_ENTITY_CONSISTENCY', title: '保持实体表述稳定', description: '确保不同 Provider 都能读到一致的品牌与场景信息。', effortLevel: 'LOW' },
  ],
  SENTIMENT_RESPONSE: [
    { actionType: 'REVIEW_NEGATIVE_SIGNAL', title: '人工复核负面表达来源', description: '逐条核对 Evidence：确认是否规则误判；检查产品事实说明与易误解信息，必要时补准确说明。', effortLevel: 'LOW' },
  ],
  DATA_COLLECTION: [
    { actionType: 'COLLECT_MORE_DATA', title: '扩大真实检测样本', description: '扩展 Benchmark / 补足 Provider coverage / 降低失败率 / 统一 Analysis 口径后，再评估高成本优化。', effortLevel: 'LOW' },
  ],
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function clampScore(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function priorityLabelOf(score: number): PriorityLabel {
  return score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
}

interface ClusterKey { type: RecommendationType; category: string | null; competitor: string | null }

function keyOf(type: RecommendationType, category: string | null, competitor: string | null): string {
  return `${type}|${category ?? ''}|${competitor ?? ''}`;
}

// ---------------------------------------------------------------------------
// Core: Finding → clusters（mapping + dedup by type/category/competitor）
// ---------------------------------------------------------------------------
export function runRecommendations(input: RecommendationInput): { recommendations: RecommendationCandidate[]; summary: RecommendationSummary } {
  const findings = input.findings;
  if (findings.length === 0) {
    return { recommendations: [], summary: emptySummary() };
  }

  // 1) map each finding to strategy entries
  const clusters = new Map<string, { key: ClusterKey; findingIds: string[] }>();
  for (const f of findings) {
    const mapping = FINDING_TO_STRATEGY[f.findingType];
    if (!mapping) continue;
    for (const entry of mapping) {
      const category = entry.categoryKey === 'finding.category' ? f.category : null;
      const competitor = entry.competitorKey === 'finding.competitor' ? f.competitorName : null;
      const k = keyOf(entry.type, category, competitor);
      const existing = clusters.get(k);
      if (existing) existing.findingIds.push(f.id);
      else clusters.set(k, { key: { type: entry.type, category, competitor }, findingIds: [f.id] });
    }
  }

  // 2) data-quality guard：run 内存在 HIGH/MEDIUM 的 DATA_QUALITY_WARNING → 高成本建议降优先
  const hasDataQualityIssue = findings.some(f =>
    f.findingType === 'DATA_QUALITY_WARNING' && (f.severity === 'HIGH' || f.severity === 'MEDIUM'));

  const candidates: RecommendationCandidate[] = [];
  for (const cluster of clusters.values()) {
    const members = cluster.findingIds
      .map(id => findings.find(f => f.id === id))
      .filter((f): f is RecommendationFindingFact => Boolean(f));
    if (members.length === 0) continue;
    candidates.push(buildCandidate(cluster.key, members, hasDataQualityIssue));
  }

  // 3) deterministic sort：score desc → type → title
  candidates.sort((a, b) =>
    b.priorityScore - a.priorityScore || a.recommendationType.localeCompare(b.recommendationType) || a.title.localeCompare(b.title));

  const summary = buildSummary(candidates, hasDataQualityIssue);
  return { recommendations: candidates, summary };
}

function emptySummary(): RecommendationSummary {
  return { priorityCounts: { HIGH: 0, MEDIUM: 0, LOW: 0 }, recommendationCount: 0, actionItemCount: 0, directions: [], dataQualityDamped: false };
}

function buildCandidate(key: ClusterKey, members: RecommendationFindingFact[], hasDataQualityIssue: boolean): RecommendationCandidate {
  const spec = RECOMMENDATION_TYPE_RULES[key.type];
  const typeTitle = TITLE_BY_TYPE[key.type];
  const baseScore = spec.weight * 0.35
    + avg(members.map(m => m.priorityScore)) * 0.35
    + Math.min(25, members.length * 6) * 0.8   // coverage 0..20
    + (members.some(m => m.severity === 'HIGH') ? 8 : 0);
  let score = clampScore(baseScore);
  let damped = false;
  // DataQualityGuard：小样本/失败率高时不让「高成本改造」排 HIGH
  if (hasDataQualityIssue && spec.effort === 'HIGH') { score = Math.min(score, 49); damped = true; }
  const priority = priorityLabelOf(score);
  const findingTypes = [...new Set(members.map(m => m.findingType))];
  const affectedQueries = members.reduce((s, m) => s + Math.max(0, m.queryCount), 0);
  const evidenceCount = members.reduce((s, m) => s + Math.max(0, m.evidenceCount), 0);

  const rationale =
    `该建议来自 ${members.length} 条 ${findingTypes.join(' / ')} 诊断` +
    (affectedQueries > 0 ? `，覆盖 ${affectedQueries} 个受影响测试问题` : '') +
    `。${members.slice(0, 2).map(m => `「${m.title}」：${truncate(m.summary, 60)}`).join('；')}` +
    (damped ? '。注意：当前诊断含数据质量提示，本建议已被系统下调优先级（高成本改造不建议在小样本上自动优先）。' : '');

  return {
    recommendationType: key.type,
    title: typeTitle,
    summary: buildSummaryText(key.type, members, key.category),
    rationale,
    priority,
    priorityScore: score,
    impactArea: spec.impactArea,
    targetAssetType: spec.targetAssetType,
    expectedSignal: spec.expectedSignal,
    effortLevel: spec.effort,
    category: key.category,
    competitorName: key.competitor,
    findingCount: members.length,
    evidenceCount,
    findingIds: members.map(m => m.id),
    actions: ACTION_TEMPLATES[key.type].map((a, i) => ({
      actionType: a.actionType, title: a.title, description: a.description,
      sortOrder: i, effortLevel: a.effortLevel, verificationMethod: DEFAULT_VERIFY,
    })),
  };
}

function buildSummaryText(type: RecommendationType, members: RecommendationFindingFact[], categoryKey: string | null): string {
  const headline = members[0];
  const area = categoryKey ? `「${categoryKey}」场景` : '';
  const extra = members.length > 1 ? `（另有 ${members.length - 1} 条同类诊断佐证）` : '';
  switch (type) {
    case 'ENTITY_CLARITY':
      return `增强 AI 对品牌实体的稳定理解：${headline ? truncate(headline.summary, 80) : '明确品牌是什么、服务谁、能完成什么任务。'}${extra}`;
    case 'CATEGORY_COVERAGE':
      return `${area}存在品牌可见缺口：${headline ? truncate(headline.summary, 80) : ''} 建议补充该场景可直接回答“何时该用、能完成什么”的说明型信息。${extra}`;
    case 'QUERY_COVERAGE':
      return `${area}存在用户问题类型未被覆盖（${affectedText(members)}）。建议按相似问题聚类补充信息结构，而非逐条机械建页。${extra}`;
    case 'RECOMMENDATION_READINESS':
      return `品牌被提及但推荐信号不足：建议补齐适用人群、适用条件、核心能力与可验证案例，让 AI 有依据地主动推荐。${extra}`;
    case 'COMPETITOR_DIFFERENTIATION':
      return `已审核竞品在测试场景中被推荐/被提及而品牌表现弱：建议以真实差异（适用对象/专用场景/不可替代价值）做差异化表达，不贬低竞品。${extra}`;
    case 'CITATION_READINESS':
      return `当前样本未观察到引用信号：建议准备稳定可引用的事实/案例/说明资产（含 URL 与来源归属），不做权威性因果断言。${extra}`;
    case 'POSITIONING_CLARITY':
      return `品牌已被理解但排序靠后：建议强化核心价值与场景匹配信号（直接价值声明、差异与证明材料）。${extra}`;
    case 'PROVIDER_COVERAGE':
      return `品牌在某模型服务中可见度明显更低：建议检查弱势 Provider 环境中的高频问题覆盖、实体表述与竞品共同特征。${extra}`;
    case 'SENTIMENT_RESPONSE':
      return `存在规则版情感判定为负面的样本：建议人工复核来源并补充准确说明（不自动发布公关内容）。${extra}`;
    case 'DATA_COLLECTION':
      return `当前诊断含数据质量提示（样本/成功率/口径）：建议先扩大真实样本与 Provider 覆盖，再评估高成本优化。${extra}`;
    default:
      return headline ? truncate(headline.summary, 120) : '';
  }
}

function affectedText(members: RecommendationFindingFact[]): string {
  const total = members.reduce((s, m) => s + Math.max(0, m.queryCount), 0);
  return total > 0 ? `共 ${total} 个受影响问题` : '多个受影响问题';
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function buildSummary(candidates: RecommendationCandidate[], damped: boolean): RecommendationSummary {
  const priorityCounts: Record<PriorityLabel, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  const directions = new Set<string>();
  let actionItemCount = 0;
  for (const c of candidates) {
    priorityCounts[c.priority] += 1;
    directions.add(c.impactArea);
    actionItemCount += c.actions.length;
  }
  return {
    priorityCounts,
    recommendationCount: candidates.length,
    actionItemCount,
    directions: [...directions].sort(),
    dataQualityDamped: damped,
  };
}

const TITLE_BY_TYPE: Record<RecommendationType, string> = {
  ENTITY_CLARITY: '增强品牌实体清晰度',
  POSITIONING_CLARITY: '强化核心价值与场景匹配信号',
  CATEGORY_COVERAGE: '增强场景覆盖',
  QUERY_COVERAGE: '覆盖缺失用户问题类型',
  RECOMMENDATION_READINESS: '增强可推荐性信息',
  COMPETITOR_DIFFERENTIATION: '增强与竞品的差异化表达',
  CITATION_READINESS: '增强可引用信息资产准备',
  STRUCTURED_INFORMATION: '结构化信息表达',
  PROVIDER_COVERAGE: '增强弱势模型环境中的覆盖',
  SENTIMENT_RESPONSE: '核查负面表达来源并补充准确说明',
  DATA_COLLECTION: '扩大真实检测样本后再评估高成本优化',
};
