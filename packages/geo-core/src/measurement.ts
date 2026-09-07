// ============================================================================
// M8A — Measurement Validity（真实测量有效性）
// ============================================================================
// 原则：
//   1) retrievalMode / sourceType 是唯一判定依据 —— 绝不按 provider 名称猜。
//   2) api_plain（普通模型 API，无 Web Search/Retrieval 证明）⇒ INVALID_FOR_WEB_CHANGE。
//      “今天改公开网页” 与 “今天 api_plain 输出变化” 之间不构成有效网页 GEO 实验。
//   3) manual_verified（sourceType=manual + retrievalMode=manual_verified，含
//      verifiedBy/verifiedAt/verificationNotes/retrievalConfirmed）⇒ VALID_FOR_WEB_CHANGE
//      —— 用户从官方 AI Web UI 完成真实查询并人工确认检索。
//   4) api_web_search / official_web_ui / browser_agent 必须带“确认真实网页检索”的
//      provenance（fact.retrievalConfirmed === true）才 VALID；否则 PARTIALLY_VALID。
//   5) mock / estimated 永远不能作为真实网页实验测量（demo ≠ real pilot）。
//   6) 全部 deterministic，纯函数，无 Prisma / HTTP / env / LLM。

export type MeasurementVerdict =
  | 'VALID_FOR_WEB_CHANGE'
  | 'PARTIALLY_VALID'
  | 'INVALID_FOR_WEB_CHANGE'
  | 'UNKNOWN';

export type MeasurementMode =
  | 'WEB_VALIDATED'   // 确认检索到真实网页内容
  | 'MANUAL_VERIFIED' // 人工在官方 AI Web UI 查询并确认（fallback）
  | 'MODEL_BEHAVIOR_ONLY' // 仅观测模型 API 行为（api_plain），不构成网页实验
  | 'UNKNOWN';

export interface MeasurementModeFact {
  /** Evidence.retrievalMode（api_plain / manual_verified / api_web_search / …） */
  retrievalMode: string;
  /** Evidence.sourceType（official_api / manual / mock / …） */
  sourceType: string;
  /** 是否确认真实网页检索（browser/web-ui/api-web-search provenance）。默认 false。 */
  retrievalConfirmed?: boolean;
  /** 人工确认字段（manual_verified 必填 provenance）。 */
  manualVerified?: { verifiedBy: string; verifiedAt: string } | null;
}

export interface MeasurementVerdictResult {
  verdict: MeasurementVerdict;
  mode: MeasurementMode;
  reasons: string[];
}

export const MEASUREMENT_FRAMEWORK_VERSION = 'geolens-measurement-v1';

/** 单条 measurement 事实 → 判定（确定性）。 */
export function classifyMeasurementFact(fact: MeasurementModeFact): MeasurementVerdictResult {
  const r = (fact.retrievalMode || '').toLowerCase();
  const s = (fact.sourceType || '').toLowerCase();
  const reasons: string[] = [];

  // mock/estimated 永远不能作为真实网页实验
  if (s === 'mock' || s === 'estimated') {
    return {
      verdict: 'INVALID_FOR_WEB_CHANGE',
      mode: 'UNKNOWN',
      reasons: ['演示/估算来源（' + s + '）不能作为真实网页实验测量。'],
    };
  }

  // manual verified（人工确认；retrievalMode 本身不是 provenance —— 必须带确认字段才 VALID）
  if (r === 'manual_verified' || s === 'manual') {
    const confirmed = fact.retrievalConfirmed === true || Boolean(fact.manualVerified?.verifiedBy);
    if (confirmed) {
      return {
        verdict: 'VALID_FOR_WEB_CHANGE',
        mode: 'MANUAL_VERIFIED',
        reasons: ['人工在官方 AI 产品界面查询并确认检索到网页内容（manual_verified）。'],
      };
    }
    return {
      verdict: 'PARTIALLY_VALID',
      mode: 'MANUAL_VERIFIED',
      reasons: ['人工来源缺少 retrievalConfirmed / verifiedBy provenance，仅部分可信。'],
    };
  }

  // 具备检索语义的模式
  if (r === 'api_web_search' || r === 'official_web_ui' || r === 'browser_agent') {
    if (fact.retrievalConfirmed === true) {
      return {
        verdict: 'VALID_FOR_WEB_CHANGE',
        mode: 'WEB_VALIDATED',
        reasons: ['检索模式 ' + r + ' 且已确认真实网页检索 provenance。'],
      };
    }
    return {
      verdict: 'PARTIALLY_VALID',
      mode: 'WEB_VALIDATED',
      reasons: ['检索模式 ' + r + ' 但缺少 retrievalConfirmed provenance，不能完全确认读到修改后的公开网页。'],
    };
  }

  if (r === 'api_plain') {
    return {
      verdict: 'INVALID_FOR_WEB_CHANGE',
      mode: 'MODEL_BEHAVIOR_ONLY',
      reasons: ['api_plain（普通模型 API）未验证 Web Search / Web Retrieval，输出变化不能证明模型读取了公开网页改动。'],
    };
  }

  if (r === 'unknown' || r === '') {
    return { verdict: 'UNKNOWN', mode: 'UNKNOWN', reasons: ['检索模式未知，无法判定。'] };
  }

  return {
    verdict: 'UNKNOWN',
    mode: 'UNKNOWN',
    reasons: ['未识别的检索模式 ' + r + '。'],
  };
}

