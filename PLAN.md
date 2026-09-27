# Perf Plan: Execute One Command Per Distinct Oracle

## Problem

`gate-check.mjs` currently executes one `CHECK` command per gate. If gates `G1` and `G2` both declare `CHECK: node scripts/build.mjs`, the command runs twice. This wastes wall-clock time, shell overhead, and I/O when multiple gates share the same oracle.

The `--jobs` axis is unchanged: the same worker pool and concurrency limit apply. This plan changes only *how many times* each distinct command is dispatched.

## Scope of Change

- Changes only the execution count: how many times `spawn(task.gate.check, ...)` is called.
- `--jobs` concurrency, the approval system, evidence recording, and ledger writes are preserved.
- Every gate still gets its own `EVIDENCE:` line written to the ledger.
- Every gate still gets its own approval record keyed to `(file, gate.id, signature)`.

## Key Definition

A **distinct oracle** is defined by the tuple of oracle fields that uniquely determine the `spawn()` call and the process environment:

```
oracleKey = sha256(JSON.stringify({ check, cwd, shell, timeoutMs, path }))
```

This excludes `expect`, `maxOutputBytes`, `regexTimeoutMs`, `platform`, and `version` because they do not change the spawned process. Two gates with the same `CHECK`, `CWD`, `shell`, `timeout`, and `PATH` share one oracle and execute exactly once.

Why `expect` is excluded: the output of one command can be matched against multiple `EXPECT` patterns, so the command itself is the same even if the expected result differs.

## Execution Flow (Current vs Proposed)

### Current

```
for each gate in pending:
    if not approvalExists(file, gate): request approval
    runnable.push({ file, gate, cwd, signature })

results = runRolling(runnable, jobs)
for each result in results:
    writeEvidence(result)
    updateLedger(result)
```

**N gates → N spawn calls.**

### Proposed

```
Phase 1: Group by oracle
  for each gate in pending:
    key = oracleKey(file, gate)
    oracleGroups[key].push(gate)

Phase 2: Deduplicate approvals
  for each key in oracleGroups:
    representative = oracleGroups[key][0]
    if not approvalExists(file, representative): request approval
    for each gate in oracleGroups[key]:
      recordApproval(file, gate)  // lightweight, no re-approval needed

Phase 3: Execute one per oracle
  runnable = []
  for each key in oracleGroups:
    representative = oracleGroups[key][0]
    runnable.push({ file, gate: representative, cwd, signature, oracleKey: key })
  results = runRolling(runnable, jobs)

Phase 4: Distribute results
  for each result in results:
    for each gate in oracleGroups[result.oracleKey]:
      writeEvidence(file, gate, result.output)  // each gate gets its own EVIDENCE
      updateLedger(file, gate, result)
```

**N gates sharing M distinct oracles → M spawn calls (M ≤ N).**

## Detailed Changes

### 1. `scripts/lib/runner.mjs` — Add `oracleKey` helper

Add a new exported function that computes the oracle key from a gate and file context. This function is pure and does not depend on gate state.

```javascript
export function createOracleKey({ check, cwd, shell, timeoutMs, pathValue }) {
  return sha256(JSON.stringify({ check, cwd, shell, timeoutMs, path: pathValue }));
}
```

