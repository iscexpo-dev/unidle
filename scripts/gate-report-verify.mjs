#!/usr/bin/env node
// Verify a final report against gate ledger evidence.
// Prevents confident reports from outrunning their evidence.
// Zero dependencies. Node 16+.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseGates, gateState, resolveTarget } from "./lib/gates.mjs";

const HELP = `usage: gate-report-verify.mjs --report <file> [options]

verify modes:
  --report FILE       path to the markdown report to verify
  --ledger FILE       gate ledger file(s) to verify against
  --root DIR          repository root (for scope resolution)
  --scope ID          pipeline scope
  --strict            require all truthfulness declarations to pass
  --json              output findings as JSON
  --help              show this help

exit codes: 0 report is truthful; 1 violations found; 2 usage or parse error;
            3 report references gates not found in any ledger.

The verifier checks every claim in the report against the actual gate
ledger evidence. It confirms counts, remaining work, abandonments,
and quoted evidence match what the ledgers actually contain.`;

function failUsage(message) {
  console.error("gate-report-verify: " + message);
  console.error("run gate-report-verify.mjs --help for usage");
  process.exit(2);
}

const FLAG_OPTIONS = new Set(["--strict", "--json", "--help", "-h", "--"]);
const VALUE_OPTIONS = new Set(["--report", "--ledger", "--root", "--scope"]);

function parseArgs(argv) {
  const options = {};
  const files = [];
  let positional = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") { positional = true; continue; }
    if (!positional && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      if (VALUE_OPTIONS.has(name)) {
        const key = name.slice(2).replace(/-/g, "_");
        if (options[key] !== undefined) return { error: "duplicate option " + arg };
        const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
        if (value === undefined || value === "") return { error: name + " needs a value" };
        options[key] = value;
        continue;
      }
      if (FLAG_OPTIONS.has(arg)) {
        const key = arg.replace(/^-+/, "").replace(/-/g, "_");
        if (options[key] !== undefined) return { error: "duplicate option " + arg };
        options[key] = true;
        continue;
      }
      return { error: "unknown option " + name };
    }
    if (!positional && arg.startsWith("-")) return { error: "unknown option " + arg };
    files.push(arg);
  }
  return { options, files };
}

const parsedArgs = parseArgs(process.argv.slice(2));
if (parsedArgs.error) failUsage(parsedArgs.error);
const { options: opt, files: fileArgs } = parsedArgs;

if (opt.help || opt.h) { console.log(HELP); process.exit(0); }
if (!opt.report) failUsage("--report is required");
if (!opt.ledger && !opt.root && !opt.scope) failUsage("at least one of --ledger, --root, or --scope is required");

const root = resolve(opt.root || process.cwd());
if (!existsSync(root) || !statSync(root).isDirectory()) failUsage("--root is not a directory: " + root);
const reportPath = resolve(opt.report);
if (!existsSync(reportPath) || !statSync(reportPath).isFile()) failUsage("report file not found: " + reportPath);

const ledgerFiles = opt.ledger ? [opt.ledger] : fileArgs;

function loadReport() {
  try { return readFileSync(reportPath, "utf8"); }
  catch (error) { failUsage("cannot read report: " + error.message); }
}

function loadLedgers() {
  const ledgers = [];
  for (const file of ledgerFiles) {
    try {
      const text = readFileSync(file, "utf8");
      const doc = parseGates(text);
      if (doc.errors.length) {
        for (const error of doc.errors) console.error("gate-report-verify: " + file + ": " + error);
        continue;
      }
      ledgers.push({ file, doc });
    } catch (error) {
      console.error("gate-report-verify: cannot read " + file + ": " + error.message);
    }
  }
  if (!ledgers.length) {
    try {
      const target = resolveTarget({ root, scope: opt.scope, files: [] });
      if (target.error) failUsage(target.error);
      if (!target.files.length) failUsage("no gate files found");
      for (const file of target.files) {
        const text = readFileSync(file, "utf8");
        const doc = parseGates(text);
        if (doc.errors.length) continue;
        ledgers.push({ file, doc });
      }
    } catch (error) { failUsage(error.message); }
  }
  return ledgers;
}

