import { api } from './api.js';
import { h, esc, timeAgo, dist, toast, ICONS } from './ui.js';
import { exifGps, haversine } from './exif.js';
import { cropImage } from './crop.js';
import { avatarSvg, randomSeed } from './avatar.js';
import { t, tf, initI18n, setUiLang, currentUiLang, UI_LANGS_META } from './i18n.js';

/* Cartoon avatar (③) — an inline generative SVG seeded by the user. Everyone gets a stable
 * cartoon even without a saved seed (derived from their name); "regenerate" persists a fresh
 * random seed. `person` is any object with { avatarSeed?, name?, nameCjk?, avatar? }. */
function avatarMarkup(person, size = 40) {
  const seed = (person && person.avatarSeed != null)
    ? person.avatarSeed
    : (person?.name || person?.nameCjk || person?.avatar || 'block');
  return avatarSvg(seed, size);
}

const app = document.getElementById('app');

const state = {
  user: null,
  view: 'near',     // near | good | care | impact | community | capture | post
  stream: 'good',   // good | care (for near/list streams)
  sort: 'near',     // new | near | top
  postId: null,
  config: { googleEnabled: true, gatewayEnabled: true },
};

const NAV = [
  { key: 'near', label: 'Near Me', icon: 'near' },
  { key: 'good', label: 'The Good', icon: 'good' },
  { key: 'care', label: 'Needs Care', icon: 'care' },
  { key: 'impact', label: 'My Impact', icon: 'impact' },
  { key: 'community', label: 'Community', icon: 'community' },
];

const STREAM_META = {
  good: { dot: 'g', icon: '✦', title: 'The Good', sub: 'Savour what your neighbours are doing well' },
  care: { dot: 'c', icon: '△', title: 'Needs Care', sub: 'Notice what needs attention — then act' },
};

// Emotion tags (⑦) — a quick affective signal attached to a post; shown as an icon in feeds.
const MOODS = [
  { id: 'happy', e: '😊', label: 'Happy' },
  { id: 'neutral', e: '😐', label: 'Okay' },
  { id: 'sad', e: '😢', label: 'Sad' },
  { id: 'angry', e: '😡', label: 'Upset' },
  { id: 'anxious', e: '😰', label: 'Worried' },
];
const moodOf = (id) => MOODS.find((m) => m.id === id) || null;

// Narrative card label (④) — turn each post into a one-line "card story" so the feed reads
// like a sequence of small neighbourhood moments rather than a list of rows. Purely derived
// from fields already present (no extra fetch): actor + verb + place + relative time.
function narrativeLabel(p) {
  const who = (p.author?.nameCjk || p.author?.name || t('A neighbour')).split(' ')[0];
  const where = p.placeName || t('nearby');
  const when = timeAgo(p.createdAt);
  const key = p.stream === 'good'
    ? '{who} noticed something good at {where} · {when}'
    : (p.status === 'resolved'
      ? '{who} helped close a care item at {where} · {when}'
      : '{who} flagged something that needs care at {where} · {when}');
  return tf(key, { who: esc(who), where: esc(where), when });
}

// Concern-group tags (⑥) — whose needs a post speaks for, so quieter voices stay visible.
const CONCERN_GROUPS = [
  { id: 'elderly', e: '👵', label: 'Elderly' },
  { id: 'children', e: '🧒', label: 'Children' },
  { id: 'disabled', e: '♿', label: 'Accessibility' },
  { id: 'low_income', e: '🤝', label: 'Low-income' },
  { id: 'newcomers', e: '🧳', label: 'Newcomers' },
  { id: 'pets', e: '🐾', label: 'Pets & strays' },
  { id: 'commuters', e: '🚌', label: 'Commuters' },
  { id: 'everyone', e: '🌍', label: 'Everyone' },
];
const groupOf = (id) => CONCERN_GROUPS.find((g) => g.id === id) || null;

// Badge chips — founding steward (⑧) + per-season badges (①). Season keys look like
// `season-2026-summer`; anything else falls back to a generic medal.
function badgeChip(key) {
  if (key === 'founding-steward')
    return `<span class="badge-chip founding" title="${esc(t('One of the first to tend this block'))}">🏅 ${esc(t('Founding Steward'))}</span>`;
  const m = /^season-(\d{4})-(\w+)$/.exec(key || '');
  if (m) { const name = m[2][0].toUpperCase() + m[2].slice(1); return `<span class="badge-chip">🎖 ${esc(t(name))} ${esc(m[1])}</span>`; }
  return `<span class="badge-chip">🎖 ${esc(key)}</span>`;
}

// Task checklist (④) — renders the server-derived daily/weekly/season tasks with done ticks.
function taskChecklist(tasks) {
  const groups = { daily: [], weekly: [], season: [] };
  tasks.forEach((tk) => (groups[tk.period] || groups.daily).push(tk));
  const box = h(`<div class="card task-card"><h4 style="font-family:var(--display);margin-bottom:8px">${esc(t('Your missions'))}</h4></div>`);
  [['daily', 'Today'], ['weekly', 'This week'], ['season', 'This season']].forEach(([p, label]) => {
    if (!groups[p].length) return;
    box.appendChild(h(`<div class="task-period">${esc(t(label))}</div>`));
    groups[p].forEach((tk) => box.appendChild(h(
      `<div class="task-row ${tk.done ? 'done' : ''}"><span class="task-tick">${tk.done ? '✓' : ''}</span>
        <span class="task-label">${esc(t(tk.label))}</span>
        <span class="task-prog">${tk.have}/${tk.need}</span></div>`)));
  });
  return box;
}

const ACTION_LABEL = { self: 'Tend it yourself', rally: 'Rally neighbours', city: 'Send to the city' };
const STATUS_LABEL = {
  open: 'Unclaimed', rallying: 'Rallying neighbours', routed: 'Routed to city',
  claimed: 'Being handled', pending_verify: 'Awaiting a neighbour’s check',
  in_progress: 'In progress', resolved: 'Resolved',
};
// The closure ladder shown as a progress strip on care items (③).
const CARE_LADDER = [
  { key: 'open', label: 'Unclaimed' },
  { key: 'claimed', label: 'Being handled' },
  { key: 'pending_verify', label: 'Awaiting check' },
  { key: 'resolved', label: 'Resolved' },
];
// Map any legacy status onto a ladder rung so old posts still render on the strip.
const ladderRung = (status) =>
  status === 'resolved' ? 3 : status === 'pending_verify' ? 2 : status === 'claimed' ? 1
  : ['rallying', 'routed', 'in_progress'].includes(status) ? 1 : 0;

/* ---------------------------------------------------------------- bootstrap */
async function boot() {
  try {
    state.config = await api.get('/api/auth/config');
  } catch { /* gateway config unavailable — fall back to defaults */ }
  // Preload the UI dictionary before the first render. The default language follows the
  // viewer's LOCATION (defaultLang(): China detection → geo-IP → locale), overridable by
  // ?lang=, a saved choice, or the in-app switcher.
  try { await initI18n({ hint: defaultLang() }); } catch { /* fall back to English */ }
  try {
    const { user } = await api.get('/api/auth/me');
    state.user = user;
  } catch { /* offline / first run */ }
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

/** A compact UI-language <select>; switching re-renders the whole app in the new language. */
function langSwitcher(cls = '') {
  const sel = h(`<select class="lang-switch ${cls}" aria-label="${esc(t('Language'))}"></select>`);
  UI_LANGS_META.forEach((l) => sel.appendChild(h(`<option value="${l.code}">${esc(l.label)}</option>`)));
  sel.value = currentUiLang();
  // routeFromHash() re-renders the CURRENT view for both anonymous (landing/auth) and
  // logged-in (shell) states; render() alone only rebuilds the logged-in shell.
  sel.onchange = async () => { await setUiLang(sel.value); routeFromHash(); };
  return sel;
}

/* Theme: 'glass' (liquid glass, default) or 'light'. Applied as <html data-theme>; it's pure
 * CSS, so toggling restyles everything live with no re-render. The initial value is also set
 * by an inline script in index.html to avoid a flash before this module loads. */
function currentTheme() {
  try { return localStorage.getItem('ob.theme') || 'glass'; } catch { return 'glass'; }
}
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', 'glass');
  try { localStorage.setItem('ob.theme', theme); } catch { /* private mode */ }
}
function themeToggle(cls = '') {
  const btn = h(`<button class="theme-toggle ${cls}" type="button"></button>`);
  const paint = () => {
    const glass = currentTheme() === 'glass';
    btn.textContent = glass ? '🪟' : '☀️';
    btn.title = glass ? t('Liquid glass theme — tap for light') : t('Light theme — tap for glass');
  };
  paint();
  btn.onclick = () => { applyTheme(currentTheme() === 'glass' ? 'light' : 'glass'); paint(); };
  return btn;
}

function routeFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, id] = hash.split('/');

  // Anonymous visitors get a public landing page — not the login wall. They can
  // explore samples, read posts, share something good, or choose to log in.
  if (!state.user) {
    if (seg === 'login' || seg === 'auth') return renderAuth();
    if (seg === 'share') return renderAnonShare();
    if (seg === 'post' && id) return renderAnonPost(id);
    return renderLanding();
  }

  if (seg === 'post' && id) { state.view = 'post'; state.postId = id; }
  else if (NAV.some((n) => n.key === seg)) { state.view = seg; if (seg === 'good' || seg === 'care') state.stream = seg; }
  else if (seg === 'capture') state.view = 'capture';
  else state.view = 'near';
  render();
}

function go(path) { location.hash = `#/${path}`; }

// A photo's GPS can be off by a few hundred metres; 1 km blocks "taken in a different place".
const GEO_THRESHOLD_M = 1000;

/**
 * Confirm a photo was taken where the device is now. Sets draft.geoFar (true only when the
 * photo carries GPS *and* it's far from the live location), updates the status line, and
 * calls onChange() so the post button can re-gate. No EXIF GPS → can't verify → allowed.
 */
function verifyPhotoGeo(draft, statusEl, onChange) {
  const show = (cls, txt) => { if (statusEl) { statusEl.className = 'geo-check ' + cls; statusEl.textContent = txt; } };
  if (!draft.photoGps) { draft.geoFar = false; if (statusEl) statusEl.className = 'geo-check hidden'; onChange?.(); return; }
  if (!draft.coords) return; // wait until the device location arrives, then re-run
  const d = haversine(draft.photoGps, draft.coords);
  draft.geoFar = d != null && d > GEO_THRESHOLD_M;
  if (draft.geoFar) show('bad', `⚠ This photo looks like it was taken about ${dist(d)} away. Use a photo taken here, on this device.`);
  else show('ok', '✓ Photo location matches where you are.');
  onChange?.();
}

/* ------------------------------------------------------------------- auth */
const GOOGLE_G = '<svg width="17" height="17" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.8 6.1C12.2 13.4 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.2-.4-4.7H24v9h12.4c-.5 2.9-2.1 5.4-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.8z"/><path fill="#FBBC05" d="M10.3 19.3c-.5 1.4-.8 2.9-.8 4.5s.3 3.1.8 4.5l-7.8 6.1C.9 31 0 27.6 0 24s.9-7 2.5-10.6l7.8 5.9z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.1-5.5c-2 1.3-4.6 2.1-8.1 2.1-6.4 0-11.8-3.9-13.7-9.4l-7.8 6.1C6.4 42.6 14.6 48 24 48z"/></svg>';

function renderAuth() {
  let mode = 'login';           // login | register | verify | forgot | reset
  let pendingEmail = '';        // carried into verify / reset
  const oauthErr = /[?&]error=oauth/.test(location.hash);

  const setErr = (card, msg, kind = 'auth-err') => {
    card.querySelector('.err-slot').innerHTML = msg ? `<div class="${kind}">${esc(msg)}</div>` : '';
  };

  const mount = () => {
    app.innerHTML = '';
    const showGoogle = state.config.googleEnabled && (mode === 'login' || mode === 'register');

    const forms = {
      login: `
        <form class="auth-form" data-act="login">
          <div class="field"><label>${esc(t('Email'))}</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <div class="field"><label>${esc(t('Password'))}</label><input name="password" type="password" placeholder="••••••" required></div>
          <button class="btn primary" type="submit">${esc(t('Sign in'))}</button>
        </form>
        <div class="auth-switch"><a data-sw="forgot">${esc(t('Forgot password?'))}</a> · ${esc(t('New here?'))} <a data-sw="register">${esc(t('Create an account'))}</a></div>`,
      register: `
        <form class="auth-form" data-act="register">
          <div class="field"><label>${esc(t('Name'))}</label><input name="name" placeholder="${esc(t('e.g. Ling W.'))}" required></div>
          <div class="field"><label>${esc(t('Name in 中文 (optional)'))}</label><input name="nameCjk" placeholder="玲"></div>
          <div class="field"><label>${esc(t('Email'))}</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <div class="field"><label>${esc(t('Password'))}</label><input name="password" type="password" placeholder="${esc(t('at least 6 characters'))}" required></div>
          <button class="btn primary" type="submit">${esc(t('Create account'))}</button>
        </form>
        <div class="auth-switch">${esc(t('Have an account?'))} <a data-sw="login">${esc(t('Sign in'))}</a></div>`,
      verify: `
        <p class="auth-note">${tf('We emailed a 6-digit code to {email}. Enter it to finish.', { email: `<b>${esc(pendingEmail)}</b>` })}</p>
        <form class="auth-form" data-act="verify">
          <div class="field"><label>${esc(t('Verification code'))}</label><input name="code" inputmode="numeric" placeholder="123456" maxlength="6" required></div>
          <button class="btn primary" type="submit">${esc(t('Verify & continue'))}</button>
        </form>
        <div class="auth-switch"><a data-sw="resend">${esc(t('Resend code'))}</a> · <a data-sw="login">${esc(t('Back to sign in'))}</a></div>`,
      forgot: `
        <p class="auth-note">${esc(t("Enter your email and we'll send a reset code."))}</p>
        <form class="auth-form" data-act="forgot">
          <div class="field"><label>${esc(t('Email'))}</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <button class="btn primary" type="submit">${esc(t('Send reset code'))}</button>
        </form>
        <div class="auth-switch"><a data-sw="login">${esc(t('Back to sign in'))}</a></div>`,
      reset: `
        <p class="auth-note">${tf('Enter the code sent to {email} and your new password.', { email: `<b>${esc(pendingEmail)}</b>` })}</p>
        <form class="auth-form" data-act="reset">
          <div class="field"><label>${esc(t('Reset code'))}</label><input name="code" inputmode="numeric" placeholder="123456" maxlength="6" required></div>
          <div class="field"><label>${esc(t('New password'))}</label><input name="newPassword" type="password" placeholder="${esc(t('at least 6 characters'))}" required></div>
          <button class="btn primary" type="submit">${esc(t('Update password'))}</button>
        </form>
        <div class="auth-switch"><a data-sw="login">${esc(t('Back to sign in'))}</a></div>`,
    };

    const titles = {
      login: t('Your block, in good hands — together.'),
      register: t('Create your neighbour account.'),
      verify: t('Check your email.'),
      forgot: t('Reset your password.'),
      reset: t('Set a new password.'),
    };

    const card = h(`
      <div class="auth-wrap"><div class="auth-card">
        <a class="auth-back" data-back>‹ ${esc(t('Back to explore'))}</a>
        <div class="brand cjk">优城美市<small>Our Block</small></div>
        <div class="auth-tag">${esc(titles[mode])}</div>
        <div class="err-slot"></div>
        ${showGoogle ? `<button class="btn google" data-google>${GOOGLE_G}<span>${esc(t('Continue with Google'))}</span></button><div class="auth-divider"><span>${esc(t('or'))}</span></div>` : ''}
        ${forms[mode]}
      </div></div>`);

    if (oauthErr && mode === 'login') setErr(card, t("Google sign-in didn't complete. Please try again."));

    card.querySelector('[data-back]')?.addEventListener('click', () => go(''));

    const gbtn = card.querySelector('[data-google]');
    if (gbtn) gbtn.onclick = () => {
      // Send the browser's real origin so the callback follows wherever the app is
      // actually served (localhost, an HTTPS forward, a custom domain) — never a
      // hardcoded host. The path stays relative; the server fixes the callback path.
      window.location.href = `/api/auth/google/start?origin=${encodeURIComponent(location.origin)}`;
    };

    card.querySelectorAll('[data-sw]').forEach((a) => {
      a.onclick = async () => {
        const to = a.dataset.sw;
        if (to === 'resend') {
          try { await api.post('/api/auth/resend-code', { email: pendingEmail }); toast('New code sent', 'ok'); }
          catch (e) { setErr(card, e.message); }
          return;
        }
        mode = to; mount();
      };
    });

    card.querySelector('.auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const act = e.target.dataset.act;
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      setErr(card, '');
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        if (act === 'login') {
          const data = await api.post('/api/auth/login', fd);
          api.saveToken(data.token); state.user = data.user;
          toast(tf('Welcome, {name}', { name: data.user.name.split(' ')[0] }), 'ok'); go('near');
        } else if (act === 'register') {
          const out = await api.post('/api/auth/register', fd);
          if (out.user) { api.saveToken(out.token); state.user = out.user; go('near'); return; } // local fallback
          pendingEmail = fd.email; mode = 'verify'; mount();
          toast(t('Verification code sent'), 'ok');
        } else if (act === 'verify') {
          const data = await api.post('/api/auth/verify', { email: pendingEmail, code: fd.code });
          api.saveToken(data.token); state.user = data.user;
          toast(t('Email verified — welcome!'), 'ok'); go('near');
        } else if (act === 'forgot') {
          await api.post('/api/auth/forgot-password', { email: fd.email });
          pendingEmail = fd.email; mode = 'reset'; mount();
          toast(t('Reset code sent (if the email exists)'), 'ok');
        } else if (act === 'reset') {
          await api.post('/api/auth/reset-password', { email: pendingEmail, code: fd.code, newPassword: fd.newPassword });
          mode = 'login'; mount();
          toast(t('Password updated — sign in'), 'ok');
        }
      } catch (err) {
        setErr(card, err.message);
        btn.disabled = false;
      }
    };
    app.appendChild(card);
  };
  mount();
}

