import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateReplicates,
  assessComparability,
  calculateHonestComparison,
  type ObservationSnapshot,
} from '../src/measurement-science';

test('GEO Measurement Science V2 - Repeated Observations (Replicates)', () => {
  const observations: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '中大型企业管理软件选型',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 1,
      recommended: true,
      hasCitation: true,
    },
    {
      queryId: 'q-1',
      queryText: '中大型企业管理软件选型',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 2,
      recommended: false,
      hasCitation: false,
    },
    {
      queryId: 'q-1',
      queryText: '中大型企业管理软件选型',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
  ];

  const aggregates = aggregateReplicates(observations);
  assert.strictEqual(aggregates.length, 1);
  const agg = aggregates[0];

  assert.strictEqual(agg.replicateCount, 3);
  assert.strictEqual(agg.mentionCount, 2);
  assert.strictEqual(agg.mentionProbability, 0.6667);
  assert.strictEqual(agg.recommendationCount, 1);
  assert.strictEqual(agg.recommendationProbability, 0.3333);
  assert.strictEqual(agg.meanPosition, 1.5); // (1 + 2) / 2
  assert.strictEqual(agg.citationCount, 1);
  assert.strictEqual(agg.citationProbability, 0.3333);
  assert.strictEqual(agg.crossReplicateConsistency, 'MEDIUM');
});

test('GEO Measurement Science V2 - Model Identity Drift Detection', () => {
  const baseline: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat-build-202608',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
  ];

  const retest: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-v4-flash-build-202610', // model updated by provider!
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 1,
      recommended: true,
      hasCitation: true,
    },
  ];

  const assessment = assessComparability(baseline, retest);
  assert.strictEqual(assessment.verdict, 'COMPARABLE_WITH_WARNING');
  assert.strictEqual(assessment.modelDrift, true);
  assert.strictEqual(assessment.retrievalModeDrift, false);
  assert.ok(assessment.warnings[0].includes('模型版本漂移'));
});

test('GEO Measurement Science V2 - Retrieval Mode Drift (api_plain vs web_search is INCOMPATIBLE)', () => {
  const baseline: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_plain', // no web retrieval
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
  ];

  const retest: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search', // with web retrieval
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 1,
      recommended: true,
      hasCitation: true,
    },
  ];

  const assessment = assessComparability(baseline, retest);
  assert.strictEqual(assessment.verdict, 'INCOMPATIBLE');
  assert.strictEqual(assessment.retrievalModeDrift, true);
});

test('GEO Measurement Science V2 - Retrieval Mode Drift (web_search vs api_plain is symmetrically INCOMPATIBLE)', () => {
  const baseline: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 1,
      recommended: true,
      hasCitation: true,
    },
  ];

  const retest: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_plain',
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
  ];

  const assessment = assessComparability(baseline, retest);
  assert.strictEqual(assessment.verdict, 'INCOMPATIBLE');
  assert.strictEqual(assessment.retrievalModeDrift, true);
});

test('GEO Measurement Science V2 - Statistical Honesty (Small sample cannot claim strong attribution)', () => {
  // Baseline n=2 (below n=3 threshold)
  const baseline: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐1',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
    {
      queryId: 'q-2',
      queryText: '选型推荐2',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: false,
      mentionPosition: null,
      recommended: false,
      hasCitation: false,
    },
  ];

  const retest: ObservationSnapshot[] = [
    {
      queryId: 'q-1',
      queryText: '选型推荐1',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 1,
      recommended: true,
      hasCitation: true,
    },
    {
      queryId: 'q-2',
      queryText: '选型推荐2',
      engineKey: 'deepseek-chat',
      provider: 'deepseek',
      requestedModel: 'deepseek-chat',
      responseModel: 'deepseek-chat',
      retrievalMode: 'api_web_search',
      sourceType: 'official_api',
      brandMentioned: true,
      mentionPosition: 2,
      recommended: false,
      hasCitation: false,
    },
  ];

  const comparison = calculateHonestComparison(baseline, retest);

  assert.strictEqual(comparison.baselineCount, 2);
  assert.strictEqual(comparison.retestCount, 2);
  assert.strictEqual(comparison.absoluteMentionDeltaPp, 100); // 0% -> 100%
  // Despite 100% delta, sample size is too small (n=2 < 3) -> must be LOW confidence!
  assert.strictEqual(comparison.confidenceLevel, 'LOW');
  assert.strictEqual(comparison.allowsAttributionClaim, false);
  assert.ok(comparison.statisticalHonestyNotice.includes('样本量较小'));
});

test('GEO Measurement Science V2 - Statistical Honesty (Sufficient sample with exact match allows attribution)', () => {
  // Baseline n=6 (all false)
  const baseline: ObservationSnapshot[] = Array.from({ length: 6 }, (_, i) => ({
    queryId: `q-${i}`,
    queryText: `选型推荐${i}`,
    engineKey: 'deepseek-chat',
    provider: 'deepseek',
    requestedModel: 'deepseek-chat',
    responseModel: 'deepseek-chat',
    retrievalMode: 'api_web_search',
    sourceType: 'official_api',
    brandMentioned: i < 2, // 2/6 mentioned
    mentionPosition: i < 2 ? 2 : null,
    recommended: false,
    hasCitation: false,
  }));

  // Retest n=6 (5/6 mentioned)
  const retest: ObservationSnapshot[] = Array.from({ length: 6 }, (_, i) => ({
    queryId: `q-${i}`,
    queryText: `选型推荐${i}`,
    engineKey: 'deepseek-chat',
    provider: 'deepseek',
    requestedModel: 'deepseek-chat',
    responseModel: 'deepseek-chat',
    retrievalMode: 'api_web_search',
    sourceType: 'official_api',
    brandMentioned: i < 5, // 5/6 mentioned
    mentionPosition: 1,
    recommended: true,
    hasCitation: true,
  }));

  const comparison = calculateHonestComparison(baseline, retest);

  assert.strictEqual(comparison.baselineCount, 6);
  assert.strictEqual(comparison.retestCount, 6);
  assert.strictEqual(comparison.comparability.verdict, 'EXACT_MATCH');
  assert.strictEqual(comparison.confidenceLevel, 'HIGH');
  assert.strictEqual(comparison.allowsAttributionClaim, true);
  assert.ok(comparison.statisticalHonestyNotice.includes('样本量充足'));
});
