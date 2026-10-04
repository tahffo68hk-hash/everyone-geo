# GeoLens Productization 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing feature-complete GeoLens workspace into a daily-usable product by clarifying first-hour onboarding, surfacing derived next actions, simplifying user-facing language, and strengthening evidence/verification entry points without changing canonical business truth.

**Architecture:** Keep the existing Next.js App Router, `ProjectContext`, API client, and backend contracts. Derive product actions from existing project, report, activity, recommendation, content, publication, and outcome responses; do not introduce a second task-status database. Add small reusable UI primitives for onboarding progress, action rows, evidence summaries, and workflow guidance, then compose them into the existing Dashboard and relevant pages.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind v4/CSS, NestJS API, PostgreSQL, Redis, Playwright, pnpm 11.1.0, Node 24.20.0.

## Global Constraints

- Preserve `Evidence`, `Retest`, `OutcomeComparison`, `OutcomeAttribution`, `LearningObservation`, published-asset lineage, AI provider truth, tenant isolation, and project isolation.
- Do not create `/v2`, `/demo`, a replacement site, Stripe, billing, or a second task truth model.
- Do not invent KPI formulas or business data; use existing API responses and explicit empty states.
- AI mutations remain `Generate → Preview → Apply`; no Apply operation may happen before user confirmation.
- Do not modify existing unrelated untracked files; do not use `git add .`, `git reset --hard`, `git clean`, or `git push`.
- Keep Cloudflare Tunnel out of scope.

---

### Task 1: Capture the audit baseline and product gap ledger

**Files:**
- Create: `scratch/productization-1.0-audit.md`
- Inspect: `apps/web/src/components/app-shell.tsx`, `apps/web/src/app/app/page.tsx`, `apps/web/src/components/project-context.tsx`, all `apps/web/src/app/app/**/page.tsx`, `apps/web/src/components/ai/**`, `apps/web/src/components/content/**`

**Interfaces:**
- Consumes: current route structure, API client, existing label dictionaries, local service health.
- Produces: a concise ledger with `Page`, `User Goal`, `Current Experience`, `Problem`, `Severity`, `Root Cause`, `Action`, and `Verification` fields; no committed code changes.

- [ ] **Step 1: Record repository, runtime, service, and route baseline.**
- [ ] **Step 2: Start Web/API/Worker/PostgreSQL/Redis with the existing control script and record health.**
- [ ] **Step 3: Exercise the current browser routes and record only actionable P0–P3 gaps.**
- [ ] **Step 4: Write the ledger and identify the smallest implementation surface for each P0/P1 gap.**

### Task 2: Add reusable productization UI primitives

**Files:**
- Modify: `apps/web/src/components/ui.tsx`
- Create: `apps/web/src/components/productization.tsx`
- Modify: `apps/web/src/lib/labels.ts`

**Interfaces:**
- Consumes: existing `PageHeader`, `EmptyState`, `StatusBadge`, `LoadingSkeleton`, `ErrorState`, and label formatters.
- Produces: typed `ActionItem`, `OnboardingStep`, `WorkflowStep`, and reusable `ActionList`, `SetupChecklist`, `WorkflowRail`, `EvidenceSummary`, and `ContextualEmptyState` components.

- [ ] **Step 1: Add labels for user-facing workflow states and action sources without removing existing canonical values.**
- [ ] **Step 2: Implement `ActionList` with explicit title, reason, source label, destination, and optional status; never render internal IDs as primary copy.**
- [ ] **Step 3: Implement `SetupChecklist` and `WorkflowRail` as presentational components with accessible headings and links.**
- [ ] **Step 4: Implement `EvidenceSummary` with separate “观测事实” and “AI 解读” sections and an optional evidence destination.**
- [ ] **Step 5: Add component-level tests or deterministic render checks for empty, loading, and populated states.**

### Task 3: Make first-hour onboarding continuous

**Files:**
- Modify: `apps/web/src/app/app/page.tsx`
- Modify: `apps/web/src/app/app/projects/new/page.tsx`
- Modify: `apps/web/src/app/app/target/page.tsx`
- Modify: `apps/web/src/app/app/queries/page.tsx`
- Modify: `apps/web/src/app/app/benchmark/page.tsx`
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `ProjectContext`, existing project/target/query/benchmark APIs, and the new onboarding primitives.
- Produces: a lightweight setup checklist derived from existing state, with links for project creation, target setup, query-set creation, first measurement, and diagnosis/report review.

