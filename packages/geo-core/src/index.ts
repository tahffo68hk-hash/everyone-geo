export const ANALYSIS_VERSION = 'm4-rule-v1';
export const METRIC_VERSION = 'geolens-v1';
export type Sentiment = 'positive' | 'neutral' | 'negative' | 'unknown';
export type Entity = { id: string; canonicalName: string; aliases: string[]; entityType: 'brand' | 'competitor' };
export type StructuredCitation = { url: string; title?: string };
export interface Mention {
  entityType: Entity['entityType']; entityId: string; canonicalName: string; displayName: string;
  position: number; context: string; sentiment: Sentiment; startOffset: number; endOffset: number;
}
export interface Citation { url: string; domain: string; title: string | null; position: number }
export interface AnalysisOutput {
  analysisVersion: string; brandMentioned: boolean; mentionPosition: number | null;
  recommended: boolean; sentiment: Sentiment; mentions: Mention[]; citations: Citation[];
}
export interface AnalysisInput { rawResponse: string; entities: Entity[]; structuredCitations?: StructuredCitation[] }
export interface EntityOccurrence { entityId: string; startOffset: number; endOffset: number }
export interface JudgeInput { rawResponse: string; entityId: string; occurrences: EntityOccurrence[] }
export interface JudgeResult { recommended: boolean; sentiment: Sentiment }
/** Pure replaceable judge. A replacement must identify its own persisted analysis version. */
export interface ResponseJudge { readonly analysisVersion: string; judge(input: JudgeInput): JudgeResult }

type Span = { start: number; end: number };
const latinWord = /[\p{Script=Latin}\p{N}_]/u;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entityKey = (entity: Entity) => `${entity.entityType}:${entity.id}`;

function urlSpans(text: string): Span[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"'\u3000，。；！？]+/giu)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
}

function normalizedWithOffsets(raw: string): { text: string; starts: number[]; ends: number[] } {
  let text = ''; const starts: number[] = []; const ends: number[] = [];
  // Graphemes preserve composed accents and compatibility expansions while mapping back to raw UTF16.
  for (const item of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(raw)) {
    const normalized = item.segment.normalize('NFKC').toLowerCase();
    text += normalized;
    for (let i = 0; i < normalized.length; i++) { starts.push(item.index); ends.push(item.index + item.segment.length); }
  }
  return { text, starts, ends };
}

function aliasRegex(alias: string): RegExp | null {
  const folded = alias.normalize('NFKC').trim().replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  if (!folded) return null;
  // Whitespace is optional between explicit words/camel components; outer boundaries remain mandatory.
  return new RegExp(folded.split(/\s+/u).map(escapeRegExp).join('\\s*'), 'gu');
}

type Candidate = EntityOccurrence & { entity: Entity; key: string; order: number };
function findOccurrences(raw: string, entities: Entity[]): Candidate[] {
  const normalized = normalizedWithOffsets(raw); const excluded = urlSpans(raw); const candidates: Candidate[] = [];
  const unique = new Set<string>();
  entities.forEach((entity, order) => {
    const key = entityKey(entity); if (unique.has(key)) return; unique.add(key);
    for (const alias of [entity.canonicalName, ...entity.aliases]) {
      const regex = aliasRegex(alias); if (!regex) continue;
      for (const match of normalized.text.matchAll(regex)) {
        const start = match.index!; const end = start + match[0].length;
        const previous = [...normalized.text.slice(0, start)].at(-1) ?? '';
        const next = [...normalized.text.slice(end)][0] ?? '';
        if ((latinWord.test(match[0][0]) && latinWord.test(previous)) ||
            (latinWord.test(match[0].at(-1)!) && latinWord.test(next))) continue;
        const startOffset = normalized.starts[start]; const endOffset = normalized.ends[end - 1];
        if (excluded.some(span => startOffset < span.end && endOffset > span.start)) continue;
        candidates.push({ entity, key, order, entityId: key, startOffset, endOffset });
      }
    }
  });
  // Longest raw span wins all overlaps; equal spans use configured order. Never double count a shared alias.
  candidates.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset) || a.order - b.order || a.startOffset - b.startOffset);
  const accepted: Candidate[] = [];
  for (const candidate of candidates) {
    if (!accepted.some(other => candidate.startOffset < other.endOffset && candidate.endOffset > other.startOffset)) accepted.push(candidate);
  }
  return accepted.sort((a, b) => a.startOffset - b.startOffset || a.order - b.order);
}