/* ===================================================================== landing
 * Everything an anonymous visitor sees: an attractive public page with real
 * Good/Care locations on a live map, a way to share "the good" (location only),
 * read-only post detail, and a Log in button. "Needs care" + replies need auth.
 * ========================================================================== */

function anonTopBar() {
  const bar = h(`
    <header class="land-top">
      <div class="brand cjk" data-home>优城美市<small>Our Block</small></div>
      <div class="land-top-right">
        <button class="btn primary land-login">${esc(t('Log in'))}</button>
      </div>
    </header>`);
  bar.querySelector('[data-home]').onclick = () => go('');
  bar.querySelector('.land-login').onclick = () => go('login');
  bar.querySelector('.land-top-right').prepend(langSwitcher('compact'), themeToggle('compact'));
  return bar;
}

async function renderLanding() {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());

  const hero = h(`
    <section class="hero">
      <h1>${esc(t('Your block, in good hands — together.'))}</h1>
      <p>${esc(t("Notice the good on your street, and flag what needs care — then act. Here's what neighbours nearby are noticing right now."))}</p>
      <div class="hero-cta">
        <button class="btn primary" data-share>✦ ${esc(t('Share something good'))}</button>
        <button class="btn ghost" data-login>△ ${esc(t('Log in to flag care'))}</button>
      </div>
      <div class="hero-note">${esc(t('Sharing “the good” is open to everyone — just allow your location. Flagging “needs care” and replying to neighbours need a free account.'))}</div>
    </section>`);
  hero.querySelector('[data-share]').onclick = () => go('share');
  hero.querySelector('[data-login]').onclick = () => go('login');
  wrap.appendChild(hero);

  // Fetch a wide pool of real public posts and let the map's radius filter narrow it
  // client-side as the visitor pans/zooms.
  let realPosts = [];
  try {
    const [g, c] = await Promise.all([
      api.get('/api/posts?stream=good&sort=new&limit=50').catch(() => ({ posts: [] })),
      api.get('/api/posts?stream=care&sort=new&limit=50').catch(() => ({ posts: [] })),
    ]);
    realPosts = [...(g.posts || []), ...(c.posts || [])];
  } catch { /* offline */ }

  const cols = h(`<div class="land-cols"></div>`);
  const goodCol = h(`<div class="land-col"><h2>✦ ${esc(t('The Good nearby'))}</h2><div class="land-grid"></div></div>`);
  const careCol = h(`<div class="land-col"><h2>△ ${esc(t('Needs Care nearby'))}</h2><div class="land-grid"></div></div>`);
  cols.append(goodCol, careCol);

  // The map owns the radius filter and keeps the two columns in sync as it pans/zooms.
  wrap.appendChild(landingMap(realPosts, goodCol.querySelector('.land-grid'), careCol.querySelector('.land-grid')));
  wrap.appendChild(cols);

  wrap.appendChild(h(`<footer class="land-foot">优城美市 · ${esc(t('Our Block — a place-based civic wellbeing app.'))}</footer>`));
  app.appendChild(wrap);
}

function landingCard(p) {
  const g = p.stream === 'good';
  const card = h(`<article class="lcard"></article>`);
  card.appendChild(p.mediaUrl
    ? h(`<div class="lmedia"><img src="${esc(p.mediaUrl)}" alt=""></div>`)
    : h(`<div class="lmedia ph ${g ? 'g' : 'c'}">${g ? '✦' : '△'}</div>`));
  card.appendChild(h(`<div class="lbody">
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.body || '')}</p>
      <div class="lmeta">📍 ${esc(p.placeName || t('Nearby'))} · ${esc(p.author?.name || t('A neighbour'))} · ${timeAgo(p.createdAt)}${p.sample ? ` · <span class="sample-tag">${esc(t('sample'))}</span>` : ''}</div>
    </div>`));
  card.onclick = () => go(`post/${p.id}`);
  return card;
}

// Radius choices for the landing filter. Default is one mile (1609.34 m); the picker lets a
// visitor widen the view. Distances are great-circle (haversine) from the map's centre.
const LAND_RADII = [
  { mi: 1, m: 1609.34 },
  { mi: 3, m: 4828.03 },
  { mi: 5, m: 8046.72 },
  { mi: 10, m: 16093.4 },
];

function landingMap(realPosts, goodGrid, careGrid) {
  let radiusM = LAND_RADII[0].m; // 1 mile by default

  const card = h(`
    <div class="map-card land-map">
      <div class="loc">
        <span class="live"></span>📍 <span class="loc-name">${esc(t('Exploring nearby'))}</span>
        <label class="radius-pick">${esc(t('Within'))} <select class="radius-select" aria-label="${esc(t('Show posts within this radius'))}"></select></label>
      </div>
      <div class="gmap"></div>
    </div>`);
  const el = card.querySelector('.gmap');
  const nameEl = card.querySelector('.loc-name');
  const sel = card.querySelector('.radius-select');
  LAND_RADII.forEach((r) => sel.appendChild(h(`<option value="${r.m}">${r.mi} ${esc(t('mi'))}</option>`)));
  sel.value = String(radiusM);

  getEngine().then(async ({ create }) => {
    const first = realPosts.find((p) => p.lat != null);
    const M = create(el, first ? [first.lat, first.lng] : [20, 0], first ? 14 : 2);

    let origin = null;   // the visitor's real location, once geolocation resolves
    let pins = [];       // current pin markers
    let youM = null;
    let ready = false;   // suppress filtering on programmatic moves during setup

    // Resolve every real post to an absolute [lat,lng] using its own stored coordinates.
    const resolved = () =>
      realPosts.filter((p) => p.lat != null).map((p) => ({ ...p, _lat: p.lat, _lng: p.lng }));

    const liveCentre = () => (M.center && M.center()) || origin || (first ? [first.lat, first.lng] : null);
    const within = (c) => {
      const all = resolved();
      if (!c) return all;
      return all.filter((p) => { const d = haversine({ lat: c[0], lng: c[1] }, { lat: p._lat, lng: p._lng }); return d != null && d <= radiusM; });
    };

    // Repaint pins + both columns from a precomputed in-radius set.
    const paint = (list) => {
      pins.forEach((m) => M.remove(m)); pins = [];
      list.forEach((p) => pins.push(M.addPin(p._lat, p._lng, p.stream === 'good', () => go(`post/${p.id}`))));
      const fill = (grid, items, emptyMsg) => {
        grid.innerHTML = '';
        if (items.length) items.forEach((p) => grid.appendChild(landingCard(p)));
        else grid.appendChild(h(`<p class="land-empty">${esc(emptyMsg)}</p>`));
      };
      fill(goodGrid, list.filter((p) => p.stream === 'good'), t('Be the first to report what’s good here.'));
      fill(careGrid, list.filter((p) => p.stream === 'care'), t('Nothing flagged for care nearby — that’s a good sign.'));
    };

    // Recentre on an explicit point, fit the view to that point's in-radius posts, and paint.
    // Used on first render, on location lock, and on radius change. We pass the target centre
    // explicitly (rather than reading the map) because the fit moves the map asynchronously.
    const recentre = (c) => {
      ready = false;
      const list = within(c);
      const bounds = list.map((p) => [p._lat, p._lng]);
      if (origin) bounds.push(origin);
      if (bounds.length) M.fit(bounds, 16);
      paint(list);
      setTimeout(() => { ready = true; }, 300); // ignore the fit's own move event
    };

    // User pans/zooms → re-filter around wherever the map now sits.
    if (M.onMove) M.onMove(() => { if (ready) paint(within(liveCentre())); });
    sel.onchange = () => { radiusM = Number(sel.value); recentre(liveCentre()); };

    recentre(liveCentre());

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        origin = [pos.coords.latitude, pos.coords.longitude];
        if (youM) M.move(youM, origin[0], origin[1]); else youM = M.addYou(origin[0], origin[1]);
        recentre(origin);
        const geo = await reverseGeocode(origin[0], origin[1]);
        if (geo?.neighborhood) nameEl.textContent = geo.neighborhood;
      }, () => { /* keep sample view */ }, { enableHighAccuracy: true, timeout: 8000 });
    }
  }).catch(() => mapFallback(el));

  return card;
}

/* ----------------------------------------------- AI writing-style composer */
// Languages we have style catalogs + gateway support for, with native labels for the picker.
const STYLE_LANGS = [
  { code: 'zh', label: '中文' }, { code: 'en', label: 'English' }, { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' }, { code: 'de', label: 'Deutsch' }, { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' }, { code: 'ja', label: '日本語' }, { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt (Vietnamese)' }, { code: 'ru', label: 'Русский' }, { code: 'ar', label: 'العربية' }, { code: 'hi', label: 'हिन्दी' },
];
// Rough country → language for a location-based default (the geo-IP hint from /api/auth/config).
const COUNTRY_LANG = {
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh', JP: 'ja', KR: 'ko', VN: 'vi',
  FR: 'fr', DE: 'de', AT: 'de', CH: 'de', IT: 'it', RU: 'ru', IN: 'hi',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  BR: 'pt', PT: 'pt', SA: 'ar', AE: 'ar', EG: 'ar', QA: 'ar',
};
const LANG_KEY = 'ob.lang';
const supportedLang = (c) => STYLE_LANGS.some((l) => l.code === c);

// The default writing language, derived from LOCATION first: China detection (the same signal
// the map uses) → zh, then the edge geo-IP country, then the browser locale, else English.
function defaultLang() {
  if (browserInChina()) return 'zh';
  const cc = (state.config && state.config.country || '').toUpperCase();
  if (COUNTRY_LANG[cc]) return COUNTRY_LANG[cc];
  const loc = (navigator.language || 'en').toLowerCase().split(/[-_]/)[0];
  return supportedLang(loc) ? loc : 'en';
}

// The active writing language: a saved user choice wins; otherwise the location default.
function currentLang() {
  try { const saved = localStorage.getItem(LANG_KEY); if (supportedLang(saved)) return saved; } catch { /* private mode */ }
  const d = defaultLang();
  return supportedLang(d) ? d : 'en';
}
function setLang(code) { try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode */ } }

// Renders a language picker + a row of culturally-iconic writing-style chips (鲁迅风格 / 古文 /
// 李白 … in Chinese, Shakespeare / Hemingway … in English, etc.) and wires each to the LLM
// composer. Tapping a chip rewrites the title + description from the photo and/or note in that
// voice. The picker defaults to the location's language; changing it reloads the chips and is
// remembered. `host` is where the row is appended.
async function mountStyleComposer(host, { getFile, getNote, stream, fill, busy }) {
  const row = h(`<div class="style-row">
      <div class="style-head">
        <span class="style-lead">${ICONS.spark}<b>Write it as…</b></span>
        <select class="style-lang" aria-label="Writing language"></select>
      </div>
      <div class="style-chips"></div>
    </div>`);
  const sel = row.querySelector('.style-lang');
  const chips = row.querySelector('.style-chips');
  STYLE_LANGS.forEach((l) => sel.appendChild(h(`<option value="${l.code}">${esc(l.label)}</option>`)));

  let lang = currentLang();
  sel.value = lang;
  let seq = 0;

  async function loadChips(lng) {
    chips.innerHTML = '<span class="style-loading">…</span>';
    let styles = [];
    try { ({ styles = [] } = await api.get(`/api/ai/styles?lang=${encodeURIComponent(lng)}`)); }
    catch { chips.innerHTML = ''; return; }
    chips.innerHTML = '';
    styles.forEach((s) => {
      const chip = h(`<button type="button" class="style-chip" data-id="${esc(s.id)}"${s.hint ? ` title="${esc(s.hint)}"` : ''}>${esc(s.label)}</button>`);
      chip.onclick = async () => {
        const file = getFile();
        const note = (getNote() || '').trim();
        if (!file && !note) { toast('Add a photo or a note first', ''); return; }
        const my = ++seq;
        chips.querySelectorAll('.style-chip').forEach((c) => c.classList.toggle('on', c === chip));
        chip.classList.add('busy');
        busy?.(true, s.label);
        try {
          const streamNow = typeof stream === 'function' ? stream() : stream;
          const { title, description } = await api.compose({ file, note, stream: streamNow, lang: lng, style: s.id });
          if (my !== seq) return; // a newer pick superseded this one
          fill({ title, description, label: s.label });
        } catch (e) {
          toast(e.message || 'AI is unavailable right now', 'err');
        } finally {
          chip.classList.remove('busy');
          busy?.(false);
        }
      };
      chips.appendChild(chip);
    });
  }

  sel.onchange = () => { lang = sel.value; setLang(lang); loadChips(lang); };
  host.appendChild(row);
  loadChips(lang);
}