- [ ] **Step 1: Derive checklist completion from existing project, target, query-set, report, and diagnosis data; do not add persisted checklist state.**
- [ ] **Step 2: Show the checklist only when a project is new or incomplete, with one primary next action and explanatory empty states.**
- [ ] **Step 3: Ensure every empty state explains what the page is, why it is empty, and the next real action.**
- [ ] **Step 4: Preserve `project` query context through all checklist links and project/target transitions.**
- [ ] **Step 5: Add browser checks for the no-project, target-missing, no-query-set, and no-report paths.**

### Task 4: Turn Dashboard into a daily workspace

**Files:**
- Modify: `apps/web/src/app/app/page.tsx`
- Create: `apps/web/src/lib/action-center.ts`
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: dashboard reports/activity plus existing recommendation, opportunity, content, publication, retest, and outcome endpoints where available.
- Produces: `deriveActionItems(input): ActionItem[]`, deterministic derived actions grouped as attention and next actions; no new persistence or conflicting status.

- [ ] **Step 1: Define the `ActionItem` shape with `id`, `kind`, `title`, `reason`, `href`, `source`, `priority`, and `state` fields.**
- [ ] **Step 2: Implement pure derivation helpers that convert existing API states into actions such as run unmeasured queries, review diagnosis, process recommendation, publish reviewed content, and retest due assets.**
- [ ] **Step 3: Fetch only the existing project-scoped summaries needed by the Dashboard and degrade each optional source independently when unavailable.**
- [ ] **Step 4: Replace generic “查看详情/查看更多” CTAs with 2–5 task-oriented next actions, while keeping truthful current-state metrics.**
- [ ] **Step 5: Add unit tests for action derivation, including no data, mixed statuses, and negative/no-change outcomes.**

### Task 5: Simplify AI and evidence entry points

**Files:**
- Modify: `apps/web/src/app/app/diagnosis/page.tsx`
- Modify: `apps/web/src/app/app/recommendations/page.tsx`
- Modify: `apps/web/src/app/app/queries/page.tsx`
- Modify: `apps/web/src/app/app/content/page.tsx`
- Modify: `apps/web/src/app/app/content/[id]/page.tsx`
- Modify: `apps/web/src/components/ai/ai-action-button.tsx`
- Modify: `apps/web/src/components/ai/ai-generation-modal.tsx`
- Modify: `apps/web/src/app/app/monitor/evidence-dialog.tsx`

**Interfaces:**
- Consumes: existing AI APIs and preview modal contracts, diagnosis/recommendation evidence responses, and existing content editor actions.
- Produces: contextual primary AI actions, grouped lower-frequency actions, explicit preview/apply affordances, and visible evidence traceability.

- [ ] **Step 1: Inventory visible AI actions and classify each as primary, menu, merged, contextual, or duplicate in the audit ledger.**
- [ ] **Step 2: Keep one contextual primary action per workflow surface and move low-frequency actions behind an existing menu or modal entry point.**
- [ ] **Step 3: Add or strengthen `查看证据` affordances showing query, provider/model, measured time, raw answer/citation, source, and retrieval mode where the API already returns them.**
- [ ] **Step 4: Ensure AI explanation styling is visually distinct from observation facts and preserve existing provider/recovery behavior.**
- [ ] **Step 5: Test Generate → Preview → Apply flows without changing the API mutation semantics.**

### Task 6: Strengthen Verification / Outcome workspace

**Files:**
- Modify: `apps/web/src/app/app/content/verification/page.tsx`
- Modify: `apps/web/src/components/content/outcome-workspace/outcome-workspace-view.tsx`
- Modify: `apps/web/src/components/content/outcome-workspace/asset-outcome-overview.tsx`
- Modify: `apps/web/src/components/content/outcome-workspace/query-outcome-table.tsx`
- Modify: `apps/web/src/components/content/outcome-workspace/query-outcome-drawer.tsx`

**Interfaces:**
- Consumes: existing published asset, before/after, comparability, outcome, attribution, and raw evidence data.
- Produces: a first-screen verification summary, query-level structured outcomes, and expandable raw-evidence detail while preserving positive, negative, no-change, and mixed states.

