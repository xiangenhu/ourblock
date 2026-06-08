import { api } from './api.js';
import { h, esc, timeAgo, dist, toast, ICONS } from './ui.js';
import { exifGps, haversine } from './exif.js';

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

const ACTION_LABEL = { self: 'Tend it yourself', rally: 'Rally neighbours', city: 'Send to the city' };
const STATUS_LABEL = {
  open: 'Open', rallying: 'Rallying neighbours', routed: 'Routed to city',
  in_progress: 'In progress', resolved: 'Resolved',
};

/* ---------------------------------------------------------------- bootstrap */
async function boot() {
  try {
    state.config = await api.get('/api/auth/config');
  } catch { /* gateway config unavailable — fall back to defaults */ }
  try {
    const { user } = await api.get('/api/auth/me');
    state.user = user;
  } catch { /* offline / first run */ }
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
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
          <div class="field"><label>Email</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <div class="field"><label>Password</label><input name="password" type="password" placeholder="••••••" required></div>
          <button class="btn primary" type="submit">Sign in</button>
        </form>
        <div class="auth-switch"><a data-sw="forgot">Forgot password?</a> · New here? <a data-sw="register">Create an account</a></div>`,
      register: `
        <form class="auth-form" data-act="register">
          <div class="field"><label>Name</label><input name="name" placeholder="e.g. Ling W." required></div>
          <div class="field"><label>Name in 中文 (optional)</label><input name="nameCjk" placeholder="玲"></div>
          <div class="field"><label>Email</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <div class="field"><label>Password</label><input name="password" type="password" placeholder="at least 6 characters" required></div>
          <button class="btn primary" type="submit">Create account</button>
        </form>
        <div class="auth-switch">Have an account? <a data-sw="login">Sign in</a></div>`,
      verify: `
        <p class="auth-note">We emailed a 6-digit code to <b>${esc(pendingEmail)}</b>. Enter it to finish.</p>
        <form class="auth-form" data-act="verify">
          <div class="field"><label>Verification code</label><input name="code" inputmode="numeric" placeholder="123456" maxlength="6" required></div>
          <button class="btn primary" type="submit">Verify &amp; continue</button>
        </form>
        <div class="auth-switch"><a data-sw="resend">Resend code</a> · <a data-sw="login">Back to sign in</a></div>`,
      forgot: `
        <p class="auth-note">Enter your email and we'll send a reset code.</p>
        <form class="auth-form" data-act="forgot">
          <div class="field"><label>Email</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <button class="btn primary" type="submit">Send reset code</button>
        </form>
        <div class="auth-switch"><a data-sw="login">Back to sign in</a></div>`,
      reset: `
        <p class="auth-note">Enter the code sent to <b>${esc(pendingEmail)}</b> and your new password.</p>
        <form class="auth-form" data-act="reset">
          <div class="field"><label>Reset code</label><input name="code" inputmode="numeric" placeholder="123456" maxlength="6" required></div>
          <div class="field"><label>New password</label><input name="newPassword" type="password" placeholder="at least 6 characters" required></div>
          <button class="btn primary" type="submit">Update password</button>
        </form>
        <div class="auth-switch"><a data-sw="login">Back to sign in</a></div>`,
    };

    const titles = {
      login: 'Your block, in good hands — together.',
      register: 'Create your neighbour account.',
      verify: 'Check your email.',
      forgot: 'Reset your password.',
      reset: 'Set a new password.',
    };

    const card = h(`
      <div class="auth-wrap"><div class="auth-card">
        <a class="auth-back" data-back>‹ Back to explore</a>
        <div class="brand cjk">优城美市<small>Our Block</small></div>
        <div class="auth-tag">${titles[mode]}</div>
        <div class="err-slot"></div>
        ${showGoogle ? `<button class="btn google" data-google>${GOOGLE_G}<span>Continue with Google</span></button><div class="auth-divider"><span>or</span></div>` : ''}
        ${forms[mode]}
      </div></div>`);

    if (oauthErr && mode === 'login') setErr(card, "Google sign-in didn't complete. Please try again.");

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
          toast(`Welcome, ${data.user.name.split(' ')[0]}`, 'ok'); go('near');
        } else if (act === 'register') {
          const out = await api.post('/api/auth/register', fd);
          if (out.user) { api.saveToken(out.token); state.user = out.user; go('near'); return; } // local fallback
          pendingEmail = fd.email; mode = 'verify'; mount();
          toast('Verification code sent', 'ok');
        } else if (act === 'verify') {
          const data = await api.post('/api/auth/verify', { email: pendingEmail, code: fd.code });
          api.saveToken(data.token); state.user = data.user;
          toast('Email verified — welcome!', 'ok'); go('near');
        } else if (act === 'forgot') {
          await api.post('/api/auth/forgot-password', { email: fd.email });
          pendingEmail = fd.email; mode = 'reset'; mount();
          toast('Reset code sent (if the email exists)', 'ok');
        } else if (act === 'reset') {
          await api.post('/api/auth/reset-password', { email: pendingEmail, code: fd.code, newPassword: fd.newPassword });
          mode = 'login'; mount();
          toast('Password updated — sign in', 'ok');
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
 * Everything an anonymous visitor sees: an attractive public page with sample
 * Good/Care locations on a live map, a way to share "the good" (location only),
 * read-only post detail, and a Log in button. "Needs care" + replies need auth.
 * ========================================================================== */

let _samplesCache = null;
async function getSamples() {
  if (_samplesCache) return _samplesCache;
  try { _samplesCache = (await api.get('/api/posts/samples')).samples || []; }
  catch { _samplesCache = []; }
  return _samplesCache;
}

function anonTopBar() {
  const bar = h(`
    <header class="land-top">
      <div class="brand cjk" data-home>优城美市<small>Our Block</small></div>
      <button class="btn primary land-login">Log in</button>
    </header>`);
  bar.querySelector('[data-home]').onclick = () => go('');
  bar.querySelector('.land-login').onclick = () => go('login');
  return bar;
}

async function renderLanding() {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());

  const hero = h(`
    <section class="hero">
      <h1>Your block, in good hands — together.</h1>
      <p>Notice the good on your street, and flag what needs care — then act. Here's what neighbours nearby are noticing right now.</p>
      <div class="hero-cta">
        <button class="btn primary" data-share>✦ Share something good</button>
        <button class="btn ghost" data-login>△ Log in to flag care</button>
      </div>
      <div class="hero-note">Sharing “the good” is open to everyone — just allow your location. Flagging “needs care” and replying to neighbours need a free account.</div>
    </section>`);
  hero.querySelector('[data-share]').onclick = () => go('share');
  hero.querySelector('[data-login]').onclick = () => go('login');
  wrap.appendChild(hero);

  const samples = await getSamples();
  wrap.appendChild(landingMap(samples));

  // Mix real public "good" posts in with the samples; care column is samples only
  // (anonymous visitors can't create care, so there's nothing real to surface yet).
  let realGood = [];
  try { realGood = (await api.get('/api/posts?stream=good&sort=new&limit=6')).posts || []; } catch { /* offline */ }
  const goodAll = [...realGood, ...samples.filter((s) => s.stream === 'good')];
  const care = samples.filter((s) => s.stream === 'care');

  const cols = h(`<div class="land-cols"></div>`);
  const goodCol = h(`<div class="land-col"><h2>✦ The Good nearby</h2><div class="land-grid"></div></div>`);
  const careCol = h(`<div class="land-col"><h2>△ Needs Care nearby</h2><div class="land-grid"></div></div>`);
  goodAll.forEach((p) => goodCol.querySelector('.land-grid').appendChild(landingCard(p)));
  care.forEach((p) => careCol.querySelector('.land-grid').appendChild(landingCard(p)));
  cols.append(goodCol, careCol);
  wrap.appendChild(cols);

  wrap.appendChild(h(`<footer class="land-foot">优城美市 · Our Block — a place-based civic wellbeing app.</footer>`));
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
      <div class="lmeta">📍 ${esc(p.placeName || 'Nearby')} · ${esc(p.author?.name || 'A neighbour')} · ${timeAgo(p.createdAt)}${p.sample ? ' · <span class="sample-tag">sample</span>' : ''}</div>
    </div>`));
  card.onclick = () => go(`post/${p.id}`);
  return card;
}

