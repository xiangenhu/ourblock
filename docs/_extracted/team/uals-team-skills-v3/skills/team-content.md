---
description: Generate/import/tune content via the LLM gateway
argument-hint: [generate <topic> | import <path> | tune-prompt <sys> | bulk-precache <scope>]
---

# Team Content

Generate, import, or tune content through a content-generation pipeline (e.g., an LLM gateway).

## Target: $ARGUMENTS
Options: "generate <topic>" | "import <path>" | "tune-prompt <system>" | "bulk-precache <scope>"

## Workflow Phases

### Phase 1: Plan (Sequential)
- **Content Generation**: Confirm content type, scope, target audience, language

### Phase 2: Generate / Import (Sequential)
- **Content Generation**: Route through the project's unified generation gateway
- For import: validate against the content schema; write to the configured store

### Phase 3: Verify (Sequential)
- **Content Generation**: Sample-check output quality and cache hit on second call

## Generic Content Pipeline Principles

- **Single gateway / entry point** for all generation requests — never call providers directly from feature code
- **Authoritative source for content metadata** is the store, not the cache — load fresh on each generation
- **Unified cache keys**: every call site producing the same logical request must hash identically
- **Per-language caching**: language is part of the cache key
- **Schema validation on import**: never accept content that doesn't match the expected structure
- **Versioning**: keep multiple versions of generated content for review / rollback
- **Cost / token tracking**: every generation logs its cost for budgeting

## Cache Key Composition (Typical)

Include: content-type identifier, primary subject/topic, parameters that change the output, language, any author-supplied customization
Exclude: session/runtime fields, request IDs, user-specific identifiers (unless the content is per-user)

## Output Format

```
## Content Report

### Generation Results
| Type | Subject | Cache Hit? | Tokens | Latency |
|------|---------|------------|--------|---------|

### Cache Verification
- Second call cache hit: [yes/no]
- Key: [key]

### Quality Spot-Checks
- [item] — [pass/concern]

### Imported (if applicable)
- Path: [store path]
- Mode: [replace/insert]
- Versions: [count]
```

## Shared references
Cache-key invariants are canonical here — do not restate them, reference them:
`@.claude/commands/_shared/cache-invariants.md`

## Project invariants
- GCS-only persistence (language files & generated content in GCS): `@.claude/commands/_shared/storage-invariants.md` · Role scoping: `@.claude/commands/_shared/roles.md`

- All model calls go through the single gateway (language + accounting centralized): `@.claude/commands/_shared/llm-gateway.md`

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
