#!/usr/bin/env node
'use strict';
/**
 * bug-triage.js — read/triage bugs from the BUG_LRS (BUG_TRACKING_AND_FIXING.md §7).
 * Fix log lives in GCS (shared across CLI + admin tab), not a local file.
 *
 *   node scripts/bug-triage.js --since 24h
 *   node scripts/bug-triage.js --mark-fixed <id> "note"
 *   node scripts/bug-triage.js --dismiss   <id> "reason"
 *   node scripts/bug-triage.js --reset
 *   node scripts/bug-triage.js            # minimal interactive menu
 */
const fs = require('fs');
const path = require('path');
const { fetchBugs } = require('../src/bug/fetch');
const fixlog = require('../src/bug/fixlog');

const REPORT_PATH = path.resolve(process.cwd(), 'bug-triage-report.md');

function renderReport({ since, bugs, summary }) {
  const lines = [`# Bug Triage Report`, ``, `- Since: ${since}`,
    `- Unique: ${summary.unique}  ·  Open: ${summary.open}  ·  Fixed: ${summary.fixed}  ·  Dismissed: ${summary.dismissed}`,
    `- By severity: ${JSON.stringify(summary.bySeverity)}  ·  By source: ${JSON.stringify(summary.bySource)}`, ``];
  const byCat = {};
  for (const b of bugs) (byCat[b.category] = byCat[b.category] || []).push(b);
  const cats = Object.keys(byCat).sort((a, b) =>
    byCat[b].reduce((s, x) => s + x.score, 0) - byCat[a].reduce((s, x) => s + x.score, 0));
  for (const cat of cats) {
    lines.push(`## ${cat}`, '');
    for (const b of byCat[cat].filter((x) => x.status === 'open')) {
      lines.push(`### [${b.severity}] ${(b.message || '').slice(0, 120)}`);
      lines.push(`- errorId: \`${b.errorId}\`  ·  occurrences: ${b.occurrences}  ·  score: ${b.score}`);
      if (b.route) lines.push(`- route: \`${b.route}\`${b.statusCode ? `  (${b.statusCode})` : ''}`);
      if (b.stack) lines.push('```\n' + String(b.stack).slice(0, 1200) + '\n```');
      lines.push('');
    }
  }
  return lines.join('\n');
}

async function runSince(since) {
  const data = await fetchBugs({ since });
  if (!data.configured) { console.log('[bug-triage] BUG_LRS not configured — nothing to do (local dev).'); return; }
  fs.writeFileSync(REPORT_PATH, renderReport(data));
  console.log(`[bug-triage] ${data.summary.open} open / ${data.summary.unique} unique. Report → ${REPORT_PATH}`);
  for (const b of data.bugs.filter((x) => x.status === 'open').slice(0, 25)) {
    console.log(`  · [${b.severity}] (${b.category}) x${b.occurrences}  ${(b.message || '').slice(0, 80)}  [${b.errorId}]`);
  }
}

async function main() {
  const a = process.argv.slice(2);
  if (a[0] === '--since') return runSince(a[1] || '7d');
  if (a[0] === '--mark-fixed') { await fixlog.markFixed(a[1], a.slice(2).join(' ')); console.log('marked fixed:', a[1]); return; }
  if (a[0] === '--dismiss') { await fixlog.dismiss(a[1], a.slice(2).join(' ')); console.log('dismissed:', a[1]); return; }
  if (a[0] === '--reset') { await fixlog.reset(); console.log('fix log reset'); return; }

  // minimal interactive menu
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));
  console.log('Bug triage — 1) fetch 7d  2) custom range  5) mark-fixed  6) dismiss  9) reset  0) exit');
  for (;;) {
    const k = (await ask('> ')).trim();
    if (k === '0') break;
    else if (k === '1') await runSince('7d');
    else if (k === '2') await runSince((await ask('range (e.g. 24h, 3d, 2w): ')).trim() || '7d');
    else if (k === '5') { const id = (await ask('errorId: ')).trim(); await fixlog.markFixed(id, (await ask('note: ')).trim()); console.log('fixed', id); }
    else if (k === '6') { const id = (await ask('errorId: ')).trim(); await fixlog.dismiss(id, (await ask('reason: ')).trim()); console.log('dismissed', id); }
    else if (k === '9') { await fixlog.reset(); console.log('reset'); }
    else console.log('?');
  }
  rl.close();
}
main().catch((e) => { console.error('[bug-triage]', e.message); process.exit(1); });
