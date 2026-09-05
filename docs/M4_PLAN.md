# M4 implementation plan

Baseline: clean master at e227dc7, verified at takeover. Extend existing BullMQ processor, fencing token and task aggregation; do not replace M3.

1. Disable incremental compilation only for the production Nest build. Build twice and verify main.js after each build.
2. Add Evidence (one immutable observation per Run), versioned Analysis, Mention and Citation. Store original query/prompt/response, engine/model/source/retrieval/timestamp and entity configuration snapshot. Add independent Run analysisStatus and bounded recovery attempts.
3. Add pure @geo/core deterministic analyzer and internal metric formulas, with multilingual, boundary, alias, negation, citation and denominator unit tests.
4. Commit provider success and Evidence atomically under the existing task lock/fencing rule; perform analysis afterward. Analysis failure cannot undo Evidence or turn provider success into provider failure. Periodically recover unanalysed successful runs. Version replay reuses immutable Evidence and its entity snapshot.
5. Add tenant-filtered Run Evidence and task Metrics read endpoints, preserving task status API. Extend the existing monitoring page with raw evidence detail and small metric cards.
6. Apply additive migration to geo_test first, test immutable UPDATE rejection, replay/new version, failed analyzer persistence, successful worker execution, API isolation, 15 Run evidence completeness and exact metrics. Run all M3 tests.
7. Compare development table fingerprints, apply the verified additive migration to geo_dev, start production package scripts, check health and UI. Demo fixture stays in geo_test; tests do not create business data in geo_dev.
8. Update current architecture/database/evidence/metrics/decision logs, commit reviewed M4 changes locally, stop before M5. No paid model calls.

Metric contract: eligible = provider SUCCEEDED and requested analysis version saved; missing analyses reported separately. Visibility/recommendation rates use eligible denominator; average rank only mentioned brand; share of voice uses one presence per configured entity per eligible response. No denominator returns null, not zero.