/**
 * 聚合多条 measurement 事实（一次 run/report 的多个 Query Evidence）。
 * 规则（保守优先，deterministic）：
 *   - 空 ⇒ UNKNOWN
 *   - 任一 INVALID_FOR_WEB_CHANGE ⇒ 整体 INVALID（除非有 manual_verified 人工确认？
 *     否 —— 保守：任何单条 api_plain 都说明该次测量包含非网页路径；混合按 PARTIALLY。
 *     修正：混合真实网页 + api_plain ⇒ PARTIALLY_VALID，便于提示“部分测量不可网页归因”。
 *   - 全 VALID ⇒ VALID
 *   - 混合 VALID/PARTIALLY ⇒ PARTIALLY
 *   - 混合 VALID/PARTIALLY/UNKNOWN ⇒ PARTIALLY（未知模式不拉低整体到 INVALID，但提示）
 *   - mode：多数派 > 首个非 UNKNOWN > UNKNOWN
 */
export function aggregateMeasurementFacts(facts: MeasurementModeFact[]): MeasurementVerdictResult {
  if (facts.length === 0) {
    return { verdict: 'UNKNOWN', mode: 'UNKNOWN', reasons: ['没有可用的测量事实。'] };
  }
  const isDemo = (f: MeasurementModeFact) => (f.sourceType || '').toLowerCase() === 'mock' || (f.sourceType || '').toLowerCase() === 'estimated';
  const results = facts.map(classifyMeasurementFact);
  const reasons = results.flatMap((r, i) => r.reasons.map(reason => `#${i + 1} ${reason}`));

  const has = (v: MeasurementVerdict) => results.some(r => r.verdict === v);
  const all = (v: MeasurementVerdict) => results.length > 0 && results.every(r => r.verdict === v);

  // 演示/估算来源混入 —— 直接 INVALID（Demo 永远不能作为真实 pilot 测量）
  if (facts.some(isDemo)) {
    return {
      verdict: 'INVALID_FOR_WEB_CHANGE',
      mode: 'UNKNOWN',
      reasons: [...reasons, '（含 mock/estimated 演示来源 —— 演示测量不能作为真实网页实验）'],
    };
  }

  if (all('VALID_FOR_WEB_CHANGE')) {
    const mode = results[0]!.mode;
    return { verdict: 'VALID_FOR_WEB_CHANGE', mode, reasons };
  }
  // 全 api_plain（非 demo）⇒ INVALID
  if (all('INVALID_FOR_WEB_CHANGE')) {
    const mode = results.some(r => r.mode === 'MODEL_BEHAVIOR_ONLY') ? 'MODEL_BEHAVIOR_ONLY' : 'UNKNOWN';
    return { verdict: 'INVALID_FOR_WEB_CHANGE', mode, reasons };
  }
  // 混合：真实网页路径 + api_plain / 未确认 ⇒ PARTIALLY（不能把 api_plain 全归因网页变化）
  if (has('VALID_FOR_WEB_CHANGE') || has('PARTIALLY_VALID')) {
    const counts = new Map<string, number>();
    for (const r of results) if (r.mode !== 'UNKNOWN') counts.set(r.mode, (counts.get(r.mode) ?? 0) + 1);
    let mode: MeasurementMode = 'UNKNOWN';
    let best = -1;
    for (const [m, n] of counts) if (n > best) { best = n; mode = m as MeasurementMode; }
    if (mode === 'UNKNOWN' && results[0]) mode = results[0]!.mode as MeasurementMode;
    const reasonsOut = [...reasons];
    if (has('INVALID_FOR_WEB_CHANGE')) {
      reasonsOut.push('（部分测量为 api_plain —— 整体仅部分可比，不能全部归因网页变化）');
    }
    return { verdict: 'PARTIALLY_VALID', mode, reasons: reasonsOut };
  }
  return { verdict: 'UNKNOWN', mode: 'UNKNOWN', reasons };
}

