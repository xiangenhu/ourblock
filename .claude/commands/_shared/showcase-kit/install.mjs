#!/usr/bin/env node
/**
 * showcase-kit installer (standalone shim).
 * Prefer:  node ../kits/install.mjs showcase --app <dir>
 * Direct:  node .claude/commands/_shared/showcase-kit/install.mjs --app <dir> [--force] [--dry-run]
 * Drops the teaser + factsheet SCAFFOLDS into <app>/showcase-templates/. Fill them
 * via the /showcase skill (or by hand) and move to your web root. See README.md.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { installKit } from '../kits/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await installKit(__dirname, process.argv.slice(2));
