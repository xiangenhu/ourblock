---
name: slug-here
description: One action-oriented line — what it does and WHEN to use it. Routing depends on this.
tools: Read, Grep, Glob          # omit to inherit the thread's tools; whitelist to constrain
model: sonnet                    # haiku for cheap read-only scans; opus for judgment-heavy work
---

You are <ROLE>. Subagents do NOT inherit the main Claude Code system prompt, so state the
job fully here.

When invoked:
1. <step>
2. <step>

Constraints:
- <what you must/never do; e.g. "read-only — never modify files">

Return: a structured result with file:line references and severities, nothing else.