- [ ] **Step 1: Put Published Asset, Before, After, Observed Change, Comparability, and Attribution before any AI summary.**
- [ ] **Step 2: Present query-level Mention, Citation, Position, Recommendation, Sentiment, and Competitor changes in a table-first layout.**
- [ ] **Step 3: Keep raw before/after answers, citations, attribution reasons, and confounders behind a clear evidence drawer.**
- [ ] **Step 4: Add explicit copy for negative, no-change, and mixed results without causal overclaiming.**
- [ ] **Step 5: Add browser assertions for evidence visibility and project context preservation.**

### Task 7: Product language and feature exposure audit

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`
- Modify: `apps/web/src/lib/labels.ts`
- Modify: affected page/component files identified by the ledger
- Modify: `scratch/productization-1.0-audit.md`

**Interfaces:**
- Consumes: implemented onboarding, action, AI, and verification surfaces.
- Produces: consistent task-oriented Chinese copy, fewer duplicate buttons, and a completed exposure audit categorized as `PRIMARY`, `SECONDARY`, `ADVANCED`, `HIDDEN_CONTEXTUAL`, or `REMOVE_DUPLICATE_UI`.

- [ ] **Step 1: Replace marketing-style CTAs with concrete task verbs while retaining technical identifiers only where they are necessary for traceability.**
- [ ] **Step 2: Hide or regroup low-frequency internal entity labels without changing URL paths or API behavior.**
- [ ] **Step 3: Scan for fake KPI labels, redundant AI buttons, large card clusters, and unhelpful empty-state copy.**
- [ ] **Step 4: Record all remaining P2/P3 gaps and close the actionable P0/P1 items.**

### Task 8: Run browser iteration and product red-team

**Files:**
- Create: `scratch/productization-1.0-browser-check.py`
- Modify: `scratch/productization-1.0-audit.md`

**Interfaces:**
- Consumes: running local Web/API/Worker services and the implemented UI.
- Produces: screenshots/logs or concise results for viewports 1440×1000, 1200×900, and 1024×800 across onboarding/dashboard, monitoring/diagnosis, recommendations/actions, content, and verification/learning.

- [ ] **Step 1: Run the bundled server helper help command before using it, then launch the existing local services with the project control script.**
- [ ] **Step 2: Use Playwright reconnaissance after `networkidle` to inspect rendered DOM and identify stable selectors.**
- [ ] **Step 3: Exercise the five browser rounds, collecting console errors, page exceptions, failed requests, undefined/NaN/[object Object] text, and screenshots.**
- [ ] **Step 4: Fix the first actionable browser defect, rerun the affected round, and repeat until P0/P1 are zero.**
- [ ] **Step 5: Run the daily-use test: Dashboard → complete one action → return to Dashboard and verify state/context updates.**

### Task 9: Run regression and commercialization readiness audit

**Files:**
- Create: `scratch/productization-1.0-regression.md`
- Modify: `scratch/productization-1.0-audit.md`

**Interfaces:**
- Consumes: current repository test/build scripts and source-level tenant/user/role/usage/provider provenance evidence.
- Produces: exact command outputs summarized for Prisma validate/generate, API/Worker/Web builds, UI check, formal suites, and a non-implementation readiness checklist.

- [ ] **Step 1: Discover current test scripts and run Prisma validation/generation without resetting data.**
- [ ] **Step 2: Run API build, Worker build, Web TypeScript, Web build, and Chinese UI check using Node 24.**
- [ ] **Step 3: Run all formal suites discoverable from the repository, recording counts from output rather than guessing.**
- [ ] **Step 4: Record tenant, user, role, usage, AI cost/provenance, provider status, and project isolation readiness without implementing billing/RBAC.**

### Task 10: Review, commit, and final gate report

**Files:**
- Create: `docs/PRODUCTIZATION_1_0_FINAL_REPORT.md`
- Modify: only explicitly reviewed product files from Tasks 2–7

**Interfaces:**
- Consumes: audit ledger, browser results, regression report, and Git diff.
- Produces: 2–6 focused local commits, no push, and the required final gate report with PASS/FAIL statuses grounded in observed evidence.

- [ ] **Step 1: Review the complete diff against frozen truth boundaries and remove accidental generated files.**
- [ ] **Step 2: Stage only the reviewed product files and the final report; never use `git add .`.**
- [ ] **Step 3: Create focused commits by responsibility when the diff supports it; otherwise create one productization commit.**
- [ ] **Step 4: Re-run final status, tests, and commit log; confirm no push occurred.**
- [ ] **Step 5: Write the final report with explicit blockers and gate statuses; do not claim PASS when browser or pilot evidence is unavailable.**
