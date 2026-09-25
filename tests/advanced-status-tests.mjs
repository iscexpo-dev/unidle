#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(process.cwd(), "scripts", "unidle-status.mjs");
const root = mkdtempSync(join(tmpdir(), "unidle-status-test-"));
try {
  mkdirSync(join(root, "gates"));
  writeFileSync(join(root, "gates", "leaf.md"), `# Gates\n\n- [x] G1: fresh outcome\n  OWNER: platform\n  SEVERITY: high\n  TAGS: api, regression\n  FRESHNESS: 24h\n  EVIDENCE: at=${new Date().toISOString()}; exit=0\n\n- [ ] G2: unfinished\n  EVIDENCE: pending\n`);
  const run = (args) => new Promise((done) => execFile(process.execPath, [script, "--root", root, ...args], { encoding: "utf8" }, (error, stdout, stderr) => done({ code: error?.code || 0, stdout, stderr })));
  const json = await run(["--format", "json"]);
  if (json.code !== 1) throw new Error("expected unmet status");
  const parsed = JSON.parse(json.stdout);
  const gate = parsed.reports[0].gates[0];
  if (gate.metadata.owner !== "platform" || gate.metadata.tags.length !== 2) throw new Error("metadata missing");
  if (!parsed.reports[0].gates[1].nextAction) throw new Error("next action missing");
  const history = await run(["--history", "--format", "json"]);
  if (!existsSync(history.stdout.match(/"historyFile": "([^"]+)/)?.[1] || "")) {
    const files = require("node:fs").readdirSync(join(root, ".unidle", "history"));
    if (!files.length) throw new Error("history was not written");
  }
  console.log("advanced status tests passed");
} finally { rmSync(root, { recursive: true, force: true }); }
