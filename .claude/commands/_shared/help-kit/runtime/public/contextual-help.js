/* contextual-help.js — app-wide context-sensitive "?" assistant.
 *
 * One-file IIFE. Idempotent. Injects its own styles. Works on any HTML page.
 * Three triggers: click the chip, double-tap Shift, F1 — plus opt-in dwell.
 * The card sends the DOM snippet under the cursor to /api/help/ask and renders
 * the LLM's reply with light markdown. Optional per-turn TTS + feedback launcher.
 */
(function () {
  'use strict';

  if (window.__contextualHelpInstalled) return;
  window.__contextualHelpInstalled = true;

  // ─── Configuration ──────────────────────────────────────────────────────
  // Edit these constants to wire the module to your app.
  const CFG = {
    appSlug: 'alwaysai',                     // namespace for locationId (must == server APP_SLUG)
    langCookie: 'preferredLanguage',         // the SPA writes the UI language code to this cookie
    api: {
      config:     '/server/config/help-hover', // dwell ms + auto-open flag
      ask:        '/server/help/ask',          // main Q&A endpoint (LLM gateway, public)
      tts:        '/server/tts',               // optional read-aloud (server route not wired in this build)
      languages:  '/server/i18n/languages',    // optional — drives tts coverage gate
    },
    feedbackUrl: null,                       // app feedback wizard launches elsewhere; hide here
    footerText:  'AI offers · adapt, edit, or ignore',
  };

  // ─── Self-contained CSS ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('cx-help-styles')) return;
    const css = `
#cx-help-chip{position:fixed;right:18px;bottom:18px;z-index:2147483000;
  width:42px;height:42px;border-radius:50%;
  background:radial-gradient(circle at 32% 28%,#f4dc8d 0%,#c9a84c 55%,#a68632 100%);
  color:#2b1d05;border:none;cursor:pointer;
  font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:21px;line-height:1;
  box-shadow:0 6px 18px rgba(0,0,0,.55),0 2px 4px rgba(0,0,0,.4),
    inset 0 1px 0 rgba(255,255,255,.45),0 0 0 1px rgba(201,168,76,.4);
  display:flex;align-items:center;justify-content:center;
  transition:transform .15s ease,box-shadow .15s ease;opacity:.92;}
#cx-help-chip:hover{opacity:1;transform:translateY(-2px) scale(1.06);}
#cx-help-chip span{pointer-events:none;text-shadow:0 1px 0 rgba(255,255,255,.35);}

#cx-help-card{position:fixed;z-index:2147483001;
  width:min(400px,calc(100vw - 32px));max-height:min(500px,calc(100vh - 32px));
  color:#1d2838;
  background:linear-gradient(180deg,rgba(255,255,255,.96) 0%,rgba(247,244,236,.94) 100%),#fbf8ef;
  border:1px solid rgba(130,100,40,.35);border-radius:14px;
  box-shadow:0 28px 60px rgba(8,14,28,.55),0 12px 24px rgba(8,14,28,.4),
    0 2px 6px rgba(8,14,28,.3),inset 0 1px 0 rgba(255,255,255,.9),
    inset 0 -1px 0 rgba(120,90,30,.08),0 0 0 1px rgba(0,0,0,.18);
  backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  display:flex;flex-direction:column;
  font-family:'DM Sans',system-ui,sans-serif;font-size:12.5px;line-height:1.55;
  opacity:0;visibility:hidden;
  transform:translateY(10px) scale(.82);transform-origin:center center;
  transition:opacity .28s cubic-bezier(.4,0,.2,1),
             transform .42s cubic-bezier(.22,1.18,.36,1),
             visibility 0s linear .42s;
  pointer-events:none;overflow:hidden;}
#cx-help-card.open{opacity:1;visibility:visible;transform:translateY(0) scale(1);pointer-events:auto;
  transition:opacity .28s cubic-bezier(.4,0,.2,1),
             transform .42s cubic-bezier(.22,1.18,.36,1),
             visibility 0s linear 0s;}
#cx-help-card.dragging{transition:none;cursor:grabbing;user-select:none;}
#cx-help-card.maximized{left:16px !important;top:16px !important;right:16px;bottom:16px;
  width:auto;max-height:none;height:calc(100vh - 32px);max-width:none;}

#cx-help-card .cxh-head{display:flex;align-items:center;gap:10px;padding:11px 12px;
  background:linear-gradient(180deg,#c9a84c 0%,#b89638 100%);
  color:#231708;cursor:grab;user-select:none;
  border-bottom:1px solid rgba(130,100,40,.45);}
#cx-help-card .cxh-title{flex:1;display:flex;align-items:center;gap:8px;
  font-family:'Playfair Display',Georgia,serif;font-weight:700;font-size:14px;}
#cx-help-card .cxh-dot{width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 30% 30%,#fff6d8,#7a5c1f);}
#cx-help-card .cxh-head-actions{display:flex;gap:6px;align-items:center;}
#cx-help-card .cxh-toggle{background:rgba(255,255,255,.2);border:1px solid rgba(0,0,0,.2);color:#231708;
  font-size:10px;letter-spacing:.04em;padding:3px 8px;border-radius:10px;cursor:pointer;
  font-family:'IBM Plex Mono',monospace;}
#cx-help-card .cxh-toggle.on{background:rgba(255,255,255,.55);}
#cx-help-card .cxh-fb{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.4);
  border:1px solid rgba(0,0,0,.22);color:#231708;font-size:11px;font-weight:600;
  padding:3px 9px 3px 7px;border-radius:11px;cursor:pointer;}
#cx-help-card .cxh-max,#cx-help-card .cxh-close{background:rgba(255,255,255,.18);
  border:1px solid rgba(0,0,0,.18);color:#231708;width:24px;height:22px;padding:0;border-radius:6px;
  font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
#cx-help-card .cxh-close{font-size:18px;}

#cx-help-card .cxh-tts-row{display:flex;justify-content:flex-end;margin-top:6px;padding-top:6px;
  border-top:1px dashed rgba(130,100,40,.22);}
#cx-help-card .cxh-tts{display:inline-flex;align-items:center;gap:5px;background:#faf3dd;
  border:1px solid rgba(130,100,40,.3);color:#6b4b10;padding:3px 8px;border-radius:11px;
  font-family:'IBM Plex Mono',Menlo,monospace;font-size:9.5px;letter-spacing:.08em;
  text-transform:uppercase;cursor:pointer;line-height:1;}
#cx-help-card .cxh-tts.is-playing{background:#fff;border-color:#8a6f32;color:#3a2f15;}
#cx-help-card .cxh-tts.is-busy{cursor:wait;opacity:.75;}
#cx-help-card .cxh-tts.is-error{background:#fdecec;border-color:#c96d6d;color:#7a1f1f;}
#cx-help-card .cxh-tts-spin{display:inline-block;width:10px;height:10px;
  border:2px solid currentColor;border-top-color:transparent;border-radius:50%;
  animation:cxhSpin .7s linear infinite;}
@keyframes cxhSpin{to{transform:rotate(360deg);}}

#cx-help-card .cxh-context{padding:7px 12px;border-bottom:1px solid rgba(130,100,40,.2);
  font-size:10.5px;color:#6b5c3f;background:#f4ecd5;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
#cx-help-card .cxh-context-label{font-family:'IBM Plex Mono',monospace;font-size:9px;
  letter-spacing:.12em;text-transform:uppercase;color:#8a7549;margin-right:4px;}
#cx-help-card .cxh-context-val{color:#3a2f15;font-weight:500;}

#cx-help-card .cxh-msgs{flex:1;min-height:90px;max-height:280px;overflow-y:auto;padding:12px;
  display:flex;flex-direction:column;gap:9px;
  background:linear-gradient(180deg,#fbf8ef 0%,#f5efdc 100%);}
#cx-help-card.maximized .cxh-msgs{max-height:none;}
#cx-help-card .cxh-empty{color:#7a6a4a;font-size:11.5px;padding:10px 4px;line-height:1.5;}
#cx-help-card .cxh-msg{max-width:90%;padding:8px 11px;border-radius:10px;font-size:12.5px;
  line-height:1.55;white-space:pre-wrap;word-wrap:break-word;box-shadow:0 1px 2px rgba(0,0,0,.08);}
#cx-help-card .cxh-msg.user{align-self:flex-end;
  background:linear-gradient(180deg,#e8c97a,#c9a84c);color:#231708;
  border:1px solid rgba(130,100,40,.35);}
#cx-help-card .cxh-msg.bot{align-self:flex-start;background:#fff;color:#1d2838;
  border:1px solid rgba(130,100,40,.18);}
#cx-help-card .cxh-msg.bot.loading{opacity:.7;font-style:italic;}
#cx-help-card .cxh-msg.bot .cxh-p{margin:0 0 8px 0;}
#cx-help-card .cxh-msg.bot .cxh-p:last-child{margin-bottom:0;}
#cx-help-card .cxh-msg.bot .cxh-h{font-family:'Playfair Display',Georgia,serif;
  margin:2px 0 6px 0;color:#231708;line-height:1.3;font-weight:700;}
#cx-help-card .cxh-msg.bot h4.cxh-h{font-size:14px;}
#cx-help-card .cxh-msg.bot h5.cxh-h{font-size:13px;}
#cx-help-card .cxh-msg.bot h6.cxh-h{font-size:12px;letter-spacing:.02em;
  text-transform:uppercase;color:#6b5c3f;}
#cx-help-card .cxh-msg.bot .cxh-ul,#cx-help-card .cxh-msg.bot .cxh-ol{margin:0 0 8px 0;padding-left:20px;}
#cx-help-card .cxh-msg.bot .cxh-bq{margin:2px 0 8px 0;padding:6px 10px;
  border-left:3px solid #c9a84c;background:#faf3dd;color:#4a3d1d;
  border-radius:0 4px 4px 0;font-style:italic;}
#cx-help-card .cxh-msg.bot strong{color:#231708;font-weight:700;}
#cx-help-card .cxh-msg.bot a{color:#8a6f32;text-decoration:underline;text-underline-offset:2px;}
#cx-help-card .cxh-msg.bot .cxh-ic{font-family:'IBM Plex Mono',Menlo,monospace;font-size:11.5px;
  background:#f4ecd5;border:1px solid rgba(130,100,40,.25);padding:1px 5px;border-radius:3px;color:#3a2f15;}
#cx-help-card .cxh-msg.bot .cxh-code{margin:2px 0 8px 0;padding:8px 10px;
  background:#1d2838;color:#e8e0c5;border-radius:6px;
  font-family:'IBM Plex Mono',Menlo,monospace;font-size:11.5px;overflow-x:auto;line-height:1.5;}

#cx-help-card .cxh-quickrow{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0;background:#f5efdc;}
#cx-help-card .cxh-quick{background:#fff;border:1px solid rgba(130,100,40,.3);color:#3a2f15;
  font-size:11px;padding:5px 10px;border-radius:14px;cursor:pointer;font-family:inherit;}
#cx-help-card .cxh-quick:hover{border-color:#8a6f32;color:#231708;background:#fffbef;}

#cx-help-card .cxh-inputrow{display:flex;gap:6px;padding:10px 12px 8px;background:#f5efdc;
  border-top:1px solid rgba(130,100,40,.2);margin-top:10px;}
#cx-help-card .cxh-input{flex:1;background:#fff;color:#1d2838;
  border:1px solid rgba(130,100,40,.3);border-radius:6px;padding:7px 10px;
  font-family:inherit;font-size:12px;outline:none;}
#cx-help-card .cxh-input:focus{border-color:#8a6f32;box-shadow:0 0 0 2px rgba(201,168,76,.25);}
#cx-help-card .cxh-send{background:linear-gradient(180deg,#d4b45c,#b89638);color:#231708;
  border:1px solid rgba(130,100,40,.5);border-radius:6px;padding:7px 14px;
  font-family:inherit;font-weight:600;font-size:11.5px;cursor:pointer;}

#cx-help-card .cxh-foot{padding:7px 12px 10px;font-family:'IBM Plex Mono',monospace;
  font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#8a7549;
  text-align:center;background:#f5efdc;}

@media (max-width:520px){
  #cx-help-card:not(.maximized){left:8px !important;right:8px;top:auto !important;
    bottom:70px;width:auto;max-height:70vh;}
  #cx-help-chip{right:12px;bottom:12px;}
}

#cx-help-fb-overlay{position:fixed;inset:0;z-index:2147483002;
  background:rgba(8,14,28,.55);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;padding:24px;opacity:0;
  transition:opacity .22s cubic-bezier(.4,0,.2,1);}
#cx-help-fb-overlay.open{display:flex;opacity:1;}
#cx-help-fb-overlay .cxfm-dialog{
  width:min(920px,calc(100vw - 48px));height:min(760px,calc(100vh - 48px));
  background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(247,244,236,.96));
  border:1px solid rgba(130,100,40,.35);border-radius:14px;overflow:hidden;
  display:flex;flex-direction:column;
  transform:translateY(12px) scale(.97);
  transition:transform .28s cubic-bezier(.2,.8,.25,1.05);}
#cx-help-fb-overlay.open .cxfm-dialog{transform:translateY(0) scale(1);}
#cx-help-fb-overlay .cxfm-head{display:flex;align-items:center;gap:10px;padding:11px 12px;
  background:linear-gradient(180deg,#c9a84c 0%,#b89638 100%);color:#231708;
  border-bottom:1px solid rgba(130,100,40,.45);}
#cx-help-fb-overlay .cxfm-title{flex:1;font-family:'Playfair Display',Georgia,serif;
  font-weight:700;font-size:14.5px;color:#231708;}
#cx-help-fb-overlay .cxfm-close{background:rgba(255,255,255,.2);border:1px solid rgba(0,0,0,.2);
  color:#231708;width:26px;height:24px;padding:0;border-radius:6px;font-size:19px;cursor:pointer;}
#cx-help-fb-overlay .cxfm-frame-wrap{flex:1;min-height:0;background:#fff;}
#cx-help-fb-overlay iframe{width:100%;height:100%;border:0;display:block;background:#fff;}`;
    const style = document.createElement('style');
    style.id = 'cx-help-styles';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  // ─── Constants ──────────────────────────────────────────────────────────
  const MOVE_THRESHOLD_PX = 6;
  const COOLDOWN_AFTER_DISMISS_MS = 4000;
  const MAX_HISTORY_TURNS = 6;
  const SNIPPET_MAX_CHARS = 1500;
  const STORAGE_ENABLED_KEY = 'cx_help_enabled';
  const HELP_CACHE_KEY = 'cx_help_cache_v1';
  const HELP_CACHE_MAX = 80;
  const HELP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const HOTKEY = 'F1';
  const DOUBLE_TAP_WINDOW_MS = 400;

  // ─── Hashing ────────────────────────────────────────────────────────────
  function fnv1aHash(s) {
    let h = 0x811c9dc5;
    const str = String(s);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }
  function cacheKeyFor(question, lang) {
    return fnv1aHash([
      question || '',
      state.lastElementSnippet || '',
      state.lastNearestHeading || '',
      state.lastViewName || '',
      String(lang || 'en'),
    ].join(''));
  }

  // ─── State ──────────────────────────────────────────────────────────────
  const state = {
    dwellMs: 3000,
    autoOpenEnabled: true,
    userEnabled: readEnabledPref(),
    dwellTimer: null,
    cooldownUntil: 0,
    lastX: 0, lastY: 0, lastMoveAt: 0,
    hoverTarget: null, card: null, chip: null,
    history: [], loading: false,
    lastElementSnippet: '',
    lastNearestHeading: '',
    lastViewName: '',
    lastLocationKey: '',
  };

  function readEnabledPref() {
    try {
      const v = localStorage.getItem(STORAGE_ENABLED_KEY);
      return v === null ? false : v === '1';
    } catch (_) { return false; }
  }
  function writeEnabledPref(on) {
    try { localStorage.setItem(STORAGE_ENABLED_KEY, on ? '1' : '0'); } catch (_) {}
  }

  function readHelpCache() {
    try {
      const raw = localStorage.getItem(HELP_CACHE_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return (data && typeof data === 'object') ? data : {};
    } catch (_) { return {}; }
  }
  function writeHelpCache(map) {
    try { localStorage.setItem(HELP_CACHE_KEY, JSON.stringify(map)); } catch (_) {}
  }
  function pruneHelpCache(map) {
    const now = Date.now();
    const kept = {};
    const entries = Object.entries(map)
      .filter(([, v]) => v && typeof v.a === 'string' && (now - (v.t || 0)) < HELP_CACHE_TTL_MS)
      .sort((a, b) => (b[1].t || 0) - (a[1].t || 0))
      .slice(0, HELP_CACHE_MAX);
    for (const [k, v] of entries) kept[k] = v;
    return kept;
  }

  // ─── Language ───────────────────────────────────────────────────────────
  function currentLang() {
    if (window.I18n && typeof window.I18n.lang === 'string') return window.I18n.lang;
    const re = new RegExp('(?:^|;\\s*)' + CFG.langCookie + '=([^;]+)');
    const m = document.cookie.match(re);
    return m ? decodeURIComponent(m[1]) : 'en';
  }
  function t(src) {
    if (window.I18n && typeof window.I18n.t === 'function') {
      try { return window.I18n.t(src); } catch (_) { return src; }
    }
    return src;
  }

  // ─── DOM context extraction ─────────────────────────────────────────────
  function isOurUI(el) {
    return !!(el && el.closest && el.closest('#cx-help-card, #cx-help-chip, #cx-help-fb-overlay'));
  }
  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function findMeaningfulContainer(el) {
    if (!el) return null;
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 8) {
      // App-specific interest selectors — tuned for this React/Tailwind SPA.
      const interesting = cur.matches && cur.matches(
        '[data-help], [role="dialog"], [role="tab"], [role="button"], dialog, ' +
        'button, a, label, input, textarea, select, details, ' +
        'nav, header, section, article, form, ' +
        '[class*="card"], [class*="modal"], [class*="panel"], [class*="tile"], ' +
        '[class*="chat"], [data-i18n]'
      );
      if (interesting) return cur;
      const txt = (cur.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length >= 20) return cur;
      cur = cur.parentElement; hops++;
    }
    return el;
  }

  function nearestHeadingFor(el) {
    if (!el) return '';
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 12) {
      const h = cur.querySelector && cur.querySelector(
        'h1, h2, h3, h4, .section-title, .modal-title, .topbar-title'
      );
      if (h) {
        const txt = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if (txt) return txt.slice(0, 200);
      }
      cur = cur.parentElement; hops++;
    }
    return (document.title || '').slice(0, 200);
  }

  function elementSnippet(el) {
    if (!el) return '';
    const container = findMeaningfulContainer(el);
    if (!container) return '';
    const clone = container.cloneNode(true);
    clone.querySelectorAll('script, style, svg, #cx-help-card, #cx-help-chip').forEach(n => n.remove());
    let text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > SNIPPET_MAX_CHARS) text = text.slice(0, SNIPPET_MAX_CHARS) + '…';
    return text;
  }

  function currentViewName() {
    const navActive = document.querySelector('.nav-item.active [data-i18n], .nav-item.active span');
    if (navActive) {
      const x = (navActive.textContent || '').trim();
      if (x) return x;
    }
    const topbar = document.getElementById('topbar-title');
    if (topbar) {
      const x = (topbar.textContent || '').trim();
      if (x) return x;
    }
    return '';
  }

  function locationKeyFor(el) {
    if (!el || el === document.body) return '';
    const slug = (s) => String(s || '').trim().toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    let cur = el, hops = 0;
    while (cur && cur !== document.body && hops < 10) {
      if (cur.dataset && cur.dataset.help) return 'help:' + slug(cur.dataset.help);
      if (cur.id) return 'id:' + slug(cur.id);
      if (cur.dataset && cur.dataset.view) return 'view:' + slug(cur.dataset.view);
      if (cur.dataset && cur.dataset.task) return 'task:' + slug(cur.dataset.task);
      cur = cur.parentElement; hops++;
    }
    const heading = nearestHeadingFor(el);
    if (heading) return 'sec:' + slug(heading);
    const tag = (el.tagName || 'el').toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.split(/\s+/).filter(Boolean)[0] : '';
    return 'el:' + tag + (cls ? '.' + slug(cls) : '');
  }

  // ─── Feedback launcher (optional) ───────────────────────────────────────
  function mapLangForWizard(lang) {
    if (!lang) return 'en';
    const l = String(lang).toLowerCase();
    if (l === 'zh') return 'zh-CN';
    return l;
  }
  function buildFeedbackUrl() {
    if (!CFG.feedbackUrl) return '';
    const dom = (() => {
      const name = (document.getElementById('user-name')?.textContent || '').trim();
      const looksLikeName = name && name !== 'Loading…' && name !== '—';
      return { userName: looksLikeName ? name : '' };
    })();
    const pathKey = (location.pathname || '/').replace(/\/+$/, '') || '/';
    const loc = state.lastLocationKey || 'loc:unknown';
    const sourceID = CFG.appSlug + ':' + pathKey + ':' + loc;
    const c = {
      sourceID, lang: mapLangForWizard(currentLang()),
      domain: 'general', reading_level: 'professional', level: '1',
    };
    if (dom.userName) c.userName = dom.userName;
    return CFG.feedbackUrl + (CFG.feedbackUrl.includes('?') ? '&' : '?')
      + 'json=' + encodeURIComponent(JSON.stringify(c));
  }
  function openFeedbackWizard() {
    if (!CFG.feedbackUrl) return;
    const url = buildFeedbackUrl();
    let overlay = document.getElementById('cx-help-fb-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'cx-help-fb-overlay';
      overlay.innerHTML = [
        '<div class="cxfm-dialog" role="dialog" aria-label="Feedback">',
        '  <div class="cxfm-head">',
        '    <div class="cxfm-title" data-i18n>Feedback</div>',
        '    <button type="button" class="cxfm-close" id="cxfm-close" aria-label="Close">&times;</button>',
        '  </div>',
        '  <div class="cxfm-frame-wrap"><iframe id="cxfm-frame" title="Feedback wizard" allow="clipboard-write"></iframe></div>',
        '</div>',
      ].join('');
      document.body.appendChild(overlay);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFeedbackWizard(); });
      overlay.querySelector('#cxfm-close').addEventListener('click', closeFeedbackWizard);
      window.addEventListener('message', (e) => {
        const d = e && e.data;
        if (!d) return;
        const kind = (typeof d === 'string') ? d : (d.type || d.kind || '');
        if (/^(feedback[_-]?)?(done|submitted|close|cancel)$/i.test(String(kind))) closeFeedbackWizard();
      });
      if (window.I18n && I18n.applyTo) I18n.applyTo(overlay);
    }
    overlay.querySelector('#cxfm-frame').src = url;
    overlay.offsetHeight;
    overlay.classList.add('open');
    document.addEventListener('keydown', onFeedbackKey);
  }
  function closeFeedbackWizard() {
    const overlay = document.getElementById('cx-help-fb-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    const f = overlay.querySelector('#cxfm-frame');
    if (f) setTimeout(() => { try { f.src = 'about:blank'; } catch (_) {} }, 220);
    document.removeEventListener('keydown', onFeedbackKey);
  }
  function onFeedbackKey(e) { if (e.key === 'Escape') closeFeedbackWizard(); }

  // ─── API ────────────────────────────────────────────────────────────────
  async function fetchConfig() {
    try {
      const r = await fetch(CFG.api.config, { credentials: 'same-origin' });
      if (!r.ok) return;
      const cfg = await r.json();
      if (typeof cfg.dwellMs === 'number') state.dwellMs = Math.max(0, cfg.dwellMs);
      state.autoOpenEnabled = !!cfg.enabled;
    } catch (_) {}
  }

  async function askServer(question) {
    const lang = currentLang();
    const assistantTurnsSoFar = state.history.filter(m => m.role === 'assistant').length;
    const key = assistantTurnsSoFar === 0 ? cacheKeyFor(question, lang) : null;
    if (key) {
      const cache = readHelpCache();
      const hit = cache[key];
      if (hit && typeof hit.a === 'string' && hit.a) {
        hit.t = Date.now();
        writeHelpCache(cache);
        state.history.push({ role: 'assistant', content: hit.a, cached: true });
        renderMessages();
        return;
      }
    }
    state.loading = true;
    renderMessages();
    try {
      const r = await fetch(CFG.api.ask, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-app-lang': lang },
        body: JSON.stringify({
          question,
          elementSnippet: state.lastElementSnippet,
          nearestHeading: state.lastNearestHeading,
          viewName: state.lastViewName,
          pageTitle: document.title || '',
          locationKey: state.lastLocationKey || '',
          pathKey: ((location.pathname || '/').replace(/\/+$/, '') || '/'),
          lang,
          history: state.history.slice(-MAX_HISTORY_TURNS * 2),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      const answer = String(data.answer || '').trim();
      state.history.push({ role: 'assistant', content: answer });
      if (key && answer) {
        const cache = readHelpCache();
        cache[key] = { a: answer, t: Date.now() };
        writeHelpCache(pruneHelpCache(cache));
      }
    } catch (e) {
      state.history.push({ role: 'assistant',
        content: '⚠︎ ' + t('Help unavailable') + ': ' + (e.message || String(e)) });
    } finally {
      state.loading = false;
      renderMessages();
    }
  }

  // ─── Chip ───────────────────────────────────────────────────────────────
  function buildChip() {
    if (state.chip) return state.chip;
    const chip = document.createElement('button');
    chip.id = 'cx-help-chip';
    chip.type = 'button';
    chip.setAttribute('aria-label', 'Open help assistant');
    // English source string only — see "echo-of-source guard" in CONTEXT_HELP.md
    chip.setAttribute('title', 'Help assistant — double-tap Shift, click, or pause the cursor anywhere');
    chip.setAttribute('data-i18n-attr', 'title');
    chip.innerHTML = '<span>?</span>';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isCardOpen()) closeCard();
      else openCardAt(null, { manual: true });
    });
    document.body.appendChild(chip);
    state.chip = chip;
    if (window.I18n && I18n.applyTo) I18n.applyTo(chip);
    return chip;
  }

  // ─── Markdown (tiny) ────────────────────────────────────────────────────
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function renderMarkdown(raw) {
    if (raw == null) return '';
    const src = String(raw);
    const codeBlocks = [];
    const fenceStripped = src.replace(/```([a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g, (_, lang, body) => {
      const id = codeBlocks.length;
      codeBlocks.push('<pre class="cxh-code"><code>' + escapeHTML(body.replace(/\n+$/, '')) + '</code></pre>');
      return ' CB' + id + ' ';
    });
    let text = escapeHTML(fenceStripped);
    text = text.replace(/`([^`\n]+)`/g, (_, c) => '<code class="cxh-ic">' + c + '</code>');
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const lines = text.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      const h = line.match(/^(#{1,3})\s+(.+)$/);
      if (h) {
        const level = h[1].length + 3;
        out.push('<h' + level + ' class="cxh-h">' + h[2] + '</h' + level + '>');
        i++; continue;
      }
      if (/^\s*&gt;\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*&gt;\s?/, '')); i++;
        }
        out.push('<blockquote class="cxh-bq">' + buf.join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push('<li>' + lines[i].replace(/^\s*\d+\.\s+/, '') + '</li>'); i++;
        }
        out.push('<ol class="cxh-ol">' + items.join('') + '</ol>');
        continue;
      }
      if (/^\s*[-*•]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
          items.push('<li>' + lines[i].replace(/^\s*[-*•]\s+/, '') + '</li>'); i++;
        }
        out.push('<ul class="cxh-ul">' + items.join('') + '</ul>');
        continue;
      }
      const para = [line]; i++;
      while (i < lines.length
        && !/^\s*$/.test(lines[i])
        && !/^(#{1,3})\s+/.test(lines[i])
        && !/^\s*&gt;\s?/.test(lines[i])
        && !/^\s*\d+\.\s+/.test(lines[i])
        && !/^\s*[-*•]\s+/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push('<p class="cxh-p">' + para.join('<br>') + '</p>');
    }
    let html = out.join('');
    html = html.replace(/ CB(\d+) /g, (_, id) => codeBlocks[+id] || '');
    return html;
  }

  // ─── Card ───────────────────────────────────────────────────────────────
  function buildCard() {
    if (state.card) return state.card;
    const card = document.createElement('div');
    card.id = 'cx-help-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Help assistant');
    const fbBtnHTML = CFG.feedbackUrl
      ? '<button type="button" class="cxh-fb" id="cxh-fb" data-i18n-attr="title" title="Share feedback">'
        + '<span aria-hidden="true">✎</span><span data-i18n>Feedback</span></button>'
      : '';
    card.innerHTML = [
      '<div class="cxh-head" id="cxh-drag-handle">',
      '  <div class="cxh-title"><span class="cxh-dot"></span><span data-i18n>Need help here?</span></div>',
      '  <div class="cxh-head-actions">',
      '    <button type="button" class="cxh-toggle" id="cxh-toggle" data-i18n-attr="title" title="Toggle auto-open on hover"></button>',
      fbBtnHTML,
      '    <button type="button" class="cxh-max" id="cxh-max" aria-label="Maximize" data-i18n-attr="title" title="Maximize">⛶</button>',
      '    <button type="button" class="cxh-close" id="cxh-close" aria-label="Close">&times;</button>',
      '  </div>',
      '</div>',
      '<div class="cxh-context" id="cxh-context"></div>',
      '<div class="cxh-msgs" id="cxh-msgs"></div>',
      '<div class="cxh-quickrow">',
      '  <button type="button" class="cxh-quick" data-q="what-is" data-i18n>What is this?</button>',
      '  <button type="button" class="cxh-quick" data-q="what-can" data-i18n>What can I do here?</button>',
      '  <button type="button" class="cxh-quick" data-q="why" data-i18n>Why is this here?</button>',
      '</div>',
      '<div class="cxh-inputrow">',
      '  <input type="text" class="cxh-input" id="cxh-input" data-i18n-attr="placeholder" placeholder="Ask a follow-up about this area…">',
      '  <button type="button" class="cxh-send" id="cxh-send" data-i18n>Send</button>',
      '</div>',
      '<div class="cxh-foot" data-i18n>' + escapeHTML(CFG.footerText) + '</div>',
    ].join('');
    document.body.appendChild(card);

    card.querySelector('#cxh-close').addEventListener('click', () => closeCard());
    card.querySelector('#cxh-toggle').addEventListener('click', () => {
      state.userEnabled = !state.userEnabled;
      writeEnabledPref(state.userEnabled);
      updateToggleLabel();
    });
    card.querySelectorAll('.cxh-quick').forEach(b => {
      b.addEventListener('click', () => {
        if (state.loading) return;
        const kind = b.getAttribute('data-q');
        const q = kind === 'what-is' ? t('What is this?')
               : kind === 'what-can' ? t('What can I do here?')
               : t('Why is this here and why is the app designed this way?');
        submit(q);
      });
    });
    const inputEl = card.querySelector('#cxh-input');
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = inputEl.value.trim();
        if (v) { inputEl.value = ''; submit(v); }
      }
    });
    card.querySelector('#cxh-send').addEventListener('click', () => {
      const v = inputEl.value.trim();
      if (v) { inputEl.value = ''; submit(v); }
    });
    card.addEventListener('mousemove', (e) => e.stopPropagation(), true);

    if (CFG.feedbackUrl) {
      card.querySelector('#cxh-fb').addEventListener('click', openFeedbackWizard);
    }

    card.querySelector('#cxh-msgs').addEventListener('click', (e) => {
      const btn = e.target.closest('.cxh-tts');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-turn'), 10);
      if (Number.isFinite(idx)) onSpeakTurnClick(idx);
    });

    const maxBtn = card.querySelector('#cxh-max');
    maxBtn.addEventListener('click', () => {
      const on = card.classList.toggle('maximized');
      maxBtn.textContent = on ? '❐' : '⛶';
      maxBtn.setAttribute('title', on ? t('Restore') : t('Maximize'));
      if (!on) {
        card.style.left = ''; card.style.top = ''; card.style.width = ''; card.style.height = '';
        positionCardNear(state.lastX || null, state.lastY || null);
      }
    });

    const handle = card.querySelector('#cxh-drag-handle');
    let drag = null;
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button')) return;
      if (card.classList.contains('maximized')) return;
      const rect = card.getBoundingClientRect();
      drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      card.classList.add('dragging');
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const W = card.offsetWidth, H = card.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight, margin = 8;
      let left = e.clientX - drag.dx;
      let top = e.clientY - drag.dy;
      left = Math.max(margin, Math.min(left, vw - W - margin));
      top = Math.max(margin, Math.min(top, vh - H - margin));
      card.style.left = left + 'px'; card.style.top = top + 'px';
      card.style.right = 'auto'; card.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!drag) return; drag = null; card.classList.remove('dragging');
    });

    state.card = card;
    if (window.I18n && I18n.applyTo) I18n.applyTo(card);
    updateToggleLabel();
    return card;
  }

  function updateToggleLabel() {
    const btn = state.card && state.card.querySelector('#cxh-toggle');
    if (!btn) return;
    if (state.userEnabled) { btn.textContent = t('Auto-help: on');  btn.classList.add('on'); }
    else                   { btn.textContent = t('Auto-help: off'); btn.classList.remove('on'); }
  }
  function isCardOpen() { return !!(state.card && state.card.classList.contains('open')); }

  function positionCardNear(x, y) {
    const card = state.card;
    if (!card) return;
    if (card.classList.contains('maximized')) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const W = card.offsetWidth || 380, H = card.offsetHeight || 320, margin = 16;
    let left, top;
    if (x == null || y == null) { left = vw - W - margin; top = vh - H - margin; }
    else {
      left = x + 18; top = y + 18;
      if (left + W + margin > vw) left = Math.max(margin, x - W - 18);
      if (top + H + margin > vh)  top  = Math.max(margin, y - H - 18);
      left = Math.max(margin, Math.min(left, vw - W - margin));
      top  = Math.max(margin, Math.min(top,  vh - H - margin));
    }
    card.style.left = Math.round(left) + 'px';
    card.style.right = 'auto'; card.style.bottom = 'auto';
    card.style.top = Math.round(top) + 'px';
  }

  function captureContextFrom(el) {
    state.lastElementSnippet = elementSnippet(el);
    state.lastNearestHeading = nearestHeadingFor(el);
    state.lastViewName = currentViewName();
    state.lastLocationKey = locationKeyFor(el);
  }

  function renderContextChip() {
    const el = state.card && state.card.querySelector('#cxh-context');
    if (!el) return;
    const bits = [];
    if (state.lastNearestHeading) bits.push(state.lastNearestHeading);
    if (state.lastViewName && state.lastViewName !== state.lastNearestHeading) bits.push(state.lastViewName);
    const label = bits.join(' · ') || t('This area');
    el.innerHTML = '<span class="cxh-context-label">' + t('Context') + ':</span> '
      + '<span class="cxh-context-val">' + escapeHTML(label) + '</span>';
  }

  function renderMessages() {
    const el = state.card && state.card.querySelector('#cxh-msgs');
    if (!el) return;
    const turns = state.history.slice();
    if (turns.length === 0 && !state.loading) {
      el.innerHTML = '<div class="cxh-empty" data-i18n>'
        + 'Pause on anything — or tap a question below to learn what this is and what you can do here.'
        + '</div>';
    } else {
      el.innerHTML = turns.map((m, idx) => {
        if (m.role === 'user') return '<div class="cxh-msg user">' + escapeHTML(m.content) + '</div>';
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
        const tts = (hasText && ttsSupportedHere()) ? ttsButtonHTML(idx) : '';
        return '<div class="cxh-msg bot">' + renderMarkdown(m.content) + tts + '</div>';
      }).join('')
      + (state.loading ? '<div class="cxh-msg bot loading"><span data-i18n>Thinking…</span></div>' : '');
    }
    if (window.I18n && I18n.applyTo) I18n.applyTo(el);
    el.scrollTop = el.scrollHeight;
    if (speak.activeTurn >= 0 && speak.state !== 'idle') setTtsButton(speak.activeTurn, speak.state);
  }

  function submit(question) {
    stopSpeakAudio();
    state.history.push({ role: 'user', content: question });
    renderMessages();
    askServer(question);
  }

  function openCardAt(event, opts) {
    buildCard();
    const target = (event && event.target) || state.hoverTarget || document.body;
    captureContextFrom(target);
    renderContextChip();
    state.history = []; state.loading = false;
    renderMessages();
    if (event && typeof event.clientX === 'number') positionCardNear(event.clientX, event.clientY);
    else positionCardNear(null, null);
    void state.card.offsetHeight;
    requestAnimationFrame(() => {
      state.card.classList.add('open');
      if (event && typeof event.clientX === 'number') positionCardNear(event.clientX, event.clientY);
      else positionCardNear(null, null);
    });
    if (opts && opts.autoFirst) submit(t('What is this, and what can I do here?'));
  }

  function closeCard() {
    if (!state.card) return;
    stopSpeakAudio();
    state.card.classList.remove('open');
    state.cooldownUntil = Date.now() + COOLDOWN_AFTER_DISMISS_MS;
  }

  // ─── TTS (optional) ─────────────────────────────────────────────────────
  const speak = { audio: null, activeTurn: -1, state: 'idle' };
  const TTS_ICON_PLAY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  const TTS_ICON_STOP = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const TTS_ICON_LOAD = '<span class="cxh-tts-spin" aria-hidden="true"></span>';

  function ttsSupportedHere() {
    if (!CFG.api.tts) return false;
    if (!window.I18n || !Array.isArray(I18n.languages)) return true;
    const code = (I18n.lang || 'en').toLowerCase();
    const meta = I18n.languages.find(l => l && l.code === code);
    if (!meta) return true;
    return meta.tts !== false;
  }
  function ttsButtonHTML(turnIdx) {
    return '<div class="cxh-tts-row">'
      + '<button type="button" class="cxh-tts" data-turn="' + turnIdx + '" '
      + 'aria-label="' + t('Read this answer aloud') + '" '
      + 'title="' + t('Read this answer aloud') + '">'
      + TTS_ICON_PLAY
      + '<span class="cxh-tts-label" data-i18n>Read aloud</span>'
      + '</button></div>';
  }
  function ttsButtonFor(turnIdx) {
    return state.card && state.card.querySelector('.cxh-tts[data-turn="' + turnIdx + '"]');
  }
  function setTtsButton(turnIdx, kind) {
    const btn = ttsButtonFor(turnIdx);
    if (!btn) return;
    btn.classList.remove('is-playing', 'is-busy');
    const labelSpan = '<span class="cxh-tts-label" data-i18n>';
    if (kind === 'playing') {
      btn.classList.add('is-playing');
      btn.innerHTML = TTS_ICON_STOP + labelSpan + t('Stop') + '</span>';
    } else if (kind === 'loading') {
      btn.classList.add('is-busy');
      btn.innerHTML = TTS_ICON_LOAD + labelSpan + t('Loading…') + '</span>';
    } else {
      btn.innerHTML = TTS_ICON_PLAY + labelSpan + t('Read aloud') + '</span>';
    }
  }
  function stopSpeakAudio() {
    if (speak.audio) {
      try { speak.audio.pause(); } catch (_) {}
      try { URL.revokeObjectURL(speak.audio.src); } catch (_) {}
      speak.audio = null;
    }
    if (speak.activeTurn >= 0) setTtsButton(speak.activeTurn, 'idle');
    speak.activeTurn = -1;
    speak.state = 'idle';
  }
  function prepareTurnTextForTts(raw) {
    let text = String(raw || '');
    text = text.replace(/```[\s\S]*?```/g, ' ');
    text = text
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1$2')
      .replace(/(^|[\s(])_([^_\n]+)_/g, '$1$2')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\s+/g, ' ').trim();
    return text.slice(0, 2500);
  }
  async function onSpeakTurnClick(turnIdx) {
    if (!CFG.api.tts) return;
    if (speak.activeTurn === turnIdx) {
      if (speak.state === 'loading') return;
      if (speak.state === 'playing') { stopSpeakAudio(); return; }
    }
    if (speak.activeTurn !== -1) stopSpeakAudio();
    const turn = state.history[turnIdx];
    if (!turn || turn.role !== 'assistant') return;
    const text = prepareTurnTextForTts(turn.content);
    if (!text) return;
    speak.activeTurn = turnIdx;
    speak.state = 'loading';
    setTtsButton(turnIdx, 'loading');
    try {
      const r = await fetch(CFG.api.tts, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-app-lang': currentLang() },
        body: JSON.stringify({ text, lang: currentLang() }),
      });
      if (!r.ok) { stopSpeakAudio(); return; }
      if (speak.activeTurn !== turnIdx) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      speak.audio = audio;
      audio.addEventListener('ended', stopSpeakAudio);
      audio.addEventListener('error', stopSpeakAudio);
      await audio.play();
      speak.state = 'playing';
      setTtsButton(turnIdx, 'playing');
    } catch (_) { stopSpeakAudio(); }
  }

  // ─── Triggers (dwell + hotkey) ──────────────────────────────────────────
  function clearDwell() {
    if (state.dwellTimer) { clearTimeout(state.dwellTimer); state.dwellTimer = null; }
  }
  function shouldIgnoreTarget(el) {
    if (!el) return true;
    if (isOurUI(el)) return true;
    if (isTypingTarget(el)) return true;
    return false;
  }
  function onMove(e) {
    state.lastMoveAt = Date.now();
    state.hoverTarget = e.target;
    state.lastX = e.clientX; state.lastY = e.clientY;
    if (isCardOpen()) return;
    if (!state.autoOpenEnabled || !state.userEnabled) return;
    if (Date.now() < state.cooldownUntil) return;
    if (shouldIgnoreTarget(e.target)) { clearDwell(); return; }
    clearDwell();
    state.dwellTimer = setTimeout(() => {
      const elNow = document.elementFromPoint(state.lastX, state.lastY);
      if (!elNow || shouldIgnoreTarget(elNow)) return;
      if (isCardOpen()) return;
      openCardAt({ target: elNow, clientX: state.lastX, clientY: state.lastY }, { autoFirst: true });
    }, state.dwellMs);
  }
  function onLeave() { clearDwell(); }
  function openHelpAtCursor() {
    if (isCardOpen()) { closeCard(); return; }
    let el = null, x = state.lastX, y = state.lastY;
    if (state.lastMoveAt > 0 && state.hoverTarget && document.body.contains(state.hoverTarget) && !isOurUI(state.hoverTarget)) {
      el = state.hoverTarget;
    } else if (document.activeElement && document.activeElement !== document.body && !isOurUI(document.activeElement)) {
      el = document.activeElement;
      const rect = el.getBoundingClientRect();
      x = rect.left + Math.min(rect.width / 2, 120);
      y = rect.bottom + 4;
    } else {
      el = document.body;
      x = Math.floor(window.innerWidth / 2);
      y = Math.floor(window.innerHeight / 2);
    }
    openCardAt({ target: el, clientX: x, clientY: y }, { autoFirst: true });
  }

  let lastShiftDownAt = 0;
  let shiftSequenceBroken = false;
  function onKey(e) {
    if (e.key === 'Escape' && isCardOpen()) closeCard();
    if (e.key === 'Shift' && !e.repeat) {
      const now = Date.now();
      if (!shiftSequenceBroken && lastShiftDownAt && (now - lastShiftDownAt) < DOUBLE_TAP_WINDOW_MS) {
        e.preventDefault(); e.stopPropagation();
        lastShiftDownAt = 0; shiftSequenceBroken = false;
        openHelpAtCursor();
        return;
      }
      lastShiftDownAt = now; shiftSequenceBroken = false;
      return;
    }
    if (lastShiftDownAt && e.key !== 'Shift') shiftSequenceBroken = true;
    if (e.key === HOTKEY || e.code === HOTKEY) {
      e.preventDefault(); e.stopPropagation();
      openHelpAtCursor();
    }
  }

  // ─── Boot ───────────────────────────────────────────────────────────────
  function boot() {
    injectStyles();
    buildChip();
    window.addEventListener('i18n:languagechange', () => {
      stopSpeakAudio();
      if (state.chip && window.I18n && I18n.applyTo) I18n.applyTo(state.chip);
      if (state.card) {
        if (window.I18n && I18n.applyTo) I18n.applyTo(state.card);
        updateToggleLabel(); renderContextChip(); renderMessages();
      }
    });
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('keydown', onKey, true);
    fetchConfig();
    window.contextualHelp = {
      open: () => openCardAt(null, { manual: true }),
      openAt: (x, y) => openCardAt({ target: document.elementFromPoint(x, y) || document.body, clientX: x, clientY: y }, { autoFirst: true }),
      close: closeCard,
      state: () => ({ ...state, card: !!state.card, chip: !!state.chip }),
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
