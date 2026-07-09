/**
 * Client-side Bug Reporter
 * Catches errors and sends them to the server's bug-report endpoint,
 * which forwards to BUG_LRS as xAPI statements.
 *
 * Usage:
 *   import { initBugReporter, reportError } from './utils/bugReporter';
 *   initBugReporter(); // once at app startup
 *   reportError({ message: 'Something broke', component: 'MyComponent' }); // manual
 */

const ENDPOINT = '/server/telemetry/bug-report';

// Dedup: avoid flooding with the same error
const recentErrors = new Map();
const DEDUP_TTL = 60000; // 1 minute
const MAX_QUEUE = 20; // max queued reports before dropping

let queue = [];
let flushTimer = null;
const FLUSH_INTERVAL = 3000; // batch every 3s

function dedupKey(message, source) {
  return `${source}:${message}`;
}

/**
 * Send a single error report to the server
 */
async function sendReport(report) {
  try {
    const token = localStorage.getItem('auth_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(report)
    });
  } catch {
    // Never let bug reporting crash the app
  }
}

/**
 * Send queued reports synchronously via sendBeacon on page hide/unload.
 * Beacon survives navigation; fetch does not.
 */
function flushBeacon() {
  if (queue.length === 0 || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  const batch = queue.splice(0, MAX_QUEUE);
  for (const report of batch) {
    try {
      const blob = new Blob([JSON.stringify(report)], { type: 'application/json' });
      navigator.sendBeacon(ENDPOINT, blob);
    } catch {
      // Never let bug reporting crash unload
    }
  }
}

/**
 * Flush queued reports
 */
function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_QUEUE);
  for (const report of batch) {
    sendReport(report);
  }
}

/**
 * Queue an error report
 */
function enqueue(report) {
  const key = dedupKey(report.message, report.component || report.route || '');
  if (recentErrors.has(key)) return;
  recentErrors.set(key, Date.now());

  if (queue.length >= MAX_QUEUE) return; // drop if too many
  queue.push(report);
}

/**
 * Manually report an error
 *
 * @param {Object} params
 * @param {string} params.message - Error message
 * @param {string} [params.stack] - Stack trace
 * @param {string} [params.component] - React component or module name
 * @param {string} [params.severity] - 'error' | 'warning' | 'fatal'
 * @param {Object} [params.context] - Additional data
 */
export function reportError(params) {
  enqueue({
    message: params.message,
    stack: params.stack,
    component: params.component,
    route: window.location.pathname,
    severity: params.severity || 'error',
    context: {
      ...params.context,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * Initialize global error listeners.
 * Call once at app startup (e.g., in main.jsx or App.jsx).
 */
export function initBugReporter() {
  // Global JS errors
  window.addEventListener('error', (e) => {
    enqueue({
      message: e.message || 'Unknown error',
      stack: e.error?.stack,
      route: window.location.pathname,
      severity: 'error',
      context: {
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        userAgent: navigator.userAgent,
        url: window.location.href
      }
    });
  });

  // Intercept console.error and console.warn so caught errors also reach BUG_LRS
  function interceptConsole(method, severity) {
    const original = console[method];
    console[method] = (...args) => {
      original.apply(console, args);
      try {
        const firstArg = args[0];
        let message, stack;
        if (firstArg instanceof Error) {
          message = firstArg.message;
          stack = firstArg.stack;
        } else {
          message = args.map(a => (a instanceof Error ? a.message : typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
          const errorArg = args.find(a => a instanceof Error);
          stack = errorArg?.stack;
        }
        if (message) {
          enqueue({
            message: message.substring(0, 1000),
            stack,
            route: window.location.pathname,
            severity,
            context: {
              type: `console.${method}`,
              userAgent: navigator.userAgent,
              url: window.location.href
            }
          });
        }
      } catch {
        // Never let interception crash the app
      }
    };
  }
  interceptConsole('error', 'error');
  interceptConsole('warn', 'warning');

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    const message = e.reason instanceof Error
      ? e.reason.message
      : String(e.reason || 'Unhandled promise rejection');
    const stack = e.reason instanceof Error ? e.reason.stack : undefined;

    enqueue({
      message,
      stack,
      route: window.location.pathname,
      severity: 'error',
      context: {
        type: 'unhandledrejection',
        userAgent: navigator.userAgent,
        url: window.location.href
      }
    });
  });

  // Flush on interval
  flushTimer = setInterval(flush, FLUSH_INTERVAL);

  // Flush on page hide / unload via sendBeacon (survives navigation).
  // visibilitychange fires on mobile tab-hide where beforeunload doesn't.
  window.addEventListener('pagehide', flushBeacon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBeacon();
  });

  // Clean up dedup cache periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of recentErrors) {
      if (now - ts > DEDUP_TTL) recentErrors.delete(key);
    }
  }, DEDUP_TTL);
}

/**
 * Report a caught error from a React component or async handler.
 * Convenience wrapper that extracts info from an Error object.
 *
 * @param {Error} error - The caught error
 * @param {string} [component] - Component or handler name
 * @param {Object} [context] - Additional context
 */
export function reportCaughtError(error, component, context) {
  reportError({
    message: error.message || String(error),
    stack: error.stack,
    component,
    severity: 'error',
    context
  });
}
