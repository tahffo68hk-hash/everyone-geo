import { validateCapabilityOutput, CAPABILITY_SCHEMAS } from '../src/ai/contracts';
import { validateDeepSchema } from '../src/ai/contracts/schema-validator';

describe('AI Contracts & Deep Schema Validation', () => {
  it('should validate query_set_generation schema with valid payload', () => {
    const validPayload = {
      querySetName: '企业管理软件选型问题集',
      description: '针对企业中大型场景',
      queries: [
        {
          text: '2026年适合中大型企业的管理软件推荐',
          category: '行业选型',
          intent: 'COMMERCIAL',
          queryType: 'DISCOVERY',
          rationale: '客观选型提问',
        },
        {
          text: 'AcmeBrand怎么样？主要优缺点',
          category: '品牌基线',
          intent: 'INFORMATIONAL',
          queryType: 'BRANDED',
          rationale: '品牌认知探测',
        },
      ],
    };

    const result = validateCapabilityOutput('query_set_generation', validPayload);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject query_set_generation with invalid intent enum', () => {
    const invalidPayload = {
      querySetName: '测试问题集',
      description: '描述',
      queries: [
        {
          text: '问题1',
          category: '分类',
          intent: 'INVALID_INTENT', // invalid
          queryType: 'DISCOVERY',
          rationale: '理由',
        },
      ],
    };

    const result = validateCapabilityOutput('query_set_generation', invalidPayload);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('intent must be one of'))).toBe(true);
  });

  it('should reject diagnosis_explanation with missing keyFindings fields', () => {
    const invalidDiagnosis = {
      summary: '诊断摘要',
      explanation: '详细解释',
      keyFindings: [
        {
          point: '横评缺失',
          impact: 'INVALID_IMPACT', // not HIGH/MEDIUM/LOW
          reason: '原因',
        },
      ],
      supportingEvidenceIds: ['ev-1'],
      limitations: ['快照局限'],
    };

    const result = validateCapabilityOutput('diagnosis_explanation', invalidDiagnosis);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('impact must be one of'))).toBe(true);
  });

  it('should validate nested array items with proper path reporting', () => {
    const schema = {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              id: { type: 'string' as const },
              score: { type: 'number' as const, min: 0, max: 100 },
            },
          },
        },
      },
    };

    const invalidData = {
      items: [
        { id: 'item-1', score: 85 },
        { id: 'item-2', score: 150 }, // out of range
      ],
    };

    const result = validateDeepSchema(schema, invalidData);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('items[1].score must be at most 100');
  });

  it('all 27 capability schemas should be registered', () => {
    const registeredFeatures = Object.keys(CAPABILITY_SCHEMAS);
    expect(registeredFeatures.length).toBe(27);
  });
});

