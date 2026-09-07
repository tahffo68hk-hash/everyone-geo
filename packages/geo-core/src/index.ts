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
  readonly analysisVersion: string;
  /** 版本可参数化：m4 默认 ANALYSIS_VERSION；M6B re-analysis 使用独立版本标签
   *  （如 m6b-competitors-v1）复用同一套确定性词法规则，但不污染 m4 指标。 */
  constructor(analysisVersion: string = ANALYSIS_VERSION) {
    this.analysisVersion = analysisVersion;
  }
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

// ============================================================
// M6B Competitor Discovery —— deterministic extraction (pure)
// ============================================================
// Mentioned Brand ≠ Competitor：这里只产出“候选品牌信号”（候选 ≠ 竞对）。
// 规则均为确定性词法信号：大小写/别名归并、URL 排除、自身品牌排除、普通词排除；
// 不输出任何未经训练支持的概率。竞争关系（DIRECT/ADJACENT/SUBSTITUTE）只允许
// 人工在评审（Approve）时选择，本模块永不推断 DIRECT。

export interface BrandOccurrence { text: string; start: number; end: number }

export interface DiscoveredCandidate {
  /** 展示名：频次最高的原始变体（lexicon 内全局累计） */
  canonicalName: string;
  /** 归并键 token 序列（小写）；跨 Evidence 用其身份做 suffix 归并 */
  keyTokens: string[];
  /** 观测到的原始变体（大写变体/拼写变体），供 UI 别名展示 */
  aliases: string[];
  /** 本次（单条 Evidence）文本内的命中 */
  occurrences: BrandOccurrence[];
}

export interface DiscoveryOptions {
  /** 自身品牌（name + aliases）：命中既不产候选，也不计为竞对 */
  ownBrandAliases?: string[];
  /** 附加排除名（如 legacy 占位 Competitor A/B/C 等开发占位） */
  excludeNames?: string[];
  /** 覆盖默认 stop words */
  stopWords?: ReadonlySet<string>;
  /** 单候选最大 token 数（防整句被抓成候选），默认 6 */
  maxTokens?: number;
}

/** 常见大写句首/功能词与泛化产品词（generic，非针对特定品牌）。 */
export const DEFAULT_CANDIDATE_STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'not', 'no', 'yes', 'of', 'for', 'in', 'on', 'at', 'by', 'with',
  'to', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that',
  'these', 'those', 'there', 'here', 'they', 'their', 'them', 'we', 'our', 'you', 'your', 'he', 'she',
  'his', 'her', 'i', 'me', 'my', 'all', 'any', 'both', 'each', 'every', 'other', 'others', 'some',
  'many', 'most', 'more', 'less', 'such', 'like', 'can', 'could', 'would', 'should', 'may', 'might',
  'must', 'will', 'shall', 'do', 'does', 'did', 'have', 'has', 'had', 'what', 'why', 'when', 'where',
  'which', 'who', 'whom', 'how', 'if', 'then', 'than', 'also', 'however', 'additionally', 'first',
  'second', 'third', 'next', 'last', 'one', 'two', 'new', 'top', 'best', 'key', 'popular', 'leading',
  'great', 'good', 'free', 'paid', 'pro', 'vs', 'versus', 'ai', 'api', 'ui', 'saas', 'app', 'apps',
  'tool', 'tools', 'software', 'platform', 'platforms', 'feature', 'features', 'pricing', 'review',
  'reviews', 'compare', 'comparison', 'alternatives', 'alternative', 'use', 'using', 'used', 'need',
  'needs', 'note', 'notes', 'learn', 'list', 'guide', 'check', 'consider', 'recommended',
  'recommend', 'recommendation', 'recommendations', 'available', 'latest', 'yourself', 'include',
  'includes', 'including', 'requires', 'explore', 'ready', 'go', 'chatbot', 'chatbots',
]);

