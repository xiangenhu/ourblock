# Critical Evaluation — UALS Team Skills Bundle

*Reviewer note: this evaluates the bundle as Claude Code automation. Claims about Claude Code
behavior are dated and sourced at the end. Evidence, assumption, and inference are kept separate.*

---

## Executive summary

The bundle is a **well-designed, internally consistent set of 32 Claude Code slash commands** that
encode a "team of specialists in phased workflows" pattern. The prose is tight, the output
templates are genuinely useful, and the engineering principles are sound. Three problems hold it
back from production quality:

1. **It does not ship the thing it depends on.** Every command delegates to named subagents
   (*Architect*, *Security Specialist*, …) — **56 distinct personas, zero of them bundled.** In
   current Claude Code this is the difference between real delegation and the main agent
   role-playing the persona in-context. *(Evidence: full agent roster computed from the files;
   no `.claude/agents/` directory present.)*
2. **It violates its own DRY principle.** `team-architect` preaches "prefer ONE implementation;
   avoid parallel forks that drift," yet cache invariants, code-smell lists, the security
   checklist, and an entire i18n command are duplicated across files.
3. **It is almost entirely generic SWE, with the edtech domain barely represented.** For a
   *learning* app handling *minors'* data and *LLM-generated* instruction, the highest-risk
   surfaces — student-data compliance, AI content safety/age-appropriateness, output evaluation,
   and learning-efficacy measurement — were absent.

The revised bundle (this directory) fixes #2 and #3 directly and gives you the scaffolding to fix
#1. Net change: 31 deduplicated base commands + 5 new domain commands + an agents manifest.

---

## Key concepts (so the critique is unambiguous)

- **Slash command** = `.claude/commands/x.md`; user-invoked prompt template; `$ARGUMENTS` is the
  full trailing string. This is what the bundle is.
- **Skill** = `.claude/skills/x/SKILL.md`; model-*invocable* by description, supports supporting
  files and forking into subagents. In current Claude Code, **commands and skills have merged** —
  a command file and a skill of the same name both create `/x`. The README calls these "skills"
  but ships them as commands; the distinction matters for the recommendation below.
- **Subagent** = `.claude/agents/x.md`; isolated context window, scoped tools, own model; the
  worker a command delegates to. **Does not inherit the main system prompt.**

---

## What is good (keep)

- **Consistent skeleton** (Title → purpose → Target/$ARGUMENTS → phased workflow → principles →
  output template) makes the set learnable and composable.
- **Parallel/Sequential phase tags** map cleanly to "parallelize safe work, serialize risky work."
- **Output templates** are the strongest feature — they make results comparable across runs.
- **The project-specific commands** (`team-gcs`, `team-xapi`, `team-xgh-gateway`, hash-i18n) carry
  real institutional knowledge that generic tools can't.
- **Principles are correct and well-chosen** (cache-key determinism, targeted xAPI queries,
  online migrations, alert-on-symptoms).

---

## Findings

### A. Redundancy (resolved in v2)

| # | Overlap | Evidence | Resolution |
|---|---------|----------|------------|
| 1 | `team-i18n` vs `team-i18n-hash` | Hash file says it is "the preferred i18n pattern"; ~80% conceptual overlap | **Merged** into one `team-i18n`; generic kept as fallback section |
| 2 | Cache-key invariants | Restated in team-cache, team-content, team-performance, team-gcs | **Extracted** to `_shared/cache-invariants.md`; referenced via `@` |
| 3 | Code-smell / debt / dead-code lists | Restated across review, clean, debt, refactor | **Extracted** to `_shared/code-quality.md` + disambiguation table |
| 4 | Security baseline checklist | In team-security, partially echoed in feature/review | **Extracted** to `_shared/security-baseline.md` |
| 5 | Frontend perf | `team-load` ⊂ `team-performance` "Frontend" focus | **Kept both**, added delegation note (perf → load / test-load) |
| 6 | Load testing | `team-test-load` ≈ team-performance Phase 1 | **Kept both**, delegation note |

*Assumption:* the four quality commands (review/clean/debt/refactor) are intentionally distinct
verbs (assess / remove / prioritize / restructure), so they were disambiguated, not merged. If you
disagree, collapsing them into one `team-quality <mode>` is defensible.

### B. Structural / convention issues

| Issue | Evidence | Status |
|-------|----------|--------|
| No YAML frontmatter | None of the 32 files had it; `/`-picker shows the first body line | **Fixed** (description + argument-hint on all) |
| Inconsistent arg header | `## Target:` vs `## Scope:` vs `## Feature:` vs `## Incident:`; team-review buries `$ARGUMENTS` mid-file | Left as-is (cosmetic); flagged |
| Inconsistent agent prompts | Only team-review and team-security inline their agent prompts; the other 30 assume the agents exist | Root cause is the missing agents (§C) |
| Generic agent names | "Fullstack Developer" routes worse than job-shaped names | Manifest recommends kebab job-slugs |