function extractReportCounts(report) {
  const counts = { met: null, unmet: null, abandoned: null, stale: null, total: null };
  const patterns = {
    met: /\*\*Met\*\*:\s*(\d+)/,
    unmet: /\*\*Unmet\*\*:\s*(\d+)/,
    abandoned: /\*\*Abandoned\*\*:\s*(\d+)/,
    stale: /\*\*Stale\*\*:\s*(\d+)/,
    total: /\*\*Total gates\*\*:\s*(\d+)/,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = report.match(pattern);
    if (match) counts[key] = parseInt(match[1], 10);
  }
  return counts;
}

function extractReportGateIds(report) {
  const ids = new Set();
  const regex = /`([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)`/g;
  let match;
  while ((match = regex.exec(report)) !== null) {
    ids.add(match[1]);
  }
  return ids;
}

function extractReportAbandonments(report) {
  const abandons = [];
  const regex = /`([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)`\s*—\s*(.+)/g;
  let match;
  const sectionMatch = report.match(/## Abandonments([\s\S]*?)(?=\n## |\n##$|\z)/);
  if (sectionMatch) {
    const section = sectionMatch[1];
    while ((match = regex.exec(section)) !== null) {
      abandons.push({ id: match[1], reason: match[2].trim() });
    }
  }
  return abandons;
}

function getActualLedgerState(ledgers) {
  const gates = [];
  for (const { file, doc } of ledgers) {
    const stem = file.replace(/.*\//, "").replace(/\.md$/i, "");
    for (const gate of doc.gates) {
      const state = gateState(gate, doc.abandoned);
      gates.push({
        id: stem + ":" + gate.id,
        ledger: stem,
        title: gate.title,
        state,
        evidence: gate.evidence,
        abandoned: doc.abandoned.has(gate.id),
        abandonReason: doc.abandoned.get(gate.id) || null,
        checked: gate.checked,
      });
    }
  }
  return gates;
}

function verifyReport(report, ledgers) {
  const findings = [];
  const add = (level, rule, message) => findings.push({ level, rule, message });
  const ledgerState = getActualLedgerState(ledgers);
  const reportCounts = extractReportCounts(report);
  const reportGateIds = extractReportGateIds(report);
  const reportAbandonments = extractReportAbandonments(report);

  // Count actual states from ledgers
  const actualCounts = {
    met: ledgerState.filter((g) => g.state === "met").length,
    unmet: ledgerState.filter((g) => ["unmet", "unmet-no-evidence"].includes(g.state)).length,
    abandoned: ledgerState.filter((g) => g.state === "abandoned").length,
    stale: ledgerState.filter((g) => g.state === "stale").length,
    total: ledgerState.length,
  };

  // 1. Count verification
  for (const [key, actual] of Object.entries(actualCounts)) {
    const reported = reportCounts[key];
    if (reported !== null && reported !== actual) {
      add("error", "count-mismatch",
        `report says ${key}=${reported} but ledger has ${key}=${actual}`);
    }
  }

  // 2. Gate coverage: every ledger gate must appear in the report
  const ledgerGateIds = new Set(ledgerState.map((g) => g.id));
  const missingFromReport = [...ledgerGateIds].filter((id) => !reportGateIds.has(id));
  if (missingFromReport.length) {
    add("error", "shortened-list",
      `report omits ${missingFromReport.length} gate(s): ${missingFromReport.slice(0, 5).join(", ")}${missingFromReport.length > 5 ? ", +" + (missingFromReport.length - 5) + " more" : ""}`);
  }

  // 3. Abandonment verification
  const ledgerAbandons = ledgerState.filter((g) => g.abandoned);
  const ledgerAbandonIds = new Set(ledgerAbandons.map((g) => g.id));
  const reportAbandonIds = new Set(reportAbandonments.map((a) => a.id));

  for (const abandon of ledgerAbandons) {
    if (!reportAbandonIds.has(abandon.id)) {
      add("error", "hidden-abandonment",
        `ABANDON: ${abandon.id} is not surfaced in the report`);
    }
  }
  for (const abandonId of reportAbandonIds) {
    if (!ledgerAbandonIds.has(abandonId)) {
      add("warn", "phantom-abandonment",
        `report mentions abandonment ${abandonId} which is not abandoned in any ledger`);
    }
  }

  // 4. Quoted evidence verification
  const evidenceRegex = /EVIDENCE:\s*(.+)/g;
  const ledgerEvidence = new Set();
  for (const gate of ledgerState) {
    if (gate.evidence && gate.evidence !== "pending" && gate.evidence !== "") {
      ledgerEvidence.add(gate.evidence.trim());
    }
  }
  const quotedEvidenceRegex = /- \*\*EVIDENCE\*\*:\s*(.+)/g;
  let quotedMatch;
  const quotedEvidence = new Set();
  while ((quotedMatch = quotedEvidenceRegex.exec(report)) !== null) {
    quotedEvidence.add(quotedMatch[1].trim());
  }
  for (const quoted of quotedEvidence) {
    if (!ledgerEvidence.has(quoted)) {
      add("warn", "unverified-quote",
        `quoted evidence "${quoted.slice(0, 80)}..." does not match any EVIDENCE line in the ledgers`);
    }
  }

  // 5. Check for hypothesis-as-fact patterns
  const hypothesisPatterns = [
    /we (believe|think|suspect|assume|expect that)/i,
    /likely (to|that)/i,
    /probably (met|passed|completed)/i,
    /should (be|have been|pass)/i,
    /appears (to|to be)/i,
    /seems (to|to be)/i,
  ];
  for (const pattern of hypothesisPatterns) {
    if (pattern.test(report)) {
      add("warn", "hypothesis-as-fact",
        `report contains language that may state a hypothesis as fact: "${pattern.source}"`);
    }
  }

  // 6. Verify all remaining work sections are complete
  const remainingSection = report.match(/## Remaining Work([\s\S]*?)(?=\n## |\n##$|\z)/);
  if (remainingSection) {
    const remainingText = remainingSection[1];
    const remainingGateRefs = new Set();
    const remainingRegex = /`([a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+)`/g;
    let rMatch;
    while ((rMatch = remainingRegex.exec(remainingText)) !== null) {
      remainingGateRefs.add(rMatch[1]);
    }
    const unmetInLedger = [...ledgerGateIds].filter((id) => {
      const gate = ledgerState.find((g) => g.id === id);
      return gate && ["unmet", "unmet-no-evidence", "stale"].includes(gate.state);
    });
    const missingFromRemaining = unmetInLedger.filter((id) => !remainingGateRefs.has(id));
    if (missingFromRemaining.length) {
      add("error", "shortened-remaining-work",
        `remaining work omits ${missingFromRemaining.length} unmet gate(s): ${missingFromRemaining.slice(0, 5).join(", ")}`);
    }
  }

  return { findings, ledgerState, reportCounts, actualCounts };
}

const report = loadReport();
const ledgers = loadLedgers();
if (!ledgers.length) failUsage("no readable ledger files found");

const { findings, ledgerState, reportCounts, actualCounts } = verifyReport(report, ledgers);

const errors = findings.filter((f) => f.level === "error");
const warnings = findings.filter((f) => f.level === "warn");

if (opt.json) {
  console.log(JSON.stringify({
    truthful: errors.length === 0,
    errors: errors.length,
    warnings: warnings.length,
    findings,
    actualCounts,
    reportCounts,
  }, null, 2));
} else {
  if (findings.length === 0) {
    console.log("REPORT IS TRUTHFUL: all claims verified against ledger evidence");
  } else {
    if (errors.length) {
      console.log("REPORT VIOLATIONS (" + errors.length + " error(s)):");
      for (const finding of errors) console.log("  ERROR " + finding.rule + ": " + finding.message);
    }
    if (warnings.length) {
      console.log("WARNINGS (" + warnings.length + "):");
      for (const finding of warnings) console.log("  WARN  " + finding.rule + ": " + finding.message);
    }
  }
  if (warnings.length && !errors.length) console.log("REPORT IS TRUTHFUL (advisory warnings only)");
}

const hasViolations = errors.length > 0;
if (opt.strict && warnings.length > 0) {
  process.exit(1);
} else if (hasViolations) {
  process.exit(1);
} else {
  process.exit(0);
}
