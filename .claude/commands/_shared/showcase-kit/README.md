# showcase-kit — project intro pack scaffold

The runtime half of the `/showcase` skill: the **reusable machinery** behind the public intro pack
(120-second cinematic teaser + comprehensive factsheet), so a new app starts from a working engine
instead of rebuilding one. The `/showcase` skill is the *authoring* half — it fills these scaffolds
with content grounded in the actual codebase.

## What it installs

```
runtime/templates/                → <app>/showcase-templates/
  teaser-template.html      120s scene-based auto-play teaser. The <style>+<script> ENGINE is
                            content-agnostic (rAF-accumulated per-scene timing, progress bar,
                            scene dots, play/pause, m:ss clock, replay overlay, keyboard, reduced-
                            motion). 11 placeholder scenes whose durations already sum to 120.
  factsheet-template.html   One-page factsheet: hero + verified stat band + four sections
                            (Theory · Technology · Applications · Impacts) + CTA footer.
```

## Install

```bash
node .claude/commands/_shared/kits/install.mjs showcase --app <dir>
# or: node .claude/commands/_shared/showcase-kit/install.mjs --app <dir>
```

Lands both scaffolds in `<app>/showcase-templates/`. They are **not** finished pages.

## Finishing the pages — two paths

**A) Run `/showcase`** (recommended). It reproduces the full workflow: refresh `CLAUDE.md`, then
fill every `{{PLACEHOLDER}}` with content **grounded in the repo** (verified counts, real features —
never invented numbers), and write the final pages to the web root.

**B) By hand.** Replace the `{{PLACEHOLDERS}}`, then move to your served web root:
```
showcase-templates/factsheet-template.html  → <webroot>/factsheet.html
showcase-templates/teaser-template.html      → <webroot>/teasers/about.html
```

## Invariants (don't regress)

- **Teaser engine stays verbatim.** The `<style>` and `<script>` are content-agnostic; only edit
  scene markup. Total time + progress are computed from the DOM.
- **Scene `data-dur` values must sum to exactly 120.** Assert this after editing.
- **Keep the two closing CTA links** (fact sheet + open app); both paths must resolve — verify the
  static mount serves them ahead of any SPA catch-all.
- **Grounded content only.** Every number verified against the repo; "impacts" are grounded
  *mechanisms the design produces*, never measured study results or adoption/efficacy claims.
- **Self-contained.** Inline CSS/JS only — no external CDNs or network fonts. Add a self-hosted
  font `<link>` if the app has one; otherwise the CSS falls back to system serif/sans.

## Verify

- Scene durations sum to 120 (`node -e` over the `data-dur` values, or count by hand).
- Parse the teaser `<script>` with `@babel/parser` (script mode); no transpile.
- Both CTA paths (`/factsheet.html`, `/`) resolve to real pages, not the SPA fallback.

Full authoring guidance: the `/showcase` skill (`.claude/commands/showcase.md`).
