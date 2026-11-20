// Small wrapper around fetch(): adds the login token, parses JSON, throws ApiError with a `code`.
// In a production build with no VITE_API_URL (for example the GitHub Pages site before the backend is deployed), there is no server to call.
const API_URL = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '' : 'http://localhost:4000')).replace(/\/$/, '');
const TOKEN_KEY = 'hx_token';

// Photos saved by the MOCK storage have a relative address (/media/...). Cloudinary photos are full https addresses.
export const mediaUrl = (url) => (url && url.startsWith('/') ? `${API_URL}${url}` : url);

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// body = plain object (sent as JSON), or form = FormData (for file upload)
export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  if (!API_URL) throw new ApiError(0, 'NETWORK_ERROR', 'No server address is set');
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  } catch (e) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    if (res.status === 401 && token && path !== '/api/auth/google') window.dispatchEvent(new Event('hx-unauthorized'));
    throw new ApiError(res.status, err.code || 'UNKNOWN', err.message, err.details);
  }
  return data;
}

// For private images: fetch with the token and return a temporary browser URL.
export async function fetchImageUrl(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new ApiError(res.status, 'IMAGE_LOAD_FAILED', 'Could not load image');
  return URL.createObjectURL(await res.blob());
}
