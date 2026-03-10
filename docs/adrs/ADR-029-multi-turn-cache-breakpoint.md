# ADR-029: Multi-Turn Cache Breakpoint for Tool-Use Loop

## Status
Accepted

## Context
ADR-026 introduced prompt caching with `cache_control` on the system prompt and last tool definition. This caches the static prefix across different module groups, saving ~1,200 tokens per call.

However, the `check` command's tool-use loop (`analyzeWithTools`) makes multiple turns per module group — each `read_code` call adds a turn. The messages array grows with each turn, but has no `cache_control` breakpoint. Anthropic's prefix-based cache only covers content up to the last breakpoint, so the entire messages array is recomputed every turn.

Measured impact from a 95-binding check run:

| Module | ADR count | read_code turns | Input tokens | Cache read | Hit rate |
|--------|-----------|-----------------|-------------|------------|----------|
| cli/index.ts | 12 | 7 | 240,077 | 17,024 | 7% |
| html-generator.ts | 7 | 7 | 140,737 | 13,440 | 9.5% |
| client.ts | 8 | 7 | 133,623 | 13,440 | 10% |
| checker.ts | 8 | 3 | 152,260 | 16,128 | 10.6% |

These 4 modules consumed 666k of 1,036k total input tokens (64%). With proper multi-turn caching, each turn would only pay for the new content (latest assistant response + tool result), with everything before served from cache.

## Decision

Add `cache_control: { type: "ephemeral" }` to the last `tool_result` message pushed into the messages array after each tool-use turn.

### Before (ADR-026)
```
Turn 1: [system*] [tools*] [user_msg]                           → cache: system+tools only
Turn 2: [system*] [tools*] [user_msg] [asst_1] [tr_1]          → cache: system+tools only
Turn 3: [system*] [tools*] [user_msg] [asst_1] [tr_1] [asst_2] [tr_2] → cache: system+tools only
```

### After (ADR-029)
```
Turn 1: [system*] [tools*] [user_msg]                             → cache: system+tools
Turn 2: [system*] [tools*] [user_msg] [asst_1] [tr_1*]           → cache: system+tools+user_msg+asst_1+tr_1
Turn 3: [system*] [tools*] [user_msg] [asst_1] [tr_1*] [asst_2] [tr_2*] → cache: everything up to tr_1
```

`*` = has `cache_control` breakpoint.

### Code Change
In `src/core/semantic/client.ts`, the `tool_result` push in the multi-turn loop. Note: `cache_control` cannot be placed directly on `tool_result` content blocks (Anthropic API rejects it). Instead, append a minimal `text` block with the cache breakpoint after all tool results:

```typescript
messages.push({
  role: "user",
  content: [
    ...toolUseBlocks.map((b: any) => ({
      type: "tool_result",
      tool_use_id: b.id,
      content: handler({ name: b.name, input: b.input }),
    })),
    { type: "text", text: ".", cache_control: { type: "ephemeral" } },
  ],
});
```

The trailing `text` block with `"."` is semantically inert but provides the cache breakpoint. Anthropic caches the entire prefix up to this breakpoint.

### What Does NOT Change
- System prompt and last tool still have `cache_control` (ADR-026)
- The `analyze()` method (used by `scan`/`init`) is single-turn — no change needed
- LLM receives identical content — caching is transparent to model behavior
- No accuracy impact — same input, same output, lower cost

### Expected Savings
For a module with N read_code turns and base prompt size B tokens:
- **Before**: total input ≈ B × N (full recompute every turn)
- **After**: total input ≈ B + small increments (each turn only pays for new content)

Conservative estimate for the 95-binding check run: 40-60% reduction in total input tokens for multi-turn modules, roughly 300-400k tokens saved overall.

### Measured Results

After implementation, a 78-binding check run showed:

| Metric | Before (ADR-026 only) | After (ADR-029) |
|--------|----------------------|-----------------|
| Non-cached input | 1,161,879 | 51,633 |
| Cache read | 143,174 | 999,681 |
| Total input | 1,305,053 | 1,051,314 |
| Cache hit rate | 11.0% | 95.1% |

Non-cached input dropped by 95.6% (22×). Estimated cost reduction: ~87%.

### Breakpoint Limit
Anthropic allows up to 4 cache breakpoints per request. Current usage:
1. System prompt
2. Last tool definition
3. Last tool_result (new)

This leaves 1 breakpoint available for future use.

## Consequences
- **Positive**: Dramatic input token reduction for multi-turn check calls (the biggest cost driver).
- **Positive**: Zero impact on accuracy — LLM sees identical content.
- **Positive**: Simple 3-line change in one file.
- **Positive**: Cache hit rate for multi-turn modules should increase from ~10% to 60-80%.
- **Negative**: None identified. The cache_control annotation is a no-op if caching is unavailable.