/* --------------------------------------------------- anonymous "share the good" */
function renderAnonShare() {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());

  const view = h(`
    <section class="share-view">
      <a class="back-link" data-back>‹ ${esc(t('Back to explore'))}</a>
      <h1>${esc(t('Share something good'))} ✦</h1>
      <p class="share-sub">${esc(t('Savour what your neighbours are doing well. A photo is required as evidence, and your location is attached so it lands on the block. No account needed.'))}</p>
      <div class="loc-status" data-loc>${esc(t('Requesting your location…'))}</div>

      <label class="photo-cta">${ICONS.camera}<span><b>${esc(t('Take a photo'))}</b><small>${esc(t('Required as evidence — the AI writes the title & description from it'))}</small></span>
        <input type="file" accept="image/*" capture="environment" hidden></label>
      <div class="vf-preview hidden"></div>
      <div class="geo-check hidden"></div>

      <div class="card">
        <div class="field"><label>${esc(t('Add a note'))} <small>${esc(t('(optional)'))}</small></label><input name="note" placeholder="${esc(t('anything extra for your neighbours'))}"></div>
        <button class="btn ghost" data-ai>${ICONS.spark} ${esc(t('Suggest title & description'))}</button>
        <div class="ai-preview hidden">${ICONS.spark}<div class="ai-text"></div></div>
        <div class="field"><label>${esc(t('Title'))}</label><input name="title" placeholder="${esc(t('A short title'))}"></div>
        <div class="field"><label>${esc(t('Description'))} <small>${esc(t('(50 words or less)'))}</small></label><textarea name="desc" rows="3" placeholder="${esc(t('A warm line for your neighbours'))}"></textarea></div>
        <button class="btn primary" data-post disabled>${esc(t('Post to the block'))}</button>
        <div class="share-foot">${tf('Want to flag something that needs care? {login}.', { login: `<a data-login>${esc(t('Log in'))}</a>` })}</div>
      </div>
    </section>`);
  wrap.appendChild(view);
  app.appendChild(wrap);

  const draft = { coords: null, place: null, file: null };
  const locEl = view.querySelector('[data-loc]');
  const noteInput = view.querySelector('[name=note]');
  const titleInput = view.querySelector('[name=title]');
  const descInput = view.querySelector('[name=desc]');
  const aiBox = view.querySelector('.ai-preview');
  const aiText = view.querySelector('.ai-text');
  const postBtn = view.querySelector('[data-post]');
  const preview = view.querySelector('.vf-preview');
  const geoEl = view.querySelector('.geo-check');

  view.querySelector('[data-back]').onclick = () => go('');
  view.querySelector('[data-login]').onclick = () => go('login');

  // A post needs a title, a photo (evidence) and a location — and the photo's GPS (if any)
  // must match that location.
  const refresh = () => { postBtn.disabled = !titleInput.value.trim() || !draft.coords || !draft.file || draft.geoFar; };
  titleInput.oninput = refresh;

  // location is mandatory for any post
  const setLoc = (txt, ok) => { locEl.textContent = txt; locEl.classList.toggle('ok', !!ok); };
  function requestLoc() {
    if (!navigator.geolocation) { setLoc(t('Location isn’t available on this device — you can’t post here.'), false); return; }
    setLoc(t('Requesting your location…'), false);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      draft.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const geo = await reverseGeocode(draft.coords.lat, draft.coords.lng);
      draft.place = geo?.placeName || `${draft.coords.lat.toFixed(4)}, ${draft.coords.lng.toFixed(4)}`;
      setLoc(`📍 ${draft.place}`, true);
      verifyPhotoGeo(draft, geoEl, refresh); // recheck the photo against this location
    }, () => setLoc(t('Turn on location to post to the block — tap to retry.'), false),
    { enableHighAccuracy: true, timeout: 8000 });
  }
  locEl.onclick = requestLoc;
  requestLoc();

  // photo → let the neighbour crop it, then preview + auto-compose from the image
  view.querySelector('input[type=file]').onchange = async (e) => {
    const original = e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!original) return;
    const cropped = await cropImage(original); // null = cancelled
    if (!cropped) return;
    draft.file = cropped;
    preview.classList.remove('hidden');
    preview.innerHTML = '';
    preview.appendChild(h(`<img src="${URL.createObjectURL(cropped)}" alt="${esc(t('preview'))}">`));
    refresh();
    compose();
    // GPS lives in the ORIGINAL file's EXIF — cropping re-encodes and strips it.
    draft.photoGps = null;
    exifGps(original).then((g) => { draft.photoGps = g; verifyPhotoGeo(draft, geoEl, refresh); });
  };

  // AI compose (from the photo and/or the note)
  let seq = 0;
  async function compose() {
    if (!draft.file && !noteInput.value.trim()) { toast(t('Take a photo or write a few words first'), ''); return; }
    const my = ++seq;
    aiBox.classList.remove('hidden');
    aiText.innerHTML = `<b>${esc(t('Thinking…'))}</b>`;
    try {
      const { title, description } = await api.compose({ file: draft.file, note: noteInput.value.trim(), stream: 'good', lang: currentLang() });
      if (my !== seq) return;
      if (title && !titleInput.value.trim()) titleInput.value = title;
      if (description && !descInput.value.trim()) descInput.value = description;
      aiText.innerHTML = `<b>${esc(t('Suggested — edit anything before posting.'))}</b>`;
      refresh();
    } catch (err) { aiBox.classList.add('hidden'); toast(err.message, 'err'); }
  }
  view.querySelector('[data-ai]').onclick = compose;

  // Culturally-iconic style chips — tapping one rewrites the title + description in that voice.
  const styleHost = h('<div class="style-host"></div>');
  aiBox.after(styleHost);
  mountStyleComposer(styleHost, {
    getFile: () => draft.file,
    getNote: () => noteInput.value,
    stream: 'good',
    busy: (on, label) => {
      if (!on) return;
      aiBox.classList.remove('hidden');
      aiText.innerHTML = `✍️ <b>${tf('Writing as {label}…', { label: esc(label) })}</b>`;
    },
    fill: ({ title, description, label }) => {
      if (title) titleInput.value = title;       // styled picks intentionally replace the fields
      if (description) descInput.value = description;
      aiBox.classList.remove('hidden');
      aiText.innerHTML = `✍️ <b>${esc(label)}</b> — ${esc(t('edit anything before posting.'))}`;
      refresh();
    },
  });

  postBtn.onclick = async () => {
    if (!draft.coords) { toast(t('Turn on location first'), 'err'); return; }
    postBtn.disabled = true; postBtn.textContent = t('Posting…');
    try {
      let mediaUrl = null, mediaType = 'photo';
      if (draft.file) { const u = await api.upload(draft.file); mediaUrl = u.url; mediaType = u.mediaType; }
      const { post } = await api.post('/api/posts', {
        stream: 'good',
        title: titleInput.value.trim(),
        body: descInput.value.trim(),
        mediaType, mediaUrl,
        lat: draft.coords.lat, lng: draft.coords.lng,
        placeName: draft.place,
      });
      toast(t('Posted to your block') + ' ✦', 'ok');
      go(`post/${post.id}`);
    } catch (err) {
      toast(err.message, 'err');
      postBtn.disabled = false; postBtn.textContent = t('Post to the block');
    }
  };
}

/** The 📍 address label shown on post detail. When the post carries coordinates it
 * becomes a button that opens the map on demand — the detail page ships an address
 * (text) and never an inline map, so the exact spot is only revealed on a tap. */
function addrLabel(p) {
  const place = esc(p.placeName || t('Nearby'));
  return (p.lat != null && p.lng != null)
    ? `<button class="addr-btn" type="button" data-map>📍 ${place} <span class="addr-map-hint">${esc(t('map'))}</span></button>`
    : `📍 ${place}`;
}

/** Wire the addrLabel button inside a rendered element to open the map popup. */
function wireAddr(el, p) {
  el.querySelector('[data-map]')?.addEventListener('click', () => openMapPopup(p));
}

/** Open a single post's location on a map in a dismissible popup, loading the map
 * engine on demand. Kept ungated (same reveal as before) — the map moved off the
 * page, not behind proximity. */
function openMapPopup(p) {
  if (p.lat == null || p.lng == null) return;
  const overlay = h(`<div class="modal-overlay"></div>`);
  const cardEl = h(`<div class="modal-card map-popup">
      <div class="map-popup-head">📍 ${esc(p.placeName || t('Location'))}</div>
      <div class="map-card detail-map"><div class="gmap"></div></div>
    </div>`);
  const close = h(`<button class="modal-close" type="button" aria-label="${esc(t('Close'))}">×</button>`);
  const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
  close.onclick = dismiss;
  overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
  document.addEventListener('keydown', onKey);
  cardEl.appendChild(close);
  overlay.appendChild(cardEl);
  document.body.appendChild(overlay);
  const el = cardEl.querySelector('.gmap');
  getEngine().then(({ create }) => {
    const M = create(el, [p.lat, p.lng], 16);
    M.addPin(p.lat, p.lng, p.stream === 'good');
  }).catch(() => mapFallback(el));
}

/* ----------------------------------------------- anonymous read-only post detail */
async function renderAnonPost(id) {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());
  const view = h(`<section class="anon-post"><a class="back-link" data-back>‹ ${esc(t('Back to explore'))}</a><div class="slot"><div class="spinner"></div></div></section>`);
  wrap.appendChild(view);
  app.appendChild(wrap);
  view.querySelector('[data-back]').onclick = () => go('');
  const slot = view.querySelector('.slot');

  try {
    const { post: p, comments } = await api.get(`/api/posts/${id}`);
    slot.innerHTML = '';
    slot.appendChild(anonPostCard(p, { comments }));
  } catch (err) {
    slot.innerHTML = `<div class="empty"><b>${esc(t("Couldn't load this post"))}</b>${esc(err.message)}</div>`;
  }
}

function anonPostCard(p, { sample, comments } = {}) {
  const g = p.stream === 'good';
  const box = h(`<div></div>`);
  box.appendChild(p.mediaUrl
    ? h(`<div class="detail-media"><img src="${esc(p.mediaUrl)}" alt=""></div>`)
    : h(`<div class="detail-media ${g ? 'g' : 'c'}"></div>`));
  const metaCard = h(`<div class="card" style="margin-top:14px">
      <div><span class="badge" style="background:${g ? 'var(--good)' : 'var(--care)'};color:${g ? '#3a2a10' : '#fff'}">${g ? '✦ ' + esc(t('The Good')) : '△ ' + esc(t('Needs Care'))}</span>${sample ? ` <span class="sample-tag">${esc(t('sample'))}</span>` : ''}</div>
      <h2 style="font-family:var(--display);font-size:22px;margin:8px 0 6px">${esc(p.title)}</h2>
      <div class="pmeta">${addrLabel(p)} · ${esc(p.author?.name || t('A neighbour'))} · ${timeAgo(p.createdAt)}</div>
      ${p.body ? `<p class="pdesc" style="margin-top:8px">${esc(p.body)}</p>` : ''}
    </div>`);
  wireAddr(metaCard, p);
  box.appendChild(metaCard);

  const cbox = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:8px">${comments ? tf('Neighbour replies ({n})', { n: comments.length }) : esc(t('Neighbour replies'))}</h4></div>`);
  if (sample) {
    cbox.appendChild(h(`<p style="font-size:12.5px;color:var(--ink-soft)">${esc(t('This is a sample showing how Our Block works. Log in to join your real block.'))}</p>`));
  } else {
    (comments || []).forEach((c) => cbox.appendChild(h(`
      <div class="comment"><div class="av cartoon">${avatarMarkup({ name: c.author, avatar: c.avatar }, 30)}</div>
        <div><b>${esc(c.author)}</b> <span style="color:var(--ink-soft);font-size:11px">· ${timeAgo(c.createdAt)}</span>
        <p>${esc(c.body)}</p></div></div>`)));
    if (!comments || !comments.length) cbox.appendChild(h(`<p style="font-size:12.5px;color:var(--ink-soft)">${esc(t('No replies yet.'))}</p>`));
    const prompt = h(`<button class="btn primary" style="margin-top:10px;width:auto;padding:10px 16px">${esc(t('Log in to reply'))}</button>`);
    prompt.onclick = () => go('login');
    cbox.appendChild(prompt);
  }
  box.appendChild(cbox);
  return box;
}

/* --------------------------------------------------------------- app shell */
function render() {
  if (state.view === 'capture') return renderShell(captureView());
  if (state.view === 'post') return renderShell(postDetailView());
  if (state.view === 'impact') return renderShell(impactView());
  if (state.view === 'community') return renderShell(communityView());
  return renderShell(feedView());
}

function renderShell(centerNode) {
  const u = state.user;
  app.innerHTML = '';
  const shell = h(`<div class="app-shell"></div>`);

  // left rail
  const rail = h(`
    <aside class="rail">
      <div class="brand cjk">优城美市<small>Our Block</small></div>
      <div style="height:8px"></div>
      <div class="nav-slot"></div>
      <div class="spacer"></div>
      <div class="me">
        <div class="av cartoon">${avatarMarkup(u, 40)}</div>
        <div><b>${esc(u.name)}</b><span>${esc(t('Lv.'))} ${u.level} ${esc(t(u.levelTitle))} · ${tf('{n} pts', { n: u.pointsEarned || 0 })}</span></div>
      </div>
      <div class="rail-foot"></div>
      <button class="signout">${esc(t('Sign out'))}</button>
    </aside>`);
  const navSlot = rail.querySelector('.nav-slot');
  NAV.forEach((n) => {
    const item = h(`<button class="nav-i ${state.view === n.key ? 'on' : ''}" data-help="nav-${n.key}">${ICONS[n.icon]}${esc(t(n.label))}</button>`);
    item.onclick = () => go(n.key);
    navSlot.appendChild(item);
  });
  rail.querySelector('.rail-foot').append(langSwitcher(), themeToggle());
  rail.querySelector('.signout').onclick = signOut;
  rail.querySelector('.me').onclick = openAccount;
  rail.querySelector('.me').style.cursor = 'pointer';

  // center
  const main = h(`<main class="main"></main>`);
  main.appendChild(mobileTop());
  main.appendChild(centerNode);

  // right side
  const side = sidePanel();

  shell.append(rail, main, side);
  app.appendChild(shell);
  app.appendChild(mobileNav());
  if (state.view !== 'capture') app.appendChild(fab());
}

function mobileTop() {
  const bar = h(`<div class="mobile-top"><div class="brand cjk">优城美市<small>Our Block</small></div></div>`);
  const right = h(`<div class="mobile-top-right"></div>`);
  const out = h(`<button class="signout" style="width:auto;padding:7px 12px;background:var(--card);color:var(--ink-soft);border-color:var(--line)">${esc(t('Sign out'))}</button>`);
  out.onclick = signOut;
  right.append(langSwitcher('compact'), themeToggle('compact'), out);
  bar.appendChild(right);
  return bar;
}

function mobileNav() {
  const nav = h(`<nav class="pnav"></nav>`);
  [['near', 'Map', 'near'], ['care', 'Care', 'care'], ['impact', 'Impact', 'impact'], ['community', 'Me', 'community']]
    .forEach(([key, label, icon]) => {
      const b = h(`<button class="${state.view === key ? 'on' : ''}">${ICONS[icon]}${esc(t(label))}</button>`);
      b.onclick = () => go(key);
      nav.appendChild(b);
    });
  return nav;
}

function fab() {
  const f = h(`<button class="fab" data-help="new-capture">${ICONS.camera.replace('currentColor', '#3a2a10')}</button>`);
  f.onclick = () => go('capture');
  return f;
}

