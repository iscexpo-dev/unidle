#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const VERIFY = join(process.cwd(), "scripts", "gate-report-verify.mjs");
const LINT = join(process.cwd(), "scripts", "gate-lint.mjs");

function run(cmd, args, env = {}) {
  return new Promise((done) => {
    execFile(process.execPath, [cmd, ...args], {
      cwd: tmpdir(),
      env: { ...process.env, ...env, UNIDLE_APPROVAL_DIR: join(tmpdir(), "unidle-approvals") },
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => done({ code: error?.code || 0, stdout, stderr }));
  });
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "unidle-truthful-"));
  return {
    path: dir,
    write(name, text) {
      const file = join(dir, name);
      writeFileSync(file, text);
      return file;
    },
    writeReport(report) {
      const file = join(dir, "REPORT.md");
      writeFileSync(file, report);
      return file;
    },
  };
}

const MET_GATE = (id) => "- [x] " + id + ": outcome for " + id + "\n" +
  '  CHECK: node -e "process.exit(0)"\n' +
  "  EXPECT: probe-" + id + "\n" +
  "  EVIDENCE: at=2026-01-01T00:00:00.000Z; exit=0; output=probe-" + id + "\n";

const UNMET_GATE = (id, title) => "- [ ] " + id + ": " + title + "\n" +
  '  CHECK: node -e "process.exit(0)"\n' +
  "  EXPECT: probe-" + id + "\n" +
  "  EVIDENCE: pending\n";

const LEDGER = (stem, metIds, unmetDefs = []) => {
  const body = metIds.map((id) => MET_GATE(id)).join("\n");
  const unmet = unmetDefs.map((d) => UNMET_GATE(d.id, d.title)).join("\n");
  return "# Gates\n\n" + body + (unmet ? "\n" + unmet : "") + "\n";
};

function reportWithIds(stem, metIds, unmetIds) {
  const allIds = [...metIds, ...unmetIds];
  const metCount = metIds.length;
  const unmetCount = unmetIds.length;
  const total = allIds.length;
  const gateLines = allIds.map((id) => `- \`${stem}:${id}\``).join("\n");
  const remainingLines = unmetIds.map((id) => `- \`${stem}:${id}\` — ${id} task\n  - **Why**: manual outcome not recorded\n  - **Next action**: complete the manual outcome and record EVIDENCE`).join("\n");
  const quotedEvidence = metIds.map((id) => `- **EVIDENCE**: at=2026-01-01T00:00:00.000Z; exit=0; output=probe-${id}\n- **Source**: ${stem}.md`).join("\n\n");
  return `# Final Report: test task

## Evidence Summary

- **Met**: ${metCount}
- **Unmet**: ${unmetCount}
- **Abandoned**: 0
- **Stale**: 0
- **Total gates**: ${total}

## Remaining Work

### Blocked gates (state: unmet or unmet-no-evidence)

${remainingLines}

## Abandonments

## Gate Coverage

${gateLines}

## Quoted Evidence

${quotedEvidence}

## Truthfulness Declarations

- [x] **No shortened list**: Every gate from the ledger appears in the report.
- [x] **No quoted output that never ran**: Every quoted string traces to an EVIDENCE line.
- [x] **No hypothesis stated as fact**: Claims are backed by evidence.
- [x] **No hidden narrowing**: All gates are reported.
- [x] **Counts verified**: Counts match unidle-status output.
- [x] **Abandonments surfaced**: All ABANDON lines are reported.
`;
}

