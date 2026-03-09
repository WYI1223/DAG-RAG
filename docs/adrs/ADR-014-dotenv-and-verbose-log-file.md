---
id: ADR-014
status: accepted
supersedes: ADR-013 (verbose output section)
affects:
  - src/cli/index.ts
  - src/core/semantic/client.ts
  - src/core/semantic/analyzer.ts
---

# Dotenv config, verbose log file, and truncation detection

## Context

Three usability issues emerged during LLM integration testing:

1. **Environment variables lost on restart**: API keys set via `export` in the terminal are lost when the terminal session or VSCode is restarted, requiring re-entry every time.

2. **Verbose output clutters terminal**: When `--verbose` was added (ADR-013), it printed raw LLM prompts and responses directly to stdout, mixing with spinner output and making it hard to review.

3. **Silent truncation**: When the LLM hits `max_tokens` (e.g. 4096 output tokens consumed by thinking without producing a text block), the response is silently treated as `[]`. There was no way to distinguish "model found no relationships" from "model was cut off mid-response".

## Decision

### Dotenv support

Added `dotenv/config` import at the CLI entry point. Users create a `.env` file in the project root with their provider credentials. The file is loaded automatically on every CLI invocation. `.env` is added to `.gitignore` to prevent credential leaks.

### Verbose output to log file

When `--verbose` is used, output is written to `.adr-graph/verbose.log` instead of stdout. After analysis completes, the log file is automatically opened in VSCode via `code` CLI. The terminal stays clean with only the summary line and log path displayed.

The analyzer accepts a `verboseStream` option (any object with a `write(s: string)` method) so the CLI controls where verbose output goes.

### Truncation detection

`AnalyzeResult` now includes a `truncated: boolean` field, set to `true` when `response.stop_reason === "max_tokens"`. The analyzer:
- Logs a `TRUNCATED` label in verbose output
- Records a warning in `result.errors[]`: `"ADR-xxx: response truncated (hit max_tokens)"`
- The CLI displays the warning as `⚠ ADR-xxx: response truncated ...`

### Max tokens increase

`MAX_TOKENS` was increased from 1024 to 4096 to accommodate models that produce longer responses or use output tokens for thinking.

## Consequences

- Positive: credentials persist across sessions without manual `export`
- Positive: verbose output is reviewable in VSCode editor instead of scrolling terminal
- Positive: truncated responses are clearly flagged, not silently swallowed as empty
- Negative: `.env` file must be manually created by the user (template provided with comments)
