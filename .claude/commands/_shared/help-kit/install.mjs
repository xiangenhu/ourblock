#!/usr/bin/env node
/**
 * help-kit installer (standalone shim).
 * Prefer:  node ../kits/install.mjs help --app <dir>
 * Direct:  node .claude/commands/_shared/help-kit/install.mjs --app <dir> [--force] [--dry-run]
 * Reads kit.json in this directory; logic lives in ../kits/lib.mjs.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { installKit } from '../kits/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await installKit(__dirname, process.argv.slice(2));