Import `sha256` from `gates.mjs` (already a dependency of `runner.mjs`'s consumers).

### 2. `scripts/gate-check.mjs` — Phase 1: Oracle grouping

Replace the flat `pending` array construction with a grouping step:

**Current** (lines 485-500):
```javascript
const pending = [];
for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    if (ledger.doc.abandoned.has(gate.id) || !gate.check) continue;
    const state = gateState(gate, ledger.doc.abandoned);
    if (opt.status || (!opt.reverify && state === "met")) continue;
    const cwd = resolvedGateCwd(gate, ledger.file);
    pending.push({ file: ledger.file, gate, cwd, wasMet: state === "met", signature: signature(ledger.file, gate) });
  }
}
```

**Proposed**:
```javascript
const pending = [];
for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    if (ledger.doc.abandoned.has(gate.id) || !gate.check) continue;
    const state = gateState(gate, ledger.doc.abandoned);
    if (opt.status || (!opt.reverify && state === "met")) continue;
    const cwd = resolvedGateCwd(gate, ledger.file);
    pending.push({ file: ledger.file, gate, cwd, wasMet: state === "met", signature: signature(ledger.file, gate) });
  }
}

// NEW: Group by distinct oracle
const oracleGroups = new Map();
for (const task of pending) {
  const key = createOracleKey(oracle(task.file, task.gate));
  if (!oracleGroups.has(key)) oracleGroups.set(key, []);
  oracleGroups.get(key).push(task);
}
```

### 3. `scripts/gate-check.mjs` — Phase 2: Deduplicated approvals

Approval is per-gate (required by the security model), but the *approval check* can be deduplicated: if the representative gate's oracle is approved, all gates in the same oracle group are also approved.

**Current** (lines 502-524):
```javascript
const runnable = [];
const notRun = [];
for (const task of pending) {
  if (!approvalExists(task.file, task.gate)) {
    printOracle(task.file, task.gate, "APPROVAL REQUIRED");
    if (!opt.approve) { notRun.push(task); continue; }
    await recordApproval(task.file, task.gate);
  }
  runnable.push(task);
}
```

**Proposed**:
```javascript
const runnable = [];
const notRun = [];
const approvedKeys = new Set();
for (const [key, group] of oracleGroups) {
  const representative = group[0];
  if (!approvalExists(representative.file, representative.gate)) {
    printOracle(representative.file, representative.gate, "APPROVAL REQUIRED");
    if (!opt.approve) {
      for (const task of group) notRun.push(task);
      continue;
    }
    await recordApproval(representative.file, representative.gate);
    approvedKeys.add(key);
  } else {
    approvedKeys.add(key);
  }
  // All gates in the group are approved (either previously or just now)
  for (const task of group) runnable.push(task);
}
```

Note: `printOracle` and `recordApproval` are called once per oracle group, not per gate. The approval file still records the individual gate's identity for audit purposes — `recordApproval` remains per-gate but `approvalExists` is checked on the representative.

Wait — `recordApproval` writes per-gate approval files. So even with deduplication, each gate gets its own approval file. The optimization is in the `approvalExists` check: we check the representative and skip the check for all others in the group. This means:

```javascript
for (const task of group) {
  if (!approvedKeys.has(key) && !approvalExists(task.file, task.gate)) {
    // This gate doesn't have approval even though the group does
    printOracle(task.file, task.gate, "APPROVAL REQUIRED");
    if (!opt.approve) { notRun.push(task); continue; }
    await recordApproval(task.file, task.gate);
  }
  runnable.push(task);
}
```

Actually, the simplest approach: if the representative is approved, all gates in the group share the same oracle and are implicitly approved. We record approval for each gate but skip the `approvalExists` check for non-representatives in an approved group.

### 4. `scripts/gate-check.mjs` — Phase 3: Execute one per oracle

**Current** (lines 526-529):
```javascript
for (const task of runnable) {
  console.log("  RUN  " + qualify(task.file, task.gate.id) + " ...");
}
const results = opt.status ? [] : await runRolling(runnable, jobs);
```

**Proposed**:
```javascript
const oracleRunnable = [];
for (const [key, group] of oracleGroups) {
  const representative = group[0];
  if (runnable.includes(representative)) {
    oracleRunnable.push({ ...representative, oracleKey: key, group });
  }
}
for (const task of oracleRunnable) {
  console.log("  RUN  " + qualify(task.file, task.gate.id) + " (oracle, " + task.group.length + " gates)" + " shell=...");
}
const rawResults = opt.status ? [] : await runRolling(oracleRunnable, jobs);
```

### 5. `scripts/gate-check.mjs` — Phase 4: Distribute results

**Current** (lines 530-538):
```javascript
for (const result of results) {
  const outputSummary = result.ok ? tail(result.output) : failureOutput(result.output);
  const outcome = "exit=" + ...;
  if (result.ok) console.log("  PASS " + qualify(result.file, result.gate.id) + ": " + ...);
  else console.log("  FAIL " + qualify(result.file, result.gate.id) + ": " + ...);
}
```

**Proposed**:
```javascript
const results = [];
for (const rawResult of rawResults) {
  const group = rawResult.group;
  for (const task of group) {
    // Each gate gets its own result with the same output but its own EXPECT match
    const gateResult = { ...rawResult, gate: task.gate, file: task.file, cwd: task.cwd };
    const matched = matchExpectation(task.gate.expectation, rawResult.output);
    gateResult.matched = matched;
    gateResult.ok = !gateResult.error && gateResult.exitCode === 0 && matched;
    results.push(gateResult);
  }
}
// Now results has one entry per gate (same as before)
for (const result of results) {
  // identical display logic
}
```

### 6. `scripts/gate-check.mjs` — Evidence and ledger updates (unchanged)

The evidence recording and ledger update loop (lines 566-593) remains unchanged because `results` still has one entry per gate. Each gate gets its own `EVIDENCE:` line with the same output but its own gate identity.

## Approval System

- `approvalPath(file, gate)` remains per-gate (unchanged)
- `recordApproval(file, gate)` remains per-gate (each gate gets its own approval file for audit)
- `approvalExists(file, gate)` is checked on the representative gate of the oracle group; non-representatives in the same group skip the check if the representative is approved
- The approval file content (`schema`, `file`, `gate`, `signature`, `oracle`, `approvedAt`) remains per-gate

## Matching

Each gate in an oracle group has its own `expectation`. The `safeRegexMatch` call from `runner.mjs` must be invoked per-gate against the shared output. This happens in Phase 4 (distribution). The `createRunner` function's `runCheck` should return output once per oracle, and the matching happens during distribution.

To minimize changes to `runner.mjs`, the simplest approach is:
1. `runCheck` returns the raw spawn result (exitCode, output) without matching
2. Matching happens in Phase 4 in `gate-check.mjs`
3. Each gate's `expectation` is matched against the shared output

Alternatively, `runCheck` can be modified to accept a list of expectations and return the matched result for each.

## Example

Given a ledger with 10 gates where 7 share `CHECK: node build.mjs` and 3 have distinct checks:

- **Before**: 10 spawn calls, 10 approval checks
- **After**: 3 spawn calls, 3 approval checks (one per distinct oracle), 10 evidence writes, 10 ledger updates
- **Wall-clock reduction**: ~70% fewer spawn calls, `--jobs` concurrency unchanged

## Verification

- `--status` mode: unchanged behavior, no commands executed
- `--reverify`: re-runs every runnable gate, deduplication applies to the re-verification pass
- `--approve`: approves each exact pending oracle, deduplication applies to approval recording
- `--jobs N`: unchanged; the worker pool still limits concurrent spawn calls
- Cross-scope `NEEDS-SCOPE`: unchanged; dependency verification happens before oracle grouping
- `approvalInfrastructureFailures`: unchanged; each gate's approval failure is counted individually

## Files to Modify

1. **`scripts/gate-check.mjs`** — Oracle grouping, deduplicated approvals, single execution, result distribution
2. **`scripts/lib/runner.mjs`** — Optionally extract `createOracleKey` helper; `runCheck` may need to return raw output without matching (or matching moves to distribution phase)
3. **`scripts/lib/gates.mjs`** — Export `sha256` is already exported; may need `createOracleKey` helper if not in runner
4. **`tests/run-tests.mjs`** — Verify deduplication behavior with fixtures having shared oracles
5. **`tests/hardening-tests.mjs`** — Verify approval system still works with deduplication
6. **`tests/stress-tests.mjs`** — Verify `--jobs` concurrency is preserved

## Risk Assessment

- **Low risk**: Evidence recording and ledger writes are per-gate, unchanged
- **Low risk**: `--jobs` concurrency is preserved; the worker pool limits `oracleRunnable.length`, not `pending.length`
- **Medium risk**: Approval deduplication changes the approval flow; must ensure `approvalExists` + `recordApproval` still provides the same security guarantees
- **Medium risk**: Result distribution changes how `matched` is computed; each gate's expectation must be independently verified against shared output
- **Mitigation**: The existing test suite (`run-tests`, `hardening-tests`, `stress-tests`) provides coverage; add a fixture with shared oracles to verify deduplication

## Success Criteria

1. Gates sharing the same distinct oracle execute exactly once (`--jobs` constant)
2. Each gate still gets its own `EVIDENCE:` line in the ledger
3. Each gate still gets its own approval record
4. `--jobs` concurrency behavior is identical
5. All existing tests pass without modification
6. A new test verifies that 2+ gates with the same oracle produce exactly 1 spawn call
