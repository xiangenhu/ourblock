// Thin fetch wrapper. Cookies carry the session; we also keep a token in
// localStorage as a fallback for environments that strip cookies.
const TOKEN_KEY = 'ob_token';

function authHeaders() {
  const t = localStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function request(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: { ...authHeaders() } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),

  async upload(file) {
    const fd = new FormData();
    fd.append('media', file);
    const res = await fetch('/api/upload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...authHeaders() },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  saveToken: (t) => t && localStorage.setItem(TOKEN_KEY, t),
  clearToken: () => localStorage.removeItem(TOKEN_KEY),
};
