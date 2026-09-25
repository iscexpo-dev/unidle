# Advanced status and evidence

`unidle-status.mjs` is an additive reporting surface. It does not execute checks or rewrite existing Markdown ledgers.

```bash
node scripts/unidle-status.mjs --format json
node scripts/unidle-status.mjs --history --scope api
```

Optional metadata can be placed below a gate:

```markdown
- [ ] G1: API contract is compatible
  OWNER: platform
  SEVERITY: high
  TAGS: api, regression
  FRESHNESS: 24h
  EVIDENCE: pending
```

`FRESHNESS` supports `m`, `min`, `h`, `hr`, `d`, `day`, `days`, and simple ISO durations such as `PT24H`. A met gate with missing or expired timestamped evidence is reported as `stale`. JSON snapshots are written to `.unidle/history/` when `--history` is supplied; add that directory to `.gitignore` when history is local-only.
