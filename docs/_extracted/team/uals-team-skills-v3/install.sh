#!/usr/bin/env bash
# UALS team-* skills installer (v3)
# Installs commands into <project>/.claude/commands/ (incl. _shared/) and
# subagent stubs into <project>/.claude/agents/.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_SKILLS="$SCRIPT_DIR/skills"
SRC_AGENTS="$SCRIPT_DIR/agents"
TARGET_PROJECT="${1:-$PWD}"
FORCE=0; for a in "$@"; do [ "$a" = "--force" ] || [ "$a" = "-f" ] && FORCE=1; done

[ -d "$SRC_SKILLS" ] || { echo "Error: skills/ not found next to install.sh" >&2; exit 1; }
[ -d "$TARGET_PROJECT" ] || { echo "Error: target does not exist: $TARGET_PROJECT" >&2; exit 1; }

CMD_DIR="$TARGET_PROJECT/.claude/commands"
AGT_DIR="$TARGET_PROJECT/.claude/agents"
mkdir -p "$CMD_DIR/_shared" "$AGT_DIR"
echo "Installing UALS team-* skills v3"
echo "  commands -> $CMD_DIR"
echo "  agents   -> $AGT_DIR"

copy() { # src dest
  local name; name="$(basename "$1")"
  if [ -e "$2/$name" ] && [ "$FORCE" -eq 0 ]; then echo "  skipped (exists): $name"; else cp "$1" "$2/$name"; echo "  installed: $name"; fi
}
for f in "$SRC_SKILLS"/team-*.md;      do [ -e "$f" ] && copy "$f" "$CMD_DIR"; done
for f in "$SRC_SKILLS"/_shared/*.md;   do [ -e "$f" ] && copy "$f" "$CMD_DIR/_shared"; done
for f in "$SRC_AGENTS"/*.md;           do [ -e "$f" ] && copy "$f" "$AGT_DIR"; done

echo
echo "Done. NOTE: agents/ ships a manifest (AGENTS.md) + 3 exemplars + a template."
echo "Author the remaining subagents listed in AGENTS.md, or the /team-* commands will"
echo "role-play personas in the main context instead of delegating to real workers."
echo "Re-run with --force to overwrite."