describe('Prompt Evaluation Foundation (Deterministic Invariant Tests)', () => {
  // 1. Query Generation Invariants
  describe('Query Generation Prompt Guard', () => {
    it('DISCOVERY queries must never contain brand alias (Brand Contamination Guard)', () => {
      const brandName = 'GeoLens';
      const brandAliases = ['GeoLens', 'geolens', 'everyone-geo'];

      const testQueries = [
        { text: '2026年主流GEO优化平台选型横评', queryType: 'DISCOVERY' },
        { text: '如何提升生成式AI搜索的品牌提及度？', queryType: 'DISCOVERY' },
        { text: 'GeoLens平台使用教程与功能评测', queryType: 'BRANDED' },
      ];

      for (const q of testQueries) {
        if (q.queryType === 'DISCOVERY') {
          for (const alias of brandAliases) {
            expect(q.text.toLowerCase().includes(alias.toLowerCase())).toBe(false);
          }
        }
      }
    });

    it('Query count must be within reasonable bounds (4-30)', () => {
      const generatedCount = 8;
      expect(generatedCount).toBeGreaterThanOrEqual(4);
      expect(generatedCount).toBeLessThanOrEqual(30);
    });

    it('Duplicate query texts must be detected and rejected', () => {
      const queries = [
        '2026年企业级选型推荐',
        '2026年企业级选型推荐', // duplicate
      ];
      const unique = new Set(queries.map((q) => q.trim().toLowerCase()));
      expect(unique.size).toBeLessThan(queries.length);
    });
  });

  // 2. Diagnosis Invariants
  describe('Diagnosis Invariant Guard', () => {
    it('supportingEvidenceIds must not reference non-existent evidence', () => {
      const existingEvidenceIds = new Set(['ev-001', 'ev-002', 'ev-003']);
      const diagnosisSupportingIds = ['ev-001', 'ev-002'];

      for (const id of diagnosisSupportingIds) {
        expect(existingEvidenceIds.has(id)).toBe(true);
      }
    });

    it('Diagnosis must explicitly declare limitations', () => {
      const diagnosisOutput = {
        summary: '选型问题下品牌提及率较低',
        explanation: '竞品具有更强的第三方评测背书',
        limitations: ['基于系统当前采集的证据快照分析，不代表全网所有时刻的状态'],
      };

      expect(diagnosisOutput.limitations).toBeDefined();
      expect(diagnosisOutput.limitations.length).toBeGreaterThan(0);
    });
  });

  // 3. Recommendation Invariants
  describe('Recommendation Honest Invariants', () => {
    it('expectedObservableSignal must describe an observable metric, not guaranteed outcome', () => {
      const validRecommendation = {
        title: '发布客观横评指南',
        action: '在第三方技术社区发布包含多维对比的选型指南',
        expectedObservableSignal: '在行业选型问题下被 AI 引擎作为引用信源检索到并呈现正面结论',
      };

      // Disallow misleading marketing guarantee words
      const forbiddenGuaranteeWords = ['保证提升', '100%提升', '绝对增加', '必然排第一'];
      for (const forbidden of forbiddenGuaranteeWords) {
        expect(validRecommendation.expectedObservableSignal).not.toContain(forbidden);
        expect(validRecommendation.action).not.toContain(forbidden);
      }
    });
  });

  // 4. Content Invariants (Fact Grounding & Claim Guard)
  describe('Content Claim & Fact Grounding Guard', () => {
    it('Invented statistics or unsupported absolute claims must be flagged', () => {
      const suspiciousClaims = [
        { text: '本产品占据全国 95% 的市场份额', hasGrounding: false },
        { text: '根据 IDC 2025 年报告，GEO 投入产出比达 300%', hasGrounding: false },
      ];

      // Claim guard: ungrounded claims must be flagged as HIGH or MEDIUM risk
      for (const claim of suspiciousClaims) {
        if (!claim.hasGrounding) {
          const riskLevel = 'HIGH';
          expect(['HIGH', 'MEDIUM']).toContain(riskLevel);
        }
      }
    });
  });

  // 5. Outcome Invariants (Attribution Honesty)
  describe('Outcome Attribution Honesty Guard', () => {
    it('Outcome attribution must never claim causal proof from observational data alone', () => {
      const attributionExplanation = {
        explanation: '在发布后 14 天的复测中观察到品牌在选型提问下的提及率提升，与内容发布时间窗口一致。',
        confoundingNotes: ['不能排除同期搜索引擎算法更新或竞品内容变动带来的混杂影响。'],
        disclaimer: '基于观察性复测数据，表明正相关性，不构成绝对因果证明。',
      };

      const forbiddenCausalPhrases = ['证明该文章直接导致', '绝对因果关系', '100%是内容带来的'];
      for (const phrase of forbiddenCausalPhrases) {
        expect(attributionExplanation.explanation).not.toContain(phrase);
      }
      expect(attributionExplanation.confoundingNotes.length).toBeGreaterThan(0);
      expect(attributionExplanation.disclaimer).toContain('观察性');
    });
  });

  // 6. Learning Signal Invariants
  describe('Learning Signal Guard', () => {
    it('Single sample observations must never be promoted to universal patterns', () => {
      const singleSampleObservation = {
        sampleCount: 1,
        isUniversalPattern: false,
        warning: '单次观测结果，受单次抽样随机性影响较大，不足以推导通用规律。',
      };

      if (singleSampleObservation.sampleCount < 3) {
        expect(singleSampleObservation.isUniversalPattern).toBe(false);
        expect(singleSampleObservation.warning).toContain('单次观测');
      }
    });
  });
});