/**
 * M7D OptimizationExperiment Measurement Guard：
 * 当实验目标是“验证真实网页内容优化”而测量路径无效/部分无效时，禁止把结果当
 * 网页优化结论 —— 返回 outcome 修正建议。
 *
 * targetChangeType：'WEB_CONTENT' | 'MODEL_BEHAVIOR' | 'UNSPECIFIED'
 */
export interface MeasurementGuardInput {
  verdict: MeasurementVerdict;
  targetChangeType?: 'WEB_CONTENT' | 'MODEL_BEHAVIOR' | 'UNSPECIFIED';
}

export interface MeasurementGuardResult {
  /** true = 该测量足以支撑“网页内容优化观察”结论 */
  allowsWebChangeClaim: boolean;
  /** 若不允许，Evaluation 应使用的 outcome（INCONCLUSIVE / INVALID_MEASUREMENT 语义由 service 落库） */
  blockedOutcome: 'INCONCLUSIVE' | 'INVALID_MEASUREMENT' | null;
  reasons: string[];
}

export function measurementGuard(input: MeasurementGuardInput): MeasurementGuardResult {
  const target = input.targetChangeType ?? 'UNSPECIFIED';
  if (target !== 'WEB_CONTENT') {
    return {
      allowsWebChangeClaim: true,
      blockedOutcome: null,
      reasons: ['实验目标不是网页内容变化（' + target + '），不施加网页测量 guard。'],
    };
  }
  if (input.verdict === 'VALID_FOR_WEB_CHANGE') {
    return { allowsWebChangeClaim: true, blockedOutcome: null, reasons: ['测量模式可支撑网页变化观察。'] };
  }
  if (input.verdict === 'PARTIALLY_VALID') {
    return {
      allowsWebChangeClaim: false,
      blockedOutcome: 'INCONCLUSIVE',
      reasons: ['测量路径仅部分有效（含 api_plain / 未确认检索），当前不能输出“网页优化已观察”的结论；应改用 manual_verified 或确认真实网页检索。'],
    };
  }
  if (input.verdict === 'INVALID_FOR_WEB_CHANGE') {
    return {
      allowsWebChangeClaim: false,
      blockedOutcome: 'INVALID_MEASUREMENT',
      reasons: ['当前测量为 api_plain / 演示来源，无法证明模型读取了修改后的公开网页 —— 禁止把结果标为网页优化验证。'],
    };
  }
  return {
    allowsWebChangeClaim: false,
    blockedOutcome: 'INCONCLUSIVE',
    reasons: ['测量有效性未知，不能输出网页变化结论。'],
  };
}

/** 把 Prisma Evidence 行/或聚合检索模式的列表变成最小 fact。工具函数。 */
export function factsFromRetrievalModes(modes: Array<{ retrievalMode?: string; sourceType?: string; retrievalConfirmed?: boolean }>): MeasurementModeFact[] {
  return modes
    .filter(m => m.retrievalMode || m.sourceType)
    .map(m => ({
      retrievalMode: m.retrievalMode ?? 'unknown',
      sourceType: m.sourceType ?? 'unknown',
      retrievalConfirmed: m.retrievalConfirmed,
    }));
}
