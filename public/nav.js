// nav.js — restaurant switcher (admin mode) OR restaurant name + logout (auth mode)
// Intercepts all /api/ fetch calls to add Bearer token automatically.
(function () {
  // ── Impersonation: admin passes token via query param ────────────────────
  const _params = new URLSearchParams(location.search);
  const _impToken = _params.get('impersonate_token');
  if (_impToken) {
    localStorage.setItem('authToken', _impToken);
    _params.delete('impersonate_token');
    _params.delete('restaurantId');
    const clean = location.pathname + (_params.toString() ? '?' + _params.toString() : '');
    history.replaceState(null, '', clean);
  }

  // ── Auth helpers ─────────────────────────────────────────────────────────

  window.getAuthToken = function () {
    return localStorage.getItem('authToken') || '';
  };

  window.getRestaurantId = function () {
    // In auth mode the token carries the restaurantId; fall back to localStorage
    const token = getAuthToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.restaurantId || 1;
      } catch { /* fall through */ }
    }
    // Admin/dev mode: honour ?id= in the URL
    const urlId = new URLSearchParams(location.search).get('id');
    if (urlId) {
      localStorage.setItem('selectedRestaurantId', urlId);
      return Number(urlId);
    }
    return Number(localStorage.getItem('selectedRestaurantId')) || 1;
  };

  // ── Fetch interceptor — adds Bearer token to all /api/ requests ──────────
  const _fetch = window.fetch.bind(window);
  // Public auth paths that never need a token
  const _publicPaths = ['/api/auth/login', '/api/auth/config', '/api/auth/logout'];

  window.fetch = function (url, opts) {
    const token = getAuthToken();
    if (token && typeof url === 'string' && url.startsWith('/api/') &&
        !_publicPaths.some(function (p) { return url === p || url.startsWith(p + '?'); })) {
      opts = opts ? { ...opts } : {};
      opts.headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + token };
    }
    return _fetch(url, opts).then(function (res) {
      if (res.status === 401 &&
          typeof url === 'string' &&
          !url.startsWith('/api/auth/')) {
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
      }
      return res;
    });
  };

  // ── Theme ─────────────────────────────────────────────────────────────────
  (function applyTheme() {
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : '');
  })();

  // ── CSS ──────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* Mobile nav */
    .nav-hamburger {
      display: none; background: none; border: none; color: var(--gold-light);
      font-size: 1.35rem; cursor: pointer; padding: 0.3rem 0.5rem; line-height: 1;
    }
    @media (max-width: 768px) {
      .nav-hamburger { display: block; }
      .nav-links {
        display: none !important; flex-direction: column !important;
        position: fixed; top: 64px; left: 0; right: 0;
        background: var(--bg-nav); border-bottom: 1px solid var(--gold-border);
        padding: 0.5rem 0; z-index: 198; backdrop-filter: blur(12px);
      }
      .nav-links.mobile-open { display: flex !important; }
      .nav-links a { padding: 0.75rem 1.5rem !important; border-bottom: none !important;
        border-left: 2px solid transparent; text-align: left; }
      .nav-links a.active { border-left-color: var(--gold); }
      main { padding-left: 1rem !important; padding-right: 1rem !important; }
    }

    .nav-switcher {
      display: flex; align-items: center; gap: 0.4rem; margin: 0 1rem;
    }
    .nav-switcher select {
      background: var(--bg-surface);
      border: 1px solid var(--gold-border); border-radius: 6px;
      color: var(--gold-light); padding: 0.28rem 0.5rem;
      font-family: 'Inter', sans-serif; font-size: 0.78rem;
      cursor: pointer; max-width: 160px; outline: none;
    }
    .nav-switcher select:focus { border-color: var(--gold); }
    .nav-switcher .nav-new-btn {
      background: var(--gold-dim);
      border: 1px solid var(--gold-border); border-radius: 6px;
      color: var(--gold-light); padding: 0.28rem 0.55rem;
      cursor: pointer; font-size: 0.9rem; line-height: 1; font-weight: 600;
      transition: background 0.2s;
    }
    .nav-switcher .nav-new-btn:hover { background: var(--gold-border); }
    /* Auth mode: restaurant name chip + logout */
    .nav-rest-chip {
      display: flex; align-items: center; gap: 0.5rem; margin: 0 1rem;
      padding: 0.25rem 0.75rem;
      background: var(--gold-dim); border: 1px solid var(--gold-border);
      border-radius: 20px;
    }
    .nav-rest-chip span { color: var(--gold-light); font-size: 0.8rem; font-weight: 500; }
    .nav-logout-btn {
      background: none; border: 1px solid var(--border);
      border-radius: 6px; color: var(--text-muted); font-family: 'Inter', sans-serif;
      font-size: 0.75rem; padding: 0.25rem 0.65rem; cursor: pointer;
      transition: color 0.2s, border-color 0.2s;
    }
    .nav-logout-btn:hover { color: var(--text); border-color: var(--border-hover); }
    /* New-restaurant modal */
    #navRestModal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.72); z-index: 9999;
      align-items: center; justify-content: center;
    }
    #navRestModal.open { display: flex; }
    .nav-modal-box {
      background: var(--bg-card); border: 1px solid var(--gold-border);
      border-radius: 12px; padding: 2rem; width: 440px; max-width: 92vw;
    }
    .nav-modal-box h3 {
      font-family: var(--font-display);
      color: var(--gold-light); font-size: 1.15rem; margin-bottom: 1.4rem;
    }
    .nav-modal-field { margin-bottom: 1rem; }
    .nav-modal-label {
      display: block; font-size: 0.75rem; font-weight: 600;
      letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--text-muted); margin-bottom: 0.35rem;
    }
    .nav-modal-input {
      width: 100%; background: var(--bg-surface);
      border: 1px solid var(--border); border-radius: 8px;
      padding: 0.6rem 0.9rem; color: var(--text);
      font-family: 'Inter', sans-serif; font-size: 0.88rem; outline: none;
      box-sizing: border-box;
    }
    .nav-modal-input:focus { border-color: var(--gold); }
    .nav-modal-actions {
      display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem;
    }
    .nav-modal-cancel {
      background: none; border: 1px solid var(--border);
      border-radius: 8px; padding: 0.5rem 1.1rem;
      color: var(--text-muted); cursor: pointer; font-family: inherit; font-size: 0.85rem;
    }
    .nav-modal-create {
      background: var(--gold-dim); border: 1px solid var(--gold-border);
      border-radius: 8px; padding: 0.5rem 1.2rem;
      color: var(--gold-light); cursor: pointer; font-family: inherit;
      font-size: 0.85rem; font-weight: 600; transition: background 0.2s;
    }
    .nav-modal-create:hover:not(:disabled) { background: var(--gold-border); }
    .nav-modal-create:disabled { opacity: 0.5; cursor: default; }
  `;
  document.head.appendChild(style);

  // ── Mobile hamburger + Settings link ─────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    const nav = document.querySelector('nav');
    if (!nav) return;

    // Inject Settings link if not present
    const navLinks = nav.querySelector('.nav-links');
    if (navLinks && !navLinks.querySelector('a[href*="settings"]')) {
      const a = document.createElement('a');
      a.href = 'settings.html';
      a.textContent = 'Settings';
      if (window.location.pathname.endsWith('/settings.html')) a.className = 'active';
      navLinks.appendChild(a);
    }

    // Hamburger button
    const hamburger = document.createElement('button');
    hamburger.className = 'nav-hamburger';
    hamburger.setAttribute('aria-label', 'Menu');
    hamburger.textContent = '☰';
    hamburger.addEventListener('click', function () {
      if (navLinks) navLinks.classList.toggle('mobile-open');
      hamburger.textContent = navLinks?.classList.contains('mobile-open') ? '✕' : '☰';
    });
    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && navLinks?.classList.contains('mobile-open')) {
        navLinks.classList.remove('mobile-open');
        hamburger.textContent = '☰';
      }
    });
    nav.appendChild(hamburger);

    // Theme toggle
    const themeBtn = document.createElement('button');
    themeBtn.className = 'theme-toggle';
    themeBtn.setAttribute('aria-label', 'Toggle theme');
    const currentTheme = localStorage.getItem('theme') || 'dark';
    themeBtn.textContent = currentTheme === 'light' ? '☀️' : '🌙';
    themeBtn.addEventListener('click', function () {
      const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next === 'light' ? 'light' : '');
      localStorage.setItem('theme', next);
      themeBtn.textContent = next === 'light' ? '☀️' : '🌙';
    });
    nav.appendChild(themeBtn);
  });

  // ── Init on DOMContentLoaded ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async function () {
    // Detect auth mode from server
    let authEnabled = false;
    try {
      const cfg = await _fetch('/api/auth/config').then(r => r.json());
      authEnabled = cfg.authEnabled;
    } catch { /* assume disabled */ }

    const token = getAuthToken();

    const publicPages = ['/login.html', '/signup.html', '/auth-callback.html', '/index.html', '/'];
    if (authEnabled && !token && !publicPages.some(p => window.location.pathname.endsWith(p))) {
      window.location.href = '/login.html';
      return;
    }

    if (token) {
      // Authenticated: show restaurant chip + logout, no switcher
      injectAuthChip();
    } else {
      // Admin / dev mode: show restaurant switcher
      injectSwitcher();
      injectModal();
      loadRestaurants();
    }
  });

  // ── Auth chip (logged-in mode) ────────────────────────────────────────────
  function injectAuthChip() {
    const nav = document.querySelector('nav');
    if (!nav) return;

    const chip = document.createElement('div');
    chip.className = 'nav-rest-chip';
    chip.innerHTML = `<span id="navRestName">…</span><button class="nav-logout-btn" id="navLogoutBtn">Log out</button>`;

    const brand = nav.querySelector('.nav-brand');
    if (brand && brand.nextSibling) nav.insertBefore(chip, brand.nextSibling);
    else nav.appendChild(chip);

    document.getElementById('navLogoutBtn').addEventListener('click', async function () {
      try { await _fetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
      localStorage.removeItem('authToken');
      window.location.href = '/login.html';
    });

    // Fetch current restaurant name
    _fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + getAuthToken() },
    }).then(r => r.json()).then(function (data) {
      const el = document.getElementById('navRestName');
      if (el && data.name) el.textContent = data.name;
    }).catch(function () { /* ignore */ });
  }

  // ── Restaurant switcher (admin / dev mode) ────────────────────────────────
  function injectSwitcher() {
    const nav = document.querySelector('nav');
    if (!nav) return;
    const switcher = document.createElement('div');
    switcher.className = 'nav-switcher';
    switcher.innerHTML = `
      <select id="navRestSelect" title="Switch restaurant">
        <option>Loading…</option>
      </select>
      <button class="nav-new-btn" id="navNewRestBtn" title="New restaurant">+</button>
    `;
    const brand = nav.querySelector('.nav-brand');
    if (brand && brand.nextSibling) nav.insertBefore(switcher, brand.nextSibling);
    else nav.appendChild(switcher);

    document.getElementById('navRestSelect').addEventListener('change', function () {
      const id = Number(this.value);
      if (id) { localStorage.setItem('selectedRestaurantId', id); location.reload(); }
    });
    document.getElementById('navNewRestBtn').addEventListener('click', function () {
      document.getElementById('navRestModal').classList.add('open');
    });
  }

  async function loadRestaurants() {
    const select = document.getElementById('navRestSelect');
    if (!select) return;
    try {
      const rows = await _fetch('/api/db/restaurants').then(r => r.json());
      const currentId = window.getRestaurantId();
      select.innerHTML = '';
      rows.forEach(function (r) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        opt.selected = r.id === currentId;
        select.appendChild(opt);
      });
      if (rows.length && !rows.find(function (r) { return r.id === currentId; })) {
        localStorage.setItem('selectedRestaurantId', rows[0].id);
        select.value = rows[0].id;
      }
    } catch {
      if (select) select.innerHTML = '<option value="1">Default</option>';
    }
  }

  function injectModal() {
    const modal = document.createElement('div');
    modal.id = 'navRestModal';
    modal.innerHTML = `
      <div class="nav-modal-box">
        <h3>New Restaurant</h3>
        <div class="nav-modal-field">
          <label class="nav-modal-label">Restaurant Name *</label>
          <input id="navRestName" class="nav-modal-input" placeholder="e.g. The Golden Fork">
        </div>
        <div class="nav-modal-field">
          <label class="nav-modal-label">Cuisine Type</label>
          <input id="navRestCuisine" class="nav-modal-input" placeholder="e.g. Italian, French, Japanese">
        </div>
        <div class="nav-modal-actions">
          <button class="nav-modal-cancel" id="navRestCancel">Cancel</button>
          <button class="nav-modal-create" id="navRestCreate">Create &amp; Switch</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('navRestCancel').addEventListener('click', function () {
      modal.classList.remove('open');
    });
    modal.addEventListener('click', function (e) {
      if (e.target === modal) modal.classList.remove('open');
    });
    document.getElementById('navRestCreate').addEventListener('click', async function () {
      const name = document.getElementById('navRestName').value.trim();
      if (!name) { alert('Please enter a restaurant name'); return; }
      const cuisineType = document.getElementById('navRestCuisine').value.trim();
      const btn = document.getElementById('navRestCreate');
      btn.textContent = 'Creating…'; btn.disabled = true;
      try {
        const res = await _fetch('/api/db/restaurants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, cuisineType }),
        });
        const row = await res.json();
        if (!res.ok) throw new Error(row.error);
        localStorage.setItem('selectedRestaurantId', row.id);
        modal.classList.remove('open');
        location.reload();
      } catch (e) {
        alert('Create failed: ' + e.message);
        btn.textContent = 'Create & Switch'; btn.disabled = false;
      }
    });
    document.getElementById('navRestName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('navRestCreate').click();
    });
  }
})();
