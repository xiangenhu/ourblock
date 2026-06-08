/**
 * env.js — load .env into process.env BEFORE anything reads config.
 *
 * Import this FIRST (before config.js) in every entrypoint (index.js, seed.js, tests).
 * In production (Cloud Run) there is no .env file — config comes from the real environment —
 * so a missing file is not an error.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