/** 允许作为候选内部连接词的（小写）功能词：如 "OpenAI and ChatGPT" 中 and。 */
const CANDIDATE_CONNECTORS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'in', 'on', 'at', 'by', 'with', 'to', 'from', 'vs', 'v']);
/** 允许出现在候选 token 之间的纯标点空隙。 */
const CANDIDATE_GAP_PUNCT = /^[\s\-–—/·&+]+$/u;
const UPPER_TOKEN = /[\p{Lu}][\p{L}\p{N}'’&]*/gu;

/** NFKC 折叠 → 小写 → 按非字母数字切分为 token 数组（中文整词为一个 token）。 */
export function candidateTokens(name: string): string[] {
  const folded = name.normalize('NFKC').toLowerCase().replace(/[’']/g, '');
  return folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** token 数组 → 存储/匹配键（空格连接，保留 token 边界供 suffix 归并）。 */
export function tokensKey(tokens: string[]): string {
  return tokens.join(' ');
}

/** a 是否为 b 的 token 级后缀（或相等）；用于大小写/别名/长短写法归并。 */
export function tokensAreSuffix(shorter: string[], longer: string[]): boolean {
  if (shorter.length > longer.length) return false;
  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[longer.length - shorter.length + i]) return false;
  }
  return true;
}

/** 大小写不敏感的全别名匹配（复用 m4 的归一化 + 偏移映射；URL 内不匹配）。 */
export function findAliasOccurrences(rawResponse: string, aliases: string[]): BrandOccurrence[] {
  if (!rawResponse || aliases.length === 0) return [];
  const normalized = normalizedWithOffsets(rawResponse);
  const excluded = urlSpans(rawResponse);
  const found: BrandOccurrence[] = [];
  const unique = new Set<string>();
  for (const alias of aliases) {
    const regex = aliasRegex(alias);
    if (!regex) continue;
    for (const match of normalized.text.matchAll(regex)) {
      const start = match.index!; const end = start + match[0].length;
      const previous = [...normalized.text.slice(0, start)].at(-1) ?? '';
      const next = [...normalized.text.slice(end)][0] ?? '';
      if ((latinWord.test(match[0][0]) && latinWord.test(previous)) ||
          (latinWord.test(match[0].at(-1)!) && latinWord.test(next))) continue;
      const startOffset = normalized.starts[start]; const endOffset = normalized.ends[end - 1];
      if (excluded.some(span => startOffset < span.end && endOffset > span.start)) continue;
      const key = `${startOffset}:${endOffset}`;
      if (unique.has(key)) continue;
      unique.add(key);
      found.push({ text: rawResponse.slice(startOffset, endOffset), start: startOffset, end: endOffset });
    }
  }
  return found;
}

/** 给定文本中的全部命名实体命中（供推荐归属判定时传入其他候选/品牌 offset）。 */
export interface EntityHit extends EntityOccurrence { text: string }

export interface DiscoveryLexiconGroup {
  keyTokens: string[];
  canonicalName: string;
  aliases: string[];
  variantCounts: Map<string, number>;
  firstOffset: number;
}

export interface DiscoveryLexicon {
  byKey: Map<string, DiscoveryLexiconGroup>;
}

export function createDiscoveryLexicon(): DiscoveryLexicon {
  return { byKey: new Map() };
}

function groupKey(group: DiscoveryLexiconGroup): string {
  return tokensKey(group.keyTokens);
}

function mergeGroups(target: DiscoveryLexiconGroup, incoming: DiscoveryLexiconGroup) {
  for (const [variant, count] of incoming.variantCounts) {
    target.variantCounts.set(variant, (target.variantCounts.get(variant) ?? 0) + count);
  }
  target.firstOffset = Math.min(target.firstOffset, incoming.firstOffset);
  target.aliases = [...new Set([...target.aliases, ...incoming.aliases])].sort((a, b) =>
    (target.variantCounts.get(b) ?? 0) - (target.variantCounts.get(a) ?? 0) ||
    b.length - a.length || a.localeCompare(b));
  target.canonicalName = target.aliases[0];
}

/**
 * 从一条 rawResponse 提取候选品牌信号（确定性）。
 * 通过 lexicon 跨 Evidence 累计身份：重复/大小写/别名变体（含 "chatgpt" vs
 * "OpenAI ChatGPT" 的 suffix 归并）只产生同一个候选。
 */
export function discoverCandidates(rawResponse: string, options: DiscoveryOptions = {}, lexicon = createDiscoveryLexicon()): DiscoveredCandidate[] {
  if (!rawResponse) return [];
  const stopWords = options.stopWords ?? DEFAULT_CANDIDATE_STOP_WORDS;
  const maxTokens = options.maxTokens ?? 6;

  const urlSpanList = urlSpans(rawResponse);
  const insideUrl = (offset: number) => urlSpanList.some(span => offset >= span.start && offset < span.end);

  // ---- 第 1 步：uppercase 起始 token 的原始命中 ----
  const rawTokens: Array<{ text: string; start: number; end: number; tokens: string[] }> = [];
  for (const match of rawResponse.matchAll(UPPER_TOKEN)) {
    const start = match.index!; const end = start + match[0].length;
    if (insideUrl(start)) continue;
    const text = rawResponse.slice(start, end);
    const letters = text.replace(/[^\p{L}]/gu, '');
    if (letters.length < 2) continue;
    const tokens = candidateTokens(text);
    const word = tokens.join(''); // 'Ai' 之类整词大写判断
    if (tokens.length === 1 && stopWords.has(word)) continue;
    if (tokens.some(t => stopWords.has(t) && t !== word)) continue; // 非全 stop 但含 stop → 拆词处理在 run 分组
    rawTokens.push({ text, start, end, tokens });
  }

  // ---- 第 2 步：lexicon 已知候选 + 排除名（自身品牌/占位）的大小写不敏感命中 ----
  const lexiconAliases: string[] = [];
  for (const group of lexicon.byKey.values()) lexiconAliases.push(...group.aliases);
  const hintHits: Array<{ text: string; start: number; end: number; tokens: string[] }> = [];
  const aliasPool = [...new Set([...lexiconAliases, ...(options.excludeNames ?? [])])];
  for (const hit of findAliasOccurrences(rawResponse, aliasPool)) {
    const tokens = candidateTokens(hit.text);
    if (tokens.length === 0) continue;
    hintHits.push({ text: hit.text, start: hit.start, end: hit.end, tokens });
  }
  // 排除名整体（含大小写/别名拼写）命中 → 重叠 run 整段丢弃：自身品牌/占位 ≠ 竞对
  const exclusionTexts = [...new Set([...(options.ownBrandAliases ?? []), ...(options.excludeNames ?? [])])];
  const exclusionHits = findAliasOccurrences(rawResponse, exclusionTexts);

  // ---- 第 3 步：把相邻 token 组装为候选 run ----
  const detections = [...rawTokens, ...hintHits].sort((a, b) => a.start - b.start || a.end - b.end);
  const runs: Array<{ tokens: string[]; occurrences: BrandOccurrence[]; text: string }> = [];
  let cursor = 0;
  while (cursor < detections.length) {
    const first = detections[cursor];
    let runTokens = [...first.tokens];
    let end = first.end;
    const occurrences = [{ text: first.text, start: first.start, end: first.end }];
    let next = cursor + 1;
    while (next < detections.length) {
      const candidate = detections[next];
      // 跳过与已并入 run 重叠的 hint（如 lexicon alias 与 raw token 同段重复）
      if (candidate.start < end) { next += 1; continue; }
      const gap = rawResponse.slice(end, candidate.start).trim();
      const gapOk = gap.length === 0 || CANDIDATE_GAP_PUNCT.test(gap) ||
        (candidateTokens(gap).length === 1 && CANDIDATE_CONNECTORS.has(candidateTokens(gap)[0]));
      if (!gapOk) break;
      const mergedTokens = [...runTokens, ...candidate.tokens];
      if (mergedTokens.length > maxTokens) break;
      runTokens = mergedTokens;
      end = candidate.end;
      occurrences.push({ text: candidate.text, start: candidate.start, end: candidate.end });
      next += 1;
    }
    if (runTokens.length > 0) {
      // 与排除名整体命中重叠的 run 丢弃（品牌 ≠ 竞对）
      const overlapsExclusion = occurrences.some(occ => {
        for (const key of exclusionHits) {
          if (occ.start < key.end && occ.end > key.start) return true;
        }
        return false;
      });
      if (!overlapsExclusion) {
        const text = rawResponse.slice(occurrences[0].start, occurrences[occurrences.length - 1].end);
        runs.push({ tokens: runTokens, occurrences, text });
      }
    }
    cursor = next;
  }

  // ---- 第 4 步：suffix 归并（含 lexicon 已有组）→ 返回本次命中 ----
  const byKeyTokens = new Map<string, { group: DiscoveryLexiconGroup; occurrences: BrandOccurrence[] }>();
  const attach = (group: DiscoveryLexiconGroup, occurrences: BrandOccurrence[]) => {
    const key = groupKey(group);
    const existing = byKeyTokens.get(key);
    if (existing) {
      existing.occurrences.push(...occurrences);
      existing.occurrences.sort((a, b) => a.start - b.start);
    } else {
      byKeyTokens.set(key, { group, occurrences });
    }
  };

  for (const run of runs) {
    const candidateGroup: DiscoveryLexiconGroup = {
      keyTokens: run.tokens, canonicalName: run.text, aliases: [],
      variantCounts: new Map(), firstOffset: run.occurrences[0].start,
    };
    candidateGroup.variantCounts.set(run.text, 1);
    candidateGroup.aliases = [...candidateGroup.variantCounts.keys()];
    candidateGroup.canonicalName = candidateGroup.aliases[0];

    // 与 lexicon 已有组做 suffix 归并：长 key 为基，短 key 并入
    let target: DiscoveryLexiconGroup | undefined;
    for (const group of lexicon.byKey.values()) {
      const a = group.keyTokens; const b = candidateGroup.keyTokens;
      if (tokensAreSuffix(a, b) || tokensAreSuffix(b, a) || tokensKey(a) === tokensKey(b)) {
        target = group; break;
      }
    }
    if (!target) {
      lexicon.byKey.set(groupKey(candidateGroup), candidateGroup);
      target = candidateGroup;
    } else {
      const longerKey = target.keyTokens.length >= candidateGroup.keyTokens.length ? target.keyTokens : candidateGroup.keyTokens;
      mergeGroups(target, candidateGroup);
      if (longerKey !== target.keyTokens) {
        lexicon.byKey.delete(tokensKey(target.keyTokens));
        target.keyTokens = longerKey;
        lexicon.byKey.set(groupKey(target), target);
      }
      // canonical 可能因计数变化而改变
      target.canonicalName = target.aliases[0];
    }
    attach(target, run.occurrences);
  }

  const results: DiscoveredCandidate[] = [];
  for (const { group, occurrences } of byKeyTokens.values()) {
    results.push({
      canonicalName: group.canonicalName,
      keyTokens: group.keyTokens,
      aliases: [...group.aliases],
      occurrences: [...occurrences],
    });
  }
  results.sort((a, b) => (a.occurrences[0]?.start ?? 0) - (b.occurrences[0]?.start ?? 0));
  return results;
}

/** 候选级“推荐”词法信号（确定性，非概率）：同一段内目标候选命中附近的
 *  推荐/负面 cue 归属给最近实体。 */
export function judgeRecommendationSignal(rawResponse: string, entityId: string, occurrences: EntityOccurrence[]): boolean {
  return new RuleJudge().judge({ rawResponse, entityId, occurrences }).recommended;
}

export * from './diagnosis';
export * from './recommendations';
export * from './content-opportunities';
export * from './experiments';
export * from './measurement';
export * from './pilot';
export * from './url-safety';
export * from './query-workspace';