async function main() {
  // Test 1: truthful report passes verification
  {
    const box = sandbox();
    const ledger = box.write("GATES.md", LEDGER("GATES", ["g1", "g2"], [{ id: "g3", title: "fix the login flow" }]));
    const report = box.writeReport(reportWithIds("GATES", ["g1", "g2"], ["g3"]));
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", ledger]);
    if (out.code !== 0) throw new Error("truthful report should pass: exit " + out.code + ": " + out.stderr);
    if (!out.stdout.includes("REPORT IS TRUTHFUL")) throw new Error("missing truthful confirmation");
    console.log("truthful report verification passed");
  }

  // Test 2: shortened list is detected
  {
    const box = sandbox();
    const ledger2 = box.write("GATES.md", LEDGER("GATES", ["g1", "g2", "g3"], [{ id: "g4", title: "fix the auth flow" }]));
    const report2 = box.writeReport(reportWithIds("GATES", ["g1", "g2"], ["g4"]));
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", ledger2]);
    if (out.code !== 1) throw new Error("shortened list should fail: exit " + out.code);
    if (!out.stdout.includes("shortened-list")) throw new Error("missing shortened-list finding");
    console.log("shortened list detection passed");
  }

  // Test 3: hidden abandonment is detected
  {
    const box = sandbox();
    const ledger3 = box.write("GATES.md", "# Gates\n\n- [x] g1: done\n  CHECK: node -e \"process.exit(0)\"\n  EXPECT: probe-g1\n  EVIDENCE: at=2026-01-01T00:00:00.000Z; exit=0\n\n- [ ] g2: blocked\n  EVIDENCE: pending\n\nABANDON: g2 blocked upstream\n");
    const report3 = box.writeReport(`# Final Report: test

## Evidence Summary

- **Met**: 1
- **Unmet**: 1
- **Abandoned**: 0
- **Stale**: 0
- **Total gates**: 2

## Gate Coverage

- \`GATES:g1\`

## Remaining Work

## Abandonments

## Truthfulness Declarations

- [x] **No shortened list**: Every gate from the ledger appears in the report.
- [x] **No quoted output that never ran**.
- [x] **No hypothesis stated as fact**.
- [x] **No hidden narrowing**.
- [x] **Counts verified**.
- [x] **Abandonments surfaced**.
`);
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", join(box.path, "GATES.md")]);
    if (out.code !== 1) throw new Error("hidden abandonment should fail: exit " + out.code);
    if (!out.stdout.includes("hidden-abandonment")) throw new Error("missing hidden-abandonment finding");
    console.log("hidden abandonment detection passed");
  }

  // Test 4: phantom abandonment warning
  {
    const box = sandbox();
    const ledger4 = box.write("GATES.md", MET_GATE("g1"));
    const report4 = box.writeReport(`# Final Report: test

## Evidence Summary

- **Met**: 1
- **Unmet**: 0
- **Abandoned**: 0
- **Stale**: 0
- **Total gates**: 1

## Gate Coverage

- \`GATES:g1\`

## Abandonments

- \`GATES:g2\` — phantom abandon

## Quoted Evidence

### \`GATES:g1\`

- **EVIDENCE**: at=2026-01-01T00:00:00.000Z; exit=0; output=probe-g1
- **Source**: GATES.md

## Truthfulness Declarations

- [x] No shortened list.
- [x] No quoted output that never ran.
- [x] No hypothesis stated as fact.
- [x] No hidden narrowing.
- [x] Counts verified.
- [x] Abandonments surfaced.
`);
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", join(box.path, "GATES.md")]);
    if (out.code !== 0) throw new Error("phantom abandonment should be warning, not error: exit " + out.code);
    if (!out.stdout.includes("phantom-abandonment")) throw new Error("missing phantom-abandonment warning");
    console.log("phantom abandonment warning passed");
  }

  // Test 5: hypothesis-as-fact detection
  {
    const box = sandbox();
    const ledger5 = box.write("GATES.md", MET_GATE("g1"));
    const report5 = box.writeReport(`# Final Report: test

## Evidence Summary

- **Met**: 1
- **Unmet**: 0
- **Abandoned**: 0
- **Stale**: 0
- **Total gates**: 1

## Gate Coverage

- \`GATES:g1\`

## Quoted Evidence

### \`GATES:g1\`

- **EVIDENCE**: at=2026-01-01T00:00:00.000Z; exit=0; output=probe-g1
- **Source**: GATES.md

## Truthfulness Declarations

- [x] We believe the task is complete.
- [x] No shortened list.
- [x] No quoted output that never ran.
- [x] No hidden narrowing.
- [x] Counts verified.
- [x] Abandonments surfaced.
`);
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", join(box.path, "GATES.md")]);
    if (out.code !== 0) throw new Error("hypothesis-as-fact should be warning, not error: exit " + out.code);
    if (!out.stdout.includes("hypothesis-as-fact")) throw new Error("missing hypothesis-as-fact warning");
    console.log("hypothesis-as-fact detection passed");
  }

  // Test 6: gate-lint detects completeness claims
  {
    const box = sandbox();
    const ledger6 = box.write("GATES.md", "- [x] g1: everything works\n  CHECK: node -e \"process.exit(0)\"\n  EXPECT: probe-g1\n  EVIDENCE: at=2026-01-01T00:00:00.000Z; exit=0\n\n- [ ] g2: fix the login flow\n  EVIDENCE: pending\n");
    const out = await run(LINT, ["--strict", join(box.path, "GATES.md")]);
    if (out.code !== 1) throw new Error("lint should flag completeness claim: exit " + out.code);
    if (!out.stdout.includes("unverified-completeness")) throw new Error("missing unverified-completeness finding");
    console.log("gate-lint completeness claim detection passed");
  }

  // Test 7: gate-lint detects quiet narrowing
  {
    const box = sandbox();
    const ledger7 = box.write("GATES.md", "- [x] g1: only the core part works\n  CHECK: node -e \"process.exit(0)\"\n  EXPECT: probe-g1\n  EVIDENCE: at=2026-01-01T00:00:00.000Z; exit=0\n");
    const out = await run(LINT, ["--strict", join(box.path, "GATES.md")]);
    if (out.code !== 1) throw new Error("lint should flag quiet narrowing: exit " + out.code);
    if (!out.stdout.includes("quiet-narrowing")) throw new Error("missing quiet-narrowing finding");
    console.log("gate-lint quiet-narrowing detection passed");
  }

  // Test 8: gate-lint flags manual gates with no check
  {
    const box = sandbox();
    const ledger8 = box.write("GATES.md", "- [ ] g1: verify output\n  EVIDENCE: pending\n");
    const out = await run(LINT, ["--strict", join(box.path, "GATES.md")]);
    if (out.code !== 1) throw new Error("lint should flag manual gate: exit " + out.code);
    if (!out.stdout.includes("manual-gate")) throw new Error("manual-gate finding missing");
    console.log("gate-lint manual-gate detection passed");
  }

  // Test 9: counts mismatch is detected
  {
    const box = sandbox();
    const ledger9 = box.write("GATES.md", LEDGER("GATES", ["g1"], [{ id: "g2", title: "fix the login flow" }]));
    const report9 = box.writeReport(`# Final Report: test

## Evidence Summary

- **Met**: 1
- **Unmet**: 0
- **Abandoned**: 0
- **Stale**: 0
- **Total gates**: 1

## Gate Coverage

- \`GATES:g1\`

## Truthfulness Declarations

- [x] No shortened list.
- [x] No quoted output that never ran.
- [x] No hypothesis stated as fact.
- [x] No hidden narrowing.
- [x] Counts verified.
- [x] Abandonments surfaced.
`);
    const out = await run(VERIFY, ["--report", join(box.path, "REPORT.md"), "--ledger", join(box.path, "GATES.md")]);
    if (out.code !== 1) throw new Error("counts mismatch should fail: exit " + out.code);
    if (!out.stdout.includes("count-mismatch")) throw new Error("missing count-mismatch finding");
    console.log("counts mismatch detection passed");
  }

  console.log("all truthful-reporting tests passed");
}

main().catch((err) => { console.error("test failed:", err.message); process.exit(1); });
