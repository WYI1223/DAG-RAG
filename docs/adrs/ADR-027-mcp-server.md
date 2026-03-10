# ADR-027: MCP Server for IDE Integration

## Status
Accepted

## Context
ligare is a CLI tool. To integrate with AI-powered IDEs (Claude Code, Cursor, etc.), we need to expose ligare's capabilities as callable tools. The Model Context Protocol (MCP) is the standard interface for this — it lets LLM clients discover and invoke external tools over stdio.

Two integration strategies were considered:
1. **ligare as MCP Server** — expose DAG queries and drift checking as MCP tools
2. **ligare as MCP Client** — consume external MCP servers (code search, Jira, CI) during analysis

Strategy 1 is immediately useful; strategy 2 has no current demand and can be added later without conflict.

## Decision

### Transport
stdio — the standard MCP transport. Claude Code spawns `ligare-mcp` as a child process.

### Entry Point
`src/mcp/server.ts` — parallel to `src/cli/index.ts`. Both consume the same `src/core/` modules. New bin entry in package.json: `"ligare-mcp": "./dist/mcp/server.js"`.

### Tools

| Tool | Parameters | Needs LLM | Returns |
|------|-----------|-----------|---------|
| `ligare_status` | `root?` | No | DAG stats (node/edge counts, latest snapshot summary) |
| `ligare_impact` | `target`, `root?` | No | Governing ADRs, affected modules, dependency subgraph |
| `ligare_bindings` | `target?`, `root?` | No | Binding list with metadata (ADR id, module id, edge kind, last check status). No code content — the IDE model reads files itself if needed. |
| `ligare_check` | `target?`, `changed?`, `ref?`, `root?` | Yes | Drift detection results (status, reason per binding). Uses `LIGARE_ANTHROPIC_KEY`. Synchronous — blocks until complete. |

### Design Principles
1. **Metadata-only for read tools**: `status`, `impact`, `bindings` return structured data only. They do not read source code or ADR bodies — the IDE's own model has file access and can read what it needs. This keeps tool responses small and fast.
2. **Synchronous check**: `ligare_check` blocks until LLM analysis completes. MCP tool calls are inherently synchronous. In practice, targeted checks (`target` or `--changed`) complete in seconds. Full project checks should use the CLI directly.
3. **Two API keys, separate concerns**: The IDE model (Claude Code subscription) decides when to call tools. ligare's `check` tool uses its own `LIGARE_ANTHROPIC_KEY` for drift detection LLM calls. Read-only tools consume no LLM tokens.
4. **No MCP consumption (yet)**: ligare does not consume external MCP servers. The existing `read_code` tool in the check pipeline is sufficient. External MCP consumption (Jira, CI) is a future concern.

### Dependency
`@modelcontextprotocol/sdk` — the official MCP TypeScript SDK.

### Claude Code Configuration
```json
{
  "mcpServers": {
    "ligare": {
      "command": "npx",
      "args": ["ligare-mcp"],
      "env": {
        "LIGARE_ANTHROPIC_KEY": "sk-ant-..."
      }
    }
  }
}
```

## Consequences
- **Positive**: Any MCP-compatible IDE can query DAG status, run impact analysis, and trigger drift checks without leaving the editor.
- **Positive**: Read-only tools are free (no LLM cost) and fast (JSON file read + graph traversal).
- **Positive**: `ligare_bindings` + IDE model = "free" drift analysis using the IDE's own LLM context, no separate API key needed for casual queries.
- **Negative**: `ligare_check` requires `LIGARE_ANTHROPIC_KEY` configured in the MCP server environment.
- **Negative**: Full project check via MCP may be slow (minutes). Recommended to use CLI for full checks.
