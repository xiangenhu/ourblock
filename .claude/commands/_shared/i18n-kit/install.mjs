#!/usr/bin/env node
/**
 * i18n-kit installer (standalone shim).
 * Prefer:  node ../kits/install.mjs i18n --app <dir>
 * Direct:  node .claude/commands/_shared/i18n-kit/install.mjs --app <dir> [--admin-tab] [--force] [--dry-run]
 * Reads kit.json in this directory; logic lives in ../kits/lib.mjs.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { installKit } from '../kits/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await installKit(__dirname, process.argv.slice(2));
