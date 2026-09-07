// ============================================================================
// M8C/M8D — Pilot Review 合成（deterministic 纯函数）
// ============================================================================
// PilotReview 是把以下事实合成为“一次性观察结果快照”：
//   - measurement validity（M8A：baseline/after 的测量有效性）
//   - execution validity（变更是否被 AFTER snapshot 的 hash 证实）
//   - comparison verdict（M7D evaluation 的 compatibility）
//   - evaluation outcome（M7D 引擎输出）
// 原则：
//   - observedOutcome 只是“观察结果”，不是 causal claim。
//   - INVALID_MEASUREMENT / CHANGE_NOT_VERIFIED 优先于任何“看起来变好”的结论。
//   - attributionConfidence 第一版只有 LOW / MEDIUM（无 control group / repeat /
//     stable measurement 之前不做 HIGH）。
//   - 全 deterministic；无 Prisma / HTTP / env / LLM。

export const CHANGE_PLAN_VERSION = 'geolens-change-plan-v1';
export const PILOT_REVIEW_VERSION = 'geolens-pilot-review-v1';

export type PilotObservedOutcome =
  | 'VALIDATED_OBSERVATION'
  | 'MIXED_OBSERVATION'
  | 'NO_CLEAR_OBSERVATION'
  | 'NEGATIVE_OBSERVATION'
  | 'INCONCLUSIVE'
  | 'INVALID_MEASUREMENT'
  | 'CHANGE_NOT_VERIFIED';

export type ExecutionValidity = 'CHANGE_VERIFIED' | 'CHANGE_NOT_OBSERVED' | 'NOT_RECORDED';

export type AttributionConfidence = 'LOW' | 'MEDIUM';

/** M7D Evaluation outcome → Pilot 观察结果（仅在测量/执行 guard 均通过后使用）。 */
export const EVALUATION_OUTCOME_TO_PILOT: Record<string, PilotObservedOutcome> = {
  IMPROVED_SIGNALS: 'VALIDATED_OBSERVATION',
  MIXED_SIGNALS: 'MIXED_OBSERVATION',
  NO_CLEAR_CHANGE: 'NO_CLEAR_OBSERVATION',
  REGRESSED_SIGNALS: 'NEGATIVE_OBSERVATION',
  INCONCLUSIVE: 'INCONCLUSIVE',
};

export interface PilotReviewInput {
  /** M8A 聚合后的测量判定（baseline/after evidence retrievalMode 集合） */
  measurementVerdict: string; // VALID_FOR_WEB_CHANGE / PARTIALLY_VALID / INVALID_FOR_WEB_CHANGE / UNKNOWN
  measurementMode?: string | null;
  measurementWarnings?: string[];
  /** 变更是否被 AFTER snapshot hash 证实 */
  executionValidity: ExecutionValidity;
  /** M7D compatibility verdict */
  comparisonVerdict?: string | null; // CONTROLLED_COMPARABLE / PARTIALLY_COMPARABLE / NOT_COMPARABLE
  /** M7D evaluation outcome */
  evaluationOutcome?: string | null;
  /** after evidence 是否引用/观察到修改后的资产（TRUE/FALSE/UNKNOWN） */
  changedAssetCited?: boolean | null;
  retrievalObservedForChangedAsset?: 'TRUE' | 'FALSE' | 'UNKNOWN' | null;
}

export interface PilotReviewResult {
  observedOutcome: PilotObservedOutcome;
  attributionConfidence: AttributionConfidence;
  reasons: string[];
}

/**
 * 合成 Pilot Review 快照。优先级（deterministic）：
 *   1) execution 未证实 → CHANGE_NOT_VERIFIED
 *   2) 测量 INVALID（且目标是网页变化）→ INVALID_MEASUREMENT
 *   3) 测量 PARTIALLY/UNKNOWN → INCONCLUSIVE（不能把 api_plain 当网页验证）
 *   4) comparison 不可比 → INCONCLUSIVE
 *   5) 以上都通过 → evaluation outcome 映射
 * attributionConfidence：
 *   MEDIUM 仅当 execution CHANGE_VERIFIED + 测量 VALID + comparison 可控可比 +
 *   retrievalObserved != FALSE；否则 LOW。
 */
