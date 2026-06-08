---
description: WCAG audit & accessibility remediation pass
argument-hint: [page path | all-pages | components]
---

# Team Accessibility

WCAG audit and accessibility hardening pass.

## Target: $ARGUMENTS
Options: page path | "all-pages" | "components"

## Workflow Phases

### Phase 1: Audit (Parallel)
- **Accessibility Compliance Checker**: WCAG 2.1 AA/AAA scan (axe-core or equivalent)
- **UX Consistency Specialist**: Focus order, color contrast, motion preferences
- **UI/UX Specialist**: Touch targets, mobile a11y, gesture alternatives

### Phase 2: Fix (Sequential)
- **UI/UX Specialist**: Apply remediations to components

### Phase 3: Verify (Sequential)
- **Accessibility Compliance Checker**: Re-scan and confirm

## Generic A11y Checklist

- [ ] All interactive elements have accessible labels (visible text or `aria-label`)
- [ ] Color contrast ≥ 4.5:1 (text) and 3:1 (UI components)
- [ ] Keyboard navigable — every interaction reachable without a mouse
- [ ] Visible focus indicators on custom components (don't rely on default)
- [ ] Form errors announced via `aria-live` or equivalent
- [ ] Modal dialogs trap focus and restore it on close
- [ ] RTL languages render correctly (`dir="rtl"` at the document or container level)
- [ ] Headings form a logical outline (no skipped levels)
- [ ] Images have meaningful `alt` text (or `alt=""` for decorative)
- [ ] Skip-to-content link on pages with significant nav
- [ ] Reduced-motion preference respected (`prefers-reduced-motion`)

## Output Format

```
## Accessibility Report

### Compliance Level
- Before: WCAG [level] — [N violations]
- After:  WCAG [level] — [N violations]

### Issues Fixed
- [WCAG criterion] — [component] — [fix]

### Issues Remaining
- [WCAG criterion] — [component] — [why deferred]

### Manual Verification Needed
- [item] — [test method]
```

- Learning-first UX (entry jargon, focus over density, in-place LLM help, tabs/modals): `@.claude/commands/_shared/learning-ux.md`