function landingMap(samples) {
  const card = h(`
    <div class="map-card land-map">
      <div class="loc"><span class="live"></span>📍 <span class="loc-name">Exploring nearby</span></div>
      <div class="gmap"></div>
    </div>`);
  const el = card.querySelector('.gmap');
  const nameEl = card.querySelector('.loc-name');

  loadMaps().then(async (maps) => {
    const first = samples[0];
    let real = [];
    try { real = (await api.get('/api/posts/pins')).pins || []; } catch { /* offline */ }

    const map = new maps.Map(el, {
      center: first ? { lat: first.lat, lng: first.lng } : { lat: 20, lng: 0 },
      zoom: first ? 14 : 2,
      disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy', clickableIcons: false,
    });

    const markers = [];
    const place = (origin) => {
      markers.forEach((m) => m.setMap(null));
      markers.length = 0;
      const bounds = new maps.LatLngBounds();
      const add = (lat, lng, good, id) => {
        const m = new maps.Marker({ position: { lat, lng }, map, icon: pinIcon(maps, good) });
        m.addListener('click', () => go(`post/${id}`));
        markers.push(m); bounds.extend({ lat, lng });
      };
      // Place sample pins near the visitor when we know where they are.
      samples.forEach((s) => {
        const lat = origin && s.offset ? origin.lat + s.offset.dLat : s.lat;
        const lng = origin && s.offset ? origin.lng + s.offset.dLng : s.lng;
        add(lat, lng, s.stream === 'good', s.id);
      });
      real.filter((p) => p.lat != null).forEach((p) => add(p.lat, p.lng, p.stream === 'good', p.id));
      if (origin) { new maps.Marker({ position: origin, map, icon: youIcon(maps), title: 'You', zIndex: 999 }); bounds.extend(origin); }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, 48);
        maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
      }
    };
    place(null);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        place(here);
        const geo = await reverseGeocode(here.lat, here.lng);
        if (geo?.neighborhood) nameEl.textContent = geo.neighborhood;
      }, () => { /* keep sample view */ }, { enableHighAccuracy: true, timeout: 8000 });
    }
  }).catch(() => {
    el.innerHTML = '<div class="map-fallback"><b>Map unavailable</b>' +
      '<span>Set a Google Maps API key (MAPS_API_KEY) to enable the live map.</span></div>';
  });

  return card;
}