export function synthesizePilotReview(input: PilotReviewInput): PilotReviewResult {
  const reasons: string[] = [];
  const execution = input.executionValidity;

  if (execution === 'CHANGE_NOT_OBSERVED' || execution === 'NOT_RECORDED') {
    return {
      observedOutcome: 'CHANGE_NOT_VERIFIED',
      attributionConfidence: 'LOW',
      reasons: [execution === 'CHANGE_NOT_OBSERVED'
        ? 'AFTER 资产快照与 BEFORE 一致（hash 未变化）—— 变更未被证实，实验无效。'
        : '执行记录/变更快照缺失 —— 无法确认真实变更已发生。'],
    };
  }

  const verdict = input.measurementVerdict;
  if (verdict === 'INVALID_FOR_WEB_CHANGE') {
    return {
      observedOutcome: 'INVALID_MEASUREMENT',
      attributionConfidence: 'LOW',
      reasons: [...(input.measurementWarnings ?? []),
        '测量路径为 api_plain / 演示来源，无法证明模型读取了修改后的公开网页 —— 不能作为真实网页优化验证。'],
    };
  }
  if (verdict === 'PARTIALLY_VALID' || verdict === 'UNKNOWN') {
    return {
      observedOutcome: 'INCONCLUSIVE',
      attributionConfidence: 'LOW',
      reasons: [...(input.measurementWarnings ?? []),
        verdict === 'PARTIALLY_VALID'
          ? '测量路径仅部分有效（含 api_plain / 未确认检索）—— 结果暂无法稳定归因网页变化。'
          : '测量有效性未知 —— 结果暂无法判定。'],
    };
  }

  const comparison = input.comparisonVerdict;
  if (comparison && comparison !== 'CONTROLLED_COMPARABLE' && comparison !== 'PARTIALLY_COMPARABLE') {
    return {
      observedOutcome: 'INCONCLUSIVE',
      attributionConfidence: 'LOW',
      reasons: ['Before/After 口径不可比（' + comparison + '）—— 不能输出观察结果。'],
    };
  }

  const outcome = input.evaluationOutcome
    ? (EVALUATION_OUTCOME_TO_PILOT[input.evaluationOutcome] ?? 'INCONCLUSIVE')
    : 'INCONCLUSIVE';
  reasons.push('M7D Evaluation outcome=' + (input.evaluationOutcome ?? 'null') + ' → Pilot 观察=' + outcome);

  // attribution confidence（保守）：
  let confidence: AttributionConfidence = 'LOW';
  if (execution === 'CHANGE_VERIFIED' &&
      verdict === 'VALID_FOR_WEB_CHANGE' &&
      comparison === 'CONTROLLED_COMPARABLE' &&
      input.retrievalObservedForChangedAsset !== 'FALSE' &&
      input.changedAssetCited !== false) {
    confidence = 'MEDIUM';
    reasons.push('执行已证实 + 测量有效 + 口径可控可比 → 归因置信 MEDIUM（仍非因果证明）。');
  } else {
    reasons.push('归因置信 LOW（缺少 control/repeat/stable measurement，不构成因果证明）。');
  }

  return { observedOutcome: outcome, attributionConfidence: confidence, reasons };
}

/** M7C Opportunity Block → OptimizationChangeItem 输入（编辑说明模板，非正文）。 */
export interface OpportunityBlockLike {
  blockType: string;
  title: string;
  purpose: string;
  sortOrder?: number | null;
}

export interface ChangeItemSeed {
  section: string;
  changeType: string;
  instruction: string;
  reason: string;
  sortOrder: number;
}

/** blockType → 建议 changeType（确定性；未映射 → OTHER）。 */
export const BLOCK_TO_CHANGE_TYPE: Record<string, string> = {
  USER_SCENARIO: 'ADD_USE_CASE',
  CORE_TASKS: 'ADD_USE_CASE',
  APPLICABLE_USERS: 'CLARIFY_ENTITY',
  PRODUCT_CAPABILITY: 'CLARIFY_ENTITY',
  COMPARISON_DIMENSIONS: 'ADD_COMPARISON_INFO',
  DIFFERENTIATION: 'ADD_COMPARISON_INFO',
  VERIFIABLE_FACTS: 'ADD_VERIFIABLE_FACT',
  FAQ: 'ADD_FAQ',
  SOURCE_REFERENCE: 'ADD_SOURCE_REFERENCE',
  USAGE_FLOW: 'UPDATE_SECTION',
  DEFINITION: 'CLARIFY_ENTITY',
  BOUNDARY: 'CLARIFY_ENTITY',
  METHOD: 'UPDATE_SECTION',
  UPDATE_TIME: 'UPDATE_SECTION',
  CITATION_METHOD: 'ADD_SOURCE_REFERENCE',
};

/**
 * 从 M7C 建议结构块生成 Change Item seed：
 *   section = block.title；instruction 是“在哪里放什么类型的事实”的编辑说明，
 *   reason 来自 block.purpose。绝不生成最终正文 / 营销文案。
 */
export function blocksToChangeItems(blocks: OpportunityBlockLike[]): ChangeItemSeed[] {
  return blocks
    .map((block, index) => ({
      section: block.title,
      changeType: BLOCK_TO_CHANGE_TYPE[block.blockType] ?? 'OTHER',
      instruction: `在「${block.title}」区块补充与页面主题一致的${zhSuffix(block)}；内容必须为可核实的真实信息，禁止编造数据、案例或引用。`,
      reason: `建议结构块用途：${block.purpose}`,
      sortOrder: block.sortOrder ?? index,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function zhSuffix(block: OpportunityBlockLike): string {
  const type = block.blockType;
  if (type === 'FAQ') return '问答内容';
  if (type === 'VERIFIABLE_FACTS') return '事实条目';
  if (type === 'COMPARISON_DIMENSIONS' || type === 'DIFFERENTIATION') return '对比维度说明';
  return '结构化信息';
}
