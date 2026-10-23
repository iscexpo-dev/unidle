# Advanced status and evidence

`unidle-status.mjs` is an additive reporting surface. It does not execute checks or rewrite existing Markdown ledgers.

```bash
node scripts/unidle-status.mjs --format json
node scripts/unidle-status.mjs --history --scope api
node scripts/unidle-status.mjs --trend --format json
```

Optional gate metadata is read from indented ledger lines:

```markdown
- [ ] G1: API contract is compatible
  OWNER: platform
  SEVERITY: high
  TAGS: api, regression
  FRESHNESS: 24h
  DEADLINE: 2026-12-31
  RISK: high
  CATEGORY: regression
  OWNER_TEAM: backend
  REVIEWER: alice
  REVIEW_WINDOW: 1h
  DEPENDS_ON: other-ledger:GATE-ID
  REQUIRES: other-ledger:GATE-ID
  EVIDENCE: pending
```

`FRESHNESS` supports `m`, `min`, `h`, `hr`, `d`, `day`, `days`, and simple ISO durations such as `PT24H`. A met gate with missing or expired timestamped evidence is reported as `stale`.

**Richer gate schema**: The `--format json` output includes `risk`, `category`, `deadline`, `ownerTeam`, `reviewer`, `dependsOn`, `requires`, `reviewWindow`, and `expectation` fields per gate, plus `explanations` that describe why each blocked gate is blocked.

**Dependency graph summaries**: JSON output includes `dependencyGraph` with `nodes`, `edges`, and `summary` showing which gates depend on which other gates. Edges connect `ledger:gateId` identifiers.

**Better blocked-gate explanations**: Every non-met gate includes an `explanation` string with the specific reasons it is blocked (missing evidence, freshness expiry, dependency unmet, deadline passed, review window expired, etc.).

**Snapshot history trend reporting**: Use `--trend` to compare the latest `.unidle/history/` snapshots against the previous one. The JSON output includes a `trend` object with a `summary` showing counts of improved, regressed, and stable gates across snapshots.

JSON snapshots are written to `.unidle/history/` when `--history` is supplied; add that directory to `.gitignore` when history is local-only.
