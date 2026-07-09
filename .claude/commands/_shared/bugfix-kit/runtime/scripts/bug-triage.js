#!/usr/bin/env node
/**
 * Bug Triage - Interactive Debugging Tool
 *
 * Fetches error/warning statements from BUG_LRS, deduplicates against
 * a persistent fix log, categorizes issues, and provides an interactive
 * menu to triage, fix, and dismiss bugs.
 *
 * Usage:
 *   npm run debugging          # Interactive menu
 *   node scripts/bug-triage.js # Same thing
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// --- Config ---
const BUG_LRS_ENDPOINT = process.env.BUG_LRS_ENDPOINT;
const BUG_LRS_USERNAME = process.env.BUG_LRS_USERNAME;
const BUG_LRS_PASSWORD = process.env.BUG_LRS_PASSWORD;
const BUG_APP_ID = process.env.BUG_APP_ID || 'default';
const EXT_BASE = process.env.APP_URL || 'https://alwaysai.skoonline.org';

const FIX_LOG_PATH = path.resolve(__dirname, '..', 'bug-fix-log.json');
const REPORT_PATH = path.resolve(__dirname, '..', 'bug-triage-report.md');

// --- Readline helpers ---
let rl;

function createRL() {
  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(question) {
  return new Promise((resolve, reject) => {
    try {
      rl.question(question, resolve);
    } catch (err) {
      resolve('0'); // exit gracefully if stdin closes
    }
  });
}

// Handle stdin close gracefully (e.g., piped input)
process.stdin.on('end', () => {
  closeRL();
  process.exit(0);
});

function closeRL() {
  if (rl) rl.close();
}

// --- Fix Log ---
function loadFixLog() {
  try {
    if (fs.existsSync(FIX_LOG_PATH)) {
      return JSON.parse(fs.readFileSync(FIX_LOG_PATH, 'utf8'));
    }
  } catch { /* ignore */ }
  return { fixed: {}, dismissed: {} };
}

function saveFixLog(log) {
  fs.writeFileSync(FIX_LOG_PATH, JSON.stringify(log, null, 2));
}

// --- LRS Fetcher ---
function getAuthHeader() {
  return 'Basic ' + Buffer.from(`${BUG_LRS_USERNAME}:${BUG_LRS_PASSWORD}`).toString('base64');
}

