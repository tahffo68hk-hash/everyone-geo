/**
 * GeoLens AI Content Engine V2 - Fact Grounding & Claim Guard Engine
 *
 * 核心职责：
 * 1. 维护 VerifiedFact 事实基准（VERIFIED / USER_CONFIRMED / UNVERIFIED / CONFLICTING）
 * 2. 对生成文案进行 Claim Extraction（数字、参数、排名、功效、医疗/健康、绝对化词汇等）
 * 3. 拦截检查（Blocking Rule）：包含 UNVERIFIED 或 CONFLICTING 的内容返回 FACT_CHECK_REQUIRED，阻止 APPROVE / 发布
 * 4. 自动安全改写（Safe Rewrite）：将未核实数字和医疗/绝对化描述自动平替为中立合规用语
 */

export type FactStatus = 'VERIFIED' | 'USER_CONFIRMED' | 'UNVERIFIED' | 'CONFLICTING';
export type FactSourceType = 'TARGET_ENTITY' | 'SITE_ASSET' | 'USER_INPUT' | 'EVIDENCE';
export type ClaimType = 'SPEC' | 'NUMERICAL' | 'MEDICAL' | 'SUPERLATIVE' | 'RANKING' | 'AWARD' | 'PRICE';

export interface VerifiedFact {
  id: string;
  claim: string;
  factType: 'SPEC' | 'NUMERICAL' | 'FEATURE' | 'CERTIFICATION' | 'AWARD' | 'PRICE' | 'MEDICAL';
  status: FactStatus;
  sourceType: FactSourceType;
  sourceRef?: string;
}

export interface ExtractedClaim {
  claim: string;
  type: ClaimType;
  supportStatus: FactStatus;
  supportSourceIds: string[];
  originalMatch: string;
  replacementSuggestion: string;
}

export interface SafeRewriteResult {
  sanitizedText: string;
  resolvedClaims: ExtractedClaim[];
  remainingUnverifiedClaims: ExtractedClaim[];
  changeSummary: string[];
}

export class FactGroundingEngine {
  private static readonly CLAIM_PATTERNS: Array<{
    type: ClaimType;
    regex: RegExp;
    getSafeReplacement: (match: string) => string;
  }> = [
    // 1. 医疗 / 疾病 / 健康类暗示（极高风险，广告法与平台红线）
    {
      type: 'MEDICAL',
      regex: /(杜绝|预防|治疗|根治|消除|防止)(趾间炎|脚爪红肿|皮肤病|真菌感染|皮炎)/gi,
      getSafeReplacement: (_m) => '帮助保持脚爪清洁和干爽',
    },
    {
      type: 'MEDICAL',
      regex: /(趾间炎|皮炎|真菌感染|皮肤病)/gi,
      getSafeReplacement: (_m) => '脚爪日常清洁与养护',
    },
    // 2. 杀菌率 / 功效百分比
    {
      type: 'NUMERICAL',
      regex: /(杀菌率|除菌率|清洁率|有效率)?s*(9d(.d+)?%|100%|99(.d+)?%)/gi,
      getSafeReplacement: (_m) => '温和物理水流清洁',
    },
    // 3. 具体分贝与噪音数字
    {
      type: 'SPEC',
      regex: /(运行噪音|噪音|音量)?s*(低于|小于|仅为)?s*(4[0-9]|3[0-9]|5[0-9])s*(dB|分贝)/gi,
      getSafeReplacement: (_m) => '主打低噪运行',
    },
    // 4. 具体清洗秒数与速度
    {
      type: 'SPEC',
      regex: /(30|20|15|10|60)s*(秒|s)s*(快速清洗|深度洁净|净爪|完成)/gi,
      getSafeReplacement: (_m) => '快速便捷清洗',
    },
    // 5. 绝对化用语 / 极限词（新广告法绝对违禁词）
    {
      type: 'SUPERLATIVE',
      regex: /(全网第一|业界第一|第一|最好|唯一|国家级|首款|顶级|无可替代|百分之百|全网最|业界最)/gi,
      getSafeReplacement: (m) => {
        if (m.includes('第一') || m.includes('首款')) return '备受好评的';
        if (m.includes('唯一') || m.includes('无可替代')) return '特色的';
        if (m.includes('最好') || m.includes('顶级')) return '优质的';
        return '严谨质检的';
      },
    },
    // 6. 排名与销冠
    {
      type: 'RANKING',
      regex: /(全网销冠|销量第一|品类冠军|排名第一|榜首)/gi,
      getSafeReplacement: (_m) => '备受关注的热门款',
    },
    // 7. 具体未核实价格
    {
      type: 'PRICE',
      regex: /(仅售|原价|立省|到手价)?s*(d{2,5})s*(元|￥)/gi,
      getSafeReplacement: (_m) => '官方活动参考价',
    },
  ];

