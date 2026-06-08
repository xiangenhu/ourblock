# Shared Reference: Learning-First UX (attention is the scarce resource)

**Project invariant.** This is a *learning* app: the interface exists to move attention to content,
not to display the product. Canonical here; pulled into ux, a11y, content, feature, help, architect,
review, docs via `@.claude/commands/_shared/learning-ux.md`. These are design *constraints*, checked
like any other invariant — not aesthetic preferences.

> **Grounding (why these, not taste).** They operationalize cognitive-load theory: working memory is
> narrow, so the interface must minimize **extraneous load** (anything not the learning task) to
> protect capacity for **germane load** (the thinking that builds understanding). "Attractiveness =
> low time-to-content + sustained focus," not visual density.

## The four principles (each with a testable rule)

### P1 — No jargon at entry (progressive vocabulary)
The landing/entry experience speaks the **learner's** language. Domain/system terms (the platform's
internal names, acronyms, pedagogical jargon) are introduced *after* the user is oriented, with a
plain-language gloss on first use.
- ✅ "Practice what you're learning and get feedback."  ❌ "EMT-tailored SATA remediation via the LRS."
- **Rule:** entry-screen copy passes a plain-language check (target reading level for the audience
  band — see `/team-ai-safety` age bands); every specialized term has a first-use definition or tooltip.
- **Boundary:** expert/admin surfaces may use precise terms; this rule is strongest at first contact
  and for learner-facing pages.

### P2 — Attractiveness = ease of reaching content, not amount displayed
Optimize **time-to-content** and **focus retention**, not information density. Every element on a
learning screen must earn its place by serving the current task; everything else is *distraction*.
- **Rule (distraction budget):** on a focused learning screen, count elements competing for attention
  (secondary nav, promos, unrelated widgets, decorative motion). Non-essential competing elements →
  remove, defer, or move behind a tab/modal. Default to fewer.
- **Metric:** clicks/scrolls from entry to first meaningful content (target: minimal); primary content
  is above the fold and visually dominant.
- **Anti-pattern:** dashboards that show everything "so it looks powerful." Power = the learner gets to
  the task fast and stays in it.

### P3 — LLM help is present wherever the user produces or judges work
Any interface where the user **works on something** — writes, critiques, revises, evaluates, plans —
must offer LLM assistance **in place**, not as a separate destination. The contextual-help assistant
(`/team-help`) is the baseline; production/critique surfaces add task-scoped help (e.g. "suggest a
revision", "explain this critique", "what am I missing?").
- **Rule:** every create/critique/revise/evaluate view has an affordance that routes through the single
  gateway (`@.claude/commands/_shared/llm-gateway.md`) with the on-screen artifact as context.
- **Pedagogy guard:** help **scaffolds**, it does not do the work for the learner — tour-guide/coach,
  not ghost-writer (see `/team-ai-safety`). Suggest, prompt, explain; let the learner act.
- **Privacy:** learner artifacts may contain PII; redact before send and do **not** pool-cache
  personalized work (see `/team-privacy`, cache-invariants).

### P4 — Tabs and modals to enforce single-task focus
Use **tabs** to show the current thing and hide the rest; use **modal popups** to give the current task
exclusive attention. Prefer revealing detail in place over navigating away (which loses context).
- **Rule:** when a screen has parallel sections, default to tabs (one visible) rather than one long
  scroll of everything. For a discrete task (compose, confirm, review one item), default to a modal
  that dims the background.
- **Boundaries (where modals HURT — do not over-apply):**
  - Don't stack modals (modal-in-modal); collapse to one task.
  - Don't trap multi-step or long-form work in a modal where context is needed alongside — use a
    focused page or a side panel instead.
  - A modal must be dismissible and **accessibility-correct**: focus trap + return, `Esc` to close,
    `aria-modal`, background `inert` (see `/team-a11y`).
  - Tabs must be keyboard-navigable and preserve state when switching.

## How the principles interact (resolve conflicts in this order)
1. **Accessibility is never traded away** (P4's focus mechanics must remain WCAG-correct — `/team-a11y`).
2. **Pedagogy over engagement** (P3 scaffolds; never maximize time-on-app at the cost of learning).
3. **Focus over density** (P2) — when in doubt, remove.
4. **Plain language at entry** (P1) unless on an expert/admin surface.

## Audit checklist (what `/team-ux` and `/team-review` verify)
- [ ] Entry/landing copy: no unglossed jargon; plain-language pass for the audience band (P1)
- [ ] Focused screens: distraction budget respected; primary content dominant; low time-to-content (P2)
- [ ] Every create/critique/revise/evaluate view: in-place LLM help via the gateway; scaffolds not solves (P3)
- [ ] Parallel sections use tabs; discrete tasks use modals; no modal-stacking; long work not modal-trapped (P4)
- [ ] All focus mechanics keyboard- and screen-reader-correct (P4 × a11y)
