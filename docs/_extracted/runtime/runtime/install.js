#!/usr/bin/env node
'use strict';
/**
 * install.js — Node installer for the team-* Claude Code skills (cross-platform).
 * Copies commands, _shared refs/specs, and agent stubs into a target project's .claude/.
 *
 *   node runtime/install.js [/path/to/project] [--force]
 *   (defaults to CWD)
 */
const fs = require('fs');
const path = require('path');

const BUNDLE = path.resolve(__dirname, '..');          // runtime/ lives inside the bundle
const SRC_CMDS = path.join(BUNDLE, 'skills');
const SRC_SHARED = path.join(SRC_CMDS, '_shared');
const SRC_AGENTS = path.join(BUNDLE, 'agents');

const args = process.argv.slice(2);
const force = args.includes('--force') || args.includes('-f');
const target = path.resolve(args.find((a) => !a.startsWith('-')) || process.cwd());

if (!fs.existsSync(SRC_CMDS)) { console.error('skills/ not found next to runtime/'); process.exit(1); }
if (!fs.existsSync(target)) { console.error('target does not exist:', target); process.exit(1); }

const CMD_DIR = path.join(target, '.claude', 'commands');
const SHARED_DIR = path.join(CMD_DIR, '_shared');
const AGT_DIR = path.join(target, '.claude', 'agents');
[CMD_DIR, SHARED_DIR, AGT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

let installed = 0, skipped = 0;
function copy(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  if (fs.existsSync(dest) && !force) { console.log('  skipped (exists):', path.basename(src)); skipped++; return; }
  fs.copyFileSync(src, dest); console.log('  installed:', path.relative(target, dest)); installed++;
}
const md = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));

console.log('Installing UALS team-* skills (node) into', path.join(target, '.claude'));
md(SRC_CMDS).forEach((f) => copy(f, CMD_DIR));            // team-*.md
fs.readdirSync(SRC_SHARED).forEach((f) => copy(path.join(SRC_SHARED, f), SHARED_DIR)); // refs + specs (.md)
if (fs.existsSync(SRC_AGENTS)) md(SRC_AGENTS).forEach((f) => copy(f, AGT_DIR));

console.log(`\nDone. installed=${installed} skipped=${skipped}`);
console.log('Skill commands pull shared docs via @.claude/commands/_shared/… (project-root-relative).');
console.log('Author the remaining subagents listed in .claude/agents/AGENTS.md.');
console.log('For the RUNTIME backbone: `npm install` this package, then wire mount() per runtime/README.md.');
