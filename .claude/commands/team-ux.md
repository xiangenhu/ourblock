---
description: End-to-end UX design & audit
argument-hint: [audit | journey <name> | component <name> | redesign <page>]
---

# Team UX

Design and audit end-to-end user experience (UI + journey + consistency + cross-platform).

## Target: $ARGUMENTS
Options: "audit" | "journey <name>" | "component <name>" | "redesign <page>"

## Workflow Phases

### Phase 1: Discovery (Parallel)
- **User Journey Specialist**: Map flow, identify friction and drop-off
- **UX Consistency Specialist**: Style / component drift, design-token violations
- **Cross-Platform Specialist**: Mobile / tablet / desktop parity
- **UI/UX Specialist**: Component-level usability

### Phase 2: Design (Sequential)
- **UI/UX Specialist**: Propose changes

### Phase 3: Implement (Sequential)
- **UI/UX Specialist**: Apply changes via the project's component system

## Generic UX Principles

- **Components from a shared design system** — no one-off styled elements
- **Safe dynamic rendering** — never inject untrusted HTML; use the framework's safe primitives
- **i18n by default** — every visible string routes through the translation layer
- **Consistent state visibility** — auth state, loading, errors expressed the same way everywhere
- **Mobile-first responsive** — primary breakpoint is small, then enhance for larger
- **Progressive enhancement** — core flow works without JS-heavy features when possible
- **Loading states for every async operation** — never leave the user staring at a blank screen

## Output Format

```
## UX Report

### Friction Points
- [step] — [issue] — [proposed fix]

### Consistency Violations
- [component] — [violates token / pattern]

### Cross-Platform Issues
- [breakpoint] — [issue]

### Implemented
- [change]

### Deferred (Needs Stakeholder Input)
- [change] — [decision needed]
```

## Project invariants
- Three role-based journeys (Admin console / Educator dashboard / Learner experience), re-checked server-side: `@.claude/commands/_shared/roles.md`

## Learning-First UX (project invariant)
This is a learning app — the interface moves attention to content, not to itself. Enforce the four
principles in `@.claude/commands/_shared/learning-ux.md`:
- **P1 No entry jargon** — landing speaks the learner's language; terms glossed on first use.
- **P2 Ease over density** — minimize time-to-content and distraction; primary content dominant.
- **P3 In-place LLM help** — every create/critique/revise/evaluate view offers gateway-routed help that *scaffolds*, not solves.
- **P4 Tabs + modals for focus** — current task visible, rest hidden; modals give exclusive focus (and stay a11y-correct).

### Phase 0: Learning-UX gate (Sequential — run first)
- **Learning Scientist**: Distraction budget per focused screen; time-to-content; entry-jargon scan.
- **UI/UX Specialist**: Tabs/modals applied for focus; in-place LLM affordance on every work surface.
- **Accessibility Compliance Checker**: Modal focus-trap/Esc/`aria-modal`/`inert`; tab keyboard nav (see `/team-a11y`).
