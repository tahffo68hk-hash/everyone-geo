# GeoLens Frontend Redesign Report — Comfort & Motion Pass v2

## Direction

This pass continues the existing GeoLens redesign rather than replacing the product. The goal is a calm, precise, tactile B2B SaaS interface inspired by Apple's restraint: neutral system typography, comfortable spacing, subtle depth, and short interaction feedback. GeoLens keeps its own teal brand accent and dense operational workflow.

No API contract, Evidence, Retest, Outcome, Attribution, Learning, provider selection logic, tenant isolation, or workflow meaning was intentionally changed.

## What changed in this pass

### 1. Button system

A single button language now drives product actions and AI actions.

- Primary: teal filled action, white label, 34px minimum height, 8px radius.
- Secondary: white surface, precise neutral border, restrained depth.
- Tertiary: transparent/quiet action for low-priority tools.
- Danger: calm red semantic action without turning the page into an alert wall.
- Compact: 29px minimum height for table/tool actions.
- Disabled: reduced opacity with no hover lift or misleading depth.

Interaction behavior:

- Hover: `translateY(-1px)` + subtle shadow increase.
- Press: `scale(.975)` + shadow reduction for tactile compression.
- Keyboard focus: four-pixel low-opacity brand focus ring.
- Touch devices: hover movement is disabled.
- Reduced-motion users: animation/transition durations collapse through `prefers-reduced-motion`.

Previously hand-authored blue / green / indigo primary action buttons in the main product were normalized back to the shared button system.

### 2. Global visual comfort

- Background moved to a softer neutral `#f5f5f7`.
- Main text moved toward `#1d1d1f`; secondary text uses calmer neutral grays.
- System font stack now prioritizes `-apple-system`, BlinkMacSystemFont and SF-compatible fallbacks.
- Borders were softened and made more consistent.
- Control and surface shadows are deliberately shallow rather than decorative.
- Selection color uses a low-opacity GeoLens teal.
- Typography tracking and heading weight were tightened for a cleaner system-font appearance.

### 3. Navigation and App Shell feedback

- Sidebar hover/active states now use quiet neutral surfaces.
- Active main navigation has a narrow teal inset marker rather than a large colored tile.
- Module tabs use an animated underline instead of a heavy active block.
- Breadcrumb links use a tiny neutral hover surface.
- "New project" is now a readable compact `＋ 新建` action rather than a symbol-only control.

### 4. Forms and inputs

- Inputs, selects and textareas use one neutral border language.
- Hover border is slightly darker.
- Focus uses the same teal ring as buttons.
- Auth inputs were brought into the same system.

### 5. AI interactions

- `AiActionButton` now consumes the normal GeoLens button system instead of carrying its own visual language.
- The small AI marker is intentionally quiet and secondary.
- AI modal uses a short fade + slight rise/scale entrance.
- Modal depth is more deliberate while keeping a plain white production-tool surface.
- Existing Auto / DeepSeek / Qwen behavior and Qwen -> DeepSeek recovery remain intact.

### 6. Outcome drawer and product modals

- Query outcome drawer receives a short right-to-left entrance motion with a restrained backdrop.
- Drawer close action uses the shared icon-button behavior.
- Existing `role="dialog"` modal overlays receive the same short, quiet entrance motion.
- Backdrop blur utilities were removed to avoid a glassmorphism look.

### 7. Content workspace cleanup

Decorative emoji that made operational pages feel like a template/demo were removed from the normal product workspace. Semantic warning styling remains through typography, borders and colors rather than emoji decoration.

### 8. Auth surfaces

Login and registration now share the same neutral background, system typography, input focus treatment, teal primary button and subdued card depth as the product.

## Motion principles

Motion is used only to confirm interaction or spatial change:

- button hover / press
- active navigation feedback
- modal appearance
- drawer appearance
- metric action hover

No looping decorative motion, glow, aurora, animated gradients or attention-seeking AI effects were added.

## Quality checks

- Chinese UI check: PASS — 61 files scanned.
- CSS brace structure: PASS — 339 opening / 339 closing braces.
- `rounded-2xl` / `rounded-3xl` in product TSX: 0.
- backdrop blur / backdrop filter: 0.
- selected decorative emoji in non-dev product UI: 0.
- direct blue / indigo / emerald / teal hand-authored action buttons in non-auth product UI: 0.
- TypeScript syntax-class errors (`TS1xxx`) from offline compiler parse: 0.

Full TypeScript type-check and Next build are **not reported as passing**. This source package intentionally contains no `node_modules`, and the current execution environment cannot resolve the required Next/React/@types packages. The global compiler therefore reports missing-module/type-environment errors. Those dependency errors are not treated as product-code validation success.

## Main files changed in this pass

- `apps/web/src/app/globals.css`
- `apps/web/src/components/app-shell.tsx`
- `apps/web/src/components/ai/ai-action-button.tsx`
- `apps/web/src/components/ai/ai-generation-modal.tsx`
- `apps/web/src/components/content/outcome-workspace/query-outcome-drawer.tsx`
- `apps/web/src/components/content/outcome-workspace/query-outcome-table.tsx`
- `apps/web/src/components/content/outcome-workspace/published-assets-table.tsx`
- `apps/web/src/components/content/campaign-workspace-view.tsx`
- `apps/web/src/components/content/content-calendar-view.tsx`
- `apps/web/src/components/content/production-queue-view.tsx`
- `apps/web/src/components/content/create-campaign-modal.tsx`
- `apps/web/src/components/content/edit-schedule-modal.tsx`
- `apps/web/src/app/app/content/page.tsx`
- `apps/web/src/app/app/content/[id]/page.tsx`
- primary-action normalization across Queries, Monitor, Reports, Recommendations, Opportunities, Experiments, Site Assets, Manual Runs and Change Plans
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/register/page.tsx`

## Remaining review item

A real Browser Review at 1440 / 1200 / 1024 still requires installing the locked frontend dependencies and starting Next.js. The source changes were designed to keep the existing layout/behavior contracts and include responsive and reduced-motion handling, but a running-browser visual acceptance pass should still be performed once dependencies are available.
