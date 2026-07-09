#!/usr/bin/env node
/**
 * Generic kit installer — one entry point for every packaged skill kit.
 * ===========================================================================
 *   node .claude/commands/_shared/kits/install.mjs <kit> [--app <dir>] [flags]
 *   node .claude/commands/_shared/kits/install.mjs --list
 *
 * <kit> is a name from manifest.json (e.g. i18n, help, bugfix, showcase,
 * lecture-sync, class-report). Common flags: --app <dir>, --dry-run, --force,
 * plus per-kit flags documented in each kit's README (e.g. --admin-tab) and
 * per-group dest overrides (--<group>-dir <path>).
 *
 * Each kit can also be installed directly via its own shim: node <kit>/install.mjs
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { installKit } from './lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED = path.dirname(__dirname); // .claude/commands/_shared

const argv = process.argv.slice(2);
const manifest = JSON.parse(await fs.readFile(path.join(__dirname, 'manifest.json'), 'utf-8'));

if (argv[0] === '--list' || argv.length === 0) {
  console.log('\nAvailable kits:\n');
  for (const k of manifest.kits) {
    console.log(`  ${k.name.padEnd(14)} ${k.description}`);
    console.log(`  ${''.padEnd(14)} \x1b[2mskill: /${k.skill}\x1b[0m`);
  }
  console.log('\nInstall:  node .claude/commands/_shared/kits/install.mjs <kit> --app <dir>\n');
  process.exit(0);
}

const name = argv[0];
const entry = manifest.kits.find(k => k.name === name);
if (!entry) {
  console.error(`Unknown kit "${name}". Run with --list to see options.`);
  process.exit(1);
}

const kitDir = path.join(SHARED, entry.dir);
await installKit(kitDir, argv.slice(1));