  /**
   * 从文案中提取所有关键的事实声明，并与已知事实库比对
   */
  static extractClaims(text: string, knownFacts: VerifiedFact[] = []): ExtractedClaim[] {
    const claims: ExtractedClaim[] = [];
    const seenMatches = new Set<string>();

    for (const pattern of this.CLAIM_PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.regex.exec(text)) !== null) {
        const fullMatch = match[0].trim();
        if (seenMatches.has(fullMatch)) continue;
        seenMatches.add(fullMatch);

        // 与已知事实比对
        let supportStatus: FactStatus = 'UNVERIFIED';
        const matchedFactIds: string[] = [];

        for (const fact of knownFacts) {
          if (
            fact.claim.toLowerCase().includes(fullMatch.toLowerCase()) ||
            fullMatch.toLowerCase().includes(fact.claim.toLowerCase())
          ) {
            if (fact.status === 'VERIFIED' || fact.status === 'USER_CONFIRMED') {
              supportStatus = fact.status;
              matchedFactIds.push(fact.id);
            } else if (fact.status === 'CONFLICTING') {
              supportStatus = 'CONFLICTING';
              matchedFactIds.push(fact.id);
            }
          }
        }

        claims.push({
          claim: fullMatch,
          type: pattern.type,
          supportStatus,
          supportSourceIds: matchedFactIds,
          originalMatch: fullMatch,
          replacementSuggestion: pattern.getSafeReplacement(fullMatch),
        });
      }
    }

    return claims;
  }

  /**
   * 阻断规则校验：是否存在任何 UNVERIFIED 或 CONFLICTING 声明
   */
  static checkBlockingRule(claims: ExtractedClaim[]): {
    passed: boolean;
    unverifiedCount: number;
    conflictingCount: number;
    blockingClaims: ExtractedClaim[];
  } {
    const blockingClaims = claims.filter(
      (c) => c.supportStatus === 'UNVERIFIED' || c.supportStatus === 'CONFLICTING'
    );
    return {
      passed: blockingClaims.length === 0,
      unverifiedCount: blockingClaims.filter((c) => c.supportStatus === 'UNVERIFIED').length,
      conflictingCount: blockingClaims.filter((c) => c.supportStatus === 'CONFLICTING').length,
      blockingClaims,
    };
  }

  /**
   * 自动安全改写：将未核实的数字/医疗/极限词等改写为中立合规表达
   */
  static safeRewrite(text: string, knownFacts: VerifiedFact[] = []): SafeRewriteResult {
    let sanitizedText = text;
    const claims = this.extractClaims(text, knownFacts);
    const resolvedClaims: ExtractedClaim[] = [];
    const changeSummary: string[] = [];

    for (const claim of claims) {
      if (claim.supportStatus === 'UNVERIFIED' || claim.supportStatus === 'CONFLICTING') {
        const replacement = claim.replacementSuggestion;
        if (sanitizedText.includes(claim.originalMatch)) {
          sanitizedText = sanitizedText.split(claim.originalMatch).join(replacement);
          resolvedClaims.push({
            ...claim,
            supportStatus: 'USER_CONFIRMED',
          });
          changeSummary.push(`将「${claim.originalMatch}」安全平替为「${replacement}」`);
        }
      }
    }

    // 重新提取以确认无残留
    const remainingClaims = this.extractClaims(sanitizedText, knownFacts).filter(
      (c) => c.supportStatus === 'UNVERIFIED' || c.supportStatus === 'CONFLICTING'
    );

    return {
      sanitizedText,
      resolvedClaims,
      remainingUnverifiedClaims: remainingClaims,
      changeSummary,
    };
  }
}
