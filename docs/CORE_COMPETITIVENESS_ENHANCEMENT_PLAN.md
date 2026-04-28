# PrismOps Core Competitiveness Enhancement Plan

## Context

The first usable slice of the core competitiveness roadmap is complete:

- Delivery Pack V1
- Delivery readiness gates
- Agent work board
- Team playbooks
- Organization trust layer
- Dashboard success metrics and action queue

The next goal is not to add more surface area. The next goal is to make the delivery loop more reliable, measurable, and team-ready.

## Product Thesis

PrismOps should win by becoming the engineering workspace where AI work is not only generated, but made accountable.

The durable advantage should come from four compounding loops:

1. Every AI session produces traceable delivery evidence.
2. Every delivery gap becomes a visible action item.
3. Every resolved session improves project memory and team playbooks.
4. Every team can measure whether AI work is becoming safer and faster.

## Enhancement Principles

- Prefer workflow quality over feature count.
- Keep the conversation cockpit as the primary work surface.
- Use dashboards for prioritization, not decoration.
- Promote verified handoff as the default definition of done.
- Make every automation explain what evidence it used.
- Keep provider-neutral workflows so the product is not locked to one model.

## North-Star Metrics

- Delivery-pack rate: percentage of meaningful sessions with an exported delivery pack.
- Validation coverage: percentage of code-changing sessions with test, typecheck, build, lint, or explicit rationale.
- Verified handoff time: median time from task start to validated handoff.
- Memory capture rate: percentage of useful sessions that create reusable project knowledge.
- Safety cleanup rate: percentage of blocked sessions resolved within the same workday.
- Repeat-question reduction: fewer follow-up questions such as "what changed?", "was it tested?", and "is this safe?".

## Phase A: Reliability Hardening

Goal: Make the current cockpit and dashboard trustworthy in daily use.

Scope:

- Persist delivery metrics beyond localStorage when project storage is available.
- Add a stable schema/version for metric records and action queue records.
- Deduplicate delivery actions across repeated dashboard clicks.
- Record whether a queued action was inserted, sent, completed, or abandoned.
- Add empty/error/loading states for the metrics dashboard.
- Add tests for metric summarization, action ranking, prompt generation, and action consumption.

Acceptance:

- Metrics survive app reload and session switching.
- Clicking an action queue item never creates duplicate pending prompts for the same session.
- Dashboard action ranking is deterministic and covered by tests.
- A user can understand why a session appears in the action queue.

Suggested first tasks:

1. Add unit tests for `summarizeDeliveryMetrics` and `getDeliveryMetricActionItems`.
2. Add a consumed/completed lifecycle to queued remediation actions.
3. Add UI copy for empty metrics and stale metrics states.
4. Move metric persistence behind a small storage adapter.

## Phase B: Evidence Timeline

Goal: Turn delivery evidence into a readable timeline, not scattered cards.

Scope:

- Build a session evidence timeline from messages, tools, file changes, validations, decisions, and exported reports.
- Separate evidence types: command, validation, file change, decision, risk, agent activity, delivery pack.
- Allow filtering by evidence type.
- Show gaps inline, such as "changed files after last validation" or "delivery pack older than latest diff".
- Include timeline excerpts in trust reports and delivery packs.

Acceptance:

- A reviewer can answer "what happened?" in under 30 seconds.
- Delivery reports include enough timeline context to be shared outside the app.
- The cockpit can flag stale validation when code changes after the last check.

Suggested first tasks:

1. Add a timeline model derived from current conversation messages.
2. Surface "latest change after validation" as a delivery gate warning.
3. Add timeline summary to Markdown delivery pack exports.

## Phase C: Project Memory Flywheel

Goal: Make project memory a real moat, not a manual note bucket.

Scope:

- Classify extracted memories into decision, command, risk, architecture, convention, and validation.
- Add confidence and source references to each memory.
- Suggest memory updates automatically after delivery pack generation.
- Let playbooks pull only relevant memory for the current project and task type.
- Add stale-memory review when evidence contradicts previous memory.

Acceptance:

- Team playbooks become visibly more specific after repeated use in the same project.
- Extracted memories cite the session or delivery pack they came from.
- Users can review and reject noisy memories.

Suggested first tasks:

1. Extend project knowledge extraction output with category and source.
2. Add "suggested memories" to the delivery pack flow.
3. Add memory relevance filtering to team playbook prompt generation.

## Phase D: Multi-Agent Delivery Governance

Goal: Make parallel agent work safe enough for serious codebases.

Scope:

- Add explicit ownership lanes for agent work.
- Detect overlapping files, shared directories, and conflicting commands earlier.
- Add merge-readiness gates for agent outputs.
- Generate a final supervisor handoff that includes ownership, validation, unresolved blockers, and merge order.
- Add agent outcome metrics: completed, blocked, reverted, validated, merged.

Acceptance:

- A supervisor can see which agent owns which work.
- Conflicts are visible before final merge.
- Final delivery pack includes per-agent accountability.

Suggested first tasks:

1. Promote current agent coordination risks into a compact ownership matrix.
2. Add a "merge readiness" supervisor prompt.
3. Add per-agent validation evidence to delivery pack exports.

## Phase E: Team And Organization Trust

