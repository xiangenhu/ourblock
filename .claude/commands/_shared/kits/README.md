# Skill Kits — installable runtime for code-bearing skills

Most `/team-*` skills are pure playbooks: copy the `.md` and they work in any app. A few skills
carry **actual runtime code** and can't transfer as prose alone. Those are packaged here as **kits**:
a self-contained directory with the runnable code, a one-command installer, and a complete spec.

## Layout (every kit follows this)

```
_shared/<name>-kit/
├── README.md      # the complete document: contract, install, invariants, verify
├── kit.json       # declares what to copy + the manual wiring steps (schema in ../kits/lib.mjs)
├── install.mjs    # thin shim → installKit(thisDir) so `node <kit>/install.mjs` works standalone
└── runtime/…      # the actual code (client/, server/, scripts/, public/, …)
```

## Install any kit — one interface

```bash
# list kits
node .claude/commands/_shared/kits/install.mjs --list

# install one into a target app
node .claude/commands/_shared/kits/install.mjs <kit> --app <dir> [--dry-run] [--force] [kit-flags]

# or run a kit's own shim directly
node .claude/commands/_shared/<kit>-kit/install.mjs --app <dir>
```

Common flags (all kits): `--app <dir>` (default cwd), `--dry-run`, `--force`,
and per-group dest overrides `--<group>-dir <path>` (group ids are in each `kit.json`).
Kit-specific flags (e.g. i18n's `--admin-tab`) are documented in that kit's README.

## Registry

| Kit | Skill | Carries |
|-----|-------|---------|
| `i18n` | `/team-i18n` | Hash i18n client+server, on-demand translation, Suggestion Mode |
| `showcase` | `/showcase` | 120s teaser timing engine + factsheet scaffold |
| `help` | `/team-help` | Contextual "?" help chip/card + Express routes |
| `bugfix` | `/team-bugfix` | Client+server error capture → BUG_LRS + CLI triage |
| `lecture-sync` | `/sync-lecture-urls` | MyLecture→class `lectureOverrides` script *(app-specific)* |
| `class-report` | `/class-report` | GCS learner/assessment report script *(app-schema-specific)* |

The kits marked *app-specific* assume this app's ecosystem (MyLecture API, our GCS journey schema);
they transfer to sibling apps that share those, not to arbitrary apps.

## Adding a new kit

1. `mkdir _shared/<name>-kit/runtime/…` and drop the code in.
2. Write `kit.json` (copy groups + wiring) — copy an existing kit's as a template.
3. Add the shim `install.mjs` (identical 4 lines in every kit — imports `../kits/lib.mjs`).
4. Write `README.md` (the complete spec).
5. Register it in `manifest.json`.
