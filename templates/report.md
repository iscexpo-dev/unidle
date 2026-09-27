# Truthful Report Template

A final report is truthful when every sentence it makes can be traced back to evidence that actually exists. This template defines the structure.

## Report Header

```markdown
# Final Report: <task name>

- **Scope**: <pipeline or ledger scope>
- **Generated**: <ISO timestamp from `unidle-status --format json`>
- **Schema version**: 2
```

## Evidence Summary (must match gate-state output)

Every number must come from `unidle-status.mjs --format json`, not from memory or a shortened list.

```markdown
## Evidence Summary

- **Met**: <count from unidle-status>
- **Unmet**: <count from unidle-status>
- **Abandoned**: <count from unidle-status>
- **Stale**: <count from unidle-status>
- **Total gates**: <count from unidle-status>
```

## Remaining Work (complete, not shortened)

List every unmet gate using its qualified id (`ledger:gateId`). Do not omit gates because they are blocked or because the list is long.

```markdown
## Remaining Work

### Blocked gates (state: unmet or unmet-no-evidence)

- `ledger:gateId` — <gate title>
  - **Why**: <explanation from unidle-status explanations>
  - **Next action**: <nextAction from unidle-status>

### Stale gates (evidence expired)

- `ledger:gateId` — <gate title>
  - **Why**: freshness expired (max <freshness>)
  - **Next action**: re-run the approved CHECK to refresh EVIDENCE
```

## Abandonments (all surfaced, none hidden)

```markdown
## Abandonments

- `ledger:gateId` — <reason from ABANDON: line>
```

## Dependency Graph

Include the dependency graph summary from `unidle-status --format json`. Do not omit edges.

```markdown
## Dependency Graph

- <N> gates, <M> connected, <K> isolated
- Edges:
  - `ledger:gateId` -> `ledger:gateId`
```

## Quoted Evidence

Only quote output that actually appears in `EVIDENCE:` lines. Never quote output from a CHECK that was never run or that produced different output.

```markdown
## Quoted Evidence

### `ledger:gateId`

- **EVIDENCE**: <exact text from the ledger>
- **Source**: <file path>
```

## Truthfulness Declarations

Every report must include these declarations, verified against the ledger:

- [ ] **No shortened list**: Every gate from the ledger appears in the report. The remaining-work list is complete.
- [ ] **No quoted output that never ran**: Every quoted string traces to an EVIDENCE line in a ledger.
- [ ] **No hypothesis stated as fact**: Every claim about completion is backed by a met gate's evidence. Inferred or uncertain items are marked "inferred" or "uncertain".
- [ ] **No hidden narrowing**: Blocked or abandoned gates are reported explicitly, not silently omitted.
- [ ] **Counts verified**: Met, unmet, abandoned, and stale counts match `unidle-status --format json` output exactly.
- [ ] **Abandonments surfaced**: Every ABANDON: line is reported with its reason.
```

</{filePath}
<parameter name="filePath">/workspaces/unidle/templates/report.md</parameter>