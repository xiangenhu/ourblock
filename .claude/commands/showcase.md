---
description: Refresh CLAUDE.md and generate the public intro pack (factsheet + 120s teaser)
argument-hint: [all | claudemd | factsheet | teaser]
---

# Showcase — project intro pack

Produce (or refresh) the three artifacts that introduce this project, **grounded in the actual
codebase** — never invented numbers or claimed results. Reproduces the workflow: `/init` refresh →
comprehensive factsheet → 120-second teaser.

## Target: $ARGUMENTS
Run everything by default. Optional single phase: `claudemd` · `factsheet` · `teaser`.
(Empty or `all` → run all three phases in order.)

## Ground rules (apply to every phase)

- **Ground every claim.** Before writing any count, subject list, feature name, or capability, verify
  it against the repo — read the registry/manifest/router, run a quick `node -e`/`grep`/`ls` to count,
  check `package.json` scripts. If you can't verify a number, don't print it.
- **No fabricated outcomes.** Frame "impacts" as *mechanisms the design produces* (grounded in how the
  code works), never as measured study results, adoption metrics, or efficacy claims.
- **Self-contained, no build step, no external deps.** The `.html` artifacts must be a single file each
  with inline CSS/JS — no CDN scripts, no fonts fetched over the network, no bundler. (This project
  ships client code with no build step and self-hosts assets; honor that.)
- **Match the house aesthetic.** Reuse the existing palette/typography if the project already has one
  (e.g. an existing factsheet or landing page). Otherwise pick a clean, consistent visual system and
  use it across both HTML artifacts so they read as one product.
- **Find the web root first.** Detect where static files are served from (commonly `public/`; confirm
  via the server's `express.static(...)`/static-mount or framework convention). The factsheet must
  resolve at `/factsheet.html` and the teaser at `/teasers/about.html`. Verify the static mount is
  registered *before* any SPA catch-all so the nested file is actually served.
- **Verify edits without building.** Syntax-check server JS with `node --check`; parse client JS/JSX
  with `@babel/parser` (script mode). Do not transpile.

---

## Phase 1 — Refresh CLAUDE.md (`claudemd`)

Run the `/init` analysis. If `CLAUDE.md` already exists, **improve it in place** — do not rewrite a
good file. Read it, then verify each concrete claim against the current codebase and correct anything
stale (counts, script names, module/route names, structure). Add only what's missing and non-obvious
(architecture that requires reading multiple files, commonly-used commands, invariants). Keep the
required prefix header. Report exactly what you changed and why.

## Phase 2 — Comprehensive `/factsheet.html` (`factsheet`)

Create or update the factsheet at the web root (`<webroot>/factsheet.html`). One self-contained page
that introduces the app, organized under **four explicit sections**:

1. **Theory** — the ideas the product rests on and how each maps to a design decision (cite the school
   of thought, not fake studies).
2. **Technology** — capabilities + architecture (the real stack, invariants, chokepoints).
3. **Applications** — where it fits / who uses it / concrete use cases.
4. **Impacts** — what changes for each audience, framed as grounded mechanisms.

Also include: a hero, a stat band (all numbers verified against the repo), and a "how it works" flow if
the product has one. Add a short, honest footer. Make it responsive (grids collapse on mobile).

If a factsheet already exists, reuse its design language and only correct/extend it (re-verify every
number first — counts drift as the codebase grows).

## Phase 3 — `teasers/about.html` (`teaser`)

Create a **120-second, auto-playing cinematic teaser** at `<webroot>/teasers/about.html` — a timed,
scene-based presentation (the format of a product "teaser": scenes fade/advance on a timer, ending on a
replay screen). Requirements:

- **~10–12 scenes whose durations sum to exactly 120 seconds.** Put the duration on each scene
  (`data-dur` in seconds) and compute the total in JS from the DOM so it can't drift.
- A narrative arc: hook → problem → core idea → the central abstraction → how it works →
  why it's trustworthy → coverage (verified numbers) → capabilities → impact → brand close.
- **Controls:** a progress bar, clickable scene dots, play/pause, a live `m:ss / 2:00` clock, and a
  replay overlay at the end.
- **End the teaser with exactly two call-to-action links** in the replay overlay (alongside Replay):
  one to the fact sheet (`/factsheet.html`, e.g. "Read the fact sheet") and one that starts/opens the
  app at the root (`/`, e.g. "Open the app →"). Both must resolve — verify each path is served.
- **Keyboard:** Space = play/pause, ←/→ = previous/next scene.
- Kinetic type/entrance animations that run only while a scene is active; honor
  `prefers-reduced-motion`. Reuse the factsheet's palette so the two feel like one product.
- Drive timing with `requestAnimationFrame` accumulating elapsed time per scene (not a fixed
  `setInterval`), so pause/seek stay accurate.

## Verify (before reporting done)

- `node --check` each server file you touched; `@babel/parser` (script mode) on the teaser's `<script>`
  and any client JS.
- Assert the teaser scene durations sum to **120**.
- Confirm the static mount serves both new paths (they sit under the detected web root, ahead of any
  SPA catch-all).
- Confirm the teaser's two end links resolve: `/factsheet.html` and the app root `/` both return the
  real page (not the SPA fallback for the factsheet), so the closing call-to-action works.
- Summarize what you created/changed and the grounded numbers you used. Offer to commit & push and to
  link the artifacts from the landing page — do not commit unless asked.

## Installable runtime (transfer to another app)
The reusable machinery behind the pack — the 120s teaser timing engine and the factsheet scaffold —
is packaged as a kit so a new app starts from a working engine instead of rebuilding one:

> **Kit:** `@.claude/commands/_shared/showcase-kit/` (see its `README.md`).
> `node .claude/commands/_shared/kits/install.mjs showcase --app <dir>` drops
> `teaser-template.html` + `factsheet-template.html` into `<app>/showcase-templates/`; this skill
> then fills the `{{PLACEHOLDERS}}` with grounded content. Kit index: `_shared/kits/README.md`.
