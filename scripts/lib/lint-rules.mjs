// Gate-quality rules shared by the linter CLI and future tooling.
// Zero dependencies. Node 16+.

// An oracle whose output is fixed by its own text observes nothing.
export const SELF_DETERMINING = /^\s*(echo|printf|true|:|exit\s+0)\b/;
// Tokens that appear in failure output as readily as in success output.
export const WEAK_EXPECT = new Set([
  "ok", "okay", "done", "pass", "passed", "success", "successful", "succeeded",
  "complete", "completed", "finished", "yes", "true", "0", "good", "fine", "working",
]);
// Openings that name an activity rather than an outcome a stranger could judge.
export const ACTIVITY_START = /^(work(ing)? on|improve|enhance|handle|support|ensure|make sure|try|attempt|look (at|into)|investigate|consider|review|refactor|clean ?up|polish|update|tidy|address|deal with|add support)\b/i;
// A slash wrapped EXPECT is read as a regular expression. That is correct for
// a pattern and wrong for a literal path, whose dots then match any character.
// An unescaped inner slash is the tell: patterns rarely carry one, paths do.
export const PATH_LIKE = /[^\\]\//;

// Judge one already-parsed document. Findings carry no file field; callers
// attach it so multi-file reports keep their grouping.
export function lintDocument(doc) {
  const findings = [];
  const add = (level, gate, rule, message) =>
    findings.push({ level, gate: gate || null, rule, message });

  const live = doc.gates.filter((gate) => !doc.abandoned.has(gate.id));
  const runnable = live.filter((gate) => gate.check);

  for (const gate of live) {
    const { id, title, check, expect } = gate;

    // The text a pass would match: plain text verbatim, or the body of a
    // slash wrapped pattern without its delimiters and flags.
    const literal = gate.expectation && gate.expectation.kind === "regex"
      ? gate.expectation.source
      : expect;

    if (check && SELF_DETERMINING.test(check)) {
      add("error", id, "tautological-check",
        'CHECK cannot fail: "' + check + '" produces its output regardless of the system');
    }

    // "CHECK: node build.mjs --banner DONE" with "EXPECT: DONE" passes because
    // the command prints the expectation, not because the outcome holds.
    if (check && expect && literal && literal.length >= 2 && check.includes(literal)) {
      add("error", id, "expect-echoes-check",
        'EXPECT "' + literal + '" appears verbatim in its own CHECK, so the command guarantees its own pass');
    }

    if (literal && WEAK_EXPECT.has(literal.trim().toLowerCase())) {
      add("warn", id, "weak-expect",
        'EXPECT "' + expect + '" also appears in failure output; match a line only success can print');
    }

    if (gate.expectation && gate.expectation.kind === "regex" && PATH_LIKE.test(gate.expectation.source)) {
      add("warn", id, "path-read-as-regex",
        'EXPECT "' + expect + '" looks like a literal path but is read as a regular expression, so its dots are wildcards');
    }

    if (!check) {
      add("warn", id, "manual-gate",
        "no CHECK, so this outcome is judged by hand and its evidence is only as good as the reader");
      if (/\d/.test(title)) {
        add("warn", id, "unmeasured-number",
          'title states a number that nothing measures: "' + title + '"');
      }
    }

    if (ACTIVITY_START.test(title)) {
      add("warn", id, "activity-not-outcome",
        'names an activity, not an outcome a stranger could judge: "' + title + '"');
    }

    // Truthful-reporting guardrails: gates that could produce untruthful reports
    // if the author writes a confident final report without re-measuring.

    const completenessPatterns = [
      /^everything (is|works|is done|works fine)/i,
      /^all (done|complete|working|fixed|verified)/i,
      /^fully (working|complete|done|verified)/i,
      /^completely (done|fixed|working)/i,
    ];
    for (const pattern of completenessPatterns) {
      if (pattern.test(title)) {
        add("warn", id, "unverified-completeness",
          'title claims completeness without evidence backing: "' + title + '"');
      }
    }

    const narrowingPatterns = [
      /^(only|just|mostly|primarily|basically) (the|our|this)/i,
      /core (part|functionality)/i,
      /works (for now|so far)/i,
      /minus [^;]+/,
      /except [^;]+/,
    ];
    for (const pattern of narrowingPatterns) {
      if (pattern.test(title)) {
        add("warn", id, "quiet-narrowing",
          'title may indicate scope was narrowed to hide blocked work: "' + title + '"');
      }
    }

    if (gate.evidence && gate.evidence !== "pending" && gate.evidence !== "") {
      const genericEvidence = /exit=0|output=.*probe|shell=\/bin\/sh/i;
      if (genericEvidence.test(gate.evidence) && !gate.check) {
        add("warn", id, "generic-evidence",
          "evidence is generic and may not actually verify the gate title");
      }
    }

    if (check && expect && gate.evidence) {
      const evidenceMatch = gate.evidence.match(/output=([^;]+)/);
      if (evidenceMatch && evidenceMatch[1] === expect.trim()) {
        add("warn", id, "evidence-echoes-check",
          "EVIDENCE output matches EXPECT verbatim; the report may quote evidence that just echoed the command");
      }
    }
  }

  // references/gates.md: five-to-twelve gates per leaf is the useful range.
  if (live.length && live.length < 5) {
    add("warn", null, "thin-ledger",
      live.length + " live gates, under five, which usually means the leaf is under-specified");
  }
  if (live.length > 12) {
    add("warn", null, "fat-ledger",
      live.length + " live gates, over twelve, which usually means this should have been two leaves");
  }
  if (live.length && runnable.length / live.length < 0.5) {
    add("warn", null, "mostly-manual",
      runnable.length + "/" + live.length + " gates are runnable; a mostly manual ledger is prose with checkboxes");
  }

  return findings;
}
