import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResponse, aggregateMetrics } from '../src/index';

const brand = { id: 'b', canonicalName: 'ProjectMentor', aliases: ['项目导师'], entityType: 'brand' as const };
const rival = { id: 'c', canonicalName: 'Rival', aliases: ['对手'], entityType: 'competitor' as const };
const entities = [brand, rival];
const analyze = (rawResponse: string, extra = {}) => analyzeResponse({ rawResponse, entities, ...extra });
const success = (rawResponse: string) => ({ status: 'SUCCEEDED', analysis: analyze(rawResponse) });

test('empty response is unmentioned with unknown sentiment', () => {
  const x = analyze('');
  assert.equal(x.brandMentioned, false); assert.equal(x.sentiment, 'unknown');
  assert.equal(x.mentionPosition, null); assert.equal(x.recommended, false);
});
test('case insensitive mentions preserve original display name', () => {
  assert.equal(analyze('PROJECTMENTOR').mentions[0].displayName, 'PROJECTMENTOR');
});
test('camel name accepts reasonable intervening whitespace', () => {
  assert.equal(analyze('Project   Mentor').brandMentioned, true);
});
test('Chinese aliases match contiguous text', () => {
  assert.equal(analyze('我推荐项目导师使用').brandMentioned, true);
});
test('NFKC matching retains raw UTF16 offsets', () => {
  const text = '😀 ＰｒｏｊｅｃｔＭｅｎｔｏｒ'; const m = analyze(text).mentions[0];
  assert.equal(m.startOffset, 3); assert.equal(m.endOffset, text.length);
  assert.equal(text.slice(m.startOffset, m.endOffset), m.displayName);
});
test('mention rank is contiguous entity ordering not character offset', () => {
  const x = analyze('A long intro: Rival then ProjectMentor then Rival.');
  assert.deepEqual(x.mentions.map((m: any) => m.position), [1, 2]); assert.equal(x.mentionPosition, 2);
});
test('one mention per entity uses earliest occurrence', () => {
  const x = analyze('ProjectMentor and 项目导师'); assert.equal(x.mentions.length, 1); assert.equal(x.mentions[0].startOffset, 0);
});
test('Latin names do not match substrings of words', () => {
  assert.equal(analyze('myProjectMentorish').brandMentioned, false);
});
test('single letter entities need Latin word boundaries', () => {
  const es = ['A', 'B', 'C'].map((canonicalName, id) => ({ id: String(id), canonicalName, aliases: [], entityType: 'competitor' }));
  assert.equal(analyze('Cabinet and ABC', { entities: es }).mentions.length, 0);
  assert.equal(analyze('A, B, C', { entities: es }).mentions.length, 3);
});
test('URL text is excluded from mention matches', () => {
  assert.equal(analyze('https://ProjectMentor.test/ProjectMentor').brandMentioned, false);
});
test('longest overlapping alias wins', () => {
  const es = [{ ...brand, canonicalName: 'Project', aliases: ['Project Mentor'] }];
  assert.equal(analyze('Project Mentor', { entities: es }).mentions[0].displayName, 'Project Mentor');
});
test('first configured brand controls headline fields', () => {
  const x = analyze('Other', { entities: [brand, { ...brand, id: 'b2', canonicalName: 'Other', aliases: [] }] });
  assert.equal(x.brandMentioned, false); assert.equal(x.sentiment, 'unknown');
});
for (const cue of ['recommend', 'suggest', 'consider']) test(`English ${cue} associates with brand`, () => {
  assert.equal(analyze(`I ${cue} ProjectMentor.`).recommended, true);
});
test('English suitable after entity is recommendation', () => assert.equal(analyze('ProjectMentor is suitable for teams.').recommended, true));
for (const cue of ['推荐', '建议', '适合', '首选']) test(`Chinese ${cue} associates with brand`, () => {
  assert.equal(analyze(`${cue}项目导师`).recommended, true);
});
test('not recommended is negative not recommended', () => {
  const x = analyze('ProjectMentor is not recommended.'); assert.equal(x.recommended, false); assert.equal(x.sentiment, 'negative');
});
test('do not recommend is negative', () => assert.equal(analyze('I do not recommend ProjectMentor.').sentiment, 'negative'));
test('Chinese negated recommendation is negative', () => {
  for (const text of ['不推荐项目导师', '项目导师不适合', '不建议项目导师']) {
    const x = analyze(text); assert.equal(x.recommended, false); assert.equal(x.sentiment, 'negative');
  }
});
test('other entity recommendation does not leak across clauses', () => {
  const x = analyze('ProjectMentor exists, but I recommend Rival.');
  assert.equal(x.recommended, false); assert.equal(x.sentiment, 'neutral');
});
test('other entity positive and negative cues are locally attributed', () => {
  const x = analyze('ProjectMentor is excellent, Rival is terrible.');
  assert.equal(x.sentiment, 'positive'); assert.equal(x.mentions[1].sentiment, 'negative');
});
test('unqualified mention has neutral sentiment', () => assert.equal(analyze('ProjectMentor exists.').sentiment, 'neutral'));
test('citations merge structured and text normalized URLs with preferred title', () => {
  const x = analyze('See https://EXAMPLE.com/a#section and https://example.com/a.', { structuredCitations: [{ url: 'https://example.com/a', title: 'Source' }] });
  assert.deepEqual(x.citations, [{ url: 'https://example.com/a', domain: 'example.com', title: 'Source', position: 1 }]);
});
test('citations trim markdown brackets and Chinese punctuation', () => {
  const x = analyze('[one](https://example.com/one)。 https://example.com/two，');
  assert.deepEqual(x.citations.map((c: any) => c.url), ['https://example.com/one', 'https://example.com/two']);
});
test('citation query strings stay distinct and non HTTP schemes excluded', () => {
  const x = analyze('https://example.com/?q=1 https://example.com/?q=2', { structuredCitations: [{ url: 'file:///secret' }, { url: 'javascript:alert(1)' }] });
  assert.equal(x.citations.length, 2);
});
test('zero eligible runs have null rates and null position', () => {
  const x = aggregateMetrics({ runs: [] });
  for (const key of ['visibilityRate', 'recommendationRate', 'averageMentionPosition', 'shareOfVoice']) assert.equal(x[key], null);
});
test('failed cancelled and pending runs never enter metric denominator', () => {
  const x = aggregateMetrics({ runs: [success('I recommend ProjectMentor'), success('Rival'), { status: 'FAILED' }, { status: 'CANCELLED' }, { status: 'QUEUED' }] });
  assert.equal(x.totalRuns, 5); assert.equal(x.successfulRuns, 2); assert.equal(x.failedRuns, 1); assert.equal(x.cancelledRuns, 1);
  assert.equal(x.visibilityRate, 0.5); assert.equal(x.recommendationRate, 0.5); assert.equal(x.analyzedRuns, 2);
});
test('missing analysis is counted separately excluded from rates', () => {
  const x = aggregateMetrics({ runs: [success('ProjectMentor'), { status: 'SUCCEEDED', analysis: null }] });
  assert.equal(x.analysisMissingRuns, 1); assert.equal(x.visibilityRate, 1);
});
test('mismatching analysis version cannot silently mix into metrics', () => {
  const wrong = { ...analyze('ProjectMentor'), analysisVersion: 'other' };
  const x = aggregateMetrics({ runs: [{ status: 'SUCCEEDED', analysis: wrong }, success('Rival')] });
  assert.equal(x.analyzedRuns, 1); assert.equal(x.analysisMissingRuns, 1); assert.equal(x.visibilityRate, 0);
});
test('explicit analysis version selects only that version', () => {
  const wrong = { ...analyze('ProjectMentor'), analysisVersion: 'other' };
  const x = aggregateMetrics({ runs: [{ status: 'SUCCEEDED', analysis: wrong }, success('Rival')], analysisVersion: 'other' });
  assert.equal(x.analyzedRuns, 1); assert.equal(x.visibilityRate, 1); assert.equal(x.analysisVersion, 'other');
});
test('share of voice uses unique entity presence and position uses mentioned runs', () => {
  const x = aggregateMetrics({ runs: [success('Rival ProjectMentor ProjectMentor'), success('ProjectMentor'), success('nothing')] });
  assert.equal(x.shareOfVoice, 2 / 3); assert.equal(x.averageMentionPosition, 1.5);
  assert.deepEqual(x.sentimentDistribution, { positive: 0, neutral: 2, negative: 0, unknown: 1 });
});
test('no entities mentioned makes share of voice null but visibility zero', () => {
  const x = aggregateMetrics({ runs: [success('nothing')] }); assert.equal(x.shareOfVoice, null); assert.equal(x.visibilityRate, 0);
});
test('citation count sums per run and domains dedupe across eligible runs', () => {
  const x = aggregateMetrics({ runs: [success('https://a.test/1 https://b.test/'), success('https://a.test/1'), { status: 'FAILED', analysis: analyze('https://c.test/') }] });
  assert.equal(x.citationCount, 3); assert.equal(x.citationDomainCount, 2);
});
test('not consider must not become a recommendation', () => {
  const x = analyze('Do not consider ProjectMentor.'); assert.equal(x.recommended, false); assert.equal(x.sentiment, 'negative');
});
test('cannot suggest must not become a recommendation', () => assert.equal(analyze('I cannot suggest ProjectMentor.').recommended, false));
test('later recommendation can qualify an earlier neutral mention', () => {
  const x = analyze('ProjectMentor exists. I recommend ProjectMentor.');
  assert.equal(x.recommended, true); assert.equal(x.mentions.length, 1); assert.equal(x.mentions[0].startOffset, 0);
});
test('negative evidence takes precedence for contradictory recommendation', () => {
  const x = analyze('I recommend ProjectMentor. ProjectMentor is unreliable.');
  assert.equal(x.recommended, false); assert.equal(x.sentiment, 'negative');
});
test('same shared alias is assigned to first configured entity', () => {
  const es = [{ ...rival, aliases: ['Shared'] }, { ...brand, aliases: ['Shared'] }];
  const x = analyze('Shared', { entities: es }); assert.equal(x.mentions.length, 1); assert.equal(x.mentions[0].entityId, 'c');
});
test('longer overlapping entity name beats earlier configured prefix', () => {
  const es = [{ ...brand, canonicalName: 'Project', aliases: [] }, { ...rival, canonicalName: 'Project Mentor', aliases: [] }];
  const x = analyze('Project Mentor', { entities: es }); assert.equal(x.mentions.length, 1); assert.equal(x.mentions[0].entityId, 'c');
});
test('entity name containing positive words does not praise itself', () => {
  assert.equal(analyze('Best Tool', { entities: [{ ...brand, canonicalName: 'Best Tool', aliases: [] }] }).sentiment, 'neutral');
});
test('URLs containing recommendation tokens are not recommendation evidence', () => {
  assert.equal(analyze('ProjectMentor https://example.test/recommend').recommended, false);
});
test('structured citation order precedes textual fallback and title is first nonempty', () => {
  const x = analyze('https://a.test/', { structuredCitations: [{ url: 'https://b.test/' }, { url: 'https://b.test/', title: 'Title' }, { url: 'https://b.test/', title: 'Later' }] });
  assert.deepEqual(x.citations, [{ url: 'https://b.test/', domain: 'b.test', title: 'Title', position: 1 }, { url: 'https://a.test/', domain: 'a.test', title: null, position: 2 }]);
});
test('citation extraction preserves balanced parentheses', () => {
  assert.equal(analyze('[source](https://example.com/Topic_(detail))').citations[0].url, 'https://example.com/Topic_(detail)');
});
test('context is an exact excerpt from original response', () => {
  const text = '开头 '.repeat(80) + 'ProjectMentor' + ' 后文'.repeat(80);
  const m = analyze(text).mentions[0]; assert.equal(m.context.length, 213); assert.ok(text.includes(m.context));
});
test('replaceable judge persists its distinct analysis version', () => {
  const x = analyzeResponse({ rawResponse: 'ProjectMentor', entities }, {
    analysisVersion: 'alternate-v2', judge: () => ({ recommended: false, sentiment: 'neutral' })
  });
  assert.equal(x.analysisVersion, 'alternate-v2'); assert.equal(aggregateMetrics({ runs: [{ status: 'SUCCEEDED', analysis: x }] }).analyzedRuns, 0);
});
