#!/usr/bin/env node
// Additive status/reporting surface for existing unidle ledgers.
// Preserves Markdown ledgers and never executes CHECK commands.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gateState, parseGates, resolveTarget } from "./lib/gates.mjs";

const HELP = `usage: unidle-status.mjs [options] [file ...]

options:
  --format text|json  output format (default text)
  --root DIR          repository root
  --scope ID          select a pipeline
  --history           append a structured snapshot under .unidle/history/
  --help              show this help

Optional gate metadata is read from indented ledger lines:
  OWNER, SEVERITY, TAGS, FRESHNESS
FRESHNESS accepts minutes, hours, days, or an ISO-8601 duration such as PT24H.`;

function fail(message) { console.error("unidle-status: " + message); process.exit(2); }
function valueArg(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail(name + " needs a value");
  return value;
}
function parseArgs(argv) {
  const options = { format: "text", files: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { console.log(HELP); process.exit(0); }
    if (arg === "--history") { options.history = true; continue; }
    if (arg === "--format") { options.format = valueArg(argv, i++, arg); continue; }
    if (arg === "--root") { options.root = valueArg(argv, i++, arg); continue; }
    if (arg === "--scope") { options.scope = valueArg(argv, i++, arg); continue; }
    if (arg.startsWith("--")) fail("unknown option " + arg);
    options.files.push(arg);
  }
  if (!["text", "json"].includes(options.format)) fail("--format must be text or json");
  return options;
}

function metadata(text, gate) {
  const lines = String(text).split(/\r?\n/);
  const result = { owner: null, severity: "blocking", tags: [], freshness: null };
  for (let i = gate.line + 1; i < lines.length; i++) {
    if (/^- \[( |x|X)\]/.test(lines[i])) break;
    const match = lines[i].match(/^\s+(OWNER|SEVERITY|TAGS|FRESHNESS):\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (key === "tags") result.tags = match[2].split(",").map((x) => x.trim()).filter(Boolean);
    else result[key] = match[2].trim() || null;
  }
  return result;
}

function freshnessMs(value) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|days)$/i);
  if (match) return Number(match[1]) * ({ m: 60000, min: 60000, h: 3600000, hr: 3600000, d: 86400000, day: 86400000, days: 86400000 }[match[2].toLowerCase()]);
  const iso = String(value).match(/^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?$/i);
  if (iso) return (Number(iso[1] || 0) * 3600000) + (Number(iso[2] || 0) * 60000);
  return null;
}

function evidenceTime(evidence) {
  const match = String(evidence || "").match(/(?:^|;)\s*at=([^;]+)/i);
  const time = match && Date.parse(match[1]);
  return Number.isFinite(time) ? time : null;
}

function nextAction(gate, state, refs = []) {
  if (state === "unmet-no-evidence") return "re-run the approved CHECK to refresh EVIDENCE";
  if (state === "unmet") return gate.check ? "inspect the oracle, approve it, then run the CHECK" : "complete the manual outcome and record EVIDENCE";
  if (refs.length) return "satisfy " + refs.join(", ");
  return null;
}

function load(file) {
  const text = readFileSync(file, "utf8");
  const doc = parseGates(text);
  if (doc.errors.length) fail(file + ": " + doc.errors.join("; "));
  const reports = doc.gates.map((gate) => {
    const state = gateState(gate, doc.abandoned);
    const meta = metadata(text, gate);
    const age = evidenceTime(gate.evidence);
    const maxAge = freshnessMs(meta.freshness);
    const stale = state === "met" && maxAge !== null && (age === null || Date.now() - age > maxAge);
    return { id: gate.id, title: gate.title, state: stale ? "stale" : state, stale, metadata: meta,
      nextAction: nextAction(gate, stale ? "unmet-no-evidence" : state) };
  });
  for (const ref of doc.needsScope) {
    const blocked = reports.find((x) => x.state !== "met");
    if (blocked) blocked.nextAction = "satisfy " + ref.scope + ":" + ref.stem + ":" + ref.gate;
  }
  return { file, ledger: basename(file).replace(/\.md$/i, ""), gates: reports,
    dependencies: doc.needsScope, counts: { total: reports.length,
      met: reports.filter((x) => x.state === "met").length,
      unmet: reports.filter((x) => ["unmet", "unmet-no-evidence", "stale"].includes(x.state)).length,
      abandoned: reports.filter((x) => x.state === "abandoned").length,
      stale: reports.filter((x) => x.state === "stale").length } };
}

const opt = parseArgs(process.argv.slice(2));
const root = resolve(opt.root || process.cwd());
if (!statSync(root).isDirectory()) fail("--root is not a directory: " + root);
const target = resolveTarget({ root, scope: opt.scope, files: opt.files });
if (target.error) fail(target.error);
if (!target.files.length) fail("no gate files found");
const reports = target.files.map(load);
const snapshot = { schema: 1, generatedAt: new Date().toISOString(), root, scope: opt.scope || target.scope || null, reports };
if (opt.history) {
  const dir = join(root, ".unidle", "history");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, snapshot.generatedAt.replace(/[-:.TZ]/g, "") + ".json");
  appendFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  snapshot.historyFile = file;
}
if (opt.format === "json") { console.log(JSON.stringify(snapshot, null, 2)); process.exit(reports.some((r) => r.counts.unmet) ? 1 : 0); }
for (const report of reports) {
  console.log(report.ledger + ": " + report.counts.met + " met, " + report.counts.unmet + " unmet, " + report.counts.stale + " stale");
  for (const gate of report.gates.filter((x) => x.state !== "met" && x.state !== "abandoned")) console.log("  NEXT " + report.ledger + ":" + gate.id + " — " + gate.nextAction);
}
process.exit(reports.some((r) => r.counts.unmet) ? 1 : 0);
