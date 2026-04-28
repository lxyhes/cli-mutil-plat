# PrismOps Core Competitiveness Plan

## Product Positioning

PrismOps should compete as a delivery-oriented multi-agent engineering workspace, not as another AI chat box.

The core promise:

> Turn AI coding work into traceable, verifiable, shippable engineering delivery.

## Strategic Pillars

### 1. Delivery Loop

Every serious session should move through a visible loop:

1. Understand the mission
2. Execute with tools and agents
3. Record changed files and decisions
4. Validate with tests, type checks, builds, or explicit rationale
5. Produce a delivery pack with summary, risk, evidence, and next steps

This is the primary moat because it converts AI output from "generated code" into "reviewable engineering work".

### 2. Multi-Agent Coordination

The product should make parallel AI work understandable:

- Supervisor splits work into concrete subtasks
- Agents own disjoint modules or responsibilities
- Each agent exposes status, files, commands, blockers, and validation
- The final delivery is merged into one accountable narrative

The user should feel like they are directing a small engineering team, not prompting a single assistant.

### 3. Project Memory

Project knowledge should accumulate across sessions:

- Architecture decisions
- Repeated commands
- Known risks
- Debug history
- Delivery conventions
- Team preferences

This lets PrismOps become more useful the longer a team uses it.

### 4. Trust And Control

Enterprise and serious developer adoption depends on control:

- Permission visibility
- File change traceability
- Command logs
- Local-first workflows where possible
- Provider choice
- Clear validation status

The product should make it obvious what the AI did, why it did it, and whether it was verified.

## Roadmap

### Phase 1: Delivery Pack V1

Goal: Make every session end with a useful, evidence-backed handoff.

Scope:

- Enrich the task cockpit delivery action with current mission state, changed files, validation, risks, evidence, and next actions.
- Encourage the agent to either complete missing validation or explicitly explain why it cannot.
- Keep this as a prompt-level workflow first, so it is low risk and works across providers.

Status: completed for the first usable slice. The task cockpit delivery action now produces an evidence-backed delivery pack that includes mission state, changed files, validation evidence, risks, delivery gates, next actions, and suggested commit notes. The delivery pack is exported as Markdown and persisted into working context so the handoff is reviewable after the session.

### Phase 2: Delivery Readiness Gates

Goal: Make delivery quality visible before the user asks.

Scope:

- Show missing gates: no validation, failed command, changed files without summary, unresolved permission, stale risk.
- Add one-click actions for "run checks", "summarize changes", and "create repair task".
- Persist delivery snapshots into working context.

Status: completed for the first usable slice. The task cockpit now evaluates five visible gates: mission scope, traceable changes, validation evidence, failure clearance, and delivery handoff. The validation gate can run QA/SHIP checks directly, failed QA/SHIP runs create a repair task automatically with a one-click jump to the task board, and the handoff gate generates a Markdown delivery pack plus a composer-ready delivery summary. Ship results and delivery-pack snapshots are persisted into working context.

### Phase 3: Agent Work Board

Goal: Make multi-agent work legible and controllable.

Scope:

- Show agent roles, ownership, current task, files touched, last command, and risk.
- Add supervisor prompts for rebalance, unblock, validate, and merge summary.
- Highlight conflicts or duplicate ownership before agents overlap.

Status: completed for the first usable slice. The conversation task cockpit now surfaces a compact collaboration board for child agents, including active/total/blocked counts, recent agent status, touched files, last command, per-agent risk, and coordination risk signals. It also adds Supervisor prompts for dispatch, rebalance, unblock, validate, and merge summary, converting the current mission, delivery gates, changed files, risks, evidence, visible agent state, and possible ownership conflicts into actionable ownership and validation plans.

### Phase 4: Team Templates

Goal: Turn repeated engineering work into reusable playbooks.

Scope:

- Templates for bug fix, feature delivery, UI polish, code review, migration, release check.
- Each template defines expected evidence, validation, and final output.
- Support project-specific defaults from memory.

Status: completed for the first usable slice. The task cockpit now exposes six reusable team playbooks for bug fix, feature delivery, UI polish, code review, migration, and release check. Each playbook reads the current working context before insertion, so project memory and team defaults are carried into the prompt alongside current mission state, changed files, risks, evidence, expected evidence, validation requirements, and final output format.

### Phase 5: Organization Trust Layer

Goal: Make PrismOps credible for teams.

Scope:

- Audit timeline per session
- Permission policy presets
- Shared project knowledge
- Exportable delivery reports
- Provider and model governance

Status: completed for the first usable slice. The task cockpit now includes an Organization Trust Layer with audit signals, persisted permission policy presets, project knowledge readiness, one-click session-to-project knowledge extraction, provider/model governance, delivery report readiness, a prompt action for generating a transferable trust/audit summary, Markdown export for trust delivery reports, and a compact success-metrics strip covering delivery-pack creation, validation coverage, verified handoff time, reusable project memories, and safety state.

## Success Metrics

- Percentage of sessions with a delivery pack
- Percentage of code-changing sessions with validation evidence
- Time from task start to verified handoff
- Number of reusable project memories created
- Reduction in "what changed?" and "is this safe?" follow-up questions

Status: wired into the product dashboard. The conversation cockpit now records session-level delivery metrics locally, and the global dashboard summarizes delivery-pack rate, validation coverage, average verified handoff time, reusable project memories, safety state, and an average competitiveness score across recent sessions. The dashboard also includes an action queue that ranks sessions needing validation, delivery-pack generation, project-memory extraction, or safety cleanup, with one-click navigation back to the session and an auto-inserted remediation prompt.

## Near-Term Implementation Notes

- Prefer prompt-level workflows first; they are faster and provider-neutral.
- Promote existing QA/SHIP and Debug Loop rather than creating parallel concepts.
- Make the cockpit the primary interface for delivery quality.
- Avoid adding new panels until the core workflow is visibly useful inside the conversation.

## Next Enhancement Plan

See [CORE_COMPETITIVENESS_ENHANCEMENT_PLAN.md](./CORE_COMPETITIVENESS_ENHANCEMENT_PLAN.md) for the post-first-slice enhancement plan covering reliability hardening, evidence timelines, project memory flywheel, multi-agent governance, team trust, UX compression, and the recommended next sprint.