### C. The missing agents (the functional blocker)

- **Evidence:** 56 distinct personas are referenced across the commands (see `agents/AGENTS.md`
  for the full computed table and which commands use each). The zip contained **no** agent
  definitions.
- **Inference:** without `.claude/agents/*.md`, a phrase like "launch the **Architect**" yields
  in-context role-play, not a delegated subagent. You lose the isolated context window, scoped
  tools, and cost control that justify the team metaphor.
- **Resolution (partial, by design):** v2 ships `agents/AGENTS.md` (manifest), a template, and 3
  exemplars. Authoring 56 quality system prompts requires your project conventions; that is the
  one task left to you.

### D. Gaps for an edtech / LLM learning app (resolved in v2)

| Gap | Why it matters here | New command |
|-----|---------------------|-------------|
| Student-data compliance | Minors' data under FERPA/COPPA/GDPR-K/PIPL is the top legal risk; team-security covers OWASP, not data protection | `team-privacy` |
| AI content safety / age-appropriateness | The app generates content and deploys VH agents to learners; needs red-teaming, factuality, age gating | `team-ai-safety` |
| LLM output evaluation | team-content only "sample-checks quality"; no golden set, rubric, or regression gate | `team-eval` |
| Learning-efficacy measurement | "Does it help learning?" is distinct from "is the output good?"; needs design + power + effect sizes | `team-efficacy` |
| LLM/cloud cost governance | token-heavy app; cost fails quietly | `team-cost` |

*Lower-priority gaps not added (deliberate):* a UDL/readability learning-design command (could fold
into team-a11y/team-ai-safety); a release/versioning command (partly in team-deploy); a `/team`
index/dispatcher for discoverability across 36 commands.

---

## Options & trade-offs for the one open decision (agents)

| Option | Pros | Cons / failure mode |
|--------|------|---------------------|
| **A. Author 56 subagents** (manifest-driven) | Maximum fidelity to the design; true isolation + scoped tools + per-agent model (haiku for scans, opus for judgment) | Most upfront work; risk of over-fragmentation and routing collisions |
| **B. Migrate commands → Skills with `context: fork`** | Runs a skill in isolation as a subagent without a separate agent file; fewer files; gains auto-invocation | Requires restructuring to `.claude/skills/`; less explicit control per worker |
| **C. Collapse to ~8–10 "super-agents"** that several commands share | Far fewer files; easier routing | Loses specialization the output templates assume |

*What would change the recommendation:* if you mostly invoke commands manually and rarely need
parallel isolated workers, B (or even keeping role-play) is fine and cheapest. If you want the
parallel-phase design to actually run in parallel isolated contexts, you need A.

---

## Recommendation

1. **Ship v2 as-is** for the dedup + frontmatter + new domain commands (immediate value, low risk).
2. **Adopt Option A for the ~12 highest-traffic agents first** (Architect, code-reviewer,
   vuln-scanner, dba, qa-testing, data-analyst, fullstack-developer, and the 5 new domain agents),
   using the template. Defer the long tail.
3. **Prioritize `team-privacy` and `team-ai-safety`** in your actual deployment path — they are the
   risk surfaces most likely to cause real harm or liability, and they are on-brand for your
   PERP / VHS-Ed work.

---

## Next steps (things you can hand me to refine this)

- Your real `.claude/agents/` (if any exist outside the zip) — I'll reconcile the manifest and stop
  recommending agents you already have.
- One example "good" subagent you've already written — I'll match its house style and draft the
  remaining 50+.
- Whether you want to migrate to `.claude/skills/` (Option B) — I'll convert the bundle and wire
  `context: fork`.
- The jurisdictions you actually deploy in — I'll trim `team-privacy` to the regimes that apply.

---

## Sources (dated)

- Claude Code — Slash commands (frontmatter: description, argument-hint, allowed-tools, model;
  `$ARGUMENTS`; `@`-file refs; `!`-bash): code.claude.com/docs/en/slash-commands (accessed 2026-05-30).
- Claude Code — Create custom subagents (`.claude/agents/*.md`; name/description/tools/model; do
  not inherit main system prompt): code.claude.com/docs/en/sub-agents (accessed 2026-05-30).
- Commands and skills have merged; skills add auto-invocation, supporting files, and `context:
  fork`: levelup.gitconnected.com mental-model guide (2026-03-04); antstack.com field guide
  (2026-03-09).
- Job-shaped subagent names route more reliably than generic role names: builder.io,
  "Claude Code Subagents" (2026-04-16).
