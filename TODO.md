# Unidle — Development TODO

> **Project:** Unidle  
> **Repository:** https://github.com/iscexpo-dev/unidle  
> **Current baseline:** v2.2.0  
> **Target:** Unidle 3.0  
> **Vision:** Make AI agents go deeper, work deliberately, and prove completion.

---

## Project Principles

- [ ] Meaningful recursive task decomposition.
- [ ] Explicit execution and resource budgets.
- [ ] Evidence-backed acceptance criteria.
- [ ] Independent verification of completed work.
- [ ] Safe and predictable command execution.
- [ ] Truthful completion reporting.
- [ ] Reproducible evaluation rather than unsupported productivity claims.

## P0 — Security & Execution Hardening

### Wizard safety

- [ ] Make command preview execution opt-in.
- [ ] Add an explicit preview-execution option.
- [ ] Display command, CWD, shell, timeout, and environment before execution.
- [ ] Ensure non-interactive authoring does not unexpectedly execute commands.
- [ ] Add regression tests for preview and approval behavior.
- [ ] Document the difference between preview and approved execution.

### Dashboard security

- [ ] Preserve loopback-only default binding.
- [ ] Add strict Host and Origin validation.
- [ ] Protect against cross-origin access and DNS rebinding.
- [ ] Add an explicit opt-in for non-loopback exposure.
- [ ] Evaluate token-based dashboard authentication.
- [ ] Minimize sensitive paths and evidence in dashboard responses.
- [ ] Add security tests for hostile origins and unexpected hosts.

### Execution security

- [ ] Audit shell resolution and inherited environment handling.
- [ ] Review approval invalidation when commands or environments change.
- [ ] Preserve fail-closed approval behavior.
- [ ] Improve visibility into scripts and executables invoked by CHECK commands.
- [ ] Test concurrent approval and lock operations.
- [ ] Test interrupted execution and lock recovery.
- [ ] Review evidence output for accidental secret exposure.

## P1 — Product Foundation & Distribution

### Product identity

- [ ] Align GitHub repository description.
- [ ] Align README and package descriptions.
- [ ] Clarify Unidle's identity as an AI-agent skill and verification toolkit.
- [ ] Document the distinction between agent orchestration and CLI enforcement.
- [ ] Add a concise feature overview and architecture diagram.

### Runtime compatibility

- [ ] Define a supported Node.js runtime policy.
- [ ] Replace outdated Node.js CI matrix entries.
- [ ] Test supported Node.js releases on Ubuntu, Windows, and macOS.
- [ ] Verify filesystem, shell, path, and process portability.
- [ ] Document supported operating systems and runtime requirements.

### Installation and distribution

- [ ] Decide skill-first versus CLI-first distribution.
- [ ] Define supported installation methods.
- [ ] Document installation and upgrade workflows.
- [ ] Add clean-environment installation tests.
- [ ] Validate package contents before release.
- [ ] Add release automation.
- [ ] Add version and changelog consistency checks.
- [ ] Define npm publishing requirements if public npm distribution is selected.

## P1 — Depth Tree Specification

### Core model

- [ ] Define a versioned Depth Tree specification.
- [ ] Define task, branch, leaf, and integration node contracts.
- [ ] Formalize node identity and parent-child relationships.
- [ ] Define dependency and readiness semantics.
- [ ] Define leaf ownership and acceptance contracts.
- [ ] Define branch and root completion requirements.
- [ ] Document decomposition and stopping rules.

### Effort and budget model

- [ ] Define global task budget semantics.
- [ ] Define per-leaf budget semantics.
- [ ] Formalize full-budget-per-leaf execution as an explicit policy.
- [ ] Add maximum depth configuration.
- [ ] Add maximum branching factor.
- [ ] Add maximum leaf count.
- [ ] Add global execution and cost limits.
- [ ] Add concurrency limits.
- [ ] Define timeout and cancellation behavior.
- [ ] Add early stopping and diminishing-return detection.
- [ ] Distinguish theoretical effort allocation from measured model usage.

### Depth Tree validation

- [ ] Add a Depth Tree schema.
- [ ] Add structural validation.
- [ ] Detect empty and meaningless branches.
- [ ] Detect duplicate node IDs.
- [ ] Detect circular dependencies.
- [ ] Validate ownership conflicts.
- [ ] Validate global and per-leaf resource limits.
- [ ] Add tree validation fixtures and regression tests.

## P1 — Verification Engine

### Oracle execution

- [ ] Review the existing distinct-oracle optimization proposal.
- [ ] Define a stable oracle identity.
- [ ] Preserve individual gate approval requirements.
- [ ] Deduplicate execution only when semantically safe.
- [ ] Exclude side-effecting commands from automatic deduplication.
- [ ] Match EXPECT independently for each gate.
- [ ] Preserve individual evidence records.
- [ ] Introduce shared execution identifiers.
- [ ] Test commands with different CWD, shell, PATH, timeout, and expectations.
- [ ] Test behavior across multiple ledgers.
- [ ] Benchmark execution overhead before and after optimization.

### Evidence quality

- [ ] Formalize the evidence record schema.
- [ ] Improve evidence provenance.
- [ ] Track the source commit where appropriate.
- [ ] Improve stale-evidence explanations.
- [ ] Add evidence history comparisons.
- [ ] Improve failure classification.
- [ ] Strengthen parent-level independent re-verification.
- [ ] Preserve truthful reporting when checks fail or are abandoned.

### Dependency management

- [ ] Improve dependency graph explanations.
- [ ] Improve blocked-gate diagnostics.
- [ ] Test circular dependency detection.
- [ ] Test nested scope dependencies.
- [ ] Test dependency recovery after failures.
- [ ] Improve readiness and rolling-dispatch reporting.

