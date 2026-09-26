#!/usr/bin/env node
// Additive status/reporting surface for existing unidle ledgers.
// Preserves Markdown ledgers and never executes CHECK commands.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { gateState, parseGates, parseMetadata, resolveTarget } from "./lib/gates.mjs";

const HELP = `usage: unidle-status.mjs [options] [file ...]

options:
  --format text|json  output format (default text)
  --root DIR          repository root
  --scope ID          select a pipeline
  --history           append a structured snapshot under .unidle/history/
  --trend             compare latest history snapshots
  --help              show this help

Optional gate metadata is read from indented ledger lines:
  OWNER, SEVERITY, TAGS, FRESHNESS, DEADLINE, RISK, CATEGORY,
  OWNER_TEAM, REVIEWER, DEPENDS_ON, REQUIRES, REVIEW_WINDOW
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
    if (arg === "--trend") { options.trend = true; continue; }
    if (arg === "--format") { options.format = valueArg(argv, i++, arg); continue; }
    if (arg === "--root") { options.root = valueArg(argv, i++, arg); continue; }
    if (arg === "--scope") { options.scope = valueArg(argv, i++, arg); continue; }
    if (arg.startsWith("--")) fail("unknown option " + arg);
    options.files.push(arg);
  }
  if (!["text", "json"].includes(options.format)) fail("--format must be text or json");
  return options;
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

function explainBlocked(gate, state, meta, age, maxAge, stale, refs) {
  const reasons = [];
  if (state === "abandoned") return "gate was abandoned";
  if (state === "unmet" || state === "unmet-no-evidence") {
    if (gate.expectation && gate.expectation.kind === "regex") {
      reasons.push("CHECK not executed or evidence is missing");
      if (meta.dependsOn.length) reasons.push("depends on gates that may be unmet: " + meta.dependsOn.join(", "));
      if (meta.requires.length) reasons.push("requires: " + meta.requires.join(", "));
    } else {
      reasons.push("manual outcome not recorded");
      if (meta.reviewer) reasons.push("awaiting review by " + meta.reviewer);
    }
  }
  if (stale) {
    reasons.push("freshness expired (max " + (meta.freshness || "?") + ")");
    if (age !== null && maxAge !== null) {
      const elapsed = Math.round((Date.now() - age) / 60000);
      reasons.push("evidence is " + elapsed + "m old, exceeding the freshness window");
    }
  }
  if (meta.deadline) {
    const deadlineMs = Date.parse(meta.deadline);
    if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs) reasons.push("deadline " + meta.deadline + " has passed");
  }
  if (meta.reviewWindow) {
    const reviewMs = freshnessMs(meta.reviewWindow);
    if (reviewMs !== null && age !== null && Date.now() - age > reviewMs) reasons.push("review window expired (" + meta.reviewWindow + ")");
  }
  for (const ref of refs) {
    reasons.push("blocked by upstream dependency: " + ref.scope + ":" + ref.stem + ":" + ref.gate);
  }
  if (gate.expectation && gate.expectation.kind === "regex" && state !== "met") {
    reasons.push("EXPECT regex not satisfied: " + gate.expectation.source.slice(0, 80));
  }
  if (!reasons.length) return "gate is blocked for unknown reasons";
  return reasons.join("; ");
}

function buildDependencyGraph(gates, ledger) {
  const gateMap = new Map();
  const graph = { nodes: [], edges: [], summary: { total: 0, connected: 0, isolated: 0, cycles: 0 } };
  for (const gate of gates) {
    gateMap.set(ledger + ":" + gate.id, gate);
    graph.nodes.push({ id: ledger + ":" + gate.id, ledger, gateId: gate.id, state: gate.state, metadata: gate.metadata });
  }
  for (const gate of gates) {
    const nodeId = ledger + ":" + gate.id;
    const meta = gate.metadata;
    const deps = [...(meta.dependsOn || []), ...(meta.requires || [])];
    for (const dep of deps) {
      const parts = dep.split(":");
      let targetId = null;
      if (parts.length >= 2) targetId = parts[0] + ":" + parts[parts.length - 1];
      else if (parts.length === 1) targetId = ledger + ":" + parts[0];
      if (targetId && gateMap.has(targetId)) {
        graph.edges.push({ from: nodeId, to: targetId, type: "dependency" });
      }
    }
  }
  const connected = new Set();
  for (const edge of graph.edges) { connected.add(edge.from); connected.add(edge.to); }
  graph.summary.total = graph.nodes.length;
  graph.summary.connected = connected.size;
  graph.summary.isolated = graph.nodes.length - connected.size;
  return graph;
}

function formatDependencySummary(graph) {
  const lines = [];
  lines.push("Dependency graph: " + graph.summary.total + " gates, " + graph.summary.connected + " connected, " + graph.summary.isolated + " isolated");
  if (graph.edges.length) {
    lines.push("Edges (" + graph.edges.length + "):");
    for (const edge of graph.edges) lines.push("  " + edge.from + " -> " + edge.to);
  }
  return lines.join("\n");
}

function load(file) {
  const text = readFileSync(file, "utf8");
  const doc = parseGates(text);
  if (doc.errors.length) fail(file + ": " + doc.errors.join("; "));
  const reports = doc.gates.map((gate) => {
    const state = gateState(gate, doc.abandoned);
    const meta = parseMetadata(text, gate);
    const age = evidenceTime(gate.evidence);
    const maxAge = freshnessMs(meta.freshness);
    const stale = state === "met" && maxAge !== null && (age === null || Date.now() - age > maxAge);
    const metaWithStale = { ...meta, stale };
    return { id: gate.id, title: gate.title, state: stale ? "stale" : state, stale, checked: gate.checked, metadata: metaWithStale,
      risk: meta.risk || null, category: meta.category || null, deadline: meta.deadline || null,
      ownerTeam: meta.ownerTeam || null, reviewer: meta.reviewer || null,
      dependsOn: meta.dependsOn || [], requires: meta.requires || [], reviewWindow: meta.reviewWindow || null,
      expectation: gate.expectation ? { kind: gate.expectation.kind, source: gate.expectation.kind === "regex" ? gate.expectation.source : null } : null,
      nextAction: nextAction(gate, stale ? "unmet-no-evidence" : state, doc.needsScope) };
  });
  for (const ref of doc.needsScope) {
    const blocked = reports.find((x) => x.state !== "met");
    if (blocked) blocked.nextAction = "satisfy " + ref.scope + ":" + ref.stem + ":" + ref.gate;
  }
  const explanations = reports.filter((x) => x.state !== "met" && x.state !== "abandoned").map((g) => ({
    gate: g.id, title: g.title, state: g.state, explanation: explainBlocked(g, g.state, g.metadata, evidenceTime(g.evidence), freshnessMs(g.metadata.freshness), g.stale, doc.needsScope),
  }));
  return { file, ledger: basename(file).replace(/\.md$/i, ""), gates: reports, dependencies: doc.needsScope, counts: { total: reports.length,
      met: reports.filter((x) => x.state === "met").length,
      unmet: reports.filter((x) => ["unmet", "unmet-no-evidence", "stale"].includes(x.state)).length,
      abandoned: reports.filter((x) => x.state === "abandoned").length,
      stale: reports.filter((x) => x.state === "stale").length },
    dependencyGraph: buildDependencyGraph(reports, basename(file).replace(/\.md$/i, "")), explanations };
}

function loadHistoryTrends(root) {
  const dir = join(root, ".unidle", "history");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  if (files.length < 2) return null;
  const snapshots = [];
  for (const file of files.slice(0, 10)) {
    try {
      const snap = JSON.parse(readFileSync(join(dir, file), "utf8"));
      snapshots.push(snap);
    } catch { /* skip invalid */ }
  }
  if (snapshots.length < 2) return null;
  const trend = { snapshots: snapshots.length, latest: snapshots[0].generatedAt, earliest: snapshots[snapshots.length - 1].generatedAt, trends: [] };
  const latest = snapshots[0];
  const previous = snapshots[1];
  for (const latestReport of latest.reports) {
    const prevReport = previous.reports.find((r) => r.ledger === latestReport.ledger);
    if (!prevReport) { trend.trends.push({ ledger: latestReport.ledger, status: "new" }); continue; }
    for (const latestGate of latestReport.gates) {
      const prevGate = prevReport.gates.find((g) => g.id === latestGate.id);
      if (!prevGate) { trend.trends.push({ ledger: latestReport.ledger, gate: latestGate.id, status: "new" }); continue; }
      if (prevGate.state === "met" && latestGate.state !== "met") trend.trends.push({ ledger: latestReport.ledger, gate: latestGate.id, status: "regressed", from: prevGate.state, to: latestGate.state });
      else if (prevGate.state !== "met" && latestGate.state === "met") trend.trends.push({ ledger: latestReport.ledger, gate: latestGate.id, status: "improved", from: prevGate.state, to: latestGate.state });
      else if (prevGate.state === "stale" && latestGate.state === "met") trend.trends.push({ ledger: latestReport.ledger, gate: latestGate.id, status: "improved", from: prevGate.state, to: latestGate.state });
      else if (latestGate.state === "stale" && prevGate.state !== "stale") trend.trends.push({ ledger: latestReport.ledger, gate: latestGate.id, status: "regressed", from: prevGate.state, to: latestGate.state });
    }
  }
  const improved = trend.trends.filter((t) => t.status === "improved").length;
  const regressed = trend.trends.filter((t) => t.status === "regressed").length;
  trend.summary = { total: trend.trends.length, improved, regressed, stable: trend.trends.length - improved - regressed };
  return trend;
}

const opt = parseArgs(process.argv.slice(2));
const root = resolve(opt.root || process.cwd());
if (!statSync(root).isDirectory()) fail("--root is not a directory: " + root);
const target = resolveTarget({ root, scope: opt.scope, files: opt.files });
if (target.error) fail(target.error);
if (!target.files.length) fail("no gate files found");
const reports = target.files.map(load);
const snapshot = { schema: 2, generatedAt: new Date().toISOString(), root, scope: opt.scope || target.scope || null, reports };
if (opt.history) {
  const dir = join(root, ".unidle", "history");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, snapshot.generatedAt.replace(/[-:.TZ]/g, "") + ".json");
  appendFileSync(file, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  snapshot.historyFile = file;
}
if (opt.trend || (opt.history && opt.format === "json")) {
  const trend = loadHistoryTrends(root);
  if (trend) snapshot.trend = trend;
}
if (opt.format === "json") { console.log(JSON.stringify(snapshot, null, 2)); process.exit(reports.some((r) => r.counts.unmet) ? 1 : 0); }
for (const report of reports) {
  console.log(report.ledger + ": " + report.counts.met + " met, " + report.counts.unmet + " unmet, " + report.counts.stale + " stale");
  if (report.dependencyGraph.edges.length) {
    console.log("  " + formatDependencySummary(report.dependencyGraph));
  }
  for (const gate of report.gates.filter((x) => x.state !== "met" && x.state !== "abandoned")) {
    const expl = report.explanations.find((e) => e.gate === gate.id);
    console.log("  NEXT " + report.ledger + ":" + gate.id + " — " + gate.nextAction + (expl ? " [" + expl.explanation + "]" : ""));
  }
}
process.exit(reports.some((r) => r.counts.unmet) ? 1 : 0);