async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  api.clearToken();
  state.user = null;
  location.hash = '';
  renderAuth();
}

/* ---------------------------------------------------------------- account */
function openAccount() {
  const u = state.user;
  const isGoogle = u.provider === 'google';
  const overlay = h(`<div class="modal-overlay"></div>`);
  const modal = h(`
    <div class="modal">
      <div class="modal-head">
        <div class="av cartoon" style="width:46px;height:46px">${avatarMarkup(u, 46)}</div>
        <div><b style="font-family:var(--display);font-size:15px">${esc(u.name)}</b><div style="font-size:11.5px;color:var(--ink-soft)">${esc(u.email)} · ${isGoogle ? esc(t('Google account')) : esc(t('Email account'))}</div></div>
        <button class="modal-x" aria-label="${esc(t('Close'))}">✕</button>
      </div>
      <div class="modal-body">
        <h4 style="font-family:var(--display);font-size:13px;margin-bottom:8px">${esc(t('Your cartoon avatar'))}</h4>
        <div class="avatar-edit">
          <div class="av cartoon big" data-av-preview>${avatarMarkup(u, 72)}</div>
          <div>
            <p style="font-size:12px;color:var(--ink-soft);margin-bottom:8px">${esc(t('A unique character, generated just for you.'))}</p>
            <button class="btn ghost" type="button" data-regen>🎲 ${esc(t('Generate a new one'))}</button>
          </div>
        </div>
        <div class="modal-divider"></div>
        ${isGoogle ? `
          <p style="font-size:12.5px;color:var(--ink-soft);line-height:1.5">${esc(t("You're signed in with Google. Manage your password and security in your Google account."))}</p>`
        : `
          <h4 style="font-family:var(--display);font-size:13px;margin-bottom:10px">${esc(t('Change password'))}</h4>
          <div class="err-slot"></div>
          <form class="acct-form">
            <div class="field"><label>${esc(t('Current password'))}</label><input name="currentPassword" type="password" required></div>
            <div class="field"><label>${esc(t('New password'))}</label><input name="newPassword" type="password" placeholder="${esc(t('at least 6 characters'))}" required></div>
            <button class="btn primary" type="submit">${esc(t('Update password'))}</button>
          </form>`}
        <div class="modal-divider"></div>
        <div class="official-slot"></div>
      </div>
    </div>`);
  overlay.appendChild(modal);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  modal.querySelector('.modal-x').onclick = close;

  // Regenerate cartoon avatar (③) — preview a fresh seed, persist it, re-render the shell.
  const regen = modal.querySelector('[data-regen]');
  if (regen) regen.onclick = async () => {
    const seed = randomSeed();
    modal.querySelector('[data-av-preview]').innerHTML = avatarSvg(seed, 72);
    regen.disabled = true;
    try {
      const { user } = await api.put('/api/auth/me/profile', { avatarSeed: seed });
      state.user = user;
      modal.querySelector('.modal-head .av').innerHTML = avatarMarkup(user, 46);
      toast(t('New avatar saved'), 'ok');
    } catch (e) { toast(e.message, 'err'); }
    finally { regen.disabled = false; }
  };

  const form = modal.querySelector('.acct-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true;
    modal.querySelector('.err-slot').innerHTML = '';
    try {
      await api.post('/api/auth/change-password', Object.fromEntries(new FormData(form)));
      toast(t('Password changed'), 'ok'); close();
    } catch (err) {
      modal.querySelector('.err-slot').innerHTML = `<div class="auth-err">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
  renderOfficialSection(modal.querySelector('.official-slot'), () => { state.user && render(); });

  document.body.appendChild(overlay);
}

/* Official/property accounts (①) — apply as a resident, see your status, and (for admins)
 * verify pending applications. Self-contained so it works from the account modal. */
function renderOfficialSection(host, onChange) {
  const u = state.user;
  host.innerHTML = `<h4 style="font-family:var(--display);font-size:13px;margin-bottom:8px">${esc(t('Official / property account'))}</h4>`;

  if (u.role === 'official' && u.verified) {
    host.appendChild(h(`<div class="official-chip">🏢 ${tf('Verified · {org}', { org: esc(u.orgName || t('Official')) })}</div>`));
    host.appendChild(h(`<p class="muted-note">${esc(t('You can claim, update and resolve care items across the block.'))}</p>`));
  } else if (u.officialPending) {
    host.appendChild(h(`<div class="official-chip pending">⏳ ${esc(t('Application under review'))}</div>`));
  } else {
    const f = h(`<form class="acct-form">
        <p class="muted-note">${esc(t('Residents’ committee, property management or a local org? Apply to run a verified account.'))}</p>
        <div class="field"><label>${esc(t('Organisation name'))}</label><input name="orgName" placeholder="${esc(t('e.g. Garden Estate Property Mgmt'))}" required></div>
        <button class="btn ghost" type="submit">${esc(t('Apply for verification'))}</button>
      </form>`);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/community/apply-official', { orgName: f.querySelector('[name=orgName]').value.trim() });
        state.user = { ...u, officialPending: true };
        toast(t('Application sent for review'), 'ok');
        renderOfficialSection(host, onChange);
      } catch (err) { toast(err.message, 'err'); }
    };
    host.appendChild(f);
  }

  // Admin: pending applications to verify.
  if (u.isAdmin) {
    const panel = h(`<div class="admin-officials"><div class="modal-divider"></div>
        <h4 style="font-family:var(--display);font-size:13px;margin-bottom:8px">${esc(t('Pending official applications'))} <span class="adm-tag">${esc(t('admin'))}</span></h4>
        <div class="adm-slot">…</div></div>`);
    host.appendChild(panel);
    const slot = panel.querySelector('.adm-slot');
    api.get('/api/community/officials').then(({ pending }) => {
      slot.innerHTML = '';
      if (!pending.length) { slot.innerHTML = `<p class="muted-note">${esc(t('No applications waiting.'))}</p>`; return; }
      pending.forEach((a) => {
        const row = h(`<div class="adm-row"><div><b>${esc(a.orgName || a.name)}</b><small>${esc(a.name)} · ${esc(a.email)}</small></div>
            <button class="btn ghost adm-ok">✓ ${esc(t('Verify'))}</button></div>`);
        row.querySelector('.adm-ok').onclick = async () => {
          try { await api.post('/api/community/verify-official', { userId: a.id, orgName: a.orgName }); toast(t('Account verified'), 'ok'); row.remove(); onChange?.(); }
          catch (e) { toast(e.message, 'err'); }
        };
        slot.appendChild(row);
      });
    }).catch(() => { slot.innerHTML = `<p class="muted-note">${esc(t('Couldn’t load applications.'))}</p>`; });
  }
}

/* --------------------------------------------------------------- feed view */
function feedView() {
  const isNear = state.view === 'near';
  const meta = STREAM_META[state.stream];
  const wrap = h(`<div></div>`);

  // location bar (mobile-friendly, mirrors the desktop "loc" chip)
  wrap.appendChild(h(`
    <div class="locbar">
      <div class="gps">${ICONS.pin.replace('currentColor', '#234E3F')}</div>
      <div><b>${esc(state.user.neighborhood || t('Your area'))}</b><span>${esc(t('Showing places near you'))}</span></div>
      <span class="live"></span>
    </div>`));

  // header + stream toggle
  const top = h(`
    <div class="toprow">
      <h2>${isNear ? esc(t('Near Me')) : esc(t(meta.title))}<small class="count-sub">…</small></h2>
      <div class="seg">
        <button class="${state.stream === 'good' ? 'on good' : 'good'}" data-s="good">✦ ${esc(t('The Good'))}</button>
        <button class="${state.stream === 'care' ? 'on care' : 'care'}" data-s="care">△ ${esc(t('Needs Care'))}</button>
      </div>
    </div>`);
  top.querySelectorAll('[data-s]').forEach((b) => {
    b.onclick = () => { state.stream = b.dataset.s; if (!isNear) go(state.stream); else render(); };
  });
  wrap.appendChild(top);

  // sort pills
  const sorts = h(`
    <div class="sortbar">
      <span class="lbl">${esc(t('Sort'))}</span>
      ${[['near', 'Nearest'], ['new', 'Newest'], ['top', 'Most cheered']]
        .map(([k, l]) => `<button class="pill ${state.sort === k ? 'on' : ''}" data-sort="${k}">${esc(t(l))}</button>`).join('')}
    </div>`);
  sorts.querySelectorAll('[data-sort]').forEach((b) => {
    b.onclick = () => { state.sort = b.dataset.sort; render(); };
  });
  wrap.appendChild(sorts);

  // map — always shown. Near Me shows everything; the Good/Care views show their stream.
  wrap.appendChild(mapCard(isNear ? null : state.stream));

  const feed = h(`<div class="feed"></div>`);
  feed.appendChild(h(`<div class="spinner"></div>`));
  wrap.appendChild(feed);

  loadFeed(feed, top.querySelector('.count-sub'));
  return wrap;
}

async function loadFeed(feed, countEl, offset = 0) {
  try {
    const { posts, total, hasMore } = await api.get(
      `/api/posts?stream=${state.stream}&sort=${state.sort}&offset=${offset}&limit=20`
    );
    if (offset === 0) feed.innerHTML = '';
    else feed.querySelector('.load-more-wrap')?.remove();
    if (countEl) countEl.textContent = tf(state.stream === 'good' ? '{n} good things nearby' : '{n} places that need care', { n: total });
    if (!total) {
      feed.appendChild(onboardingCard());
      return;
    }
    posts.forEach((p) => feed.appendChild(postCard(p)));
    if (hasMore) {
      const wrap = h(`<div class="load-more-wrap" style="grid-column:1/-1;text-align:center;margin-top:6px"><button class="pill">${esc(t('Load more'))}</button></div>`);
      wrap.querySelector('button').onclick = () => loadFeed(feed, countEl, offset + posts.length);
      feed.appendChild(wrap);
    }
  } catch (err) {
    if (offset === 0) feed.innerHTML = '';
    feed.appendChild(h(`<div class="empty"><b>${esc(t("Couldn't load the feed"))}</b>${esc(err.message)}</div>`));
  }
}

/* Cold-start onboarding (⑧) — instead of a bare "nothing here", new neighbours get a warm
 * welcome, their Founding Steward badge (if eligible), and a few guided first tasks. */
function onboardingCard() {
  const u = state.user;
  const founder = (u.badges || []).includes('founding-steward');
  const card = h(`<div class="onboard">
      ${founder ? `<div class="onboard-badge">${badgeChip('founding-steward')}</div>` : ''}
      <h3>${founder ? esc(t('You’re a Founding Steward of this block ✦')) : esc(t('Welcome to your block ✦'))}</h3>
      <p>${esc(t('It’s quiet here — which means you get to start the story. Here are three ways to begin.'))}</p>
      <div class="onboard-steps">
        <button class="onboard-step" data-go="capture"><span>📸</span><div><b>${esc(t('Capture something good or that needs care'))}</b><small>${esc(t('+5 points · starts a card story'))}</small></div></button>
        <button class="onboard-step" data-go="good"><span>✦</span><div><b>${esc(t('Browse The Good nearby'))}</b><small>${esc(t('cheer a neighbour to send your first points'))}</small></div></button>
        <button class="onboard-step" data-go="impact"><span>🎯</span><div><b>${esc(t('See your missions'))}</b><small>${esc(t('daily & weekly tasks to grow your level'))}</small></div></button>
      </div>
    </div>`);
  card.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
  return card;
}

/* --------------------------------------------------------------- post card */
// Proximity reveal — "Our Block" is hyper-local: you can only read a message's full text
// and photo when you're near where it was posted. The thumbnail and title still show (with
// the measured distance) so neighbours know something is there. Owners and admins are never
// gated; an unknown distance (no viewer location) reveals, so the app still works offline.
const REVEAL_RADIUS_M = 500;
const REVEAL_LABEL = '500 m';
function canReveal(p) {
  if (state.user && (p.author?.id === state.user.id || state.user.isAdmin)) return true;
  return p.distanceM == null || p.distanceM <= REVEAL_RADIUS_M;
}

function postCard(p) {
  const g = p.stream === 'good';
  const card = h(`<article class="post compact"></article>`);
  const far = !canReveal(p);

  const body = h(`<div class="pbody"></div>`);
  body.appendChild(h(`<div class="narrative">${ICONS.spark}<span>${narrativeLabel(p)}</span></div>`));
  const mood = moodOf(p.mood);
  const title = h(`<h3>${mood ? `<span class="mood-ico" title="${esc(t(mood.label))}">${mood.e}</span> ` : ''}${esc(p.title)}</h3>`);
  title.onclick = () => openPostModal(p);
  body.appendChild(title);
  body.appendChild(h(`<div class="pmeta">
      <span>📍 ${esc(p.placeName || t('Nearby'))}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''}</span>
      <span>· ${tf('by {name}', { name: esc(p.author?.name || t('Neighbour')) })}</span>
      <span>· ${timeAgo(p.createdAt)}</span>
    </div>`));

  // Tags that used to overlay the photo banner now sit above the message.
  const tags = h(`<div class="ptags"></div>`);
  if (p.ai?.tag) tags.appendChild(h(`<span class="ai-tag inline">${ICONS.spark}${esc(p.ai.tag)}</span>`));
  if (p.stream === 'care' && p.status !== 'open')
    tags.appendChild(h(`<span class="status-tag ${p.status}">${esc(t(STATUS_LABEL[p.status]))}</span>`));
  (p.groups || []).forEach((id) => { const g = groupOf(id); if (g) tags.appendChild(h(`<span class="group-tag">${g.e} ${esc(t(g.label))}</span>`)); });
  if (tags.children.length) body.appendChild(tags);

  // Message: a small thumbnail beside the description. The photo/video is no longer shown
  // full-size in the feed — tapping the thumbnail or text opens the popup. When the viewer
  // is too far from where it was posted, the thumbnail is blurred and the text is withheld.
  const msg = h(`<div class="pmsg${far ? ' locked' : ''}"></div>`);
  if (p.mediaUrl) {
    const thumb = h(`<button class="pthumb ${g ? 'g' : 'c'}${far ? ' locked' : ''}" type="button" aria-label="${esc(t('View full message'))}">
      ${p.mediaType === 'video'
        ? `<video src="${esc(p.mediaUrl)}#t=0.1" muted playsinline preload="metadata"></video><span class="thumb-play">▶</span>`
        : `<img src="${esc(p.mediaUrl)}" alt="" loading="lazy">`}
      ${far ? '<span class="thumb-lock">🔒</span>' : ''}
    </button>`);
    thumb.onclick = () => openPostModal(p);
    msg.appendChild(thumb);
  }
  const desc = far
    ? h(`<p class="pdesc locked-note">🔒 ${tf('{dist} — come within {radius} of where it was posted to read it.', { dist: p.distanceM != null ? tf('{d} away', { d: dist(p.distanceM) }) : t('Nearby'), radius: REVEAL_LABEL })}</p>`)
    : p.body
      ? h(`<p class="pdesc">${esc(p.body)}</p>`)
      : h(`<p class="pdesc muted">${p.mediaUrl ? esc(t('Tap to read the full message.')) : ''}</p>`);
  desc.onclick = () => openPostModal(p);
  msg.appendChild(desc);
  body.appendChild(msg);

  // AI action suggestion for care items routed to the city
  if (p.stream === 'care' && p.ai?.action === 'city' && p.status === 'open') {
    body.appendChild(h(`<div class="suggest">${ICONS.spark}
      <div><b>${esc(t('AI suggests: this needs the city'))}</b><p>${esc(p.ai.summary || '')}</p></div></div>`));
  }

  body.appendChild(reactionRow(p, card));
  card.appendChild(body);
  return card;
}

/* A lightweight popup showing the full message + full-size photo/video. Tapping a feed
 * card's thumbnail, title, or description opens it; the full detail page (with replies)
 * is one tap away. Closes on ×, backdrop click, or Escape. */
let _modalEsc = null;
function openPostModal(p) {
  const g = p.stream === 'good';
  const far = !canReveal(p); // too far from where it was posted → withhold photo + full text
  const overlay = h(`<div class="modal-overlay"></div>`);
  const cardEl = h(`<div class="modal-card"></div>`);

  if (p.mediaUrl && !far) {
    const media = h(`<div class="modal-media"></div>`);
    media.appendChild(p.mediaType === 'video'
      ? h(`<video src="${esc(p.mediaUrl)}" controls autoplay playsinline></video>`)
      : h(`<img src="${esc(p.mediaUrl)}" alt="">`));
    cardEl.appendChild(media);
  }
  cardEl.appendChild(h(`<div class="modal-text">
      <div class="ptags">
        <span class="badge-stream ${g ? 'g' : 'c'}">${g ? '✦ ' + esc(t('The Good')) : '△ ' + esc(t('Needs Care'))}</span>
        ${p.ai?.tag ? `<span class="ai-tag inline">${ICONS.spark}${esc(p.ai.tag)}</span>` : ''}
        ${p.stream === 'care' && p.status !== 'open' ? `<span class="status-tag ${p.status}">${esc(t(STATUS_LABEL[p.status] || p.status))}</span>` : ''}
        ${(p.groups || []).map((id) => { const gg = groupOf(id); return gg ? `<span class="group-tag">${gg.e} ${esc(t(gg.label))}</span>` : ''; }).join('')}
      </div>
      <h2>${moodOf(p.mood) ? moodOf(p.mood).e + ' ' : ''}${esc(p.title)}</h2>
      <div class="pmeta">
        <span>📍 ${esc(p.placeName || t('Nearby'))}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''}</span>
        <span>· ${tf('by {name}', { name: esc(p.author?.name || t('Neighbour')) })}</span>
        <span>· ${timeAgo(p.createdAt)}</span>
      </div>
      ${far
        ? `<div class="modal-locked">🔒<div><b>${p.distanceM != null ? esc(tf('{d} away', { d: dist(p.distanceM) })) : esc(t('You’re not nearby'))}</b>
             <p>${tf('This message and its photo unlock when you’re within {radius} of where it was posted.', { radius: REVEAL_LABEL })}</p></div></div>`
        : (p.body ? `<p class="pdesc">${esc(p.body)}</p>` : '')}
      <div class="modal-actions">
        ${far ? '' : `<a class="modal-open-full" href="#/post/${p.id}">${esc(t('Open full post & replies ›'))}</a>`}
      </div>
    </div>`));

  const close = h(`<button class="modal-close" type="button" aria-label="${esc(t('Close'))}">×</button>`);
  cardEl.appendChild(close);
  overlay.appendChild(cardEl);

  const dismiss = () => {
    overlay.remove();
    if (_modalEsc) { document.removeEventListener('keydown', _modalEsc); _modalEsc = null; }
  };

  // Owner or admin (TEACHER_EMAILS) can delete; admin can remove any post.
  const isOwner = state.user && p.author?.id === state.user.id;
  if (state.user && (isOwner || state.user.isAdmin)) {
    const del = h(`<button class="modal-del" type="button">🗑 ${isOwner ? esc(t('Remove')) : esc(t('Delete (admin)'))}</button>`);
    del.onclick = async () => {
      if (!confirm(isOwner ? t('Remove this post? This cannot be undone.') : t('Delete this neighbour’s post as admin? This cannot be undone.'))) return;
      try {
        await api.del(`/api/posts/${p.id}`);
        toast(t('Post removed'), 'ok');
        dismiss();
        render(); // refresh the feed so the deleted card disappears
      } catch (e) { toast(e.message, 'err'); }
    };
    cardEl.querySelector('.modal-actions').appendChild(del);
  }
  close.onclick = dismiss;
  overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
  cardEl.querySelector('.modal-open-full')?.addEventListener('click', dismiss); // null when far; hash routes to detail
  _modalEsc = (e) => { if (e.key === 'Escape') dismiss(); };
  document.addEventListener('keydown', _modalEsc);

  document.body.appendChild(overlay);
}

/* Cheer animation (⑤) — a sub-0.6s particle burst so every Cheer gives instant joyful
 * feedback instead of just incrementing a number. Pure DOM/CSS; respects reduced-motion.
 * `origin` is the element the burst radiates from (the tapped button). */
function celebrate(origin, kind = 'cheer') {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const r = origin.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const glyphs = kind === 'thanks' ? ['💛', '🙏', '✨'] : ['⭐', '❤️', '🎉', '✨'];
  const layer = h(`<div class="burst" style="left:${x}px;top:${y}px"></div>`);
  for (let i = 0; i < 11; i++) {
    const ang = (Math.PI * 2 * i) / 11 + (i % 2 ? 0.4 : 0);
    const dist = 34 + (i % 4) * 13;
    const pcl = h(`<span>${glyphs[i % glyphs.length]}</span>`);
    pcl.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    pcl.style.setProperty('--dy', `${Math.sin(ang) * dist}px`);
    pcl.style.animationDelay = `${(i % 3) * 20}ms`;
    layer.appendChild(pcl);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 650);
}

function reactionRow(p, cardEl) {
  const row = h(`<div class="react"></div>`);
  const g = p.stream === 'good';

  const mk = (type, label, cls = '') => {
    const on = p.myReactions.includes(type);
    const n = p.reactions[type];
    const btn = h(`<button class="rbtn ${cls} ${on ? 'act' : ''}">${label}${n ? ` · <b>${n}</b>` : ''}</button>`);
    btn.onclick = async () => {
      if (!state.user) return go('');
      if (!on && type === 'cheer') celebrate(btn, 'cheer'); // joyful feedback the instant it's tapped
      try {
        const { post } = await api.post(`/api/posts/${p.id}/react`, { type });
        const fresh = postCard(post);
        cardEl.replaceWith(fresh);
      } catch (e) { toast(e.message, 'err'); }
    };
    return btn;
  };

  if (g) {
    row.append(mk('cheer', `👏 ${esc(t('Cheer'))}`, 'cheer'), mk('help', `🙌 ${esc(t("I'll help tend it"))}`));
  } else {
    if (p.ai?.action === 'city' && (p.status === 'open' || p.status === 'rallying') && p.author?.id === state.user.id) {
      const send = h(`<button class="rbtn act">${ICONS.send} ${esc(t('Send report'))}</button>`);
      send.onclick = () => advance(p.id, 'send_report');
      row.appendChild(send);
    }
    row.append(mk('metoo', `🙋 ${esc(t('Me too here'))}`), mk('help', `🙌 ${esc(t("I'll help"))}`));
  }
  const share = h(`<button class="rbtn">⤷ ${esc(t('Share'))}</button>`);
  share.onclick = () => { navigator.clipboard?.writeText(location.origin + '/#/post/' + p.id); toast(t('Link copied'), 'ok'); };
  row.appendChild(share);
  return row;
}

async function advance(id, action) {
  try {
    await api.post(`/api/posts/${id}/advance`, { action });
    toast(action === 'send_report' ? t('Report sent to District Works') : t('Loop updated'), 'ok');
    render();
  } catch (e) { toast(e.message, 'err'); }
}

/* ----------------------------------------------------------------- the map */
// Hybrid maps. The app picks a provider once per session based on the browser's own
// location: 高德/Amap in mainland China (where Google Maps JS is unreachable), Google
// elsewhere, and self-hosted Leaflet (tiles proxied through /api/maps/tiles/...) if neither
// loads. All three expose the same tiny engine interface so the three map views below are
// provider-agnostic. Reverse geocoding always goes through our server, so it works
// regardless of provider.

const GOOGLE_BLOCKED = new Set(['CN']); // mainland China — Google Maps JS is unreachable

// China lat/lng bounding box. Drives both provider auto-detection and the GCJ-02 datum
// shift below (Amap, like all China map providers, uses GCJ-02 rather than raw WGS-84 GPS).
const inChinaBounds = (lat, lng) =>
  lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;

// WGS-84 (GPS) → GCJ-02 (the datum Amap renders in). Without this, China pins land
// ~300–500m off. Outside China the two datums coincide, so coords pass through unchanged.
function wgs84ToGcj02(lat, lng) {
  if (!inChinaBounds(lat, lng)) return [lat, lng];
  const a = 6378245.0, ee = 0.00669342162296594323;
  const x = lng - 105.0, y = lat - 35.0;
  const trig = (v) => 2 / 3 * (20 * Math.sin(6 * v * Math.PI) + 20 * Math.sin(2 * v * Math.PI));
  let dLat = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
    + trig(x) + 2 / 3 * (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI))
    + 2 / 3 * (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30));
  let dLng = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
    + trig(x) + 2 / 3 * (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI))
    + 2 / 3 * (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI));
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (a * (1 - ee) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lat + dLat, lng + dLng];
}

// Rough inverse of the above: GCJ-02 → WGS-84. Amap reports its centre in GCJ-02, but our
// posts (and the haversine radius filter) are in WGS-84, so the map centre is shifted back
// before any distance math. Accurate to a few metres — fine for a one-mile radius.
function gcj02ToWgs84(lat, lng) {
  const [gLat, gLng] = wgs84ToGcj02(lat, lng);
  return [lat * 2 - gLat, lng * 2 - gLng];
}

// Is the browser in China? Prefer its real location, then the edge geo-IP hint, then
// locale/timezone (the only signal available in local dev, where the geo header is empty).
function browserInChina() {
  const u = state.user || {};
  if (u.lat != null && u.lng != null) return inChinaBounds(u.lat, u.lng);
  const cc = (state.config && state.config.country || '').toUpperCase();
  if (cc) return cc === 'CN';
  try {
    if (/Shanghai|Chongqing|Harbin|Urumqi|Kashgar/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '')) return true;
  } catch { /* Intl unavailable */ }
  return /^zh[-_]?CN/i.test(navigator.language || navigator.userLanguage || '');
}

let _googlePromise;
function loadGoogle(key, timeoutMs = 4000) {
  if (_googlePromise) return _googlePromise;
  _googlePromise = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('google maps timeout')), timeoutMs);
    window.__obMapsReady = () => { clearTimeout(to); resolve(window.google.maps); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=__obMapsReady`;
    s.async = true;
    s.onerror = () => { clearTimeout(to); reject(new Error('google maps failed')); };
    document.head.appendChild(s);
  });
  return _googlePromise;
}

