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

Status: started.

### Phase 2: Delivery Readiness Gates

Goal: Make delivery quality visible before the user asks.

Scope:

- Show missing gates: no validation, failed command, changed files without summary, unresolved permission, stale risk.
- Add one-click actions for "run checks", "summarize changes", and "create repair task".
- Persist delivery snapshots into working context.

Status: in progress. The task cockpit now evaluates five visible gates: mission scope, traceable changes, validation evidence, failure clearance, and delivery handoff. The validation gate can run QA/SHIP checks directly, failed QA/SHIP runs create a repair task automatically, and the handoff gate can generate a delivery summary into the message composer.

### Phase 3: Agent Work Board

Goal: Make multi-agent work legible and controllable.

Scope:

- Show agent roles, ownership, current task, files touched, last command, and risk.
- Add supervisor prompts for rebalance, unblock, validate, and merge summary.
- Highlight conflicts or duplicate ownership before agents overlap.

### Phase 4: Team Templates

Goal: Turn repeated engineering work into reusable playbooks.

Scope:

- Templates for bug fix, feature delivery, UI polish, code review, migration, release check.
- Each template defines expected evidence, validation, and final output.
- Support project-specific defaults from memory.

### Phase 5: Organization Trust Layer

Goal: Make PrismOps credible for teams.

Scope:

- Audit timeline per session
- Permission policy presets
- Shared project knowledge
- Exportable delivery reports
- Provider and model governance

## Success Metrics

- Percentage of sessions with a delivery pack
- Percentage of code-changing sessions with validation evidence
- Time from task start to verified handoff
- Number of reusable project memories created
- Reduction in "what changed?" and "is this safe?" follow-up questions

## Near-Term Implementation Notes

- Prefer prompt-level workflows first; they are faster and provider-neutral.
- Promote existing QA/SHIP and Debug Loop rather than creating parallel concepts.
- Make the cockpit the primary interface for delivery quality.
- Avoid adding new panels until the core workflow is visibly useful inside the conversation.
