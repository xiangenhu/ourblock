/**
 * Shared kit installer library.
 * ===========================================================================
 * Every packaged skill kit under `.claude/commands/_shared/<name>-kit/` declares
 * a `kit.json` and delegates its `install.mjs` to `installKit()` here, so all
 * kits install the same way with the same flags. See `_shared/kits/README.md`.
 *
 * kit.json schema:
 * {
 *   "name": "i18n",                     // kit id (dir is <name>-kit)
 *   "skill": "team-i18n",               // owning slash-command
 *   "description": "…",                 // one line
 *   "requires": ["GCS_BUCKET_NAME"],    // env/preconditions (printed, not enforced)
 *   "copy": [
 *     { "id": "client",                 // group id → overridable via --client-dir
 *       "from": "runtime/client",       // source dir (relative to kit dir)
 *       "to": "client/src/i18n",        // default dest (relative to --app)
 *       "files": ["a.js", "b.jsx"],
 *       "optionalFiles": { "AdminTab.jsx": "admin-tab" },  // include only if --admin-tab
 *       "seedOnly": false               // if true: never overwrite (even with --force)
 *     }
 *   ],
 *   "wiring": ["1. …", "2. …"]          // manual steps printed after copy
 * }
 */

import { promises as fs } from 'fs';
import path from 'path';

const C = { g: '\x1b[32m', y: '\x1b[33m', c: '\x1b[36m', d: '\x1b[2m', r: '\x1b[31m', x: '\x1b[0m', b: '\x1b[1m' };

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) { flags[key] = true; }
    else { flags[key] = next; i++; }
  }
  return flags;
}

export async function readKit(kitDir) {
  const raw = await fs.readFile(path.join(kitDir, 'kit.json'), 'utf-8');
  return JSON.parse(raw);
}

/**
 * Install a kit into a target app.
 * @param {string} kitDir  absolute path to the kit directory (contains kit.json)
 * @param {string[]} argv  process.argv.slice(2)
 */
export async function installKit(kitDir, argv = []) {
  const flags = parseArgs(argv);
  const app = path.resolve(flags.app || '.');
  const dryRun = !!flags['dry-run'];
  const force = !!flags.force;
  const kit = await readKit(kitDir);

  const log = (...a) => console.log(...a);
  log(`\n${C.b}${kit.name}-kit${C.x} ${C.d}— ${kit.description}${C.x}`);
  log(`${C.d}target app: ${app}${dryRun ? '   (DRY RUN)' : ''}${C.x}\n`);

  try { await fs.access(app); }
  catch { log(`${C.r}Target app path does not exist: ${app}${C.x}`); process.exit(1); }

  let written = 0, skipped = 0;

  for (const group of kit.copy || []) {
    const dest = path.resolve(app, flags[`${group.id}-dir`] || group.to);
    log(`${C.b}${group.id} →${C.x} ${path.relative(app, dest) || '.'}`);

    const files = [...(group.files || [])];
    for (const [file, flag] of Object.entries(group.optionalFiles || {})) {
      if (flags[flag]) files.push(file);
    }

    for (const file of files) {
      const src = path.join(kitDir, group.from, file);
      const dst = path.join(dest, file);
      const rel = path.relative(app, dst);
      let exists = false;
      try { await fs.access(dst); exists = true; } catch { /* new */ }

      if (exists && (group.seedOnly || !force)) {
        log(`  ${C.y}skip${C.x} ${rel} ${C.d}(exists${group.seedOnly ? '' : '; --force to overwrite'})${C.x}`);
        skipped++; continue;
      }
      if (dryRun) { log(`  ${C.c}would write${C.x} ${rel}`); written++; continue; }
      await fs.mkdir(path.dirname(dst), { recursive: true });
      await fs.copyFile(src, dst);
      log(`  ${group.seedOnly ? `${C.g}seed` : `${C.g}write`}${C.x} ${rel}`);
      written++;
    }
    log('');
  }

  log(`${C.d}${written} written/planned · ${skipped} skipped${C.x}`);

  if (kit.requires?.length) {
    log(`\n${C.b}Requires:${C.x} ${kit.requires.join(', ')} ${C.d}(preconditions — not auto-checked)${C.x}`);
  }
  if (kit.wiring?.length) {
    log(`\n${C.b}${C.c}━━ Manual wiring (installer can't safely do these) ━━${C.x}\n`);
    for (const step of kit.wiring) log(step);
  }
  log(`\n${C.b}Full spec:${C.x} ${C.d}${path.relative(app, path.join(kitDir, 'README.md'))}${C.x}\n`);
  return { written, skipped };
}