async function fetchStatements(since) {
  if (!BUG_LRS_ENDPOINT || !BUG_LRS_USERNAME || !BUG_LRS_PASSWORD) {
    console.log('\n  ❌ BUG_LRS not configured.');
    console.log('  Set BUG_LRS_ENDPOINT, BUG_LRS_USERNAME, BUG_LRS_PASSWORD in .env\n');
    return null;
  }

  const allStatements = [];
  let url = `${BUG_LRS_ENDPOINT}/statements?limit=100&ascending=false`;
  if (since) {
    url += `&since=${since}`;
  }

  console.log(`\n  📡 Fetching from ${BUG_LRS_ENDPOINT}...`);

  let page = 0;
  while (url) {
    page++;
    const response = await fetch(url, {
      headers: {
        'Authorization': getAuthHeader(),
        'X-Experience-API-Version': '1.0.3'
      }
    });

    if (!response.ok) {
      console.log(`  ❌ LRS returned ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json();
    const statements = data.statements || [];
    allStatements.push(...statements);

    if (data.more) {
      url = data.more.startsWith('http') ? data.more : `${BUG_LRS_ENDPOINT}${data.more}`;
    } else {
      url = null;
    }
  }

  console.log(`  ✓ ${allStatements.length} statements fetched (${page} page${page > 1 ? 's' : ''})\n`);
  return allStatements;
}

// --- Statement Parser ---
function parseStatement(stmt) {
  const ext = stmt.context?.extensions || {};
  return {
    id: stmt.id,
    timestamp: stmt.timestamp,
    appId: ext[`${EXT_BASE}/appId`] || 'unknown',
    source: ext[`${EXT_BASE}/source`] || 'unknown',
    severity: ext[`${EXT_BASE}/severity`] || 'unknown',
    message: ext[`${EXT_BASE}/message`] || stmt.result?.response || stmt.object?.definition?.description?.['en-US'] || 'No message',
    stack: ext[`${EXT_BASE}/stack`] || null,
    route: ext[`${EXT_BASE}/route`] || null,
    method: ext[`${EXT_BASE}/method`] || null,
    statusCode: ext[`${EXT_BASE}/statusCode`] || null,
    userEmail: ext[`${EXT_BASE}/userEmail`] || null,
    component: ext[`${EXT_BASE}/component`] || null,
    nodeEnv: ext[`${EXT_BASE}/nodeEnv`] || null,
    hostname: ext[`${EXT_BASE}/hostname`] || null,
    context: ext[`${EXT_BASE}/context`] || null
  };
}

// --- Categorization ---
function categorize(bug) {
  const msg = (bug.message || '').toLowerCase();
  const route = (bug.route || '').toLowerCase();

  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('session expired') || msg.includes('token'))
    return 'Authentication';
  if (msg.includes('404') || msg.includes('not found'))
    return 'Not Found';
  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many'))
    return 'Rate Limiting';
  if (msg.includes('500') || msg.includes('internal server'))
    return 'Server Error';
  if (msg.includes('gcs') || msg.includes('storage') || msg.includes('upload') || msg.includes('bucket'))
    return 'Storage/GCS';
  if (msg.includes('lrs') || msg.includes('xapi'))
    return 'xAPI/LRS';
  if (msg.includes('llm') || msg.includes('ai chat') || msg.includes('openai') || msg.includes('anthropic') || msg.includes('gemini'))
    return 'LLM/AI';
  if (msg.includes('quiz') || msg.includes('assessment'))
    return 'Assessment';
  if (msg.includes('i18n') || msg.includes('translat'))
    return 'i18n';
  if (msg.includes('voice') || msg.includes('websocket') || msg.includes('realtime'))
    return 'Voice/WebSocket';
  if (route.includes('/learning') || msg.includes('journey') || msg.includes('learning'))
    return 'Learning';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('syntax'))
    return 'Data Parsing';
  if (bug.source === 'client' && (msg.includes('console.error') || msg.includes('console.warn')))
    return 'Client Console';
  if (msg.includes('entity too large') || msg.includes('413') || msg.includes('payload'))
    return 'Payload Size';

  return 'Other';
}

// --- Deduplication ---
function deduplicateBugs(bugs) {
  const groups = new Map();
  for (const bug of bugs) {
    const key = `${bug.source}:${bug.message}:${bug.route || ''}:${bug.statusCode || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { ...bug, occurrences: 1, firstSeen: bug.timestamp, lastSeen: bug.timestamp, allIds: [bug.id] });
    } else {
      const existing = groups.get(key);
      existing.occurrences++;
      existing.allIds.push(bug.id);
      if (bug.timestamp < existing.firstSeen) existing.firstSeen = bug.timestamp;
      if (bug.timestamp > existing.lastSeen) existing.lastSeen = bug.timestamp;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.occurrences - a.occurrences);
}

// --- Severity Scoring ---
function severityScore(bug) {
  const sevMap = { fatal: 4, error: 3, warning: 2, info: 1 };
  const base = sevMap[bug.severity] || 1;
  const freqMultiplier = Math.min(bug.occurrences, 10);
  return base * freqMultiplier;
}

// --- Fix Proposals ---
function proposeFix(bug, category) {
  const msg = (bug.message || '').toLowerCase();

  switch (category) {
    case 'Authentication':
      if (msg.includes('session expired'))
        return 'Check token refresh logic in AuthContext.jsx. Consider auto-refreshing tokens before expiry.';
      if (msg.includes('401'))
        return 'Verify auth middleware order in server.js. Check if optionalAuth should be used instead of requireAuth for this route.';
      return 'Review auth flow in server/routes/auth.js and client/src/context/AuthContext.jsx.';
    case 'Server Error':
      if (bug.route) return `Debug route handler at server/routes/${guessRouteFile(bug.route)}. Check logs for the stack trace.`;
      return 'Check server logs for full stack trace. Look for unhandled promise rejections.';
    case 'Storage/GCS':
      return 'Check GCS bucket permissions and GCS_BUCKET_NAME env var. Verify service account credentials.';
    case 'xAPI/LRS':
      return 'Check LRS_ENDPOINT connectivity. Verify LRS credentials. Review statement structure in services/xapi.js.';
    case 'LLM/AI':
      if (msg.includes('rate limit')) return 'LLM provider rate limit hit. Consider request queuing or backup provider.';
      return 'Check LLM API key validity and quota. Review provider fallback logic in services/llm.js.';
    case 'Assessment':
      return 'Check assessment lifecycle in routes/assessments.js and routes/modules.js.';
    case 'i18n':
      return 'Check translation files in GCS and local locales/. Verify routes/i18n.js fallback logic.';
    case 'Voice/WebSocket':
      return 'Check OPENAI_API_KEY and VOICE_MODE_ENABLED. Review WebSocket relay in routes/voice.js.';
    case 'Learning':
      return 'Check learning journey state in routes/learning.js. Verify GCS snapshot save/restore.';
    case 'Rate Limiting':
      return 'Review rate limiter config in middleware/rateLimiter.js. Consider adjusting limits.';
    case 'Not Found':
      if (bug.route) return `Check if route ${bug.route} is registered. Verify route ordering (specific before parameterized).`;
      return 'Check route registration order in server.js.';
    case 'Data Parsing':
      return 'Add input validation before parsing. Check for malformed JSON in GCS files or API responses.';
    case 'Payload Size':
      return 'Increase express.json({ limit }) in server.js or reduce payload size on client.';
    default:
      return 'Review the error context and stack trace to determine root cause.';
  }
}

function guessRouteFile(route) {
  if (!route) return '?.js';
  const parts = route.replace(/^\/server\//, '').split('/');
  return `${parts[0]}.js`;
}

// --- Time range helper ---
function parseSince(val) {
  const match = val.match(/^(\d+)(h|d|w)$/);
  if (match) {
    const [, num, unit] = match;
    const ms = { h: 3600000, d: 86400000, w: 604800000 }[unit];
    return new Date(Date.now() - parseInt(num) * ms).toISOString();
  }
  return val; // assume ISO string
}

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Report Generator ---
function generateReport(bugs, fixLog) {
  const unfixed = bugs.filter(b => !fixLog.fixed[b.id] && !isAnyIdFixed(b, fixLog));
  const fixed = bugs.filter(b => fixLog.fixed[b.id] || isAnyIdFixed(b, fixLog));
  const dismissed = bugs.filter(b => fixLog.dismissed[b.id] || isAnyIdDismissed(b, fixLog));

  const categories = {};
  for (const bug of unfixed) {
    const cat = categorize(bug);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(bug);
  }

  const sortedCats = Object.entries(categories).sort((a, b) => {
    const scoreA = a[1].reduce((sum, bug) => sum + severityScore(bug), 0);
    const scoreB = b[1].reduce((sum, bug) => sum + severityScore(bug), 0);
    return scoreB - scoreA;
  });

  let report = `# Bug Triage Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n`;
  report += `**Source:** ${BUG_LRS_ENDPOINT}\n`;
  report += `**App ID:** ${BUG_APP_ID}\n\n`;
  report += `## Summary\n\n`;
  report += `| Metric | Count |\n|--------|-------|\n`;
  report += `| Total bugs fetched | ${bugs.length} |\n`;
  report += `| **Open (unfixed)** | **${unfixed.length}** |\n`;
  report += `| Fixed | ${fixed.length} |\n`;
  report += `| Dismissed | ${dismissed.length} |\n\n`;

  if (unfixed.length === 0) {
    report += `> ✅ No open bugs! All reported issues have been addressed.\n\n`;
  }

  report += `---\n\n## Open Bugs by Category\n\n`;

  for (const [cat, catBugs] of sortedCats) {
    const totalOccurrences = catBugs.reduce((sum, b) => sum + b.occurrences, 0);
    report += `### ${cat} (${catBugs.length} unique, ${totalOccurrences} total)\n\n`;
    catBugs.sort((a, b) => severityScore(b) - severityScore(a));

    for (const bug of catBugs) {
      const sevIcon = { fatal: '🔴', error: '🟠', warning: '🟡', info: '🔵' }[bug.severity] || '⚪';
      report += `#### ${sevIcon} ${bug.message.substring(0, 120)}\n\n`;
      report += `- **ID:** \`${bug.id}\`\n`;
      report += `- **Severity:** ${bug.severity} | **Source:** ${bug.source} | **Occurrences:** ${bug.occurrences}\n`;
      report += `- **First seen:** ${bug.firstSeen} | **Last seen:** ${bug.lastSeen}\n`;
      if (bug.route) report += `- **Route:** \`${bug.route}\``;
      if (bug.method) report += ` (${bug.method})`;
      if (bug.statusCode) report += ` → ${bug.statusCode}`;
      if (bug.route || bug.method || bug.statusCode) report += `\n`;
      if (bug.userEmail) report += `- **User:** ${bug.userEmail}\n`;
      report += `\n`;

      if (bug.stack) {
        report += `<details><summary>Stack trace</summary>\n\n\`\`\`\n${bug.stack.substring(0, 2000)}\n\`\`\`\n\n</details>\n\n`;
      }

      const fix = proposeFix(bug, cat);
      report += `**Proposed fix:** ${fix}\n\n---\n\n`;
    }
  }

  if (fixed.length > 0) {
    report += `## Fixed Bugs (${fixed.length})\n\n`;
    for (const bug of fixed) {
      const entry = fixLog.fixed[bug.id] || findFixEntry(bug, fixLog);
      report += `- ~~${bug.message.substring(0, 100)}~~ — fixed ${entry?.fixedAt || 'unknown'} ${entry?.note ? `(${entry.note})` : ''}\n`;
    }
    report += `\n`;
  }

  return report;
}

function isAnyIdFixed(bug, fixLog) {
  return bug.allIds?.some(id => fixLog.fixed[id]);
}

function isAnyIdDismissed(bug, fixLog) {
  return bug.allIds?.some(id => fixLog.dismissed[id]);
}

function findFixEntry(bug, fixLog) {
  for (const id of (bug.allIds || [])) {
    if (fixLog.fixed[id]) return fixLog.fixed[id];
  }
  return null;
}

// ═══════════════════════════════════════════════════════
// INTERACTIVE MENU
// ═══════════════════════════════════════════════════════

function printHeader() {
  console.clear();
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║          🐛 Bug Triage & Debugging            ║');
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
}

function printMainMenu() {
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  What would you like to do?                  │');
  console.log('  │                                              │');
  console.log('  │  1) 📡 Fetch & show all bugs (last 7 days)  │');
  console.log('  │  2) 🔍 Fetch bugs (custom time range)       │');
  console.log('  │  3) 📋 View open bugs                       │');
  console.log('  │  4) 🔎 View bug details                     │');
  console.log('  │  5) ✅ Mark a bug as fixed                   │');
  console.log('  │  6) 🙈 Dismiss a bug                        │');
  console.log('  │  7) 📊 Generate full report                 │');
  console.log('  │  8) 📜 View fix log                         │');
  console.log('  │  9) 🔄 Reset fix log                        │');
  console.log('  │  0) 🚪 Exit                                 │');
  console.log('  │                                              │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
}

// State: cached fetched bugs
let cachedBugs = null;
let cachedSince = null;

async function fetchAndCache(since) {
  const sinceISO = since ? parseSince(since) : new Date(Date.now() - 7 * 86400000).toISOString();
  const statements = await fetchStatements(sinceISO);
  if (!statements) return false;

  const parsed = statements.map(parseStatement);
  // Filter to only this app's bugs
  const appBugs = parsed.filter(b => b.appId === BUG_APP_ID);
  console.log(`  🔍 Filtered to app "${BUG_APP_ID}": ${appBugs.length} of ${parsed.length} bugs`);
  cachedBugs = deduplicateBugs(appBugs);
  cachedSince = sinceISO;
  return true;
}

function getOpenBugs(fixLog) {
  if (!cachedBugs) return [];
  return cachedBugs.filter(b => !fixLog.fixed[b.id] && !isAnyIdFixed(b, fixLog) && !fixLog.dismissed[b.id] && !isAnyIdDismissed(b, fixLog));
}

function printBugList(bugs, fixLog) {
  const open = getOpenBugs(fixLog);

  console.log(`\n  Total: ${cachedBugs.length} unique bugs | Open: ${open.length} | Fixed/Dismissed: ${cachedBugs.length - open.length}`);
  console.log('');

  if (open.length === 0) {
    console.log('  ✅ No open bugs! All reported issues have been addressed.\n');
    return;
  }

  // Group by category
  const categories = {};
  for (const bug of open) {
    const cat = categorize(bug);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(bug);
  }

  let idx = 1;
  const indexMap = {};

  for (const [cat, catBugs] of Object.entries(categories).sort((a, b) => {
    const sa = a[1].reduce((s, b) => s + severityScore(b), 0);
    const sb = b[1].reduce((s, b) => s + severityScore(b), 0);
    return sb - sa;
  })) {
    console.log(`  ── ${cat} ──`);
    catBugs.sort((a, b) => severityScore(b) - severityScore(a));
    for (const bug of catBugs) {
      const sevIcon = { fatal: '🔴', error: '🟠', warning: '🟡' }[bug.severity] || '⚪';
      const src = bug.source === 'server' ? 'SRV' : 'CLI';
      const msgShort = bug.message.substring(0, 65);
      console.log(`  ${String(idx).padStart(3, ' ')}. ${sevIcon} [${src}] ${msgShort}`);
      console.log(`       x${bug.occurrences} | ${bug.route || bug.component || '-'} | ${timeAgo(bug.lastSeen)}`);
      indexMap[idx] = bug;
      idx++;
    }
    console.log('');
  }

  return indexMap;
}

function printBugDetail(bug) {
  const cat = categorize(bug);
  const sevIcon = { fatal: '🔴', error: '🟠', warning: '🟡', info: '🔵' }[bug.severity] || '⚪';

  console.log('\n  ┌─────────────────────────────────────────────┐');
  console.log(`  │ ${sevIcon} Bug Detail`);
  console.log('  └─────────────────────────────────────────────┘');
  console.log(`  Message:     ${bug.message}`);
  console.log(`  ID:          ${bug.id}`);
  console.log(`  Category:    ${cat}`);
  console.log(`  Severity:    ${bug.severity}`);
  console.log(`  Source:      ${bug.source}`);
  console.log(`  Occurrences: ${bug.occurrences}`);
  console.log(`  First seen:  ${bug.firstSeen} (${timeAgo(bug.firstSeen)})`);
  console.log(`  Last seen:   ${bug.lastSeen} (${timeAgo(bug.lastSeen)})`);
  if (bug.route) console.log(`  Route:       ${bug.route}`);
  if (bug.method) console.log(`  Method:      ${bug.method}`);
  if (bug.statusCode) console.log(`  Status:      ${bug.statusCode}`);
  if (bug.component) console.log(`  Component:   ${bug.component}`);
  if (bug.userEmail) console.log(`  User:        ${bug.userEmail}`);
  if (bug.nodeEnv) console.log(`  Environment: ${bug.nodeEnv}`);
  if (bug.hostname) console.log(`  Hostname:    ${bug.hostname}`);

  if (bug.stack) {
    console.log('\n  Stack trace:');
    const lines = bug.stack.split('\n').slice(0, 10);
    for (const line of lines) {
      console.log(`    ${line}`);
    }
    if (bug.stack.split('\n').length > 10) {
      console.log('    ... (truncated)');
    }
  }

  if (bug.context) {
    console.log('\n  Context:');
    try {
      const ctx = typeof bug.context === 'string' ? JSON.parse(bug.context) : bug.context;
      console.log(`    ${JSON.stringify(ctx, null, 2).split('\n').join('\n    ')}`);
    } catch {
      console.log(`    ${bug.context}`);
    }
  }

  const fix = proposeFix(bug, cat);
  console.log(`\n  💡 Proposed fix: ${fix}`);
  console.log('');
}

async function menuFetchBugs(since) {
  const ok = await fetchAndCache(since);
  if (!ok) return;

  const fixLog = loadFixLog();
  printBugList(cachedBugs, fixLog);
}

async function menuViewOpen() {
  if (!cachedBugs) {
    console.log('\n  ⚠️  No bugs fetched yet. Fetching last 7 days...');
    const ok = await fetchAndCache('7d');
    if (!ok) return null;
  }

  const fixLog = loadFixLog();
  return printBugList(cachedBugs, fixLog);
}

async function menuViewDetail(indexMap) {
  if (!indexMap && !cachedBugs) {
    console.log('\n  ⚠️  No bugs loaded. Use option 1 or 3 first.\n');
    return;
  }

  if (!indexMap) {
    const fixLog = loadFixLog();
    indexMap = printBugList(cachedBugs, fixLog);
    if (!indexMap) return;
  }

  const answer = await ask('  Enter bug # (or bug ID): ');
  const trimmed = answer.trim();

  let bug;
  const num = parseInt(trimmed);
  if (!isNaN(num) && indexMap[num]) {
    bug = indexMap[num];
  } else {
    // Search by ID
    bug = cachedBugs?.find(b => b.id === trimmed || b.allIds?.includes(trimmed));
  }

  if (!bug) {
    console.log('  ❌ Bug not found.\n');
    return;
  }

  printBugDetail(bug);

  const action = await ask('  Action: [f]ix  [d]ismiss  [enter] back: ');
  if (action.trim().toLowerCase() === 'f') {
    const note = await ask('  Fix note (what was changed): ');
    const fixLog = loadFixLog();
    for (const id of (bug.allIds || [bug.id])) {
      fixLog.fixed[id] = { fixedAt: new Date().toISOString(), note: note.trim() };
    }
    saveFixLog(fixLog);
    console.log(`  ✅ Marked as fixed (${bug.allIds?.length || 1} occurrence ID(s)).\n`);
  } else if (action.trim().toLowerCase() === 'd') {
    const reason = await ask('  Dismiss reason: ');
    const fixLog = loadFixLog();
    for (const id of (bug.allIds || [bug.id])) {
      fixLog.dismissed[id] = { dismissedAt: new Date().toISOString(), reason: reason.trim() };
    }
    saveFixLog(fixLog);
    console.log(`  🙈 Dismissed (${bug.allIds?.length || 1} occurrence ID(s)).\n`);
  }
}

async function menuMarkFixed() {
  const indexMap = await menuViewOpen();
  if (!indexMap) return;

  const answer = await ask('  Enter bug # to mark as fixed (or "all"): ');
  const trimmed = answer.trim();

  if (trimmed.toLowerCase() === 'all') {
    const fixLog = loadFixLog();
    const open = getOpenBugs(fixLog);
    const note = await ask('  Fix note for all: ');
    for (const bug of open) {
      for (const id of (bug.allIds || [bug.id])) {
        fixLog.fixed[id] = { fixedAt: new Date().toISOString(), note: note.trim() };
      }
    }
    saveFixLog(fixLog);
    console.log(`  ✅ Marked ${open.length} bugs as fixed.\n`);
    return;
  }

  const num = parseInt(trimmed);
  const bug = indexMap[num];
  if (!bug) {
    console.log('  ❌ Invalid selection.\n');
    return;
  }

  const note = await ask('  Fix note (what was changed): ');
  const fixLog = loadFixLog();
  for (const id of (bug.allIds || [bug.id])) {
    fixLog.fixed[id] = { fixedAt: new Date().toISOString(), note: note.trim() };
  }
  saveFixLog(fixLog);
  console.log(`  ✅ Marked as fixed.\n`);
}

async function menuDismiss() {
  const indexMap = await menuViewOpen();
  if (!indexMap) return;

  const answer = await ask('  Enter bug # to dismiss: ');
  const num = parseInt(answer.trim());
  const bug = indexMap[num];
  if (!bug) {
    console.log('  ❌ Invalid selection.\n');
    return;
  }

  const reason = await ask('  Dismiss reason: ');
  const fixLog = loadFixLog();
  for (const id of (bug.allIds || [bug.id])) {
    fixLog.dismissed[id] = { dismissedAt: new Date().toISOString(), reason: reason.trim() };
  }
  saveFixLog(fixLog);
  console.log(`  🙈 Dismissed.\n`);
}

async function menuGenerateReport() {
  if (!cachedBugs) {
    console.log('\n  ⚠️  No bugs fetched yet. Fetching last 7 days...');
    const ok = await fetchAndCache('7d');
    if (!ok) return;
  }

  const fixLog = loadFixLog();
  const report = generateReport(cachedBugs, fixLog);
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`\n  📊 Report saved to: ${REPORT_PATH}\n`);
}

function menuViewFixLog() {
  const fixLog = loadFixLog();
  const fixedCount = Object.keys(fixLog.fixed).length;
  const dismissedCount = Object.keys(fixLog.dismissed).length;

  console.log(`\n  📜 Fix Log: ${fixedCount} fixed, ${dismissedCount} dismissed\n`);

  if (fixedCount > 0) {
    console.log('  ── Fixed ──');
    for (const [id, entry] of Object.entries(fixLog.fixed)) {
      console.log(`  ✅ ${id.substring(0, 8)}... — ${timeAgo(entry.fixedAt)} ${entry.note ? `(${entry.note})` : ''}`);
    }
    console.log('');
  }

  if (dismissedCount > 0) {
    console.log('  ── Dismissed ──');
    for (const [id, entry] of Object.entries(fixLog.dismissed)) {
      console.log(`  🙈 ${id.substring(0, 8)}... — ${timeAgo(entry.dismissedAt)} ${entry.reason ? `(${entry.reason})` : ''}`);
    }
    console.log('');
  }

  if (fixedCount === 0 && dismissedCount === 0) {
    console.log('  (empty)\n');
  }
}

async function menuResetFixLog() {
  const answer = await ask('  ⚠️  This will clear all fixed/dismissed records. Are you sure? (y/N): ');
  if (answer.trim().toLowerCase() === 'y') {
    saveFixLog({ fixed: {}, dismissed: {} });
    console.log('  🔄 Fix log reset.\n');
  } else {
    console.log('  Cancelled.\n');
  }
}

// --- Main interactive loop ---
async function interactiveMain() {
  createRL();
  printHeader();

  let running = true;
  let lastIndexMap = null;

  while (running) {
    printMainMenu();
    const choice = await ask('  Enter choice (0-9): ');

    switch (choice.trim()) {
      case '1':
        await menuFetchBugs('7d');
        break;

      case '2': {
        console.log('\n  Time range examples: 1h, 6h, 24h, 3d, 7d, 2w');
        const range = await ask('  Enter time range: ');
        await menuFetchBugs(range.trim() || '7d');
        break;
      }

      case '3':
        lastIndexMap = await menuViewOpen();
        break;

      case '4':
        await menuViewDetail(lastIndexMap);
        break;

      case '5':
        await menuMarkFixed();
        lastIndexMap = null;
        break;

      case '6':
        await menuDismiss();
        lastIndexMap = null;
        break;

      case '7':
        await menuGenerateReport();
        break;

      case '8':
        menuViewFixLog();
        break;

      case '9':
        await menuResetFixLog();
        break;

      case '0':
      case 'q':
      case 'exit':
        running = false;
        console.log('\n  👋 Bye!\n');
        break;

      default:
        console.log('  ❓ Invalid choice. Enter 0-9.\n');
    }
  }

  closeRL();
}

// --- Entry point ---
async function main() {
  const args = process.argv.slice(2);

  // If CLI args are passed, run non-interactively (backwards compatible)
  if (args.length > 0) {
    // --mark-fixed <id> [note]
    if (args[0] === '--mark-fixed') {
      const id = args[1];
      const note = args.slice(2).join(' ') || '';
      if (!id) { console.error('Usage: --mark-fixed <errorId> [note]'); process.exit(1); }
      const log = loadFixLog();
      log.fixed[id] = { fixedAt: new Date().toISOString(), note };
      saveFixLog(log);
      console.log(`✅ Marked ${id} as fixed.`);
      return;
    }

    // --dismiss <id> [reason]
    if (args[0] === '--dismiss') {
      const id = args[1];
      const reason = args.slice(2).join(' ') || '';
      if (!id) { console.error('Usage: --dismiss <errorId> [reason]'); process.exit(1); }
      const log = loadFixLog();
      log.dismissed[id] = { dismissedAt: new Date().toISOString(), reason };
      saveFixLog(log);
      console.log(`🙈 Dismissed ${id}.`);
      return;
    }

    // --reset
    if (args[0] === '--reset') {
      saveFixLog({ fixed: {}, dismissed: {} });
      console.log('🔄 Fix log reset.');
      return;
    }

    // --summary or default non-interactive
    let since;
    const sinceIdx = args.indexOf('--since');
    if (sinceIdx !== -1 && args[sinceIdx + 1]) {
      since = args[sinceIdx + 1];
    } else {
      since = '7d';
    }

    const ok = await fetchAndCache(since);
    if (!ok) process.exit(1);

    const fixLog = loadFixLog();
    printBugList(cachedBugs, fixLog);

    // Always generate report in non-interactive mode
    const report = generateReport(cachedBugs, fixLog);
    fs.writeFileSync(REPORT_PATH, report);
    console.log(`📄 Full report: ${REPORT_PATH}\n`);
    return;
  }

  // No args: interactive mode
  await interactiveMain();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
