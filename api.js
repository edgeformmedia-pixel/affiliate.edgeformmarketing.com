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

  const offline = () => new ApiError(0, 'network_error', "Couldn't reach Edgeform. Check your connection and try again.");

  // Every response goes through here: 2xx returns the body, anything else throws an ApiError
  // (and a 401 outside /auth/* drops the session and sends the creator back to the sign-in page).
  function finish(status, data, path) {
    if (status >= 200 && status < 300 && data.ok !== false) return data;
    if (status === 401 && !path.startsWith('/auth/')) {
      clearSession();
      location.replace('index.html');
    }
    throw new ApiError(status, data.code || 'error', data.error || 'Something went wrong. Please try again.');
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
        throw offline();
      }
      status = response.status;
      data = await response.json().catch(() => ({}));
    }
    return finish(status, data, path);
  }

  // Raw image bytes, not multipart or JSON (CONTRACT.md §7). XHR rather than fetch, because
  // it's the only way to get a real upload progress event for a phone screenshot on slow data.
  async function upload(path, blob, onProgress) {
    const session = getSession();
    if (isMock) {
      const { status, body } = await window.MockApi.handle('POST', path, blob, session && session.session_token, onProgress);
      return finish(status, body, path);
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', window.PORTAL_CONFIG.API_BASE + path);
      xhr.setRequestHeader('content-type', blob.type);
      if (session) xhr.setRequestHeader('authorization', 'Bearer ' + session.session_token);
      if (onProgress) xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded / event.total);
      });
      xhr.addEventListener('load', () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch {}
        try { resolve(finish(xhr.status, data, path)); } catch (error) { reject(error); }
      });
      xhr.addEventListener('error', () => reject(offline()));
      xhr.addEventListener('abort', () => reject(offline()));
      xhr.send(blob);
    });
  }

  // Images behind the Bearer header, so a plain <img src> can't load them: fetch the bytes and
  // hand back a Blob the caller turns into an object URL.
  async function blob(path) {
    const session = getSession();
    if (isMock) return window.MockApi.blob(path, session && session.session_token);
    let response;
    try {
      response = await fetch(window.PORTAL_CONFIG.API_BASE + path, {
        headers: session ? { authorization: 'Bearer ' + session.session_token } : {}
      });
    } catch {
      throw offline();
    }
    if (!response.ok) return finish(response.status, await response.json().catch(() => ({})), path);
    return response.blob();
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
    store.remove(MOCK_KEY);
    location.replace('index.html');
  }

  // Demo account: signs in against mock-api.js with sample data. It never touches the real API.
  const DEMO_EMAIL = 'affiliate@test.test';
  const DEMO_PASSWORD = 'TestTest';

  async function demoLogin(email, password) {
    if (email.toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) return false;
    const result = await window.MockApi.handle('POST', '/auth/verify', { token: window.MockApi.LOGIN_TOKEN });
    store.set(MOCK_KEY, '1');
    setSession(result.body);
    return true;
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
    DEMO_EMAIL,
    demoLogin,
    upload,
    blob,
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body ?? {}),
    patch: (path, body) => send('PATCH', path, body ?? {}),
    del: (path) => send('DELETE', path)
  };
})();
