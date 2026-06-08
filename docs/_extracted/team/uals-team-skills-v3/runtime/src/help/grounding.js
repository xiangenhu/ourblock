'use strict';
// Loads the optional grounding doc (product/design brief) from GCS. Empty => UI-only help.
const store = require('../store/gcs');
const config = require('../config');

let _cache = null;
async function loadGroundingDoc() {
  if (_cache) return _cache;
  const path = config().help.groundingDocPath;
  if (!path) return (_cache = { markdown: '' });
  try {
    const buf = await store.getBuffer(path);
    _cache = { markdown: buf ? buf.toString('utf8') : '' };
  } catch (_) { _cache = { markdown: '' }; }
  return _cache;
}
module.exports = loadGroundingDoc;
