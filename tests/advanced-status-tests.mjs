#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(process.cwd(), "scripts", "unidle-status.mjs");
const run = (root, args) => new Promise((done) => execFile(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" }, (error, stdout, stderr) => done({ code: error?.code || 0, stdout, stderr })));

async function test1() {
  const root = mkdtempSync(join(tmpdir(), "unidle-status-test-"));
  try {
    mkdirSync(join(root, "gates"));
    writeFileSync(join(root, "gates", "leaf.md"), `# Gates\n\n- [x] G1: fresh outcome\n  OWNER: platform\n  SEVERITY: high\n  TAGS: api, regression\n  FRESHNESS: 24h\n  EVIDENCE: at=${new Date().toISOString()}; exit=0\n\n- [ ] G2: unfinished\n  EVIDENCE: pending\n`);
    const json = await run(root, ["--format", "json"]);
    if (json.code !== 1) throw new Error("expected unmet status");
    const parsed = JSON.parse(json.stdout);
    if (parsed.schema !== 2) throw new Error("expected schema version 2, got " + parsed.schema);
    if (!parsed.reports[0].gates[1].nextAction) throw new Error("next action missing");
    const history = await run(root, ["--history", "--format", "json"]);
    const m = history.stdout.match(/"historyFile": "([^"]+)/);
    if (m && !existsSync(m[1])) {
      const files = readdirSync(join(root, ".unidle", "history"));
      if (!files.length) throw new Error("history was not written");
    }
    console.log("advanced status tests passed");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function test2() {
  const root = mkdtempSync(join(tmpdir(), "unidle-status-test-"));
  try {
    mkdirSync(join(root, "gates"));
    writeFileSync(join(root, "gates", "chain.md"), `# Gates\n\n- [x] A: approved check\n  OWNER: platform\n  SEVERITY: critical\n  RISK: high\n  CATEGORY: security\n  DEADLINE: 2030-01-01\n  OWNER_TEAM: team-alpha\n  DEPENDS_ON: chain:G1\n  EVIDENCE: at=${new Date().toISOString()}; exit=0\n\n- [x] G1: dependent gate\n  REVIEWER: alice\n  REVIEW_WINDOW: 1h\n  EVIDENCE: at=${new Date().toISOString()}; exit=0\n\n- [ ] B: missing gate\n  EVIDENCE: pending\n`);
    const json = await run(root, ["--format", "json"]);
    if (json.code !== 1) throw new Error("expected unmet status");
    const parsed = JSON.parse(json.stdout);
    const report = parsed.reports[0];
    const gateA = report.gates.find((g) => g.id === "A");
    if (!gateA) throw new Error("gate A not found");
    if (gateA.metadata.risk !== "high") throw new Error("risk missing: " + JSON.stringify(gateA.metadata));
    if (gateA.metadata.category !== "security") throw new Error("category missing");
    if (gateA.metadata.deadline !== "2030-01-01") throw new Error("deadline missing");
    if (!gateA.metadata.dependsOn.includes("chain:G1")) throw new Error("dependsOn not parsed");
    if (gateA.metadata.ownerTeam !== "team-alpha") throw new Error("ownerTeam not parsed");
    const gateG1 = report.gates.find((g) => g.id === "G1");
    if (!gateG1) throw new Error("gate G1 not found");
    if (gateG1.metadata.reviewer !== "alice") throw new Error("reviewer missing");
    if (gateG1.metadata.reviewWindow !== "1h") throw new Error("reviewWindow missing");
    if (!report.explanations || report.explanations.length === 0) throw new Error("explanations missing");
    const blocked = report.explanations.find((e) => e.gate === "B");
    if (!blocked || !blocked.explanation.includes("manual outcome")) throw new Error("blocked explanation missing");
    if (!report.dependencyGraph || report.dependencyGraph.edges.length === 0) throw new Error("dependency edges not found");
    console.log("richer gate schema tests passed");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function test3() {
  const root = mkdtempSync(join(tmpdir(), "unidle-status-test-"));
  try {
    mkdirSync(join(root, "gates"));
    mkdirSync(join(root, ".unidle", "history"), { recursive: true });
    const past = new Date(Date.now() - 7200000).toISOString();
    const older = new Date(Date.now() - 14400000).toISOString();
    writeFileSync(join(root, ".unidle", "history", older.replace(/[-:.TZ]/g, "") + ".json"), JSON.stringify({ schema: 2, generatedAt: older, reports: [{ ledger: "test", gates: [{ id: "G1", state: "unmet" }] }] }));
    writeFileSync(join(root, ".unidle", "history", past.replace(/[-:.TZ]/g, "") + ".json"), JSON.stringify({ schema: 2, generatedAt: past, reports: [{ ledger: "test", gates: [{ id: "G1", state: "met" }] }] }));
    writeFileSync(join(root, "gates", "test.md"), `# Gates\n\n- [ ] G1: current unmet\n  EVIDENCE: pending\n`);
    const trend = await run(root, ["--trend", "--format", "json"]);
    const parsed = JSON.parse(trend.stdout);
    if (!parsed.trend || !parsed.trend.summary) throw new Error("trend summary missing");
    if (parsed.trend.summary.improved !== 1) throw new Error("expected 1 improved trend, got " + JSON.stringify(parsed.trend));
    console.log("history trend tests passed");
  } finally { rmSync(root, { recursive: true, force: true }); }
}

async function main() {
  await test1();
  await test2();
  await test3();
  console.log("all advanced status tests passed");
}
main().catch((err) => { console.error("test failed:", err.message); process.exit(1); });
