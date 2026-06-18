// Lightweight, zero-dependency image cropper.
//
// cropImage(file) opens a modal letting the neighbour drag/resize a crop box
// (with Free / 1:1 / 4:3 / 16:9 presets) over their photo, then exports the
// selection as a fresh JPEG so it lands well-framed in the post.
//
// Resolves with:
//   • a cropped File (image/jpeg) when they tap Apply,
//   • the original File untouched when they tap Skip,
//   • null when they Cancel (caller should treat as "no photo chosen").
//
// NOTE: cropping re-encodes the image and therefore strips EXIF — including the
// GPS used for geo-verification. Callers MUST read exifGps() from the ORIGINAL
// file, never from the cropped result.

import { t } from './i18n.js';
import { h, esc } from './ui.js';

const MIN_BOX = 40;          // smallest crop box, in display px
const PRESETS = [
  { key: 'free', label: 'Free', ratio: null },
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];

// Decode the file with EXIF orientation already applied so the crop matches what
// the neighbour sees. Falls back to an <img> if createImageBitmap is unavailable.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { /* fall through to <img> */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = URL.createObjectURL(file);
  });
}

export async function cropImage(file) {
  // Non-images (videos) and undecodable files pass straight through.
  if (!file || !file.type.startsWith('image/')) return file;
  let src;
  try { src = await decode(file); }
  catch { return file; }

  const natW = src.width || src.naturalWidth;
  const natH = src.height || src.naturalHeight;
  if (!natW || !natH) return file;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (settled) return; settled = true; cleanup(); resolve(val); };

    const modal = h(`
      <div class="crop-modal" role="dialog" aria-modal="true" aria-label="${esc(t('Crop your photo'))}">
        <div class="crop-panel">
          <div class="crop-presets" role="group" aria-label="${esc(t('Aspect ratio'))}"></div>
          <div class="crop-stage"><canvas class="crop-canvas"></canvas>
            <div class="crop-box" tabindex="0">
              <span class="crop-h tl" data-h="tl"></span><span class="crop-h tr" data-h="tr"></span>
              <span class="crop-h bl" data-h="bl"></span><span class="crop-h br" data-h="br"></span>
            </div>
          </div>
          <div class="crop-actions">
            <button class="btn ghost" data-act="cancel">${esc(t('Cancel'))}</button>
            <button class="btn ghost" data-act="skip">${esc(t('Skip'))}</button>
            <button class="btn primary" data-act="apply">${esc(t('Apply'))}</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(modal);

    const canvas = modal.querySelector('.crop-canvas');
    const stage = modal.querySelector('.crop-stage');
    const boxEl = modal.querySelector('.crop-box');
    const presetsEl = modal.querySelector('.crop-presets');
    const ctx = canvas.getContext('2d');

    // Fit the image inside the available stage area ("contain"), then size the
    // canvas to that displayed rect. scale maps display px → natural px.
    const maxW = Math.min(window.innerWidth * 0.92, 560);
    const maxH = window.innerHeight * 0.6;
    const scale = Math.min(maxW / natW, maxH / natH, 1);
    const dispW = Math.round(natW * scale);
    const dispH = Math.round(natH * scale);
    canvas.width = dispW; canvas.height = dispH;
    ctx.drawImage(src, 0, 0, dispW, dispH);

    let ratio = null; // active aspect lock (null = free)
    // Crop box in canvas/display coordinates. Start at ~80% centred.
    let box = { x: dispW * 0.1, y: dispH * 0.1, w: dispW * 0.8, h: dispH * 0.8 };

    const clampBox = () => {
      box.w = Math.max(MIN_BOX, Math.min(box.w, dispW));
      box.h = Math.max(MIN_BOX, Math.min(box.h, dispH));
      box.x = Math.max(0, Math.min(box.x, dispW - box.w));
      box.y = Math.max(0, Math.min(box.y, dispH - box.h));
    };
    const drawBox = () => {
      boxEl.style.left = box.x + 'px';
      boxEl.style.top = box.y + 'px';
      boxEl.style.width = box.w + 'px';
      boxEl.style.height = box.h + 'px';
    };

    // Re-fit the box to a locked aspect ratio, keeping it centred and on-canvas.
    const applyRatio = () => {
      if (!ratio) { drawBox(); return; }
      const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
      let w = box.w, hgt = w / ratio;
      if (hgt > dispH) { hgt = dispH; w = hgt * ratio; }
      if (w > dispW) { w = dispW; hgt = w / ratio; }
      box.w = w; box.h = hgt; box.x = cx - w / 2; box.y = cy - hgt / 2;
      clampBox(); drawBox();
    };

    PRESETS.forEach((p, i) => {
      const b = h(`<button class="crop-preset${i === 0 ? ' on' : ''}" data-r="${p.key}">${esc(t(p.label))}</button>`);
      b.onclick = () => {
        ratio = p.ratio;
        presetsEl.querySelectorAll('.crop-preset').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        applyRatio();
      };
      presetsEl.appendChild(b);
    });

    // --- pointer drag (move + corner resize), mouse & touch via Pointer Events ---
    let drag = null;
    const pt = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (handle) => (e) => {
      e.preventDefault();
      drag = { handle, start: pt(e), orig: { ...box } };
      e.target.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e) => {
      if (!drag) return;
      const p = pt(e);
      const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
      const o = drag.orig;
      if (drag.handle === 'move') {
        box.x = o.x + dx; box.y = o.y + dy; clampBox(); drawBox();
        return;
      }
      // Corner resize — anchor the opposite corner.
      let left = o.x, top = o.y, right = o.x + o.w, bottom = o.y + o.h;
      if (drag.handle.includes('l')) left = o.x + dx; else right = o.x + o.w + dx;
      if (drag.handle.includes('t')) top = o.y + dy; else bottom = o.y + o.h + dy;
      let w = Math.max(MIN_BOX, right - left), hgt = Math.max(MIN_BOX, bottom - top);
      if (ratio) { // keep ratio, driven by the larger delta
        if (w / ratio >= hgt) hgt = w / ratio; else w = hgt * ratio;
      }
      box.x = drag.handle.includes('l') ? right - w : left;
      box.y = drag.handle.includes('t') ? bottom - hgt : top;
      box.w = w; box.h = hgt;
      clampBox(); drawBox();
    };
    const onUp = () => { drag = null; };

    boxEl.addEventListener('pointerdown', onDown('move'));
    boxEl.querySelectorAll('.crop-h').forEach((hd) =>
      hd.addEventListener('pointerdown', (e) => { e.stopPropagation(); onDown(hd.dataset.h)(e); }));
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);

    function cleanup() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('keydown', onKey);
      src.close?.(); // release the ImageBitmap
      modal.remove();
    }

    modal.querySelector('[data-act=cancel]').onclick = () => finish(null);
    modal.querySelector('[data-act=skip]').onclick = () => finish(file);
    modal.addEventListener('pointerdown', (e) => { if (e.target === modal) finish(null); });

    modal.querySelector('[data-act=apply]').onclick = () => {
      const nx = Math.round(box.x / scale), ny = Math.round(box.y / scale);
      const nw = Math.max(1, Math.round(box.w / scale)), nh = Math.max(1, Math.round(box.h / scale));
      const out = document.createElement('canvas');
      out.width = nw; out.height = nh;
      out.getContext('2d').drawImage(src, nx, ny, nw, nh, 0, 0, nw, nh);
      out.toBlob((blob) => {
        if (!blob) { finish(file); return; }
        const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '-crop.jpg';
        finish(new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified }));
      }, 'image/jpeg', 0.92);
    };

    // initial layout once the canvas has its box geometry
    requestAnimationFrame(() => { stage.style.width = dispW + 'px'; clampBox(); drawBox(); });
  });
}
