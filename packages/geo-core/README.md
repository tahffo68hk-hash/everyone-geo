# @geo/core

Deterministic, synchronous response analysis and metric aggregation. No database, provider, filesystem, clock, random source, or network access is used. The default analysis version is `m4-rule-v1`; metrics use `geolens-v1`.

```ts
import { analyzeResponse, aggregateMetrics } from '@geo/core';

const analysis = analyzeResponse({
  rawResponse: 'I recommend Project Mentor. https://example.com/source',
  entities: [{ id: 'brand-1', canonicalName: 'ProjectMentor', aliases: ['项目导师'], entityType: 'brand' }],
});
const metrics = aggregateMetrics({ runs: [{ status: 'SUCCEEDED', analysis }] });
```

## Matching and traceability

- The first configured `brand` controls the headline fields. All configured unique entities may appear in `mentions`, including any additional brands. Identity is `(entityType, id)`; duplicate configuration entries use the first entry. Callers should provide a stable entity ordering from their configuration snapshot.
- Canonical names and aliases match case insensitively after Unicode NFKC normalization. Grapheme mapping retains offsets in the original JavaScript UTF16 string, including emoji, fullwidth letters, and composed accents. Whitespace between configured words or camel-case components is optional, so `ProjectMentor` also matches `Project Mentor`.
- Latin letters, Unicode numbers, and underscores require outer word boundaries. Chinese names can match contiguous Chinese text. Names inside textual HTTP/HTTPS URLs are excluded.
- Across overlapping matches, the longest raw span wins; equal spans use entity configuration order, then earliest offset. A shared alias therefore belongs to one entity. Each entity emits its earliest accepted occurrence. `position` is its one-based rank among distinct mentioned entities, never a character offset.
- `displayName` is the exact original substring between `startOffset` and `endOffset` (exclusive). `context` adds at most 100 raw UTF16 code units on each side, without rewriting the text. Sentiment considers all accepted occurrences, so evidence can appear later than the displayed first excerpt.

## Rule judge

`RuleJudge` implements the exported `ResponseJudge` interface. `analyzeResponse(input, judge)` accepts a replacement judge whose required `analysisVersion` travels with the result; the default metric calculation excludes other versions.

The v1 judge uses English and Chinese recommendation and sentiment lexicons. Sentences and comma/semicolon/newline clauses, plus contrast words such as `but` and `但是`, bound attribution. Each cue belongs only to the nearest entity occurrence in that clause; equal distances select the earlier occurrence. URLs and words inside an entity name cannot become sentiment evidence. This intentionally conservative policy can miss coordinated recommendations, pronouns, sarcasm, and complex syntax. It is a transparent lexical heuristic, not an LLM or a semantic claim.

Unmentioned entities are `unknown`; a mention without lexical evidence is `neutral`. Recommendation cues are positive unless negated. Negative evidence takes precedence across occurrences and suppresses a conflicting positive recommendation. Examples include `not recommended`, `do not consider`, `不推荐`, and `不适合`.

## Citations

Structured HTTP/HTTPS citations come first in input order; text extraction supplies a fallback in raw order. The first nonempty structured title wins. URLs are normalized with the WHATWG URL parser, which lowercases hosts and removes default ports; fragments are stripped. Exact normalized URLs are deduplicated. Paths and query strings remain distinct. Trailing prose punctuation and unmatched closing markdown parentheses are removed; balanced path parentheses remain. Invalid URLs, other schemes, and credential-bearing URLs are ignored. No link is fetched or verified. Citation positions are one-based output ranks.

## Metrics

Only `SUCCEEDED` runs with the requested `analysisVersion` are eligible. The default version is `m4-rule-v1`; callers can explicitly choose another version. Successful runs with missing or mismatched analysis are counted in `analysisMissingRuns` and excluded from all analytic denominators. Failed, cancelled, queued, and running runs never enter those denominators.

| Field | Definition |
| --- | --- |
| `visibilityRate` | Eligible runs mentioning the selected brand / eligible runs |
| `recommendationRate` | Eligible runs recommending the selected brand / eligible runs |
| `averageMentionPosition` | Mean selected-brand rank over eligible runs mentioning it |
| `shareOfVoice` | Selected-brand entity presences / all distinct configured entity presences over eligible runs |
| `citationCount` | Sum of per-run deduplicated citations across eligible runs |
| `citationDomainCount` | Distinct domains across eligible runs |
| `sentimentDistribution` | Counts of selected-brand sentiment across eligible runs, including `unknown` |

Rates use 0–1 values. Empty denominators produce `null`; eligible runs without a brand mention produce visibility/recommendation `0`. Share of voice is `null` when no configured entity is mentioned. Repeated textual occurrences never increase entity presence. Run totals and status counts include all supplied runs; unknown statuses are included only in `totalRuns`.

## Verification

Run `pnpm --filter @geo/core build` and `pnpm --filter @geo/core test` under the repository's Node 24 runtime. Tests cover matching, raw offsets, collision rules, citation normalization, local recommendation attribution, negation, version selection, and metric denominator/null semantics.