/* --------------------------------------------------- anonymous "share the good" */
function renderAnonShare() {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());

  const view = h(`
    <section class="share-view">
      <a class="back-link" data-back>‹ Back to explore</a>
      <h1>Share something good ✦</h1>
      <p class="share-sub">Savour what your neighbours are doing well. A photo is required as evidence, and your location is attached so it lands on the block. No account needed.</p>
      <div class="loc-status" data-loc>Requesting your location…</div>

      <label class="photo-cta">${ICONS.camera}<span><b>Take a photo</b><small>Required as evidence — the AI writes the title &amp; description from it</small></span>
        <input type="file" accept="image/*" capture="environment" hidden></label>
      <div class="vf-preview hidden"></div>
      <div class="geo-check hidden"></div>

      <div class="card">
        <div class="field"><label>Add a note <small>(optional)</small></label><input name="note" placeholder="anything extra for your neighbours"></div>
        <button class="btn ghost" data-ai>${ICONS.spark} Suggest title &amp; description</button>
        <div class="ai-preview hidden">${ICONS.spark}<div class="ai-text"></div></div>
        <div class="field"><label>Title</label><input name="title" placeholder="A short title"></div>
        <div class="field"><label>Description <small>(50 words or less)</small></label><textarea name="desc" rows="3" placeholder="A warm line for your neighbours"></textarea></div>
        <button class="btn primary" data-post disabled>Post to the block</button>
        <div class="share-foot">Want to flag something that needs care? <a data-login>Log in</a>.</div>
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
    if (!navigator.geolocation) { setLoc('Location isn’t available on this device — you can’t post here.', false); return; }
    setLoc('Requesting your location…', false);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      draft.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const geo = await reverseGeocode(draft.coords.lat, draft.coords.lng);
      draft.place = geo?.placeName || `${draft.coords.lat.toFixed(4)}, ${draft.coords.lng.toFixed(4)}`;
      setLoc(`📍 ${draft.place}`, true);
      verifyPhotoGeo(draft, geoEl, refresh); // recheck the photo against this location
    }, () => setLoc('Turn on location to post to the block — tap to retry.', false),
    { enableHighAccuracy: true, timeout: 8000 });
  }
  locEl.onclick = requestLoc;
  requestLoc();

  // photo → preview + auto-compose from the image
  view.querySelector('input[type=file]').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    draft.file = file;
    preview.classList.remove('hidden');
    preview.innerHTML = '';
    preview.appendChild(h(`<img src="${URL.createObjectURL(file)}" alt="preview">`));
    refresh();
    compose();
    draft.photoGps = null;
    exifGps(file).then((g) => { draft.photoGps = g; verifyPhotoGeo(draft, geoEl, refresh); });
  };

  // AI compose (from the photo and/or the note)
  let seq = 0;
  async function compose() {
    if (!draft.file && !noteInput.value.trim()) { toast('Take a photo or write a few words first', ''); return; }
    const my = ++seq;
    aiBox.classList.remove('hidden');
    aiText.innerHTML = '<b>Thinking…</b>';
    try {
      const { title, description } = await api.compose({ file: draft.file, note: noteInput.value.trim(), stream: 'good' });
      if (my !== seq) return;
      if (title && !titleInput.value.trim()) titleInput.value = title;
      if (description && !descInput.value.trim()) descInput.value = description;
      aiText.innerHTML = '<b>Suggested — edit anything before posting.</b>';
      refresh();
    } catch (err) { aiBox.classList.add('hidden'); toast(err.message, 'err'); }
  }
  view.querySelector('[data-ai]').onclick = compose;

  postBtn.onclick = async () => {
    if (!draft.coords) { toast('Turn on location first', 'err'); return; }
    postBtn.disabled = true; postBtn.textContent = 'Posting…';
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
      toast('Posted to your block ✦', 'ok');
      go(`post/${post.id}`);
    } catch (err) {
      toast(err.message, 'err');
      postBtn.disabled = false; postBtn.textContent = 'Post to the block';
    }
  };
}

/** A small map centred on a single post's location (used in post detail views). */
function detailMap(p) {
  if (p.lat == null || p.lng == null) return null;
  const card = h(`<div class="map-card detail-map"><div class="gmap"></div></div>`);
  const el = card.querySelector('.gmap');
  loadMaps().then((maps) => {
    const center = { lat: p.lat, lng: p.lng };
    const map = new maps.Map(el, {
      center, zoom: 16, disableDefaultUI: true, zoomControl: true,
      gestureHandling: 'greedy', clickableIcons: false,
    });
    new maps.Marker({ position: center, map, icon: pinIcon(maps, p.stream === 'good') });
  }).catch(() => {
    el.innerHTML = '<div class="map-fallback"><b>Map unavailable</b>' +
      '<span>Set a Google Maps API key to enable the map.</span></div>';
  });
  return card;
}

/* ----------------------------------------------- anonymous read-only post detail */
async function renderAnonPost(id) {
  app.innerHTML = '';
  const wrap = h(`<div class="landing"></div>`);
  wrap.appendChild(anonTopBar());
  const view = h(`<section class="anon-post"><a class="back-link" data-back>‹ Back to explore</a><div class="slot"><div class="spinner"></div></div></section>`);
  wrap.appendChild(view);
  app.appendChild(wrap);
  view.querySelector('[data-back]').onclick = () => go('');
  const slot = view.querySelector('.slot');

  if (String(id).startsWith('sample-')) {
    const p = (await getSamples()).find((s) => s.id === id);
    slot.innerHTML = '';
    slot.appendChild(p ? anonPostCard(p, { sample: true }) : h(`<div class="empty"><b>Not found</b></div>`));
    return;
  }
  try {
    const { post: p, comments } = await api.get(`/api/posts/${id}`);
    slot.innerHTML = '';
    slot.appendChild(anonPostCard(p, { comments }));
  } catch (err) {
    slot.innerHTML = `<div class="empty"><b>Couldn't load this post</b>${esc(err.message)}</div>`;
  }
}

