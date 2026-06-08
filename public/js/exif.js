// exif.js — minimal, dependency-free EXIF GPS reader for JPEG, plus a haversine.
//
// Used to confirm a posted photo was actually taken where the device is now: if the
// image carries GPS EXIF and it's far from the live geolocation, the photo was taken
// somewhere else. Many browser-captured photos strip EXIF GPS — in that case we can't
// verify and allow the post (best-effort authenticity, not a hard guarantee).

/** Extract { lat, lng } from a JPEG's GPS EXIF, or null if absent/unparseable. */
export async function exifGps(file) {
  try {
    if (!file || !/jpe?g/i.test(file.type || '')) return null; // GPS EXIF lives in JPEG
    const view = new DataView(await file.arrayBuffer());
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG (no SOI)
    let offset = 2;
    const len = view.byteLength;
    while (offset + 4 <= len) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && // APP1, then the "Exif\0\0" signature
          view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0x0000) {
        return parseTiff(view, offset + 10);
      }
      offset += 2 + size;
    }
    return null;
  } catch { return null; }
}

function parseTiff(view, tiff) {
  const le = view.getUint16(tiff) === 0x4949; // II = little-endian, MM = big-endian
  const u16 = (o) => view.getUint16(o, le);
  const u32 = (o) => view.getUint32(o, le);
  if (u16(tiff + 2) !== 0x002a) return null;

  // Find the GPS IFD pointer (tag 0x8825) inside IFD0.
  const ifd0 = tiff + u32(tiff + 4);
  let gpsIfd = null;
  const n0 = u16(ifd0);
  for (let i = 0; i < n0; i++) {
    const e = ifd0 + 2 + i * 12;
    if (u16(e) === 0x8825) { gpsIfd = tiff + u32(e + 8); break; }
  }
  if (gpsIfd == null) return null;

  // Index the GPS IFD entries by tag.
  const tags = {};
  const n = u16(gpsIfd);
  for (let i = 0; i < n; i++) {
    const e = gpsIfd + 2 + i * 12;
    tags[u16(e)] = e;
  }
  if (tags[0x0002] == null || tags[0x0004] == null) return null; // need lat + lng

  const refChar = (e) => String.fromCharCode(view.getUint8(e + 8)); // ASCII ref is inline
  const dms = (e) => {
    // Three RATIONALs (24 bytes) → stored at the offset in bytes 8..11.
    const valOff = tiff + u32(e + 8);
    const r = (o) => u32(o) / (u32(o + 4) || 1);
    return r(valOff) + r(valOff + 8) / 60 + r(valOff + 16) / 3600;
  };

  let lat = dms(tags[0x0002]);
  let lng = dms(tags[0x0004]);
  if (tags[0x0001] != null && refChar(tags[0x0001]) === 'S') lat = -lat;
  if (tags[0x0003] != null && refChar(tags[0x0003]) === 'W') lng = -lng;
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/** Distance in metres between two { lat, lng } points. */
export function haversine(a, b) {
  if (!a || !b) return null;
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}