let _amapPromise;
function loadAmap(key, timeoutMs = 6000) {
  if (_amapPromise) return _amapPromise;
  _amapPromise = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('amap timeout')), timeoutMs);
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`;
    s.async = true;
    s.onload = () => { clearTimeout(to); window.AMap ? resolve(window.AMap) : reject(new Error('amap failed')); };
    s.onerror = () => { clearTimeout(to); reject(new Error('amap failed')); };
    document.head.appendChild(s);
  });
  return _amapPromise;
}
function leafletReady() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((resolve, reject) => {
    let n = 0;
    const t = setInterval(() => {
      if (window.L) { clearInterval(t); resolve(window.L); }
      else if (++n > 60) { clearInterval(t); reject(new Error('Leaflet failed to load')); }
    }, 50);
  });
}

// ── engine adapters — same interface, two backends ───────────────────────────
const googleEngine = (g) => (el, center, zoom) => {
  const map = new g.Map(el, {
    center: { lat: center[0], lng: center[1] }, zoom,
    disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
  });
  const youIcon = { path: g.SymbolPath.CIRCLE, scale: 7, fillColor: '#234E3F', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 };
  const pinIcon = (good) => ({
    path: 'M0 0 C-9 0 -14 7 -14 14 C-14 24 0 34 0 34 C0 34 14 24 14 14 C14 7 9 0 0 0Z',
    fillColor: good ? '#E2A02E' : '#C0613A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, anchor: new g.Point(0, 34),
  });
  return {
    addPin: (lat, lng, good, onClick) => { const m = new g.Marker({ position: { lat, lng }, map, icon: pinIcon(good) }); if (onClick) m.addListener('click', onClick); return m; },
    addYou: (lat, lng) => new g.Marker({ position: { lat, lng }, map, icon: youIcon, zIndex: 999 }),
    move: (m, lat, lng) => m.setPosition({ lat, lng }),
    remove: (m) => m.setMap(null),
    fit: (pts, maxZoom) => { if (!pts.length) return; const b = new g.LatLngBounds(); pts.forEach((p) => b.extend({ lat: p[0], lng: p[1] })); map.fitBounds(b, 48); g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > maxZoom) map.setZoom(maxZoom); }); },
    view: (c, z) => { map.setCenter({ lat: c[0], lng: c[1] }); map.setZoom(z); },
    zoom: () => map.getZoom(),
    center: () => { const c = map.getCenter(); return c ? [c.lat(), c.lng()] : null; },
    onMove: (cb) => g.event.addListener(map, 'idle', cb),
  };
};
const leafletEngine = (L) => (el, center, zoom) => {
  const map = L.map(el, { zoomControl: true }).setView(center, zoom);
  L.tileLayer('/api/maps/tiles/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  setTimeout(() => map.invalidateSize(), 60); // container may have sized after init
  const youStyle = { radius: 7, color: '#fff', weight: 3, fillColor: '#234E3F', fillOpacity: 1 };
  const pinStyle = (good) => ({ radius: 8, color: '#fff', weight: 2, fillColor: good ? '#E2A02E' : '#C0613A', fillOpacity: 1 });
  return {
    addPin: (lat, lng, good, onClick) => { const m = L.circleMarker([lat, lng], pinStyle(good)).addTo(map); if (onClick) m.on('click', onClick); return m; },
    addYou: (lat, lng) => L.circleMarker([lat, lng], youStyle).addTo(map),
    move: (m, lat, lng) => m.setLatLng([lat, lng]),
    remove: (m) => map.removeLayer(m),
    fit: (pts, maxZoom) => { if (pts.length) map.fitBounds(pts, { padding: [35, 35], maxZoom }); },
    view: (c, z) => map.setView(c, z),
    zoom: () => map.getZoom(),
    center: () => { const c = map.getCenter(); return [c.lat, c.lng]; },
    onMove: (cb) => map.on('moveend', cb),
  };
};

// 高德/Amap adapter. Amap takes [lng, lat] (note the order) in the GCJ-02 datum, so every
// WGS-84 lat/lng coming from the app is converted on the way in — keeping the rest of the
// app provider-agnostic and our stored coordinates pure WGS-84.
const amapEngine = (AMap) => (el, center, zoom) => {
  const toPos = (lat, lng) => { const g = wgs84ToGcj02(lat, lng); return [g[1], g[0]]; }; // → [lng, lat]
  const map = new AMap.Map(el, { center: toPos(center[0], center[1]), zoom, zooms: [2, 19] });
  setTimeout(() => map.resize && map.resize(), 60); // container may have sized after init
  const youStyle = { radius: 7, strokeColor: '#fff', strokeWeight: 3, fillColor: '#234E3F', fillOpacity: 1 };
  const pinStyle = (good) => ({ radius: 8, strokeColor: '#fff', strokeWeight: 2, fillColor: good ? '#E2A02E' : '#C0613A', fillOpacity: 1 });
  const mk = (lat, lng, style, onClick, z) => {
    const m = new AMap.CircleMarker({ center: toPos(lat, lng), bubble: true, cursor: onClick ? 'pointer' : 'default', zIndex: z, ...style });
    map.add(m);
    if (onClick) m.on('click', onClick);
    return m;
  };
  return {
    addPin: (lat, lng, good, onClick) => mk(lat, lng, pinStyle(good), onClick, 10),
    addYou: (lat, lng) => mk(lat, lng, youStyle, null, 999),
    move: (m, lat, lng) => m.setCenter(toPos(lat, lng)),
    remove: (m) => map.remove(m),
    fit: (pts, maxZoom) => {
      if (!pts.length) return;
      const ps = pts.map((p) => toPos(p[0], p[1]));
      if (ps.length === 1) { map.setZoomAndCenter(maxZoom, ps[0]); return; }
      const lngs = ps.map((p) => p[0]), lats = ps.map((p) => p[1]);
      map.setBounds(new AMap.Bounds([Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]));
      map.on('zoomend', function clamp() { map.off('zoomend', clamp); if (map.getZoom() > maxZoom) map.setZoom(maxZoom); });
    },
    view: (c, z) => map.setZoomAndCenter(z, toPos(c[0], c[1])),
    zoom: () => map.getZoom(),
    center: () => { const c = map.getCenter(); const lat = c.getLat ? c.getLat() : c.lat; const lng = c.getLng ? c.getLng() : c.lng; return gcj02ToWgs84(lat, lng); },
    onMove: (cb) => map.on('moveend', cb),
  };
};

// Remember which provider actually loaded, so we don't re-pay a blocked provider's timeout
// (e.g. Google behind the GFW) on every page load. Only real maps are cached, never Leaflet.
const MAP_CACHE_KEY = 'ob.mapProvider';
const cachedProvider = () => { try { return localStorage.getItem(MAP_CACHE_KEY) || ''; } catch { return ''; } };
const rememberProvider = (k) => { try { localStorage.setItem(MAP_CACHE_KEY, k); } catch { /* private mode */ } };

// Choose a provider once per session, then cache it. Order in `auto`: Amap first when the
// browser looks like it's in China, otherwise Google — but if Google can't load (a timeout
// is the GFW's signature, i.e. China after all), fall back to Amap before Leaflet. So a
// blocked Google always lands on Amap, even when location detection missed China.
// MAP_PROVIDER forces a specific provider. Each loader can fail → we try the next.
let _enginePromise;
function getEngine() {
  if (_enginePromise) return _enginePromise;
  _enginePromise = (async () => {
    const { mapsApiKey: gkey, amapKey = '', country = '', mapProvider = 'auto' } = state.config || {};
    const cn = browserInChina();
    const tryAmap = async () => amapKey && { create: amapEngine(await loadAmap(amapKey)), kind: 'amap' };
    const allowGoogle = gkey && (mapProvider === 'google' ||
      (mapProvider === 'auto' && !GOOGLE_BLOCKED.has(country.toUpperCase())));
    const tryGoogle = async () => allowGoogle && { create: googleEngine(await loadGoogle(gkey)), kind: 'google' };

    // Forced providers: honour exactly, fall through to Leaflet only if they can't load.
    if (mapProvider === 'amap') { try { const e = await tryAmap(); if (e) return e; } catch { /* → leaflet */ } }
    else if (mapProvider === 'google') { try { const e = await tryGoogle(); if (e) return e; } catch { /* → leaflet */ } }
    else {
      // auto: lead with the likely-reachable provider, then try the other before Leaflet.
      // A previously-successful provider jumps the queue so blocked ones aren't retried.
      const byKind = { amap: tryAmap, google: tryGoogle };
      const base = cn ? [tryAmap, tryGoogle] : [tryGoogle, tryAmap];
      const lead = byKind[cachedProvider()];
      const order = lead ? [lead, ...base.filter((f) => f !== lead)] : base;
      for (const attempt of order) {
        try { const e = await attempt(); if (e) { rememberProvider(e.kind); return e; } } catch { /* try next */ }
      }
    }
    return { create: leafletEngine(await leafletReady()), kind: 'leaflet' };
  })();
  return _enginePromise;
}

/** Reverse geocode a point via our server (works regardless of map provider). */
async function reverseGeocode(lat, lng) {
  try {
    const r = await api.get(`/api/maps/geocode/reverse?lat=${lat}&lng=${lng}`);
    return { placeName: r.placeName || null, neighborhood: r.neighborhood || null };
  } catch { return null; }
}

const mapFallback = (el) => {
  el.innerHTML = '<div class="map-fallback"><b>Map unavailable</b>' +
    '<span>The map service could not be reached.</span></div>';
};

function mapCard(streamFilter) {
  const card = h(`
    <div class="map-card">
      <div class="loc"><span class="live"></span>📍 <span class="loc-name">${esc(state.user.neighborhood || t('Locating…'))}</span></div>
      <div class="loc-switch" role="group" aria-label="${esc(t('Switch location'))}"></div>
      <div class="gmap"></div>
    </div>`);
  const el = card.querySelector('.gmap');
  const nameEl = card.querySelector('.loc-name');
  const switchBar = card.querySelector('.loc-switch');

  getEngine().then(async ({ create }) => {
    let data = { pins: [], viewer: null };
    try { data = await api.get('/api/posts/pins'); } catch { /* show base map */ }
    // On the Good/Care views, show only that stream's pins; on Near Me, show all.
    const pins = streamFilter ? data.pins.filter((p) => p.stream === streamFilter) : data.pins;

    const viewerCenter =
      data.viewer && data.viewer.lat != null ? [data.viewer.lat, data.viewer.lng]
      : state.user.lat != null && state.user.lng != null ? [state.user.lat, state.user.lng]
      : null;

    const M = create(el, viewerCenter || [20, 0], viewerCenter ? 15 : 2);

    let youM = null;
    const setYou = (c) => { if (youM) M.move(youM, c[0], c[1]); else youM = M.addYou(c[0], c[1]); };

    const bounds = [];
    if (viewerCenter) { setYou(viewerCenter); bounds.push(viewerCenter); }
    pins.filter((p) => p.lat != null).forEach((p) => {
      M.addPin(p.lat, p.lng, p.stream === 'good', () => go(`post/${p.id}`));
      bounds.push([p.lat, p.lng]);
    });
    if (pins.length) M.fit(bounds, 16);

    // ── Location quick-switch (Needs-care ①) ─────────────────────────────────
    // "Home / places I care about" recentres on the saved home; "📍 Current" re-locates the
    // device. People care about more than where their body is — the daytime worker still
    // watches their home block. Home is psychological ownership; the saved point is respected.
    let mode = 'current';
    let lastHere = viewerCenter;
    const paintSwitch = () => {
      const home = state.user.home;
      switchBar.innerHTML = '';
      const homeBtn = h(`<button class="loc-chip ${mode === 'home' ? 'on' : ''}">🏠 ${esc(home?.name || t('Home'))}</button>`);
      const curBtn = h(`<button class="loc-chip ${mode === 'current' ? 'on' : ''}">📍 ${esc(t('Current'))}</button>`);
      homeBtn.onclick = () => {
        if (!state.user.home) return setHomeHere();
        mode = 'home'; paintSwitch();
        M.view([state.user.home.lat, state.user.home.lng], 15);
        nameEl.textContent = state.user.home.name || t('Home');
      };
      curBtn.onclick = () => { mode = 'current'; paintSwitch(); locate(true); };
      switchBar.append(homeBtn, curBtn);
      // A small "set this as home" affordance once we know where the device is.
      if (lastHere) {
        const set = h(`<button class="loc-chip ghost" title="${esc(t('Save current location as home'))}">${state.user.home ? '↻ ' + esc(t('Update home')) : '＋ ' + esc(t('Set home'))}</button>`);
        set.onclick = setHomeHere;
        switchBar.appendChild(set);
      }
    };
    async function setHomeHere() {
      if (!lastHere) { toast(t('Locating you first…'), ''); return; }
      const geo = await reverseGeocode(lastHere[0], lastHere[1]);
      try {
        const { user } = await api.put('/api/auth/me/profile', { home: { lat: lastHere[0], lng: lastHere[1], name: geo?.neighborhood || null } });
        state.user = user; toast(t('Home saved 🏠'), 'ok'); paintSwitch();
      } catch (e) { toast(e.message, 'err'); }
    }
    function locate(recenter) {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const here = [pos.coords.latitude, pos.coords.longitude];
        lastHere = here; setYou(here);
        if (recenter || !pins.length) M.view(here, Math.max(M.zoom(), 15));
        const geo = await reverseGeocode(here[0], here[1]);
        if (geo?.neighborhood && mode === 'current') nameEl.textContent = geo.neighborhood;
        paintSwitch();
        api.put('/api/auth/me/location', { lat: here[0], lng: here[1], neighborhood: geo?.neighborhood || null })
          .then(({ user }) => { state.user = user; }).catch(() => {});
      }, () => { /* permission denied → keep profile location */ },
      { enableHighAccuracy: true, timeout: 8000 });
    }
    paintSwitch();
    locate(false);
  }).catch(() => mapFallback(el));

  return card;
}

/* ------------------------------------------------------------- right panel */
function sidePanel() {
  const side = h(`<aside class="side"></aside>`);

  const cta = h(`
    <div class="capture-cta">
      <b>${esc(t('Notice something?'))}</b>
      <p>${esc(t('Capture the good or the needs-care. Location is attached automatically on mobile.'))}</p>
      <div class="cap-row">
        <button class="cap-btn" data-mode="photo">${ICONS.camera}${esc(t('Photo'))}</button>
        <button class="cap-btn" data-mode="video">${ICONS.video}${esc(t('Video'))}</button>
        <button class="cap-btn solid" data-mode="pin">${ICONS.pin}${esc(t('Pin'))}</button>
      </div>
    </div>`);
  cta.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => go('capture')));
  side.appendChild(cta);

  side.appendChild(h(`
    <div class="panel">
      <h4>👏 ${esc(t('Capitalization in action'))} <span class="tagpin">${esc(t('Active-constructive'))}</span></h4>
      <p>${tf('Reactions aren\'t passive "likes." Neighbours reply with {a}, {b}, or {c} — the enthusiastic responses that amplify a sharer\'s wellbeing.', { a: `<strong>${esc(t('Cheer'))}</strong>`, b: `<strong>${esc(t("I'll join"))}</strong>`, c: `<strong>${esc(t('Me too here'))}</strong>` })}</p>
    </div>`));

  const impact = h(`<div class="panel"><h4>${esc(t('My impact'))} <span class="tagpin">${esc(t('Intrapersonal'))}</span></h4><div class="impact-slot">…</div></div>`);
  side.appendChild(impact);
  const community = h(`<div class="panel"><h4>${esc(t('Our block this month'))} <span class="tagpin">${esc(t('Collective efficacy'))}</span></h4><div class="comm-slot">…</div></div>`);
  side.appendChild(community);

  const loop = h(`<div class="panel"><h4>${esc(t('Loop status · recent care'))}</h4><div class="loop-slot">…</div></div>`);
  side.appendChild(loop);

  // hydrate
  api.get('/api/stats/me').then((s) => {
    impact.querySelector('.impact-slot').innerHTML = `
      <div class="stat"><span class="n">${s.pointsEarned ?? 0}</span><span class="l">${tf('points · Lv.{lv} {title}', { lv: s.level, title: esc(t(s.levelTitle)) })}</span></div>
      <div class="bar level"><i style="width:${Math.round((s.levelProgress ?? 0) * 100)}%"></i></div>
      ${s.nextTitle ? `<div class="lvl-next">${tf('{n} pts to {title}', { n: s.toNext, title: esc(t(s.nextTitle)) })}</div>` : `<div class="lvl-next">${esc(t('Top level reached ✦'))}</div>`}
      <div class="stat" style="margin-top:12px"><span class="n">${s.resolved}</span><span class="l">${tf('items you helped get {resolved}', { resolved: `<strong>${esc(t('resolved'))}</strong>` })}</span></div>`;
  }).catch(() => {});
  api.get('/api/stats/community').then((c) => {
    community.querySelector('.comm-slot').innerHTML = `
      <div class="stat"><span class="n">${c.acts}</span><span class="l">${tf('acts across {n} neighbours', { n: c.neighbours })}</span></div>
      <p style="margin-top:4px">${tf('↑ {pct}% vs last month · {n} issues closed together', { pct: c.changePct, n: c.resolved })}</p>`;
  }).catch(() => {});
  api.get('/api/posts?stream=care&sort=new').then(({ posts }) => {
    const withLoop = posts.find((p) => p.loop.length) || posts[0];
    const slot = loop.querySelector('.loop-slot');
    if (!withLoop) { slot.innerHTML = `<p>${esc(t('No care items being tracked yet.'))}</p>`; return; }
    slot.innerHTML = `<p style="font-weight:700;color:var(--ink);margin-bottom:9px">${esc(withLoop.title)}</p>` +
      (withLoop.loop.length ? renderLoopSteps(withLoop.loop) : `<p>${esc(t('Not yet routed.'))}</p>`);
  }).catch(() => {});

  return side;
}

function renderLoopSteps(steps) {
  return steps.map((s, i) =>
    `<div class="loopstep ${s.status === 'pending' ? '' : s.status}"><span class="tick"></span>${esc(s.label)}</div>` +
    (i < steps.length - 1 ? '<div class="loopline"></div>' : '')
  ).join('');
}

/* --------------------------------------------------------------- capture */
function captureView() {
  const draft = { stream: 'care', mode: 'photo', file: null, mediaUrl: null, mediaType: 'photo', coords: null, place: '', neighborhood: null };
  const wrap = h(`<div class="capture-view"></div>`);

  wrap.appendChild(h(`<div class="back-link">‹ ${esc(t('Back to feed'))}</div>`)).onclick = () => history.back();
  wrap.appendChild(h(`<div class="toprow"><h2>${esc(t('New capture'))}<small>${esc(t('Photo & short video · location attached automatically'))}</small></h2></div>`));

  const vf = h(`
    <div class="viewfinder">
      <div class="grid3"></div>
      <div class="placeholder">${esc(t('Upload a photo or a short clip (≤ 15s).'))}<br>${esc(t('Your location is auto-tagged.'))}</div>
      <div class="vf-loc">${ICONS.pin.replace('currentColor', '#fff')}<span class="loc-text">${esc(t('Locating…'))}</span></div>
    </div>`);
  wrap.appendChild(vf);

  const modes = h(`<div class="modes">
      <span class="mode on" data-m="photo">${esc(t('Photo'))}</span>
      <span class="mode" data-m="video">${esc(t('Video ≤ 15s'))}</span></div>`);
  modes.querySelectorAll('.mode').forEach((m) => m.onclick = () => {
    modes.querySelectorAll('.mode').forEach((x) => x.classList.remove('on'));
    m.classList.add('on'); draft.mode = m.dataset.m;
  });
  wrap.appendChild(modes);

  const up = h(`<div class="upbtns">
      <label class="upbtn">${ICONS.camera}${esc(t('Take a photo'))}<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="upbtn">${ICONS.video}${esc(t('Take a video'))}<input type="file" accept="video/*" capture="environment" hidden></label>
    </div>`);
  up.querySelectorAll('input').forEach((inp) => inp.onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; onFile(f); });
  wrap.appendChild(up);
  const geoEl = h(`<div class="geo-check hidden"></div>`);
  wrap.appendChild(geoEl);

  // stream picker
  const pick = h(`<div class="stream-pick">
      <button class="care on" data-s="care"><b>△ ${esc(t('Needs Care'))}</b><span>${esc(t('Something to fix or flag'))}</span></button>
      <button class="good" data-s="good"><b>✦ ${esc(t('The Good'))}</b><span>${esc(t('Something worth savouring'))}</span></button>
    </div>`);
  pick.querySelectorAll('button').forEach((b) => b.onclick = () => {
    pick.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); draft.stream = b.dataset.s;
  });
  wrap.appendChild(pick);

  // Emotion tag (⑦) + concern-group tags (⑥) — both optional, both attached to the post.
  draft.mood = null; draft.groups = [];
  const tagBlock = h(`<div class="tag-pickers">
      <div class="tp-label">${esc(t('How does this make you feel?'))} <small>${esc(t('(optional)'))}</small></div>
      <div class="mood-row">${MOODS.map((m) => `<button type="button" class="mood-chip" data-mood="${m.id}" title="${esc(t(m.label))}">${m.e}</button>`).join('')}</div>
      <div class="tp-label">${esc(t('Whose needs does this speak for?'))} <small>${esc(t('(optional)'))}</small></div>
      <div class="group-row">${CONCERN_GROUPS.map((g) => `<button type="button" class="group-chip" data-group="${g.id}">${g.e} ${esc(t(g.label))}</button>`).join('')}</div>
    </div>`);
  tagBlock.querySelectorAll('[data-mood]').forEach((b) => b.onclick = () => {
    const sel = draft.mood === b.dataset.mood;
    tagBlock.querySelectorAll('[data-mood]').forEach((x) => x.classList.remove('on'));
    draft.mood = sel ? null : b.dataset.mood;
    if (!sel) b.classList.add('on');
  });
  tagBlock.querySelectorAll('[data-group]').forEach((b) => b.onclick = () => {
    const id = b.dataset.group;
    if (draft.groups.includes(id)) { draft.groups = draft.groups.filter((x) => x !== id); b.classList.remove('on'); }
    else if (draft.groups.length < 4) { draft.groups.push(id); b.classList.add('on'); }
  });
  wrap.appendChild(tagBlock);

  const form = h(`
    <div class="card">
      <div class="field"><label>${esc(t('Title'))}</label><input name="title" placeholder="${esc(t('What did you notice?'))}"></div>
      <div class="field"><label>${esc(t('A little more (optional)'))}</label><textarea name="body" rows="2" placeholder="${esc(t('Add context for your neighbours'))}"></textarea></div>
      <div class="ai-preview hidden">${ICONS.spark}<div class="ai-text"></div></div>
      <button class="btn primary" disabled>${esc(t('Post to the block'))}</button>
    </div>`);
  const titleInput = form.querySelector('[name=title]');
  const bodyInput = form.querySelector('[name=body]');
  const aiBox = form.querySelector('.ai-preview');
  const aiText = form.querySelector('.ai-text');
  const submit = form.querySelector('button');
  // A post needs a title, a photo/video, a real location, and the photo's GPS (if any)
  // must match that location.
  const refreshSubmit = () => { submit.disabled = !titleInput.value.trim() || !draft.file || !draft.coords || draft.geoFar; };
  titleInput.oninput = refreshSubmit;
  wrap.appendChild(form);

  // Culturally-iconic style chips — tapping one (re)writes the title + body in that voice.
  const styleHost = h('<div class="style-host"></div>');
  aiBox.after(styleHost);
  mountStyleComposer(styleHost, {
    getFile: () => draft.file,
    getNote: () => bodyInput.value, // reuse whatever context the neighbour already typed
    stream: () => draft.stream,     // read live — the neighbour may switch Care/Good after mount
    busy: (on, label) => {
      if (!on) return;
      aiBox.classList.remove('hidden');
      aiText.innerHTML = `✍️ <b>${tf('Writing as {label}…', { label: esc(label) })}</b>`;
    },
    fill: ({ title, description, label }) => {
      if (title) titleInput.value = title;       // styled picks intentionally replace the fields
      if (description) bodyInput.value = description;
      aiBox.classList.remove('hidden');
      aiText.innerHTML = `✍️ <b>${esc(label)}</b><p>${esc(t('Edit anything before you post.'))}</p>`;
      refreshSubmit();
    },
  });

  // Ask the vision model to suggest a title + description from the photo. Fills only
  // empty fields (never clobbers what the neighbour typed) and stays fully editable.
  let describeSeq = 0;
  async function autoDescribe(file) {
    const seq = ++describeSeq;
    aiBox.classList.remove('hidden');
    aiText.innerHTML = `<b>${esc(t('Reading your photo…'))}</b>`;
    try {
      const { title, description } = await api.describeImage(file, draft.stream, currentLang());
      if (seq !== describeSeq) return; // a newer photo superseded this one
      if (title && !titleInput.value.trim()) titleInput.value = title;
      if (description && !bodyInput.value.trim()) bodyInput.value = description;
      refreshSubmit();
      aiText.innerHTML = `<b>${esc(t('Suggested from your photo'))}</b><p>${esc(t('Edit anything before you post.'))}</p>`;
    } catch {
      if (seq === describeSeq) aiBox.classList.add('hidden'); // silent fall back to manual
    }
  }

  async function onFile(original) {
    if (!original) return;
    const isVideo = original.type.startsWith('video');
    // Let the neighbour crop stills before they land in the post; videos pass through.
    const file = isVideo ? original : await cropImage(original);
    if (!file) return; // crop cancelled
    draft.file = file;
    draft.mediaType = isVideo ? 'video' : 'photo';
    const url = URL.createObjectURL(file);
    vf.querySelector('.placeholder')?.remove();
    vf.querySelectorAll('img,video').forEach((n) => n.remove());
    vf.insertBefore(draft.mediaType === 'video'
      ? h(`<video src="${url}" controls muted playsinline></video>`)
      : h(`<img src="${url}" alt="preview">`), vf.querySelector('.grid3'));
    refreshSubmit();
    if (draft.mediaType === 'photo') {
      autoDescribe(file); // vision only applies to stills
      // GPS lives in the ORIGINAL file's EXIF — cropping re-encodes and strips it.
      draft.photoGps = null;
      exifGps(original).then((g) => { draft.photoGps = g; verifyPhotoGeo(draft, geoEl, refreshSubmit); });
    } else {
      draft.photoGps = null; verifyPhotoGeo(draft, geoEl, refreshSubmit);
    }
  }

  // geolocation → reverse-geocode the real GPS into a street / neighbourhood name.
  // Location is required: until we have a fix, the post button stays disabled.
  const vfLoc = vf.querySelector('.vf-loc');
  const showLoc = (txt) => { vf.querySelector('.loc-text').textContent = txt; };
  const onCoords = async (lat, lng) => {
    draft.coords = { lat, lng };
    verifyPhotoGeo(draft, geoEl, refreshSubmit); // recheck now that we know where we are
    showLoc(t('Locating…'));
    const geo = await reverseGeocode(lat, lng);
    draft.place = geo?.placeName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    draft.neighborhood = geo?.neighborhood || null;
    showLoc(draft.place);
    // Persist the freshest location (and resolved neighbourhood) on the profile.
    api.put('/api/auth/me/location', { lat, lng, neighborhood: draft.neighborhood })
      .then(({ user }) => { state.user = user; }).catch(() => {});
  };
  function requestLoc() {
    if (!navigator.geolocation) { showLoc(t('Location unavailable on this device')); return; }
    showLoc(t('Locating…'));
    navigator.geolocation.getCurrentPosition(
      (pos) => onCoords(pos.coords.latitude, pos.coords.longitude),
      () => { draft.coords = null; refreshSubmit(); showLoc(t('Turn on location to post — tap to retry')); },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }
  if (vfLoc) vfLoc.style.cursor = 'pointer', vfLoc.onclick = requestLoc;
  requestLoc();

  submit.onclick = async () => {
    submit.disabled = true; submit.textContent = t('Posting…');
    try {
      let mediaUrl = null, mediaType = draft.mediaType;
      if (draft.file) {
        const u = await api.upload(draft.file);
        mediaUrl = u.url; mediaType = u.mediaType;
      }
      const { post } = await api.post('/api/posts', {
        stream: draft.stream,
        title: titleInput.value.trim(),
        body: form.querySelector('[name=body]').value.trim(),
        mediaType, mediaUrl,
        durationS: mediaType === 'video' ? 14 : null,
        lat: draft.coords?.lat ?? state.user.lat,
        lng: draft.coords?.lng ?? state.user.lng,
        placeName: draft.place || state.user.neighborhood || null,
        mood: draft.mood,
        groups: draft.groups,
      });
      // show what the AI decided
      const ai = form.querySelector('.ai-preview');
      ai.classList.remove('hidden');
      ai.querySelector('.ai-text').innerHTML =
        `<b>${tf('AI routed this to: {action}', { action: esc(t(ACTION_LABEL[post.ai.action] || post.ai.action)) })}</b><p>${esc(post.ai.summary || '')}</p>`;
      toast(t('Posted to your block'), 'ok');
      setTimeout(() => go(`post/${post.id}`), 700);
    } catch (e) {
      toast(e.message, 'err');
      submit.disabled = false; submit.textContent = t('Post to the block');
    }
  };

  return wrap;
}

/* ------------------------------------------------------------ post detail */
function postDetailView() {
  const wrap = h(`<div style="max-width:680px;margin:0 auto"></div>`);
  wrap.appendChild(h(`<div class="back-link">‹ Back</div>`)).onclick = () => (history.length > 1 ? history.back() : go('near'));
  const slot = h(`<div><div class="spinner"></div></div>`);
  wrap.appendChild(slot);

  api.get(`/api/posts/${state.postId}`).then(({ post: p, comments }) => {
    slot.innerHTML = '';
    const g = p.stream === 'good';
    const far = !canReveal(p); // gate photo + full text on proximity (owner/admin exempt)

    if (p.mediaUrl && !far) {
      const media = h(`<div class="detail-media"></div>`);
      media.appendChild(p.mediaType === 'video'
        ? h(`<video src="${esc(p.mediaUrl)}" controls playsinline></video>`)
        : h(`<img src="${esc(p.mediaUrl)}" alt="">`));
      slot.appendChild(media);
    } else if (!far) {
      const media = h(`<div class="detail-media ${g ? 'g' : 'c'}"></div>`);
      media.appendChild(h(`<span class="badge" style="position:absolute;bottom:10px;left:10px">${p.mediaType === 'video' ? '▶ Video' : '◎ Photo'}</span>`));
      slot.appendChild(media);
    }
    const card = h(`<div class="card" style="margin-top:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span class="badge" style="background:${g ? 'var(--good)' : 'var(--care)'};color:${g ? '#3a2a10' : '#fff'}">${g ? '✦ ' + esc(t('The Good')) : '△ ' + esc(t('Needs Care'))}</span>
          ${p.ai?.tag ? `<span class="badge" style="background:var(--green-tint);color:var(--green)">${esc(p.ai.tag)}</span>` : ''}
          ${p.stream === 'care' ? `<span class="badge" style="background:var(--paper-2);color:var(--ink-soft)">${esc(t(STATUS_LABEL[p.status] || p.status))}</span>` : ''}
          ${(p.groups || []).map((id) => { const gg = groupOf(id); return gg ? `<span class="group-tag">${gg.e} ${esc(t(gg.label))}</span>` : ''; }).join('')}
        </div>
        <h2 style="font-family:var(--display);font-size:22px;margin-bottom:6px">${moodOf(p.mood) ? moodOf(p.mood).e + ' ' : ''}${esc(p.title)}</h2>
        <div class="pmeta">${addrLabel(p)}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''} · ${tf('by {name}', { name: esc(p.author?.name || t('Neighbour')) })} · ${timeAgo(p.createdAt)}</div>
        ${far
          ? `<div class="modal-locked" style="margin-top:10px">🔒<div><b>${p.distanceM != null ? esc(tf('{d} away', { d: dist(p.distanceM) })) : esc(t('You’re not nearby'))}</b>
               <p>${tf('This message and its photo unlock when you’re within {radius} of where it was posted.', { radius: REVEAL_LABEL })}</p></div></div>`
          : (p.body ? `<p class="pdesc" style="margin-top:8px">${esc(p.body)}</p>` : '')}
      </div>`);
    wireAddr(card, p);
    card.appendChild(reactionRow(p, card));
    const isOwner = p.author?.id === state.user.id;
    if (isOwner || state.user.isAdmin) {
      const del = h(`<button class="rbtn" style="margin-top:10px;border-color:var(--care);color:var(--care)">🗑 ${isOwner ? esc(t('Remove this post')) : esc(t('Delete post (admin)'))}</button>`);
      del.onclick = async () => {
        if (!confirm(isOwner ? t('Remove this post? This cannot be undone.') : t('Delete this neighbour’s post as admin? This cannot be undone.'))) return;
        try { await api.del(`/api/posts/${p.id}`); toast(t('Post removed'), 'ok'); go('near'); }
        catch (e) { toast(e.message, 'err'); }
      };
      card.appendChild(del);
    }
    slot.appendChild(card);

    // resolution story (④) — the closed-loop narrative, shown first when present
    if (p.story) slot.appendChild(h(`<div class="card story-card">
        <div class="story-head">📖 ${esc(t('How this got solved'))}</div>
        <p class="story-body">${esc(p.story)}</p>
      </div>`));

    // action ladder for care
    if (p.stream === 'care') {
      if (p.status !== 'resolved') slot.appendChild(perspectiveCard(p));
      slot.appendChild(actionLadder(p));
    }

    // comments
    const cbox = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:8px">${tf('Neighbour replies ({n})', { n: comments.length })}</h4></div>`);
    comments.forEach((c) => cbox.appendChild(h(`
      <div class="comment"><div class="av cartoon">${avatarMarkup({ name: c.author, avatar: c.avatar }, 30)}</div>
        <div><b>${esc(c.author)}</b> <span style="color:var(--ink-soft);font-size:11px">· ${timeAgo(c.createdAt)}</span>
        <p>${esc(c.body)}</p></div></div>`)));
    const cform = h(`<form class="comment-form"><input placeholder="${esc(t('Add an encouraging reply…'))}" maxlength="280"><button class="btn primary" style="width:auto;padding:10px 16px">${esc(t('Reply'))}</button></form>`);
    cform.onsubmit = async (e) => {
      e.preventDefault();
      const input = cform.querySelector('input');
      if (!input.value.trim()) return;
      try {
        await api.post(`/api/posts/${p.id}/comments`, { body: input.value.trim() });
        go(`post/${p.id}`); // re-render
      } catch (err) { toast(err.message, 'err'); }
    };
    cbox.appendChild(cform);
    slot.appendChild(cbox);
  }).catch((err) => {
    slot.innerHTML = `<div class="empty"><b>${esc(t("Couldn't load this post"))}</b>${esc(err.message)}</div>`;
  });

  return wrap;
}