Goal: Make PrismOps credible for teams, leads, and regulated environments.

Scope:

- Add organization-level permission policy profiles.
- Add audit export with session timeline, file changes, commands, provider, model, and validation status.
- Add project/team dashboards with trends over time.
- Support report signing or immutable report hashes for delivery packs.
- Add redaction controls for sensitive command output or file paths.

Acceptance:

- A team lead can audit AI work without reading the whole chat.
- A delivery report can be shared in a PR or review ticket.
- Sensitive details can be redacted before export.

Suggested first tasks:

1. Add report metadata and schema version to delivery pack exports.
2. Add team-level trend view for delivery-pack rate and validation coverage.
3. Add redaction options for report export.

## Phase F: UX Compression And Speed

Goal: Keep the interface powerful without becoming heavy.

Scope:

- Continue reducing cockpit vertical height.
- Make high-signal information visible by default, details expandable.
- Add keyboard shortcuts for common delivery actions.
- Improve mobile and narrow-width layout for cockpit and dashboard cards.
- Add visual QA coverage for the cockpit, dashboard, and action queue.

Acceptance:

- The cockpit does not dominate the message stream by default.
- A user can complete delivery review without scrolling through every detail.
- Dashboard and conversation surfaces remain readable at narrow widths.

Suggested first tasks:

1. Add screenshot checks for collapsed and expanded cockpit states.
2. Add a compact mode toggle for the organization trust layer.
3. Add keyboard actions for run checks, generate delivery pack, and insert playbook.

## 30/60/90 Day Execution Plan

### First 30 Days

Focus: reliability and test coverage.

- Add unit tests for metric summary and action queue ranking.
- Add action lifecycle tracking.
- Add stale validation detection.
- Add basic evidence timeline model.
- Add visual QA screenshots for cockpit and dashboard.

Exit criteria:

- Current shipped slice is covered by targeted tests.
- Dashboard action queue is stable and explainable.
- Delivery gates can detect changed files after validation.

### Days 31-60

Focus: evidence and memory flywheel.

- Add session evidence timeline UI.
- Add timeline excerpts to delivery pack and trust report exports.
- Add categorized project memory extraction.
- Add memory suggestions to delivery pack flow.
- Add relevant memory selection for team playbooks.

Exit criteria:

- Delivery pack exports tell a coherent story of what happened.
- Project memory visibly improves repeated sessions in the same repo.

### Days 61-90

Focus: team adoption and trust.

- Add team/project trend dashboard.
- Add provider/model governance summaries over time.
- Add redaction options for reports.
- Add per-agent delivery accountability.
- Add report metadata and schema versioning.

Exit criteria:

- A team lead can review AI delivery quality across sessions.
- Reports can be shared externally with controlled detail.

## Implementation Priority Matrix

High impact, low risk:

- Tests for metrics/action queue logic.
- Stale validation detection.
- Delivery pack schema metadata.
- Dashboard empty/stale states.

High impact, medium risk:

- Evidence timeline.
- Project memory categorization.
- Per-agent delivery accountability.

High impact, higher risk:

- Server/project-level metric persistence.
- Team trend dashboard.
- Report redaction and signing.

Defer:

- Complex enterprise admin UI before the core trust workflow is proven.
- New standalone panels that duplicate cockpit behavior.
- Model-specific workflows that break provider neutrality.

## Risks And Mitigations

- Risk: The cockpit becomes too tall.
  Mitigation: Keep default collapsed, use compact rows, move trend analysis to dashboard.

- Risk: Metrics become noisy or misleading.
  Mitigation: Store evidence source, schema version, and action lifecycle. Add tests for ranking.

- Risk: Project memory accumulates low-quality notes.
  Mitigation: Add category, source, confidence, and review before promotion.

- Risk: Delivery reports expose sensitive details.
  Mitigation: Add export redaction and report metadata.

- Risk: Multi-agent governance feels heavy for solo users.
  Mitigation: Show advanced agent controls only when child agents exist.

## Next Recommended Sprint

Sprint name: Reliability And Evidence Sprint.

Duration: 1-2 weeks.

Deliverables:

- Unit tests for metric summaries, action ranking, and remediation prompt generation.
- Stale validation gate when files change after the latest validation command.
- Evidence timeline model with initial UI inside the expanded cockpit.
- Delivery pack export metadata with schema version and generated source.
- Dashboard empty/stale states.

Definition of done:

- `npm run typecheck` passes.
- `npm run build` passes.
- Relevant metric and action queue tests pass.
- The user can open Dashboard, identify the highest-priority gap, jump to the session, insert a remediation prompt, and generate a delivery pack after closing the gap.

## Implementation Progress

### Reliability And Evidence Sprint

Status: in progress.

Completed:

- Added unit coverage for delivery metric summaries, action queue ranking, remediation prompt generation, and pending action consumption.
- Added stale validation detection when file changes happen after the latest validation command.
- Surfaced stale validation in risks, next actions, delivery readiness, delivery gates, success metrics, and dashboard metric records.
- Marked delivery packs as stale when newer file changes happen after the pack was generated.

Remaining:

- Add an evidence timeline model and initial cockpit UI.
- Add delivery pack metadata with schema version and source.
- Add Dashboard empty and stale-state copy.
