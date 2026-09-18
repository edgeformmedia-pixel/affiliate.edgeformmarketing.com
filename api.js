// Client for the CRM's affiliate API (CONTRACT.md §4).
// Add ?mock=1 to any page URL to run against mock-api.js instead; ?mock=0 turns it off.
(function () {
  const SESSION_KEY = 'efa_session';
  const MOCK_KEY = 'efa_mock';

  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
    remove(key) { try { localStorage.removeItem(key); } catch {} }
  };

  const params = new URLSearchParams(location.search);
  if (params.get('mock') === '1') store.set(MOCK_KEY, '1');
  if (params.get('mock') === '0') store.remove(MOCK_KEY);
  const isMock = store.get(MOCK_KEY) === '1';

  class ApiError extends Error {
    constructor(status, code, message) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  function getSession() {
    try {
      const session = JSON.parse(store.get(SESSION_KEY) || 'null');
      if (!session || !session.session_token) return null;
      if (session.expires_at && new Date(session.expires_at) <= new Date()) return null;
      return session;
    } catch { return null; }
  }

  function setSession(session) { store.set(SESSION_KEY, JSON.stringify(session)); }
  function clearSession() { store.remove(SESSION_KEY); }

  function updateCreator(creator) {
    const session = getSession();
    if (session) setSession({ ...session, creator });
  }

  async function send(method, path, body) {
    const session = getSession();
    let status, data;
    if (isMock) {
      ({ status, body: data } = await window.MockApi.handle(method, path, body, session && session.session_token));
    } else {
      const headers = { 'content-type': 'application/json' };
      if (session) headers.authorization = 'Bearer ' + session.session_token;
      let response;
      try {
        response = await fetch(window.PORTAL_CONFIG.API_BASE + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch {
        throw new ApiError(0, 'network_error', "Couldn't reach Edgeform. Check your connection and try again.");
      }
      status = response.status;
      data = await response.json().catch(() => ({}));
    }
    if (status >= 200 && status < 300 && data.ok !== false) return data;
    if (status === 401 && !path.startsWith('/auth/')) {
      clearSession();
      location.replace('index.html');
    }
    throw new ApiError(status, data.code || 'error', data.error || 'Something went wrong. Please try again.');
  }

  // Pages that need a signed-in creator call this first.
  function requireSession() {
    const session = getSession();
    if (!session) {
      location.replace('index.html');
      throw new Error('Not signed in');
    }
    return session;
  }

  async function logout() {
    try { await send('POST', '/auth/logout'); } catch {}
    clearSession();
    location.replace('index.html');
  }

  window.Api = {
    ApiError,
    isMock,
    getSession,
    setSession,
    clearSession,
    updateCreator,
    requireSession,
    logout,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body ?? {}),
    patch: (path, body) => send('PATCH', path, body ?? {}),
    del: (path) => send('DELETE', path)
  };
})();