function anonPostCard(p, { sample, comments } = {}) {
  const g = p.stream === 'good';
  const box = h(`<div></div>`);
  box.appendChild(p.mediaUrl
    ? h(`<div class="detail-media"><img src="${esc(p.mediaUrl)}" alt=""></div>`)
    : h(`<div class="detail-media ${g ? 'g' : 'c'}"></div>`));
  const dm = detailMap(p);
  if (dm) box.appendChild(dm);
  box.appendChild(h(`<div class="card" style="margin-top:14px">
      <div><span class="badge" style="background:${g ? 'var(--good)' : 'var(--care)'};color:${g ? '#3a2a10' : '#fff'}">${g ? '✦ The Good' : '△ Needs Care'}</span>${sample ? ' <span class="sample-tag">sample</span>' : ''}</div>
      <h2 style="font-family:var(--display);font-size:22px;margin:8px 0 6px">${esc(p.title)}</h2>
      <div class="pmeta">📍 ${esc(p.placeName || 'Nearby')} · ${esc(p.author?.name || 'A neighbour')} · ${timeAgo(p.createdAt)}</div>
      ${p.body ? `<p class="pdesc" style="margin-top:8px">${esc(p.body)}</p>` : ''}
    </div>`));

  const cbox = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:8px">Neighbour replies${comments ? ` (${comments.length})` : ''}</h4></div>`);
  if (sample) {
    cbox.appendChild(h(`<p style="font-size:12.5px;color:var(--ink-soft)">This is a sample showing how Our Block works. Log in to join your real block.</p>`));
  } else {
    (comments || []).forEach((c) => cbox.appendChild(h(`
      <div class="comment"><div class="av">${esc(c.avatar || '·')}</div>
        <div><b>${esc(c.author)}</b> <span style="color:var(--ink-soft);font-size:11px">· ${timeAgo(c.createdAt)}</span>
        <p>${esc(c.body)}</p></div></div>`)));
    if (!comments || !comments.length) cbox.appendChild(h(`<p style="font-size:12.5px;color:var(--ink-soft)">No replies yet.</p>`));
    const prompt = h(`<button class="btn primary" style="margin-top:10px;width:auto;padding:10px 16px">Log in to reply</button>`);
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
        <div class="av">${esc(u.avatar || '·')}</div>
        <div><b>${esc(u.name)}</b><span>${u.neighborhood ? esc(u.neighborhood) + ' · ' : ''}Lv. ${u.level} ${esc(u.levelTitle)}</span></div>
      </div>
      <button class="signout">Sign out</button>
    </aside>`);
  const navSlot = rail.querySelector('.nav-slot');
  NAV.forEach((n) => {
    const item = h(`<button class="nav-i ${state.view === n.key ? 'on' : ''}" data-help="nav-${n.key}">${ICONS[n.icon]}${n.label}</button>`);
    item.onclick = () => go(n.key);
    navSlot.appendChild(item);
  });
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
  const t = h(`<div class="mobile-top"><div class="brand cjk">优城美市<small>Our Block</small></div></div>`);
  const out = h(`<button class="signout" style="width:auto;padding:7px 12px;background:var(--card);color:var(--ink-soft);border-color:var(--line)">Sign out</button>`);
  out.onclick = signOut;
  t.appendChild(out);
  return t;
}

function mobileNav() {
  const nav = h(`<nav class="pnav"></nav>`);
  [['near', 'Map', 'near'], ['care', 'Care', 'care'], ['impact', 'Impact', 'impact'], ['community', 'Me', 'community']]
    .forEach(([key, label, icon]) => {
      const b = h(`<button class="${state.view === key ? 'on' : ''}">${ICONS[icon]}${label}</button>`);
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
        <div class="av" style="width:38px;height:38px;border-radius:99px;display:grid;place-items:center;background:linear-gradient(135deg,var(--good),#D98748);color:#3a2a10;font-family:var(--display);font-weight:700">${esc(u.avatar || '·')}</div>
        <div><b style="font-family:var(--display);font-size:15px">${esc(u.name)}</b><div style="font-size:11.5px;color:var(--ink-soft)">${esc(u.email)} · ${isGoogle ? 'Google account' : 'Email account'}</div></div>
        <button class="modal-x" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${isGoogle ? `
          <p style="font-size:12.5px;color:var(--ink-soft);line-height:1.5">You're signed in with Google. Manage your password and security in your Google account.</p>`
        : `
          <h4 style="font-family:var(--display);font-size:13px;margin-bottom:10px">Change password</h4>
          <div class="err-slot"></div>
          <form class="acct-form">
            <div class="field"><label>Current password</label><input name="currentPassword" type="password" required></div>
            <div class="field"><label>New password</label><input name="newPassword" type="password" placeholder="at least 6 characters" required></div>
            <button class="btn primary" type="submit">Update password</button>
          </form>`}
      </div>
    </div>`);
  overlay.appendChild(modal);
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  modal.querySelector('.modal-x').onclick = close;

  const form = modal.querySelector('.acct-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button'); btn.disabled = true;
    modal.querySelector('.err-slot').innerHTML = '';
    try {
      await api.post('/api/auth/change-password', Object.fromEntries(new FormData(form)));
      toast('Password changed', 'ok'); close();
    } catch (err) {
      modal.querySelector('.err-slot').innerHTML = `<div class="auth-err">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  };
  document.body.appendChild(overlay);
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
      <div><b>${esc(state.user.neighborhood || 'Your area')}</b><span>Showing places near you</span></div>
      <span class="live"></span>
    </div>`));

  // header + stream toggle
  const top = h(`
    <div class="toprow">
      <h2>${isNear ? 'Near Me' : meta.title}<small class="count-sub">…</small></h2>
      <div class="seg">
        <button class="${state.stream === 'good' ? 'on good' : 'good'}" data-s="good">✦ The Good</button>
        <button class="${state.stream === 'care' ? 'on care' : 'care'}" data-s="care">△ Needs Care</button>
      </div>
    </div>`);
  top.querySelectorAll('[data-s]').forEach((b) => {
    b.onclick = () => { state.stream = b.dataset.s; if (!isNear) go(state.stream); else render(); };
  });
  wrap.appendChild(top);

  // sort pills
  const sorts = h(`
    <div class="sortbar">
      <span class="lbl">Sort</span>
      ${[['near', 'Nearest'], ['new', 'Newest'], ['top', 'Most cheered']]
        .map(([k, l]) => `<button class="pill ${state.sort === k ? 'on' : ''}" data-sort="${k}">${l}</button>`).join('')}
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
    if (countEl) countEl.textContent = `${total} ${state.stream === 'good' ? 'good things nearby' : 'places that need care'}`;
    if (!total) {
      feed.appendChild(h(`<div class="empty"><b>Nothing here yet</b>Be the first to capture something on your block.</div>`));
      return;
    }
    posts.forEach((p) => feed.appendChild(postCard(p)));
    if (hasMore) {
      const wrap = h(`<div class="load-more-wrap" style="grid-column:1/-1;text-align:center;margin-top:6px"><button class="pill">Load more</button></div>`);
      wrap.querySelector('button').onclick = () => loadFeed(feed, countEl, offset + posts.length);
      feed.appendChild(wrap);
    }
  } catch (err) {
    if (offset === 0) feed.innerHTML = '';
    feed.appendChild(h(`<div class="empty"><b>Couldn't load the feed</b>${esc(err.message)}</div>`));
  }
}