/* Perspective-taking (⑤) — a collapsed reflection prompt under each Needs-Care item that
 * invites the viewer to imagine the affected neighbour's experience before reacting. Builds
 * empathy (the app's core value); the reflection is private by default and can be shared as a
 * supportive reply. No backend: the draft is kept in the textarea; sharing posts a comment. */
const PERSPECTIVE_QS = [
  'If I lived right here, what would I notice first?',
  'Who is most affected by this — and what do they need today?',
  'What is one small thing I could do to help?',
];
function perspectiveCard(p) {
  const box = h(`<div class="card perspective">
      <button class="persp-head" type="button" aria-expanded="false">
        <span>🫶 ${esc(t('Take a moment: see it from their side'))}</span><span class="chev">▾</span>
      </button>
      <div class="persp-body hidden">
        <p class="persp-lead">${esc(t('Before you react, imagine you were the neighbour living with this.'))}</p>
        <ul class="persp-qs">${PERSPECTIVE_QS.map((q) => `<li>${esc(t(q))}</li>`).join('')}</ul>
        <textarea class="persp-input" rows="2" placeholder="${esc(t('Jot a thought — “If I were them, I’d need…”'))}"></textarea>
        <button class="btn ghost persp-share" type="button">${esc(t('Share as a supportive reply'))}</button>
      </div>
    </div>`);
  const head = box.querySelector('.persp-head');
  const bodyEl = box.querySelector('.persp-body');
  head.onclick = () => {
    const open = bodyEl.classList.toggle('hidden');
    head.setAttribute('aria-expanded', String(!open));
    box.querySelector('.chev').textContent = open ? '▾' : '▴';
  };
  box.querySelector('.persp-share').onclick = async () => {
    const txt = box.querySelector('.persp-input').value.trim();
    if (!txt) { toast(t('Write a thought to share first'), ''); return; }
    try {
      await api.post(`/api/posts/${p.id}/comments`, { body: txt });
      toast(t('Shared with your neighbour'), 'ok');
      go(`post/${p.id}`);
    } catch (e) { toast(e.message, 'err'); }
  };
  return box;
}

