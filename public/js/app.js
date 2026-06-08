import { api } from './api.js';
import { h, esc, timeAgo, dist, toast, ICONS, project } from './ui.js';

const app = document.getElementById('app');

const state = {
  user: null,
  view: 'near',     // near | good | care | impact | community | capture | post
  stream: 'good',   // good | care (for near/list streams)
  sort: 'near',     // new | near | top
  postId: null,
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
    const { user } = await api.get('/api/auth/me');
    state.user = user;
  } catch { /* offline / first run */ }
  window.addEventListener('hashchange', routeFromHash);
  routeFromHash();
}

function routeFromHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, id] = hash.split('/');
  if (!state.user) return renderAuth();

  if (seg === 'post' && id) { state.view = 'post'; state.postId = id; }
  else if (NAV.some((n) => n.key === seg)) { state.view = seg; if (seg === 'good' || seg === 'care') state.stream = seg; }
  else if (seg === 'capture') state.view = 'capture';
  else state.view = 'near';
  render();
}

function go(path) { location.hash = `#/${path}`; }

/* ------------------------------------------------------------------- auth */
function renderAuth() {
  let mode = 'login';
  const mount = () => {
    app.innerHTML = '';
    const card = h(`
      <div class="auth-wrap"><div class="auth-card">
        <div class="brand cjk">优城美市<small>Our Block</small></div>
        <div class="auth-tag">Your block, in good hands — together.</div>
        <div class="err-slot"></div>
        <form class="auth-form">
          ${mode === 'register' ? `
            <div class="field"><label>Name</label><input name="name" placeholder="e.g. Ling W." required></div>
            <div class="field"><label>Name in 中文 (optional)</label><input name="nameCjk" placeholder="玲"></div>` : ''}
          <div class="field"><label>Email</label><input name="email" type="email" placeholder="you@block.org" required></div>
          <div class="field"><label>Password</label><input name="password" type="password" placeholder="••••••" required></div>
          <button class="btn primary" type="submit">${mode === 'login' ? 'Sign in' : 'Create account'}</button>
        </form>
        <div class="auth-switch">
          ${mode === 'login' ? "New here? <a data-sw>Create an account</a>" : "Have an account? <a data-sw>Sign in</a>"}
        </div>
        ${mode === 'login' ? `<div class="demo-hint">Demo neighbour → <code>ling@ourblock.org</code> · <code>ourblock</code></div>` : ''}
      </div></div>`);

    card.querySelector('[data-sw]').onclick = () => { mode = mode === 'login' ? 'register' : 'login'; mount(); };
    card.querySelector('.auth-form').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const fd = Object.fromEntries(new FormData(e.target));
      try {
        const data = await api.post(`/api/auth/${mode}`, fd);
        api.saveToken(data.token);
        state.user = data.user;
        toast(`Welcome, ${data.user.name.split(' ')[0]}`, 'ok');
        go('near');
      } catch (err) {
        card.querySelector('.err-slot').innerHTML = `<div class="auth-err">${esc(err.message)}</div>`;
        btn.disabled = false;
      }
    };
    app.appendChild(card);
  };
  mount();
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
        <div><b>${esc(u.name)}</b><span>${esc(u.neighborhood)} · Lv. ${u.level} ${esc(u.levelTitle)}</span></div>
      </div>
      <button class="signout">Sign out</button>
    </aside>`);
  const navSlot = rail.querySelector('.nav-slot');
  NAV.forEach((n) => {
    const item = h(`<button class="nav-i ${state.view === n.key ? 'on' : ''}">${ICONS[n.icon]}${n.label}</button>`);
    item.onclick = () => go(n.key);
    navSlot.appendChild(item);
  });
  rail.querySelector('.signout').onclick = signOut;

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
  const f = h(`<button class="fab">${ICONS.camera.replace('currentColor', '#3a2a10')}</button>`);
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

/* --------------------------------------------------------------- feed view */
function feedView() {
  const isNear = state.view === 'near';
  const meta = STREAM_META[state.stream];
  const wrap = h(`<div></div>`);

  // location bar (mobile-friendly, mirrors the desktop "loc" chip)
  wrap.appendChild(h(`
    <div class="locbar">
      <div class="gps">${ICONS.pin.replace('currentColor', '#234E3F')}</div>
      <div><b>${esc(state.user.neighborhood)}</b><span>Showing places within 1.2 km</span></div>
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

  // map (only on Near Me)
  if (isNear) wrap.appendChild(mapCard());

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
function mapCard() {
  const card = h(`
    <div class="map-card">
      <div class="loc"><span class="live"></span>📍 ${esc(state.user.neighborhood)} · within 1.2 km</div>
      <div class="zoom"><button data-z="in">+</button><button data-z="out">−</button></div>
      <svg class="map" viewBox="0 0 560 230" xmlns="http://www.w3.org/2000/svg">
        <rect width="560" height="230" fill="#EDE7D6"/>
        <path d="M40 40 q60 -22 130 6 q40 60 -10 120 q-90 30 -130 -20 q-20 -60 10 -106z" fill="#D5E2CF"/>
        <circle cx="95" cy="95" r="5" fill="#9FBF9C"/><circle cx="130" cy="120" r="4" fill="#9FBF9C"/><circle cx="80" cy="135" r="4" fill="#9FBF9C"/>
        <path d="M0 175 q140 -30 280 6 q160 40 280 0 l0 60 l-560 0z" fill="#BFD6D2"/>
        <g stroke="#F6F1E4" stroke-width="9" stroke-linecap="round">
          <path d="M0 60 H560"/><path d="M0 130 H560"/><path d="M210 0 V200"/><path d="M380 0 V200"/><path d="M300 0 V200"/>
        </g>
        <g stroke="#E0D8C2" stroke-width="2"><path d="M0 95 H560"/><path d="M110 0 V200"/><path d="M470 0 V200"/></g>
        <g class="pin-layer"></g>
        <g class="you-layer"></g>
      </svg>
    </div>`);

  let span = 0.012;
  const draw = async () => {
    try {
      const { pins, viewer } = await api.get('/api/posts/pins');
      const center = viewer && viewer.lat != null ? viewer : { lat: state.user.lat, lng: state.user.lng };
      const layer = card.querySelector('.pin-layer');
      layer.innerHTML = '';
      pins.filter((p) => state.stream === undefined || true).forEach((p) => {
        if (p.lat == null) return;
        const { x, y } = project(p.lat, p.lng, center, span, 560, 200);
        const good = p.stream === 'good';
        const color = good ? '#E2A02E' : '#C0613A';
        const glyph = good
          ? '<circle cx="0" cy="14" r="5" fill="#fff"/>'
          : '<path d="M0 8 v6 M0 18 h.01" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>';
        const pin = h(`<g class="map-pin" transform="translate(${x.toFixed(0)},${y.toFixed(0)})">
          <path d="M0 0 C-9 0 -14 7 -14 14 C-14 24 0 34 0 34 C0 34 14 24 14 14 C14 7 9 0 0 0Z" fill="${color}" stroke="#fff" stroke-width="2"/>${glyph}</g>`);
        pin.addEventListener('click', () => go(`post/${p.id}`));
        layer.appendChild(pin);
      });
      const yl = card.querySelector('.you-layer');
      const me = project(center.lat, center.lng, center, span, 560, 200);
      yl.innerHTML = `<g transform="translate(${me.x.toFixed(0)},${me.y.toFixed(0)})"><circle r="9" fill="#3FAE6B" opacity=".25"/><circle r="5" fill="#234E3F" stroke="#fff" stroke-width="2"/></g>`;
    } catch { /* leave decorative map */ }
  };
  card.querySelector('[data-z="in"]').onclick = () => { span = Math.max(0.003, span / 1.5); draw(); };
  card.querySelector('[data-z="out"]').onclick = () => { span = Math.min(0.05, span * 1.5); draw(); };
  draw();
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
  const draft = { stream: 'care', mode: 'photo', file: null, mediaUrl: null, mediaType: 'photo', coords: null, place: '' };
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
      <label class="upbtn">${ICONS.camera}Upload photo<input type="file" accept="image/*" hidden></label>
      <label class="upbtn">${ICONS.video}Upload video<input type="file" accept="video/*" capture="environment" hidden></label>
    </div>`);
  up.querySelectorAll('input').forEach((inp) => inp.onchange = (e) => onFile(e.target.files[0]));
  wrap.appendChild(up);

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
  const submit = form.querySelector('button');
  titleInput.oninput = () => { submit.disabled = !titleInput.value.trim() || !draft.file; };
  wrap.appendChild(form);

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
    submit.disabled = !titleInput.value.trim();
  }

  // geolocation
  const setPlace = (txt) => { vf.querySelector('.loc-text').textContent = txt; draft.place = txt; };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        draft.coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPlace(`Auto-tagged · ${draft.coords.lat.toFixed(4)}, ${draft.coords.lng.toFixed(4)}`);
        api.put('/api/auth/me/location', draft.coords).then(({ user }) => { state.user = user; }).catch(() => {});
      },
      () => setPlace(`Auto-tagged · ${state.user.neighborhood}`),
      { enableHighAccuracy: true, timeout: 6000 }
    );
  } else setPlace(`Auto-tagged · ${state.user.neighborhood}`);

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
        placeName: draft.place || state.user.neighborhood,
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