/* --------------------------------------------------------------- post card */
function postCard(p) {
  const g = p.stream === 'good';
  const card = h(`<article class="post"></article>`);

  const media = h(`<div class="media ${g ? 'g' : 'c'}"></div>`);
  if (p.mediaUrl) {
    media.appendChild(p.mediaType === 'video'
      ? h(`<video src="${esc(p.mediaUrl)}" muted playsinline preload="metadata"></video>`)
      : h(`<img src="${esc(p.mediaUrl)}" alt="">`));
  }
  if (p.mediaType === 'video') media.appendChild(h(`<div class="play"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg></div>`));
  if (p.ai?.tag) media.appendChild(h(`<span class="ai-tag">${ICONS.spark}${esc(p.ai.tag)}</span>`));
  if (p.stream === 'care' && p.status !== 'open')
    media.appendChild(h(`<span class="status-tag ${p.status}">${esc(STATUS_LABEL[p.status])}</span>`));
  media.appendChild(h(`<span class="badge">${p.mediaType === 'video' ? `▶ Video${p.durationS ? ' · 0:' + String(p.durationS).padStart(2, '0') : ''}` : '◎ Photo'}</span>`));
  media.onclick = () => go(`post/${p.id}`);
  card.appendChild(media);

  const body = h(`<div class="pbody"></div>`);
  const title = h(`<h3>${esc(p.title)}</h3>`);
  title.onclick = () => go(`post/${p.id}`);
  body.appendChild(title);
  body.appendChild(h(`<div class="pmeta">
      <span>📍 ${esc(p.placeName || 'Nearby')}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''}</span>
      <span>· by ${esc(p.author?.name || 'Neighbour')}</span>
      <span>· ${timeAgo(p.createdAt)}</span>
    </div>`));

  // AI action suggestion for care items routed to the city
  if (p.stream === 'care' && p.ai?.action === 'city' && p.status === 'open') {
    body.appendChild(h(`<div class="suggest">${ICONS.spark}
      <div><b>AI suggests: this needs the city</b><p>${esc(p.ai.summary || '')}</p></div></div>`));
  }

  body.appendChild(reactionRow(p, card));
  card.appendChild(body);
  return card;
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
      try {
        const { post } = await api.post(`/api/posts/${p.id}/react`, { type });
        const fresh = postCard(post);
        cardEl.replaceWith(fresh);
      } catch (e) { toast(e.message, 'err'); }
    };
    return btn;
  };

  if (g) {
    row.append(mk('cheer', '👏 Cheer', 'cheer'), mk('help', "🙌 I'll help tend it"));
  } else {
    if (p.ai?.action === 'city' && (p.status === 'open' || p.status === 'rallying') && p.author?.id === state.user.id) {
      const send = h(`<button class="rbtn act">${ICONS.send} Send report</button>`);
      send.onclick = () => advance(p.id, 'send_report');
      row.appendChild(send);
    }
    row.append(mk('metoo', '🙋 Me too here'), mk('help', "🙌 I'll help"));
  }
  const share = h(`<button class="rbtn">⤷ Share</button>`);
  share.onclick = () => { navigator.clipboard?.writeText(location.origin + '/#/post/' + p.id); toast('Link copied', 'ok'); };
  row.appendChild(share);
  return row;
}

async function advance(id, action) {
  try {
    await api.post(`/api/posts/${id}/advance`, { action });
    toast(action === 'send_report' ? 'Report sent to District Works' : 'Loop updated', 'ok');
    render();
  } catch (e) { toast(e.message, 'err'); }
}

/* ----------------------------------------------------------------- the map */
// Load the Google Maps JS SDK once, on demand, with the key from /api/auth/config.
// Returns a promise that resolves to `google.maps` (rejects if no key / load fails).
let _mapsPromise;
function loadMaps() {
  if (_mapsPromise) return _mapsPromise;
  const key = state.config.mapsApiKey;
  if (!key) return Promise.reject(new Error('Maps not configured'));
  _mapsPromise = new Promise((resolve, reject) => {
    window.__obMapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
          + '&loading=async&callback=__obMapsReady';
    s.async = true;
    s.onerror = () => reject(new Error('Maps failed to load'));
    document.head.appendChild(s);
  });
  return _mapsPromise;
}

/** Turn coordinates into a {placeName, neighborhood} via Google's Geocoder. */
async function reverseGeocode(lat, lng) {
  try {
    const maps = await loadMaps();
    const { results } = await new maps.Geocoder().geocode({ location: { lat, lng } });
    if (!results || !results.length) return null;
    const comps = results.flatMap((r) => r.address_components || []);
    const pick = (type) => comps.find((c) => c.types.includes(type))?.long_name;
    const placeName = pick('route') || pick('neighborhood')
      || results[0].formatted_address?.split(',')[0] || null;
    const neighborhood = pick('neighborhood') || pick('sublocality') || pick('locality') || null;
    return { placeName, neighborhood };
  } catch { return null; }
}

function youIcon(maps) {
  return { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#234E3F', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 };
}
function pinIcon(maps, good) {
  return {
    path: 'M0 0 C-9 0 -14 7 -14 14 C-14 24 0 34 0 34 C0 34 14 24 14 14 C14 7 9 0 0 0Z',
    fillColor: good ? '#E2A02E' : '#C0613A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2,
    anchor: new maps.Point(0, 34),
  };
}

function mapCard(streamFilter) {
  const card = h(`
    <div class="map-card">
      <div class="loc"><span class="live"></span>📍 <span class="loc-name">${esc(state.user.neighborhood || 'Locating…')}</span></div>
      <div class="gmap"></div>
    </div>`);
  const el = card.querySelector('.gmap');
  const nameEl = card.querySelector('.loc-name');

  loadMaps().then(async (maps) => {
    let data = { pins: [], viewer: null };
    try { data = await api.get('/api/posts/pins'); } catch { /* show base map */ }
    // On the Good/Care views, show only that stream's pins; on Near Me, show all.
    const pins = streamFilter ? data.pins.filter((p) => p.stream === streamFilter) : data.pins;

    const viewerCenter =
      data.viewer && data.viewer.lat != null ? { lat: data.viewer.lat, lng: data.viewer.lng }
      : state.user.lat != null && state.user.lng != null ? { lat: state.user.lat, lng: state.user.lng }
      : null;

    const map = new maps.Map(el, {
      center: viewerCenter || { lat: 20, lng: 0 },
      zoom: viewerCenter ? 15 : 2,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });

    // One reusable "you" marker we can move once the real GPS fix arrives.
    let youMarker = null;
    const setYou = (pos) => {
      if (youMarker) youMarker.setPosition(pos);
      else youMarker = new maps.Marker({ position: pos, map, icon: youIcon(maps), title: 'You', zIndex: 999 });
    };

    const bounds = new maps.LatLngBounds();
    if (viewerCenter) { setYou(viewerCenter); bounds.extend(viewerCenter); }
    pins.filter((p) => p.lat != null).forEach((p) => {
      const m = new maps.Marker({
        position: { lat: p.lat, lng: p.lng }, map,
        icon: pinIcon(maps, p.stream === 'good'), title: p.title || '',
      });
      m.addListener('click', () => go(`post/${p.id}`));
      bounds.extend({ lat: p.lat, lng: p.lng });
    });

    // Frame everything, but never zoom in too far on a lone pin.
    if (pins.length && !bounds.isEmpty()) {
      map.fitBounds(bounds, 64);
      maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
    }

    // Ask the browser for the real location, then recentre on it and persist it
    // (so the stale profile default — e.g. the old Shanghai coords — is replaced).
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setYou(here);
        // Don't yank the view away from real pins; recentre only when none are framed.
        if (!data.pins.length) { map.setCenter(here); if (map.getZoom() < 14) map.setZoom(15); }
        const geo = await reverseGeocode(here.lat, here.lng);
        if (geo?.neighborhood) nameEl.textContent = geo.neighborhood;
        api.put('/api/auth/me/location', { ...here, neighborhood: geo?.neighborhood || null })
          .then(({ user }) => { state.user = user; }).catch(() => {});
      }, () => { /* permission denied → keep profile location */ },
      { enableHighAccuracy: true, timeout: 8000 });
    }
  }).catch(() => {
    el.innerHTML =
      '<div class="map-fallback"><b>Map unavailable</b>' +
      '<span>Set a Google Maps API key (MAPS_API_KEY) to enable the live map.</span></div>';
  });

  return card;
}

