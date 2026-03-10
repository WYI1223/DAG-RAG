# ADR-026: Prompt Caching for Token Cost Reduction

## Status
Accepted

## Context
The `check` command sends repeated LLM requests — one per module group — sharing an identical system prompt (~900 tokens) and identical tool definitions (~300 tokens). In multi-turn conversations (read_code tool loops), the system + tools + prior messages are re-sent every turn. This redundancy inflates input token costs linearly with the number of modules and turns.

Anthropic's Prompt Caching feature lets us mark prefix segments with `cache_control: { type: "ephemeral" }`. On subsequent requests within the same session (~5 min TTL), cached prefixes are served from KV cache at 90% reduced cost (and lower latency).

## Decision
1. **Static-first, dynamic-last layout**: system prompt and tool definitions are placed at the top of every request (already the case). These are marked as cacheable breakpoints.
2. **Two cache breakpoints**:
   - System prompt: `system: [{ type: "text", text: CHECK_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]`
   - Last tool definition: tools array's final element gets `cache_control: { type: "ephemeral" }`
3. **Cache token monitoring**: track `cache_read_input_tokens` and `cache_creation_input_tokens` from `response.usage` alongside existing `input_tokens` / `output_tokens`. Surface these in CLI summary output.
4. **Provider compatibility**: only Anthropic direct API guarantees prompt caching. Bedrock/Vertex/compatible providers may silently ignore `cache_control`. We add the fields unconditionally — unsupported providers simply return 0 for cache fields.

## Consequences
- **Cost**: ~90% reduction on cached input tokens. For a 10-module check run, first module pays full price (~1200 system+tool tokens), remaining 9 modules get cache hits.
- **Latency**: cached prefix skips KV computation, reducing TTFT.
- **Observability**: CLI now shows `cache read: N tokens` alongside existing token metrics, letting users verify caching is working.
- **No behavioral change**: caching is transparent to the LLM — identical outputs regardless of cache hit/miss.
