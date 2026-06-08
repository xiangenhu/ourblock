/**
 * routes/maps.js — self-hosted map service.
 *
 * The browser talks ONLY to our origin for map data, so the app works where Google (and
 * its client JS) is blocked. The server fetches tiles + reverse geocoding from whatever
 * provider IT can reach — configurable via MAP_TILE_URL / MAP_GEOCODE_URL (default OSM).
 *
 *   GET /api/maps/tiles/:z/:x/:y.png        proxy a single slippy-map tile
 *   GET /api/maps/geocode/reverse?lat&lng   reverse geocode -> { placeName, neighborhood }
 *
 * Note: the default OpenStreetMap/Nominatim endpoints have strict usage policies — for
 * production set MAP_TILE_URL to your own/commercial tile server and add caching.
 */
import express from 'express';
import config from '../config.js';

const router = express.Router();

function tileUrlFor(z, x, y) {
  return config.maps.tileUrl
    .replace('{z}', z).replace('{x}', x).replace('{y}', y)
    .replace('{s}', 'abc'[(x + y) % 3]); // if the template uses a {s} subdomain
}

router.get('/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(req.params.y);
  const span = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= span || y >= span)
    return res.status(400).end();
  try {
    const r = await fetch(tileUrlFor(z, x, y), { headers: { 'User-Agent': config.maps.userAgent } });
    if (!r.ok) return res.status(502).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // tiles are stable
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});

router.get('/geocode/reverse', async (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'lat and lng are required.' });
  try {
    const url = `${config.maps.geocodeUrl}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`;
    const r = await fetch(url, {
      headers: { 'User-Agent': config.maps.userAgent, 'Accept-Language': req.headers['accept-language'] || 'en' },
    });
    if (!r.ok) return res.status(502).json({ error: 'Geocode service error.' });
    const j = await r.json();
    const a = j.address || {};
    const placeName = a.road || a.pedestrian || a.neighbourhood || a.suburb
      || (j.display_name || '').split(',')[0] || null;
    const neighborhood = a.neighbourhood || a.suburb || a.quarter || a.city_district
      || a.town || a.city || a.county || null;
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.json({ placeName, neighborhood });
  } catch {
    res.status(502).json({ error: 'Geocode service error.' });
  }
});

export default router;