/* ------------------------------------------------------------- right panel */
function sidePanel() {
  const side = h(`<aside class="side"></aside>`);

  const cta = h(`
    <div class="capture-cta">
      <b>Notice something?</b>
      <p>Capture the good or the needs-care. Location is attached automatically on mobile.</p>
      <div class="cap-row">
        <button class="cap-btn" data-mode="photo">${ICONS.camera}Photo</button>
        <button class="cap-btn" data-mode="video">${ICONS.video}Video</button>
        <button class="cap-btn solid" data-mode="pin">${ICONS.pin}Pin</button>
      </div>
    </div>`);
  cta.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => go('capture')));
  side.appendChild(cta);

  side.appendChild(h(`
    <div class="panel">
      <h4>👏 Capitalization in action <span class="tagpin">Active-constructive</span></h4>
      <p>Reactions aren't passive "likes." Neighbours reply with <strong>Cheer</strong>, <strong>I'll join</strong>, or <strong>Me too here</strong> — the enthusiastic responses that amplify a sharer's wellbeing.</p>
    </div>`));

  const impact = h(`<div class="panel"><h4>My impact <span class="tagpin">Intrapersonal</span></h4><div class="impact-slot">…</div></div>`);
  side.appendChild(impact);
  const community = h(`<div class="panel"><h4>Our block this month <span class="tagpin">Collective efficacy</span></h4><div class="comm-slot">…</div></div>`);
  side.appendChild(community);

  const loop = h(`<div class="panel"><h4>Loop status · recent care</h4><div class="loop-slot">…</div></div>`);
  side.appendChild(loop);

  // hydrate
  api.get('/api/stats/me').then((s) => {
    impact.querySelector('.impact-slot').innerHTML = `
      <div class="stat"><span class="n">${s.acts}</span><span class="l">acts of care this season</span></div>
      <div class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></div>
      <div class="stat" style="margin-top:12px"><span class="n">${s.resolved}</span><span class="l">items you helped get <strong>resolved</strong></span></div>`;
  }).catch(() => {});
  api.get('/api/stats/community').then((c) => {
    community.querySelector('.comm-slot').innerHTML = `
      <div class="stat"><span class="n">${c.acts}</span><span class="l">acts across ${c.neighbours} neighbours</span></div>
      <p style="margin-top:4px">↑ ${c.changePct}% vs last month · ${c.resolved} issues closed together</p>`;
  }).catch(() => {});
  api.get('/api/posts?stream=care&sort=new').then(({ posts }) => {
    const withLoop = posts.find((p) => p.loop.length) || posts[0];
    const slot = loop.querySelector('.loop-slot');
    if (!withLoop) { slot.innerHTML = '<p>No care items being tracked yet.</p>'; return; }
    slot.innerHTML = `<p style="font-weight:700;color:var(--ink);margin-bottom:9px">${esc(withLoop.title)}</p>` +
      (withLoop.loop.length ? renderLoopSteps(withLoop.loop) : '<p>Not yet routed.</p>');
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

  wrap.appendChild(h(`<div class="back-link">‹ Back to feed</div>`)).onclick = () => history.back();
  wrap.appendChild(h(`<div class="toprow"><h2>New capture<small>Photo &amp; short video · location attached automatically</small></h2></div>`));

  const vf = h(`
    <div class="viewfinder">
      <div class="grid3"></div>
      <div class="placeholder">Upload a photo or a short clip (≤ 15s).<br>Your location is auto-tagged.</div>
      <div class="vf-loc">${ICONS.pin.replace('currentColor', '#fff')}<span class="loc-text">Locating…</span></div>
    </div>`);
  wrap.appendChild(vf);

  const modes = h(`<div class="modes">
      <span class="mode on" data-m="photo">Photo</span>
      <span class="mode" data-m="video">Video ≤ 15s</span></div>`);
  modes.querySelectorAll('.mode').forEach((m) => m.onclick = () => {
    modes.querySelectorAll('.mode').forEach((x) => x.classList.remove('on'));
    m.classList.add('on'); draft.mode = m.dataset.m;
  });
  wrap.appendChild(modes);

  const up = h(`<div class="upbtns">
      <label class="upbtn">${ICONS.camera}Take a photo<input type="file" accept="image/*" capture="environment" hidden></label>
      <label class="upbtn">${ICONS.video}Take a video<input type="file" accept="video/*" capture="environment" hidden></label>
    </div>`);
  up.querySelectorAll('input').forEach((inp) => inp.onchange = (e) => onFile(e.target.files[0]));
  wrap.appendChild(up);
  const geoEl = h(`<div class="geo-check hidden"></div>`);
  wrap.appendChild(geoEl);

  // stream picker
  const pick = h(`<div class="stream-pick">
      <button class="care on" data-s="care"><b>△ Needs Care</b><span>Something to fix or flag</span></button>
      <button class="good" data-s="good"><b>✦ The Good</b><span>Something worth savouring</span></button>
    </div>`);
  pick.querySelectorAll('button').forEach((b) => b.onclick = () => {
    pick.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on'); draft.stream = b.dataset.s;
  });
  wrap.appendChild(pick);

  const form = h(`
    <div class="card">
      <div class="field"><label>Title</label><input name="title" placeholder="What did you notice?"></div>
      <div class="field"><label>A little more (optional)</label><input name="body" placeholder="Add context for your neighbours"></div>
      <div class="ai-preview hidden">${ICONS.spark}<div class="ai-text"></div></div>
      <button class="btn primary" disabled>Post to the block</button>
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

  // Ask the vision model to suggest a title + description from the photo. Fills only
  // empty fields (never clobbers what the neighbour typed) and stays fully editable.
  let describeSeq = 0;
  async function autoDescribe(file) {
    const seq = ++describeSeq;
    aiBox.classList.remove('hidden');
    aiText.innerHTML = '<b>Reading your photo…</b>';
    try {
      const { title, description } = await api.describeImage(file, draft.stream);
      if (seq !== describeSeq) return; // a newer photo superseded this one
      if (title && !titleInput.value.trim()) titleInput.value = title;
      if (description && !bodyInput.value.trim()) bodyInput.value = description;
      refreshSubmit();
      aiText.innerHTML = '<b>Suggested from your photo</b><p>Edit anything before you post.</p>';
    } catch {
      if (seq === describeSeq) aiBox.classList.add('hidden'); // silent fall back to manual
    }
  }

  function onFile(file) {
    if (!file) return;
    draft.file = file;
    draft.mediaType = file.type.startsWith('video') ? 'video' : 'photo';
    const url = URL.createObjectURL(file);
    vf.querySelector('.placeholder')?.remove();
    vf.querySelectorAll('img,video').forEach((n) => n.remove());
    vf.insertBefore(draft.mediaType === 'video'
      ? h(`<video src="${url}" controls muted playsinline></video>`)
      : h(`<img src="${url}" alt="preview">`), vf.querySelector('.grid3'));
    refreshSubmit();
    if (draft.mediaType === 'photo') {
      autoDescribe(file); // vision only applies to stills
      draft.photoGps = null;
      exifGps(file).then((g) => { draft.photoGps = g; verifyPhotoGeo(draft, geoEl, refreshSubmit); });
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
    showLoc('Locating…');
    const geo = await reverseGeocode(lat, lng);
    draft.place = geo?.placeName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    draft.neighborhood = geo?.neighborhood || null;
    showLoc(draft.place);
    // Persist the freshest location (and resolved neighbourhood) on the profile.
    api.put('/api/auth/me/location', { lat, lng, neighborhood: draft.neighborhood })
      .then(({ user }) => { state.user = user; }).catch(() => {});
  };
  function requestLoc() {
    if (!navigator.geolocation) { showLoc('Location unavailable on this device'); return; }
    showLoc('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => onCoords(pos.coords.latitude, pos.coords.longitude),
      () => { draft.coords = null; refreshSubmit(); showLoc('Turn on location to post — tap to retry'); },
      { enableHighAccuracy: true, timeout: 6000 }
    );
  }
  if (vfLoc) vfLoc.style.cursor = 'pointer', vfLoc.onclick = requestLoc;
  requestLoc();

  submit.onclick = async () => {
    submit.disabled = true; submit.textContent = 'Posting…';
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
      });
      // show what the AI decided
      const ai = form.querySelector('.ai-preview');
      ai.classList.remove('hidden');
      ai.querySelector('.ai-text').innerHTML =
        `<b>AI routed this to: ${esc(ACTION_LABEL[post.ai.action] || post.ai.action)}</b><p>${esc(post.ai.summary || '')}</p>`;
      toast('Posted to your block', 'ok');
      setTimeout(() => go(`post/${post.id}`), 700);
    } catch (e) {
      toast(e.message, 'err');
      submit.disabled = false; submit.textContent = 'Post to the block';
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

    const media = h(`<div class="detail-media ${p.mediaUrl ? '' : (g ? 'g' : 'c')}"></div>`);
    if (p.mediaUrl) {
      media.appendChild(p.mediaType === 'video'
        ? h(`<video src="${esc(p.mediaUrl)}" controls playsinline></video>`)
        : h(`<img src="${esc(p.mediaUrl)}" alt="">`));
    } else {
      media.appendChild(h(`<span class="badge" style="position:absolute;bottom:10px;left:10px">${p.mediaType === 'video' ? '▶ Video' : '◎ Photo'}</span>`));
    }
    slot.appendChild(media);
    const dm = detailMap(p);
    if (dm) slot.appendChild(dm);

    const card = h(`<div class="card" style="margin-top:14px">
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span class="badge" style="background:${g ? 'var(--good)' : 'var(--care)'};color:${g ? '#3a2a10' : '#fff'}">${g ? '✦ The Good' : '△ Needs Care'}</span>
          ${p.ai?.tag ? `<span class="badge" style="background:var(--green-tint);color:var(--green)">${esc(p.ai.tag)}</span>` : ''}
          ${p.stream === 'care' ? `<span class="badge" style="background:var(--paper-2);color:var(--ink-soft)">${esc(STATUS_LABEL[p.status])}</span>` : ''}
        </div>
        <h2 style="font-family:var(--display);font-size:22px;margin-bottom:6px">${esc(p.title)}</h2>
        <div class="pmeta">📍 ${esc(p.placeName || 'Nearby')}${p.distanceM != null ? ' · ' + dist(p.distanceM) : ''} · by ${esc(p.author?.name || 'Neighbour')} · ${timeAgo(p.createdAt)}</div>
        ${p.body ? `<p class="pdesc" style="margin-top:8px">${esc(p.body)}</p>` : ''}
      </div>`);
    card.appendChild(reactionRow(p, card));
    if (p.author?.id === state.user.id) {
      const del = h(`<button class="rbtn" style="margin-top:10px;border-color:var(--care);color:var(--care)">🗑 Remove this post</button>`);
      del.onclick = async () => {
        if (!confirm('Remove this post? This cannot be undone.')) return;
        try { await api.del(`/api/posts/${p.id}`); toast('Post removed', 'ok'); go('near'); }
        catch (e) { toast(e.message, 'err'); }
      };
      card.appendChild(del);
    }
    slot.appendChild(card);

    // action ladder for care
    if (p.stream === 'care') slot.appendChild(actionLadder(p));

    // comments
    const cbox = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:8px">Neighbour replies (${comments.length})</h4></div>`);
    comments.forEach((c) => cbox.appendChild(h(`
      <div class="comment"><div class="av">${esc(c.avatar || '·')}</div>
        <div><b>${esc(c.author)}</b> <span style="color:var(--ink-soft);font-size:11px">· ${timeAgo(c.createdAt)}</span>
        <p>${esc(c.body)}</p></div></div>`)));
    const cform = h(`<form class="comment-form"><input placeholder="Add an encouraging reply…" maxlength="280"><button class="btn primary" style="width:auto;padding:10px 16px">Reply</button></form>`);
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
    slot.innerHTML = `<div class="empty"><b>Couldn't load this post</b>${esc(err.message)}</div>`;
  });

  return wrap;
}