function normalizeUrl(value: string): { url: string; domain: string } | null {
  let clean = value.trim().replace(/[.,;:!?，。；：！？\]}>]+$/u, '');
  // Remove markdown closing parentheses, preserving balanced parentheses that are part of a path.
  while (clean.endsWith(')') && (clean.match(/\)/g)?.length ?? 0) > (clean.match(/\(/g)?.length ?? 0)) clean = clean.slice(0, -1);
  try {
    const url = new URL(clean);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.hash = ''; return { url: url.href, domain: url.hostname.toLowerCase() };
  } catch { return null; }
}

function extractCitations(raw: string, structured: StructuredCitation[]): Citation[] {
  const citations = new Map<string, Citation>();
  const add = (value: string, title?: string) => {
    const normalized = normalizeUrl(value); if (!normalized) return;
    const existing = citations.get(normalized.url);
    if (existing) { if (!existing.title && title?.trim()) existing.title = title.trim(); return; }
    citations.set(normalized.url, { ...normalized, title: title?.trim() || null, position: citations.size + 1 });
  };
  for (const citation of structured) add(citation.url, citation.title);
  for (const span of urlSpans(raw)) add(raw.slice(span.start, span.end));
  return [...citations.values()];
}

const clauseDelimiter = /[.!?;,\n\r。！？；，]|\b(?:but|however|whereas)\b|但是|不过|然而/giu;
const negativeCue = /\b(?:(?:not|never|no\s+longer)\s+(?:\w+\s+){0,2}(?:recommend(?:ed|s|ing)?|suggest(?:ed|s|ing)?|consider|suitable|good|great|excellent|reliable)|(?:do(?:es)?n't|cannot|can't|wouldn't)\s+(?:recommend|suggest|consider)|bad|poor|terrible|unreliable|avoid|unsuitable|disappointing)\b|(?:不|别|避免|未)(?:太|再|值得)?(?:推荐|建议|适合)|糟糕|差劲|不可靠|不值得/giu;
const recommendationCue = /\b(?:recommend(?:ed|s|ing)?|suggest(?:ed|s|ing)?|suitable|consider)\b|推荐|建议|适合|首选/giu;
const positiveCue = /\b(?:good|great|excellent|reliable|helpful|best)\b|优秀|可靠|出色|好用/giu;

/** Conservative lexical v1: cues belong only to the nearest entity occurrence within a clause. */
export class RuleJudge implements ResponseJudge {
  readonly analysisVersion = ANALYSIS_VERSION;
  judge({ rawResponse, entityId, occurrences }: JudgeInput): JudgeResult {
    if (!occurrences.some(m => m.entityId === entityId)) return { recommended: false, sentiment: 'unknown' };
    // Mask URLs with spaces, keeping raw offsets and preventing URL tokens from becoming lexical evidence.
    let masked = rawResponse;
    for (const span of urlSpans(rawResponse)) masked = masked.slice(0, span.start) + ' '.repeat(span.end - span.start) + masked.slice(span.end);
    const clauses: Span[] = []; let start = 0;
    for (const match of masked.matchAll(clauseDelimiter)) { clauses.push({ start, end: match.index! }); start = match.index! + match[0].length; }
    clauses.push({ start, end: masked.length });
    let negative = false; let positive = false; let recommended = false;
    for (const clause of clauses) {
      const local = occurrences.filter(m => m.startOffset >= clause.start && m.endOffset <= clause.end);
      if (!local.some(m => m.entityId === entityId)) continue;
      // Normalizing may change length, so lexical cues operate on raw clause text for raw offset attribution.
      const text = masked.slice(clause.start, clause.end);
      const negatives = [...text.matchAll(negativeCue)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
      const owns = (cue: Span) => {
        const absolute = { start: cue.start + clause.start, end: cue.end + clause.start };
        // Entity names containing cue words are not evidence about themselves.
        if (local.some(m => absolute.start < m.endOffset && absolute.end > m.startOffset)) return false;
        const distance = (m: EntityOccurrence) => Math.max(m.startOffset - absolute.end, absolute.start - m.endOffset, 0);
        const sorted = [...local].sort((a, b) => distance(a) - distance(b) || a.startOffset - b.startOffset);
        return sorted[0]?.entityId === entityId;
      };
      for (const cue of negatives) if (owns(cue)) negative = true;
      for (const match of text.matchAll(recommendationCue)) {
        const cue = { start: match.index!, end: match.index! + match[0].length };
        if (!negatives.some(n => cue.start < n.end && cue.end > n.start) && owns(cue)) recommended = true;
      }
      for (const match of text.matchAll(positiveCue)) {
        const cue = { start: match.index!, end: match.index! + match[0].length };
        if (!negatives.some(n => cue.start < n.end && cue.end > n.start) && owns(cue)) positive = true;
      }
    }
    return { recommended: recommended && !negative, sentiment: negative ? 'negative' : recommended || positive ? 'positive' : 'neutral' };
  }
}

export function analyzeResponse(input: AnalysisInput, judge: ResponseJudge = new RuleJudge()): AnalysisOutput {
  const occurrences = findOccurrences(input.rawResponse, input.entities);
  const mentions: Mention[] = []; const seen = new Set<string>(); const judgments = new Map<string, JudgeResult>();
  for (const occurrence of occurrences) {
    if (seen.has(occurrence.key)) continue; seen.add(occurrence.key);
    const judgment = judge.judge({ rawResponse: input.rawResponse, entityId: occurrence.key, occurrences });
    judgments.set(occurrence.key, judgment);
    const { entity, startOffset, endOffset } = occurrence;
    mentions.push({ entityType: entity.entityType, entityId: entity.id, canonicalName: entity.canonicalName,
      displayName: input.rawResponse.slice(startOffset, endOffset), position: mentions.length + 1,
      context: input.rawResponse.slice(Math.max(0, startOffset - 100), Math.min(input.rawResponse.length, endOffset + 100)),
      sentiment: judgment.sentiment, startOffset, endOffset });
  }
  const brand = input.entities.find(entity => entity.entityType === 'brand');
  const brandMention = brand && mentions.find(m => m.entityType === 'brand' && m.entityId === brand.id);
  const judgment = brand && judgments.get(entityKey(brand));
  return { analysisVersion: judge.analysisVersion, brandMentioned: !!brandMention,
    mentionPosition: brandMention?.position ?? null, recommended: judgment?.recommended ?? false,
    sentiment: judgment?.sentiment ?? 'unknown', mentions, citations: extractCitations(input.rawResponse, input.structuredCitations ?? []) };
}

export interface MetricsInput { runs: Array<{ status: string; analysis?: AnalysisOutput | null }>; analysisVersion?: string }
export interface MetricsOutput {
  metricVersion: typeof METRIC_VERSION; analysisVersion: string; totalRuns: number; successfulRuns: number;
  failedRuns: number; cancelledRuns: number; analyzedRuns: number; analysisMissingRuns: number;
  visibilityRate: number | null; recommendationRate: number | null; averageMentionPosition: number | null;
  shareOfVoice: number | null; citationCount: number; citationDomainCount: number;
  sentimentDistribution: Record<Sentiment, number>;
}

export function aggregateMetrics({ runs, analysisVersion = ANALYSIS_VERSION }: MetricsInput): MetricsOutput {
  const successful = runs.filter(run => run.status === 'SUCCEEDED');
  const eligible = successful.flatMap(run => run.analysis?.analysisVersion === analysisVersion ? [run.analysis] : []);
  const mentioned = eligible.filter(analysis => analysis.brandMentioned);
  const positions = mentioned.flatMap(analysis => analysis.mentionPosition === null ? [] : [analysis.mentionPosition]);
  const sentimentDistribution: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0, unknown: 0 };
  const domains = new Set<string>(); let entityCount = 0; let brandCount = 0; let citationCount = 0;
  for (const analysis of eligible) {
    sentimentDistribution[analysis.sentiment]++;
    const entities = new Set(analysis.mentions.map(m => `${m.entityType}:${m.entityId}`));
    entityCount += entities.size;
    // Headline brand is the first configured brand, represented by the selected mention rank.
    if (analysis.brandMentioned && analysis.mentions.some(m => m.entityType === 'brand' && m.position === analysis.mentionPosition)) brandCount++;
    citationCount += analysis.citations.length;
    for (const citation of analysis.citations) domains.add(citation.domain.toLowerCase());
  }
  return { metricVersion: METRIC_VERSION, analysisVersion, totalRuns: runs.length, successfulRuns: successful.length,
    failedRuns: runs.filter(run => run.status === 'FAILED').length, cancelledRuns: runs.filter(run => run.status === 'CANCELLED').length,
    analyzedRuns: eligible.length, analysisMissingRuns: successful.length - eligible.length,
    visibilityRate: eligible.length ? mentioned.length / eligible.length : null,
    recommendationRate: eligible.length ? eligible.filter(analysis => analysis.recommended).length / eligible.length : null,
    averageMentionPosition: positions.length ? positions.reduce((sum, position) => sum + position, 0) / positions.length : null,
    shareOfVoice: entityCount ? brandCount / entityCount : null, citationCount, citationDomainCount: domains.size, sentimentDistribution };
}