function actionLadder(p) {
  const owner = p.author?.id === state.user.id;
  const box = h(`<div class="card">
      <h4 style="font-family:var(--display);margin-bottom:4px">${esc(t('AI action ladder'))}</h4>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">${tf('Every issue stays coupled to a path to act. AI suggested: {action}.', { action: `<strong>${esc(p.ai?.action ? t(ACTION_LABEL[p.ai.action] || p.ai.action) : '—')}</strong>` })}</p>
      <div class="ladder"></div>
    </div>`);
  const ladder = box.querySelector('.ladder');
  [['self', '1', 'Tend it yourself', 'Small enough to fix or savour on your own'],
   ['rally', '2', 'Rally neighbours', 'Organise a few people nearby'],
   ['city', '3', 'Send to the city', 'Route a report to the responsible agency']]
    .forEach(([key, k, label, sub]) => {
      const on = p.ai?.action === key;
      const rung = h(`<div class="rung ${on ? 'hot' : ''}" style="${on ? 'background:var(--green-tint);border-color:var(--green-2)' : ''}">
        <span class="k">${k}</span><div><div>${esc(t(label))}</div><div style="font-size:10.5px;color:var(--ink-soft);font-weight:500">${esc(t(sub))}</div></div>
        ${on ? `<b>${esc(t('AI pick'))}</b>` : ''}</div>`);
      ladder.appendChild(rung);
    });

  // Closure-ladder progress strip (③) — where this item sits on its path to resolved.
  const rung = ladderRung(p.status);
  box.appendChild(h(`<div class="closure-strip">${CARE_LADDER.map((s, i) =>
    `<div class="cs-step ${i < rung ? 'done' : i === rung ? 'now' : ''}"><span class="cs-dot"></span>${esc(t(s.label))}</div>`
  ).join('<div class="cs-line"></div>')}</div>`));
  if (p.claim) box.appendChild(h(`<div class="claim-line">${p.claim.official ? '🏢' : '🙋'} ${tf('Being handled by {name}', { name: esc(p.claim.name) })}${p.verify ? ` · ✓ ${tf('verified by {name}', { name: esc(p.verify.name) })}` : ''}</div>`));

  if (p.loop.length) {
    box.appendChild(h(`<div style="margin-top:14px">${renderLoopSteps(p.loop)}</div>`));
  }

  // Step buttons, gated by the viewer's relationship to the item (server re-checks).
  const u = state.user;
  const handler = p.claim?.userId === u.id;
  const official = u.role === 'official' && u.verified;
  const actions = h(`<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"></div>`);
  const add = (label, action, cls = 'rbtn') => {
    const b = h(`<button class="${cls}">${esc(label)}</button>`);
    b.onclick = () => advance(p.id, action);
    actions.appendChild(b);
  };
  if (p.status !== 'resolved') {
    // Anyone can claim an unclaimed item; the official tier and reporter can re-claim.
    if (!p.claim && p.status !== 'pending_verify') add('🙋 ' + t('I’ll handle this'), 'claim', 'rbtn act');
    if ((handler || owner || official) && p.status === 'claimed') add('🛠 ' + t('Submit the fix'), 'submit_fix', 'rbtn act');
    if (p.status === 'pending_verify' && (!handler || owner || official)) add('✓ ' + t('Verify it’s resolved'), 'verify', 'rbtn act');
    if (owner || official) {
      if (p.ai?.action === 'city' && ['open', 'rallying', 'claimed'].includes(p.status)) add('↗ ' + t('Send report to city'), 'send_report');
      add('✓ ' + t('Mark resolved'), 'resolve');
    }
  }
  if (actions.children.length) box.appendChild(actions);

  // Thanks (⑤) — once resolved, the reporter can thank helpers (costs 5 pts, +3 each helper).
  if (owner && p.status === 'resolved') {
    const thankWrap = h(`<div style="margin-top:14px"></div>`);
    if (p.thankedByMe) {
      thankWrap.appendChild(h(`<div class="thanks-done">💛 ${tf('You thanked your helpers · {n} sent', { n: p.thanks })}</div>`));
    } else {
      const tb = h(`<button class="rbtn thank-btn">💛 ${esc(t('Thank the neighbours who helped'))} <small>(−5 pts)</small></button>`);
      tb.onclick = async () => {
        tb.disabled = true;
        try {
          const { thanked } = await api.post(`/api/posts/${p.id}/thank`, {});
          celebrate(tb, 'thanks');
          toast(tf('Thanks sent to {n} neighbours 💛', { n: thanked }), 'ok');
          setTimeout(() => go(`post/${p.id}`), 700);
        } catch (e) { tb.disabled = false; toast(e.message, 'err'); }
      };
      thankWrap.appendChild(tb);
    }
    box.appendChild(thankWrap);
  }
  return box;
}