function actionLadder(p) {
  const owner = p.author?.id === state.user.id;
  const box = h(`<div class="card">
      <h4 style="font-family:var(--display);margin-bottom:4px">AI action ladder</h4>
      <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">Every issue stays coupled to a path to act. AI suggested: <strong>${esc(ACTION_LABEL[p.ai?.action] || '—')}</strong>.</p>
      <div class="ladder"></div>
    </div>`);
  const ladder = box.querySelector('.ladder');
  [['self', '1', 'Tend it yourself', 'Small enough to fix or savour on your own'],
   ['rally', '2', 'Rally neighbours', 'Organise a few people nearby'],
   ['city', '3', 'Send to the city', 'Route a report to the responsible agency']]
    .forEach(([key, k, label, sub]) => {
      const on = p.ai?.action === key;
      const rung = h(`<div class="rung ${on ? 'hot' : ''}" style="${on ? 'background:var(--green-tint);border-color:var(--green-2)' : ''}">
        <span class="k">${k}</span><div><div>${label}</div><div style="font-size:10.5px;color:var(--ink-soft);font-weight:500">${sub}</div></div>
        ${on ? '<b>AI pick</b>' : ''}</div>`);
      ladder.appendChild(rung);
    });

  if (p.loop.length) {
    box.appendChild(h(`<div style="margin-top:14px">${renderLoopSteps(p.loop)}</div>`));
  }

  if (owner && p.status !== 'resolved') {
    const actions = h(`<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"></div>`);
    const add = (label, action) => {
      const b = h(`<button class="rbtn">${esc(label)}</button>`);
      b.onclick = () => advance(p.id, action);
      actions.appendChild(b);
    };
    if (p.ai?.action === 'city' && ['open', 'rallying'].includes(p.status)) add('↗ Send report to city', 'send_report');
    if (['routed', 'rallying', 'open'].includes(p.status)) add('🛠 Mark in progress', 'in_progress');
    add('✓ Mark resolved', 'resolve');
    box.appendChild(actions);
  }
  return box;
}

