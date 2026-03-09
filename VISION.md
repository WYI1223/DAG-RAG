# Vision

## The Problem We're Really Solving

Software has two parallel histories that almost never talk to each other.

The first history lives in Git: every line of code ever written, every change, every revert. It is complete, precise, and utterly silent about meaning.

The second history lives in people's heads, in Confluence pages, in Slack threads that scroll away: why the code is structured the way it is, what was tried and rejected, what constraints the current architecture is operating under. This history is fragile. It leaves when people leave. It degrades silently as the codebase changes around it.

`adr-graph` exists to make the second history as durable as the first.

---

## The Core Belief

**Design intent and implementation are two parts of the same artifact.**

A codebase without recorded decisions is like a city without zoning laws — structures get built wherever is convenient, without regard for what was supposed to go there. The result isn't chaos immediately. It's gradual, invisible erosion: systems that become harder to change, decisions that get made again and again because no one remembers they were already made, and engineers who spend hours reading code just to understand a constraint that should have been written down in a sentence.

The traditional answer to this is documentation. Write more ADRs. Keep them updated. Review them in planning meetings. This answer fails in practice because it treats documentation as a separate activity from development, and separate activities get deprioritized under pressure. The result is a documentation graveyard: pages that were accurate once, are now quietly wrong, and no one knows which parts to trust.

The right answer is to eliminate the gap between documentation and code entirely. Not by generating documentation from code (which loses intent), but by making **ADR + code the single source of truth**. ADRs are small, they record decisions not implementations, and they are maintainable precisely because they don't try to describe everything. The code describes the how. The ADR describes the why. Together they are complete. Separately, neither is sufficient.

`adr-graph` exists to keep these two halves bound together — so tightly that the moment they diverge, the gap becomes visible.

---

## Who This Is For

`adr-graph` does not prescribe how your ADRs are written or where they come from. You can write them by hand, extract them from design discussions, or generate drafts with an AI assistant and refine them. The tool only cares about what happens after an ADR exists: whether the code that is supposed to implement it still does.

### The AI-augmented developer

A growing number of developers work primarily by directing AI assistants: specifying intent, reviewing output, steering toward goals. This is a fundamentally different workflow from line-by-line authorship, and it creates a new class of problem.

When an AI modifies code, it works from the context it was given. It does not know that the auth module is structured the way it is because of a security decision made eight months ago. It does not know that the payment processor must not be called directly from the frontend because of a compliance constraint. It makes locally reasonable changes that are globally wrong — not because it is unintelligent, but because it is uninformed.

`adr-graph` solves this by making architectural constraints machine-readable and queryable. Before you hand a piece of code to an AI assistant, you can extract the exact constraints that govern it. After the AI makes changes, you can detect automatically whether any of those constraints have been violated.

This is not a workflow for generating better prompts. It is infrastructure for making AI-assisted development architecturally safe.

### The Tech Lead

A Tech Lead's decisions travel through an imperfect transmission chain: from intent, to document, to team member's interpretation, to code. At every step there is loss. The team member fills gaps with assumptions. Those assumptions get encoded in the codebase and become the de facto architecture — which may or may not be what the Tech Lead intended.

`adr-graph` gives Tech Leads a new capability: **proactive impact analysis**. Before a decision is finalized, they can see which parts of the codebase it would affect, which existing decisions it would supersede or conflict with, and which teams would need to be involved. After a decision is made, they can see whether it is actually being implemented as intended.

The underlying problem — semantic loss in transmission — is the same as the AI-augmented developer's problem. The decision-maker has intent. The implementer has partial context. The gap between them is where architectural drift is born.

---

## What We Are Not Building

**A documentation generator.** Tools that generate documentation from code solve the wrong problem. They capture structure, not intent. If the code is already wrong, the documentation will faithfully document the wrongness.

**A linter.** Linters enforce syntactic or stylistic rules. Architectural drift is a semantic problem. "This function is 50 lines long" is a linting concern. "This module is no longer implementing the decision that governs it" is a semantic concern.

**A project management tool.** ADRs are not tickets. They are not assigned, estimated, or tracked for completion. They are records of reasoning, not units of work.

**A replacement for Git.** `adr-graph` is a layer above Git, not a replacement for it. Every semantic snapshot is anchored to a Git commit. The code history and the semantic history are permanently linked.

---

## The Long-Term Picture

The immediate product is a CLI tool for TypeScript projects. The long-term picture is larger.

A codebase with a complete semantic history becomes a different kind of artifact. You can ask questions like:

- *Which decisions have the most code depending on them?* (architectural load-bearing decisions)
- *Which decisions have never been superseded?* (stable foundations vs. forgotten constraints)
- *What was the architectural state of this system on the day we launched v2?* (historical context for incident analysis)
- *Which parts of the codebase have the most semantic drift?* (technical debt as a measurable quantity, not a feeling)

These are questions that currently have no answers — not because the information doesn't exist, but because it has never been organized. `adr-graph` is the infrastructure for organizing it.

The further horizon is a world where AI coding assistants are architecturally aware as a baseline — where the context window always includes the relevant constraints, where drift is detected before it is merged, where the gap between intent and implementation is a tracked metric rather than an invisible accumulation.

That world requires infrastructure that doesn't exist yet. `adr-graph` is one piece of that infrastructure.

---

## Design Principles

**Certainty must be earned.** The system distinguishes structurally-derived facts (certain) from semantically-inferred conclusions (inferred). This distinction is never hidden from the user. Trust is built incrementally, not assumed.

**Low friction is a correctness requirement.** A tool that requires significant maintenance will not be maintained. Any feature that creates ongoing manual work will eventually be abandoned, making the system worse than if the feature had never existed. If something can be automated, it must be automated. If something requires human input, the input surface must be as small as possible.

**The graph belongs to the repository.** Semantic history is not a cloud service or a separate database. It lives in `.adr-graph/`, versioned alongside the code, checkpointable, diffable, and permanently linked to the Git history it annotates.

**Explicit is better than inferred.** Where a developer takes the time to declare a binding explicitly — through ADR frontmatter, through a confirmation prompt — that binding is more valuable than any LLM inference. The system should always make it easy to be explicit, and should treat explicit bindings with higher trust than inferred ones.

**Show the uncertainty.** When the system is unsure — when a drift conclusion is based on LLM inference rather than structural analysis — it says so. Confidence scores are not hidden in logs. They are visible in the output, so users can calibrate their trust appropriately.
