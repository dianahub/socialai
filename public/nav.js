// nav.js — shared restaurant switcher injected into every page's nav
(function () {
  // Synchronous getter — safe to call before DOMContentLoaded
  window.getRestaurantId = function () {
    return Number(localStorage.getItem('selectedRestaurantId')) || 1;
  };

  // Inject CSS once
  const style = document.createElement('style');
  style.textContent = `
    .nav-switcher {
      display: flex; align-items: center; gap: 0.4rem;
      margin: 0 1rem;
    }
    .nav-switcher select {
      background: rgba(26,26,40,0.95);
      border: 1px solid rgba(200,168,75,0.22);
      border-radius: 6px;
      color: #e5c97a;
      padding: 0.28rem 0.5rem;
      font-family: 'Inter', sans-serif;
      font-size: 0.78rem;
      cursor: pointer;
      max-width: 160px;
      outline: none;
    }
    .nav-switcher select:focus { border-color: rgba(200,168,75,0.5); }
    .nav-switcher .nav-new-btn {
      background: rgba(200,168,75,0.14);
      border: 1px solid rgba(200,168,75,0.22);
      border-radius: 6px;
      color: #e5c97a;
      padding: 0.28rem 0.55rem;
      cursor: pointer;
      font-size: 0.9rem;
      line-height: 1;
      font-weight: 600;
      transition: background 0.2s;
    }
    .nav-switcher .nav-new-btn:hover { background: rgba(200,168,75,0.28); }
    #navRestModal {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.72); z-index: 9999;
      align-items: center; justify-content: center;
    }
    #navRestModal.open { display: flex; }
    .nav-modal-box {
      background: #12121c;
      border: 1px solid rgba(200,168,75,0.2);
      border-radius: 12px;
      padding: 2rem;
      width: 440px;
      max-width: 92vw;
    }
    .nav-modal-box h3 {
      font-family: 'Playfair Display', Georgia, serif;
      color: #e5c97a; font-size: 1.15rem;
      margin-bottom: 1.4rem;
    }
    .nav-modal-field { margin-bottom: 1rem; }
    .nav-modal-label {
      display: block; font-size: 0.75rem; font-weight: 600;
      letter-spacing: 0.07em; text-transform: uppercase;
      color: #7a7773; margin-bottom: 0.35rem;
    }
    .nav-modal-input {
      width: 100%;
      background: #1a1a28;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 0.6rem 0.9rem;
      color: #f0ede8;
      font-family: 'Inter', sans-serif;
      font-size: 0.88rem;
      outline: none;
      box-sizing: border-box;
    }
    .nav-modal-input:focus { border-color: rgba(200,168,75,0.4); }
    .nav-modal-actions {
      display: flex; gap: 0.75rem; justify-content: flex-end; margin-top: 1.5rem;
    }
    .nav-modal-cancel {
      background: none; border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 0.5rem 1.1rem;
      color: #7a7773; cursor: pointer; font-family: inherit; font-size: 0.85rem;
    }
    .nav-modal-create {
      background: rgba(200,168,75,0.18); border: 1px solid rgba(200,168,75,0.3);
      border-radius: 8px; padding: 0.5rem 1.2rem;
      color: #e5c97a; cursor: pointer; font-family: inherit; font-size: 0.85rem; font-weight: 600;
      transition: background 0.2s;
    }
    .nav-modal-create:hover:not(:disabled) { background: rgba(200,168,75,0.32); }
    .nav-modal-create:disabled { opacity: 0.5; cursor: default; }
  `;
  document.head.appendChild(style);

  document.addEventListener('DOMContentLoaded', function () {
    injectSwitcher();
    injectModal();
    loadRestaurants();
  });

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
    if (brand && brand.nextSibling) {
      nav.insertBefore(switcher, brand.nextSibling);
    } else {
      nav.appendChild(switcher);
    }
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
      const rows = await fetch('/api/db/restaurants').then(r => r.json());
      const currentId = window.getRestaurantId();
      select.innerHTML = '';
      rows.forEach(function (r) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        opt.selected = r.id === currentId;
        select.appendChild(opt);
      });
      // If stored ID not in list, default to first
      if (rows.length && !rows.find(function (r) { return r.id === currentId; })) {
        localStorage.setItem('selectedRestaurantId', rows[0].id);
        select.value = rows[0].id;
      }
    } catch (e) {
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
      btn.textContent = 'Creating…';
      btn.disabled = true;
      try {
        const res = await fetch('/api/db/restaurants', {
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
        btn.textContent = 'Create & Switch';
        btn.disabled = false;
      }
    });
    // Close on Enter key in name field
    document.getElementById('navRestName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('navRestCreate').click();
    });
  }
})();
