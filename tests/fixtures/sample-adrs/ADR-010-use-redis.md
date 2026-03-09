---
id: ADR-010
status: accepted
affects:
  - src/
supersedes: ADR-005
---

# Use Redis for session caching

## Context
We need a fast key-value store for session data.

## Decision
Use Redis.

## Consequences
- Positive: sub-millisecond reads
- Negative: requires Redis infrastructure