/* --------------------------------------------------------- impact / community */
function impactView() {
  const wrap = h(`<div style="max-width:780px;margin:0 auto"></div>`);
  wrap.appendChild(h(`<div class="toprow"><h2>My Impact<small>Intrapersonal self-efficacy — effort made visible</small></h2></div>`));
  const slot = h(`<div><div class="spinner"></div></div>`);
  wrap.appendChild(slot);

  Promise.all([api.get('/api/stats/me'), api.get('/api/posts?mine=1&sort=new')])
    .then(([s, mine]) => {
      slot.innerHTML = '';
      slot.appendChild(h(`<div class="statgrid">
          <div class="bigstat"><div class="n">${s.acts}</div><div class="l">acts of care this season</div></div>
          <div class="bigstat good"><div class="n">${s.captured}</div><div class="l">observations you captured</div></div>
          <div class="bigstat care"><div class="n">${s.resolved}</div><div class="l">items you helped resolve</div></div>
          <div class="bigstat"><div class="n">${s.cheersReceived}</div><div class="l">cheers your posts received</div></div>
        </div>`));
      slot.appendChild(h(`<div class="card" style="margin-top:16px">
          <h4 style="font-family:var(--display);margin-bottom:8px">Season goal</h4>
          <div class="stat"><span class="n">${s.acts}</span><span class="l">of ${s.goal} acts</span></div>
          <div class="bar"><i style="width:${Math.round(s.progress * 100)}%"></i></div>
        </div>`));
      const list = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:10px">Your captures</h4></div>`);
      const feed = h(`<div class="feed"></div>`);
      if (!mine.posts.length) feed.appendChild(h(`<div class="empty"><b>Nothing yet</b>Capture the first thing on your block.</div>`));
      mine.posts.forEach((p) => feed.appendChild(postCard(p)));
      list.appendChild(feed);
      slot.appendChild(list);
    }).catch((e) => { slot.innerHTML = `<div class="empty"><b>Couldn't load</b>${esc(e.message)}</div>`; });
  return wrap;
}

function communityView() {
  const wrap = h(`<div style="max-width:820px;margin:0 auto"></div>`);
  wrap.appendChild(h(`<div class="toprow"><h2>Community<small>Collective efficacy — what the block does together</small></h2></div>`));
  const slot = h(`<div><div class="spinner"></div></div>`);
  wrap.appendChild(slot);

  api.get('/api/stats/community').then((c) => {
    slot.innerHTML = '';
    slot.appendChild(h(`<div class="statgrid">
        <div class="bigstat"><div class="n">${c.acts}</div><div class="l">acts across ${c.neighbours} neighbours</div></div>
        <div class="bigstat good"><div class="n">${c.good}</div><div class="l">good things noticed</div></div>
        <div class="bigstat care"><div class="n">${c.care}</div><div class="l">care items flagged</div></div>
        <div class="bigstat"><div class="n">${c.resolved}</div><div class="l">issues closed together</div></div>
      </div>`));
    slot.appendChild(h(`<div class="card" style="margin-top:16px;background:linear-gradient(150deg,var(--green-2),var(--green));color:#fff;border:0">
        <div style="font-family:var(--display);font-weight:800;font-size:18px">↑ ${c.changePct}% more acts than last month</div>
        <p style="color:#CFE0D7;font-size:13px;margin-top:4px">When neighbours can see shared effort, they do more of it. That's collective efficacy (Sampson et al., 1997).</p>
      </div>`));
    const board = h(`<div class="card"><h4 style="font-family:var(--display);margin-bottom:10px">Most active neighbours</h4></div>`);
    c.leaders.forEach((l, i) => board.appendChild(h(`
      <div class="rung" style="margin-bottom:7px"><span class="k">${i + 1}</span>
        <span>${esc(l.name_cjk ? l.name_cjk + ' · ' : '')}${esc(l.name)}</span>
        <b style="margin-left:auto">${l.posts} posts</b></div>`)));
    slot.appendChild(board);
  }).catch((e) => { slot.innerHTML = `<div class="empty"><b>Couldn't load</b>${esc(e.message)}</div>`; });
  return wrap;
}

boot();