## P2 — Agent Integrations

### Codex

- [ ] Improve Codex skill installation.
- [ ] Improve invocation instructions.
- [ ] Document task and leaf handoff formats.
- [ ] Add practical end-to-end examples.
- [ ] Test skill behavior in a clean Codex environment.

### Claude Code

- [ ] Improve Stop hook installation and documentation.
- [ ] Test hook behavior across session types.
- [ ] Improve session-to-scope binding.
- [ ] Document hook limitations.
- [ ] Add clean installation and uninstall tests.

### Integration contract

- [ ] Define provider-neutral agent integration interfaces.
- [ ] Standardize task, branch, and leaf instructions.
- [ ] Standardize status and handoff formats.
- [ ] Define agent capability and budget declarations.
- [ ] Document integration-specific limitations.
- [ ] Add integration compatibility tests.

## P2 — Research & Benchmarking

### Evaluation framework

- [ ] Implement the reproducible validation protocol.
- [ ] Create a benchmark task collection.
- [ ] Define baseline execution conditions.
- [ ] Define Depth Tree execution conditions.
- [ ] Pin models, harnesses, permissions, and environments.
- [ ] Archive prompts, transcripts, outputs, and logs.
- [ ] Add machine-readable benchmark results.
- [ ] Add reproducible calculation scripts.

### Evaluation metrics

- [ ] Acceptance criteria completion rate.
- [ ] Defects discovered and fixed.
- [ ] Remaining defects after delivery.
- [ ] Integration and regression failures.
- [ ] False completion claims.
- [ ] Model token consumption.
- [ ] Execution time.
- [ ] Tool invocation count.
- [ ] Cost per successful task.
- [ ] Resource usage per leaf.

### Research publication

- [ ] Compare baseline and Unidle-assisted execution.
- [ ] Perform repeated independent runs.
- [ ] Include unsuccessful and inconclusive results.
- [ ] Report uncertainty and limitations.
- [ ] Publish raw results and methodology.
- [ ] Avoid unsupported claims about exponential productivity improvements.

## P3 — Visualization & Developer Experience

### Depth Tree explorer

- [ ] Interactive tree visualization.
- [ ] Expand and collapse branches.
- [ ] Display depth and branching information.
- [ ] Display leaf execution states.
- [ ] Display dependencies and blocked nodes.
- [ ] Display budget allocation.
- [ ] Display execution progress.

### Evidence explorer

- [ ] Inspect individual gate evidence.
- [ ] Compare previous and current evidence.
- [ ] Display verification timestamps.
- [ ] Highlight stale evidence.
- [ ] Display failure explanations.
- [ ] Export evidence reports.

### Dashboard improvements

- [ ] Improve multi-pipeline navigation.
- [ ] Add branch and leaf filtering.
- [ ] Add execution timelines.
- [ ] Add dependency graph visualization.
- [ ] Add historical comparisons.
- [ ] Add JSON and Markdown exports.
- [ ] Improve accessibility and responsive layout.

## P3 — Engineering Quality

### Architecture

- [ ] Document architecture and module boundaries.
- [ ] Separate approval, runner, evidence, and orchestration responsibilities where beneficial.
- [ ] Define shared data contracts.
- [ ] Add versioned schemas.
- [ ] Preserve the shared gate parser as the source of truth.
- [ ] Maintain atomic writes and file-lock guarantees.
- [ ] Avoid unnecessary runtime dependencies.

### Testing

- [ ] Expand unit tests.
- [ ] Expand integration tests.
- [ ] Expand security tests.
- [ ] Expand concurrency tests.
- [ ] Expand cross-platform tests.
- [ ] Add real-world end-to-end fixtures.
- [ ] Add failure injection tests.
- [ ] Test clean installation and upgrade scenarios.

### Documentation

- [ ] Keep README informative and visualization-focused.
- [ ] Add architecture documentation.
- [ ] Add Depth Tree specification.
- [ ] Add configuration reference.
- [ ] Improve CLI documentation.
- [ ] Improve security documentation.
- [ ] Add installation guides.
- [ ] Add practical examples.
- [ ] Maintain versioned changelog entries.

---

## Release Roadmap

| Milestone | Focus | Status |
|---|---|---|
| v2.2.x | Existing verification and orchestration foundation | Current baseline |
| v2.3.0 | Security and execution hardening | Planned |
| v2.4.0 | Runtime and distribution improvements | Planned |
| v2.5.0 | Formal Depth Tree specification | Planned |
| v2.6.0 | Verification and evidence improvements | Planned |
| v2.7.0 | Agent integration improvements | Planned |
| v2.8.0 | Research and benchmark framework | Planned |
| v3.0.0 | Unified Unidle architecture | Long-term |

## Definition of Done

A feature is complete only when:

- [ ] Its requirements and behavior are documented.
- [ ] Its acceptance criteria are explicit.
- [ ] Implementation passes relevant tests.
- [ ] Security implications have been reviewed.
- [ ] Supported platforms have been considered.
- [ ] Evidence is current and independently verifiable.
- [ ] Integration and regression checks pass.
- [ ] Documentation and changelog are updated.
- [ ] Remaining limitations are disclosed.

## Non-Goals

Unidle should not:

- Encourage unlimited recursive execution.
- Automatically execute arbitrary commands without explicit authorization.
- Treat more tokens as proof of better reasoning.
- Create artificial branches to satisfy a requested depth.
- Treat ownership leases as security isolation.
- Treat successful leaf execution as proof of complete integration.
- Claim measured productivity improvements without reproducible benchmarks.

---

**Unidle — Don't just finish. Prove it.**