/* --------------------------------------------------------- impact / community */
function impactView() {
  const wrap = h(`<div style="max-width:780px;margin:0 auto"></div>`);
  wrap.appendChild(h(`<div class="toprow"><h2>${esc(t('My Impact'))}<small>${esc(t('Intrapersonal self-efficacy — effort made visible'))}</small></h2></div>`));
  const slot = h(`<div><div class="spinner"></div></div>`);
  wrap.appendChild(slot);

  Promise.all([api.get('/api/stats/me'), api.get('/api/posts?mine=1&sort=new')])
    .then(([s, mine]) => {
      slot.innerHTML = '';
      const tiers = s.tiers || {};
      const life = tiers.lifetime || { acts: s.acts, captured: s.captured, resolved: s.resolved, points: s.pointsEarned };
      const season = tiers.season || { name: 'Season', acts: s.acts, goal: s.goal, progress: s.progress };
      const month = tiers.month || { acts: s.acts };

      // Level + badges header
      slot.appendChild(h(`<div class="card level-card">
          <div class="lvl-top"><div><div class="lvl-title">${esc(t('Lv.'))} ${s.level} · ${esc(t(s.levelTitle))}</div>
            <div class="lvl-sub">${tf('{n} lifetime points', { n: s.pointsEarned })}</div></div>
            <div class="lvl-pts">${s.points} <small>${esc(t('to spend'))}</small></div></div>
          <div class="bar level"><i style="width:${Math.round((s.levelProgress ?? 1) * 100)}%"></i></div>
          <div class="lvl-next">${s.nextTitle ? tf('{n} pts to {title}', { n: s.toNext, title: esc(t(s.nextTitle)) }) : esc(t('Top level reached ✦'))}</div>
          ${(s.badges || []).length ? `<div class="badge-row">${s.badges.map((b) => badgeChip(b)).join('')}</div>` : ''}
        </div>`));

      // Tier 1 — lifetime (永久累计, never resets)
      slot.appendChild(h(`<div class="tier-head">${esc(t('Lifetime'))} <span class="tier-note">${esc(t('never resets'))}</span></div>`));
      slot.appendChild(h(`<div class="statgrid">
          <div class="bigstat"><div class="n">${life.acts}</div><div class="l">${esc(t('total acts of care'))}</div></div>
          <div class="bigstat good"><div class="n">${life.captured}</div><div class="l">${esc(t('observations captured'))}</div></div>
          <div class="bigstat care"><div class="n">${life.resolved}</div><div class="l">${esc(t('items resolved'))}</div></div>
          <div class="bigstat"><div class="n">${s.cheersReceived}</div><div class="l">${esc(t('cheers received'))}</div></div>
        </div>`));

      // Tier 2 — season (赛季, resets each quarter → earns a badge)
      slot.appendChild(h(`<div class="tier-head">${tf('{name} season', { name: esc(t(season.name)) })} <span class="tier-note">${esc(t('resets each quarter · earns a badge'))}</span></div>`));
      slot.appendChild(h(`<div class="card">
          <div class="stat"><span class="n">${season.acts}</span><span class="l">${tf('of {goal} acts this season', { goal: season.goal })}</span></div>
          <div class="bar"><i style="width:${Math.round((season.progress ?? 0) * 100)}%"></i></div>
        </div>`));

      // Tier 3 — month (月度, rolling, resets monthly)
      slot.appendChild(h(`<div class="tier-head">${esc(t('This month'))} <span class="tier-note">${esc(t('rolling · resets monthly'))}</span></div>`));
      const taskList = s.tasks || [];
      slot.appendChild(h(`<div class="statgrid two">
          <div class="bigstat"><div class="n">${month.acts}</div><div class="l">${esc(t('acts this month'))}</div></div>
          <div class="bigstat good"><div class="n">${taskList.filter((tk) => tk.done).length}/${taskList.length || 0}</div><div class="l">${esc(t('tasks done'))}</div></div>
        </div>`));
      if (taskList.length) slot.appendChild(taskChecklist(taskList));

      const list = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:10px">${esc(t('Your captures'))}</h4></div>`);
      const feed = h(`<div class="feed"></div>`);
      if (!mine.posts.length) feed.appendChild(h(`<div class="empty"><b>${esc(t('Nothing yet'))}</b>${esc(t('Capture the first thing on your block.'))}</div>`));
      mine.posts.forEach((p) => feed.appendChild(postCard(p)));
      list.appendChild(feed);
      slot.appendChild(list);
    }).catch((e) => { slot.innerHTML = `<div class="empty"><b>${esc(t("Couldn't load"))}</b>${esc(e.message)}</div>`; });
  return wrap;
}

/* Community = Block Pulse (②) — one dashboard fusing the three E's: today's energy (collective
 * efficacy), the latest solved stories (empathy), open issues needing help (a call to act), and
 * the contribution ranking (intrapersonal recognition). */
function communityView() {
  const wrap = h(`<div style="max-width:860px;margin:0 auto"></div>`);
  wrap.appendChild(h(`<div class="toprow"><h2>${esc(t('Block Pulse'))}<small>${esc(t('Your community’s energy station — live'))}</small></h2></div>`));
  const slot = h(`<div><div class="spinner"></div></div>`);
  wrap.appendChild(slot);

  Promise.all([api.get('/api/community/pulse'), api.get('/api/stats/community').catch(() => null)])
    .then(([p, c]) => {
      slot.innerHTML = '';

      // Live pulse strip
      slot.appendChild(h(`<div class="pulse-strip">
          <div class="pulse-stat"><div class="n"><span class="pulse-dot"></span>${p.activeToday}</div><div class="l">${esc(t('active today'))}</div></div>
          <div class="pulse-stat"><div class="n">${p.neighbours}</div><div class="l">${esc(t('neighbours'))}</div></div>
          <div class="pulse-stat care"><div class="n">${p.openCount}</div><div class="l">${esc(t('open issues'))}</div></div>
          <div class="pulse-stat good"><div class="n">${p.resolvedCount}</div><div class="l">${esc(t('resolved together'))}</div></div>
        </div>`));

      if (c) slot.appendChild(h(`<div class="card pulse-trend">
          <div style="font-family:var(--display);font-weight:800;font-size:17px">${tf('↑ {pct}% more acts than last month', { pct: c.changePct })}</div>
          <p>${esc(t("When neighbours can see shared effort, they do more of it. That's collective efficacy (Sampson et al., 1997)."))}</p>
        </div>`));

      // Latest solved stories (empathy)
      const stories = h(`<div class="pulse-col"><h4 class="pulse-h">📖 ${esc(t('Latest solved stories'))}</h4></div>`);
      if (!p.stories.length) stories.appendChild(h(`<p class="muted-note">${esc(t('No stories yet — close a care loop to write the first.'))}</p>`));
      p.stories.forEach((s) => {
        const cardEl = h(`<div class="story-mini"><b>${esc(s.title)}</b><p>${esc(s.story)}</p><small>📍 ${esc(s.placeName || t('Nearby'))}</small></div>`);
        cardEl.onclick = () => go(`post/${s.id}`);
        stories.appendChild(cardEl);
      });
      slot.appendChild(stories);

      // Open issues that still need help (act)
      const open = h(`<div class="pulse-col"><h4 class="pulse-h">🙌 ${esc(t('Needs a hand now'))}</h4></div>`);
      if (!p.open.length) open.appendChild(h(`<p class="muted-note">${esc(t('Nothing open — the block is in good shape.'))}</p>`));
      p.open.forEach((o) => {
        const row = h(`<div class="open-row"><div><b>${esc(o.title)}</b><small>📍 ${esc(o.placeName || t('Nearby'))} · ${esc(t(STATUS_LABEL[o.status] || o.status))}</small></div>
            <span class="open-tag ${o.claimed ? 'claimed' : ''}">${o.claimed ? esc(t('Being handled')) : esc(t('Unclaimed'))}</span></div>`);
        row.onclick = () => go(`post/${o.id}`);
        open.appendChild(row);
      });
      slot.appendChild(open);

      // Contribution ranking (intrapersonal)
      const board = h(`<div class="pulse-col"><h4 class="pulse-h">🏆 ${esc(t('Top contributors'))}</h4></div>`);
      p.ranking.forEach((l, i) => board.appendChild(h(`
        <div class="rank-row"><span class="k">${i + 1}</span>
          <span class="av cartoon" style="width:30px;height:30px">${avatarMarkup(l, 30)}</span>
          <span class="rank-name">${esc(l.nameCjk ? l.nameCjk + ' · ' : '')}${esc(l.name)}${l.official ? ` <span class="official-pin">🏢 ${esc(l.orgName || t('Official'))}</span>` : ''}</span>
          <b class="rank-pts">${tf('{n} pts', { n: l.points })}</b></div>`)));
      slot.appendChild(board);
    }).catch((e) => { slot.innerHTML = `<div class="empty"><b>${esc(t("Couldn't load"))}</b>${esc(e.message)}</div>`; });
  return wrap;
}

boot();
