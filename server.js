require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const cld     = require('./lib/cloudinary');
const db      = require('./lib/db');
const { isAuthEnabled, createToken, requireAuth } = require('./lib/auth');
const bcrypt  = require('bcryptjs');
const cron    = require('node-cron');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Data directories (configurable for Railway volume mount) ──────────────────
const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

['logo', 'photos', 'owner'].forEach(d =>
  fs.mkdirSync(path.join(ASSETS_DIR, d), { recursive: true })
);
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.mkdirSync(path.resolve('public'), { recursive: true });

// Mark any jobs left in 'generating' state from a previous run as errored
function cleanStuckJobs() {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('_meta.json')).forEach(f => {
    try {
      const p    = path.join(OUTPUT_DIR, f);
      const meta = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (meta.status === 'generating') {
        meta.status = 'error';
        meta.error  = 'Server restarted during generation — please try again.';
        fs.writeFileSync(p, JSON.stringify(meta, null, 2));
      }
    } catch {}
  });
}
cleanStuckJobs();

app.use(express.json());
app.use(express.static(path.resolve('public')));
app.use('/assets', express.static(ASSETS_DIR));
app.use('/output',  express.static(OUTPUT_DIR));

// ── Auth endpoints (always public — no auth middleware) ────────────────────

// Tell the frontend whether auth / Google OAuth is enabled
app.get('/api/auth/config', (req, res) => {
  res.json({
    authEnabled:   isAuthEnabled(),
    googleEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL),
  });
});

// Login: email + password → JWT
app.post('/api/auth/login', async (req, res) => {
  if (!isAuthEnabled())
    return res.status(400).json({ error: 'Auth is not enabled on this server (JWT_SECRET not set)' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const r = await db.restaurant.findFirst({ where: { loginEmail: email.toLowerCase() } });
    if (!r?.loginPasswordHash)
      return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, r.loginPasswordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    const token = createToken(r.id);
    res.json({ token, restaurantId: r.id, restaurantName: r.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Logout is stateless — client removes the token
app.post('/api/auth/logout', (req, res) => res.json({ success: true }));

// Who am I? (requires token)
app.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const r = await db.restaurant.findUnique({
      where: { id: req.restaurantId || 1 },
      select: { id: true, name: true, loginEmail: true },
    });
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Sign up: create new restaurant + credentials → JWT
app.post('/api/auth/signup', async (req, res) => {
  const { restaurantName, email, password } = req.body;
  if (!restaurantName || !email || !password)
    return res.status(400).json({ error: 'Restaurant name, email, and password are required' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash       = await bcrypt.hash(password, 12);
    const restaurant = await db.restaurant.create({
      data: { name: restaurantName, loginEmail: email.toLowerCase(), loginPasswordHash: hash },
    });
    const token = createToken(restaurant.id);
    res.json({ token, restaurantId: restaurant.id, restaurantName: restaurant.name });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That email is already registered' });
    res.status(500).json({ error: e.message });
  }
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

function googleEnabled() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_URL);
}

function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v || '');
  }
  return null;
}

// Start Google OAuth flow
app.get('/auth/google', (req, res) => {
  if (!googleEnabled()) return res.status(503).send('Google OAuth not configured.');
  const crypto = require('crypto');
  const state  = crypto.randomBytes(16).toString('hex');
  const params = new URLSearchParams({
    client_id:     process.env.GOOGLE_CLIENT_ID,
    redirect_uri:  `${process.env.APP_URL}/auth/google/callback`,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    access_type:   'online',
    prompt:        'select_account',
  });
  res.setHeader('Set-Cookie', `g_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/`);
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// Google OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const storedState = getCookie(req, 'g_oauth_state');
  const failUrl     = '/login.html?error=oauth_failed';

  if (error || !code || !storedState || state !== storedState) {
    console.error('[google-oauth] failed — error:', error, 'state match:', state === storedState);
    return res.redirect(failUrl);
  }

  try {
    const axios = require('axios');

    // Exchange code for access token
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${process.env.APP_URL}/auth/google/callback`,
      grant_type:    'authorization_code',
    });
    const { access_token } = tokenRes.data;

    // Get Google user info
    const userRes = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const { id: googleId, email, name } = userRes.data;
    if (!email || !googleId) return res.redirect(failUrl);

    // Find or create restaurant linked to this Google account
    let restaurant = await db.restaurant.findFirst({ where: { googleId } });
    if (!restaurant) {
      // Try to link to existing account with same email
      restaurant = await db.restaurant.findFirst({ where: { loginEmail: email.toLowerCase() } });
      if (restaurant) {
        restaurant = await db.restaurant.update({ where: { id: restaurant.id }, data: { googleId } });
      } else {
        // New restaurant — use their name as a placeholder; they'll fill in details on Assets page
        restaurant = await db.restaurant.create({
          data: { name: name || email.split('@')[0], loginEmail: email.toLowerCase(), googleId },
        });
      }
    }

    const token = createToken(restaurant.id);
    res.setHeader('Set-Cookie', 'g_oauth_state=; HttpOnly; Secure; Max-Age=0; Path=/');
    // Pass token via URL hash (never hits the server) so the callback page can store in localStorage
    res.redirect(`/auth-callback.html#token=${encodeURIComponent(token)}`);
  } catch (e) {
    console.error('[google-oauth] error:', e.message);
    res.redirect(failUrl);
  }
});

// ── Admin panel ──────────────────────────────────────────────────────────────

const crypto = require('crypto');

function adminTokenValue() {
  // Deterministic token derived from ADMIN_SECRET — no session store needed
  return crypto.createHmac('sha256', process.env.ADMIN_SECRET || 'no-secret')
    .update('modernsocial-admin-v1')
    .digest('hex');
}

function isAdminAuthed(req) {
  return getCookie(req, 'admin_tok') === adminTokenValue();
}

function requireAdmin(req, res, next) {
  if (isAdminAuthed(req)) return next();
  res.redirect('/admin/login');
}

// Admin login page
app.get('/admin/login', (req, res) => {
  if (isAdminAuthed(req)) return res.redirect('/admin/leads');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Login — ModernSocial.ai</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#090910;color:#f0ede8;font-family:'Inter',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
  .card{background:#12121c;border:1px solid rgba(200,168,75,0.22);border-radius:16px;padding:2.5rem;width:100%;max-width:380px}
  .brand{font-family:'Playfair Display',serif;font-size:1.05rem;color:#e5c97a;margin-bottom:0.4rem}
  h1{font-family:'Playfair Display',serif;font-size:1.4rem;margin-bottom:0.3rem}
  .sub{font-size:0.82rem;color:#7a7773;margin-bottom:2rem}
  label{display:block;font-size:0.7rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#7a7773;margin-bottom:0.35rem}
  input{width:100%;background:#1a1a28;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:0.7rem 0.9rem;color:#f0ede8;font-family:'Inter',sans-serif;font-size:0.9rem;outline:none;margin-bottom:1.1rem;transition:border-color 0.2s}
  input:focus{border-color:rgba(200,168,75,0.4)}
  button{width:100%;background:#c8a84b;color:#090910;border:none;border-radius:8px;padding:0.78rem;font-family:'Inter',sans-serif;font-size:0.9rem;font-weight:600;cursor:pointer;transition:opacity 0.2s}
  button:hover{opacity:0.88}
  .err{color:#f87171;font-size:0.8rem;margin-top:0.75rem;display:none}
  .err.show{display:block}
</style>
</head>
<body>
<div class="card">
  <div class="brand">✦ ModernSocial.ai</div>
  <h1>Admin</h1>
  <p class="sub">Enter your admin password to continue.</p>
  <form method="POST" action="/admin/login">
    <label>Password</label>
    <input type="password" name="password" autofocus autocomplete="current-password">
    <button type="submit">Sign in</button>
    ${req.query.error ? '<div class="err show">Incorrect password.</div>' : ''}
  </form>
</div>
</body>
</html>`);
});

app.post('/admin/login', express.urlencoded({ extended: false }), (req, res) => {
  if (!process.env.ADMIN_SECRET) return res.redirect('/admin/login?error=1');
  if (req.body.password !== process.env.ADMIN_SECRET) return res.redirect('/admin/login?error=1');
  const tok      = adminTokenValue();
  const isSecure = (process.env.APP_URL || '').startsWith('https');
  res.setHeader('Set-Cookie', `admin_tok=${tok}; HttpOnly; SameSite=Lax; Max-Age=86400; Path=/${isSecure ? '; Secure' : ''}`);
  res.redirect('/admin/leads');
});

app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'admin_tok=; HttpOnly; Max-Age=0; Path=/');
  res.redirect('/admin/login');
});

// Admin leads page — served from memory, not from public/
app.get('/admin/leads', requireAdmin, (req, res) => {
  res.sendFile(path.resolve('admin/leads.html'));
});

// ── Global auth middleware (protects all /api/ except /api/auth/*) ─────────
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) return next();
  // ADMIN_SECRET header bypasses JWT auth (for Diana's admin operations)
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret && adminSecret === process.env.ADMIN_SECRET) return next();
  requireAuth(req, res, next);
});

// Set/update login credentials — protected by global middleware (JWT or admin secret).
// When auth is disabled: no check, open; restaurantId from body.
// When auth enabled: req.restaurantId set by JWT (own restaurant) or admin secret (any).
app.post('/api/auth/set-credentials', async (req, res) => {
  // This route is under /api/auth/ so it bypasses the global middleware.
  // We verify auth manually here.
  if (isAuthEnabled()) {
    const adminSecret = req.headers['x-admin-secret'];
    const isAdmin = adminSecret && adminSecret === process.env.ADMIN_SECRET;
    if (!isAdmin) {
      const header = req.headers.authorization;
      if (!header?.startsWith('Bearer '))
        return res.status(403).json({ error: 'Requires your login token or admin secret' });
      const { verifyToken } = require('./lib/auth');
      const payload = verifyToken(header.slice(7));
      if (!payload) return res.status(403).json({ error: 'Invalid token' });
      req.restaurantId = payload.restaurantId; // lock to own restaurant
    }
  }
  const { email, password } = req.body;
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const hash = await bcrypt.hash(password, 12);
    await db.restaurant.update({
      where: { id: restaurantId },
      data:  { loginEmail: email.toLowerCase(), loginPasswordHash: hash },
    });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That email is already used by another restaurant' });
    res.status(500).json({ error: e.message });
  }
});

// ── Multer storage (memory — files are streamed to Cloudinary or saved locally) ─

const uploadLogo   = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPhotos = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadOwner  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Save a buffer to the local filesystem fallback
function saveLocalAsset(subdir, filename, buffer) {
  const destDir = path.join(ASSETS_DIR, subdir);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, filename);
  fs.writeFileSync(dest, buffer);
  return dest;
}

// ── Upload routes ─────────────────────────────────────────────────────────────

app.post('/api/upload/logo', uploadLogo.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;

  let buffer = req.file.buffer;
  const ext  = path.extname(req.file.originalname).toLowerCase();

  // Normalize non-standard formats to PNG so Sharp can always read them
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    try { buffer = await require('sharp')(buffer).png().toBuffer(); }
    catch (e) { console.warn('[logo] Conversion failed, keeping original:', e.message); }
  }

  if (cld.isConfigured()) {
    try {
      const result = await cld.uploadBuffer(buffer, {
        public_id:    `restaurant-social-ai/${restaurantId}/logo`,
        overwrite:    true,
        quality:      'auto',
        fetch_format: 'auto',
      });
      await db.restaurant.update({ where: { id: restaurantId }, data: { logoUrl: result.url } }).catch(() => {});
      return res.json({ success: true, url: result.url, path: result.url });
    } catch (e) {
      console.error('[logo] Cloudinary upload failed:', e.message);
      return res.status(500).json({ error: 'Cloud upload failed: ' + e.message });
    }
  }

  // Local fallback
  const filename = 'logo' + (ext || '.jpg');
  saveLocalAsset('logo', filename, buffer);
  res.json({ success: true, filename, path: `/assets/logo/${filename}` });
});

app.post('/api/upload/photos', uploadPhotos.array('files', 6), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;

  if (cld.isConfigured()) {
    try {
      const uploads = await Promise.all(req.files.map(f => {
        const ts = Date.now();
        return cld.uploadBuffer(f.buffer, {
          public_id:    `restaurant-social-ai/${restaurantId}/photos/photo_${ts}_${Math.random().toString(36).slice(2, 7)}`,
          overwrite:    false,
          quality:      'auto',
          fetch_format: 'auto',
        });
      }));
      return res.json({
        success: true,
        files: uploads.map(u => ({ url: u.url, filename: u.url.split('/').pop(), path: u.url })),
      });
    } catch (e) {
      console.error('[photos] Cloudinary upload failed:', e.message);
      return res.status(500).json({ error: 'Cloud upload failed: ' + e.message });
    }
  }

  // Local fallback
  const saved = req.files.map(f => {
    const filename = `photo_${Date.now()}${path.extname(f.originalname).toLowerCase()}`;
    saveLocalAsset('photos', filename, f.buffer);
    return { filename, path: `/assets/photos/${filename}` };
  });
  res.json({ success: true, files: saved });
});

app.post('/api/upload/owner', uploadOwner.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;

  if (cld.isConfigured()) {
    try {
      const result = await cld.uploadBuffer(req.file.buffer, {
        public_id:    `restaurant-social-ai/${restaurantId}/owner`,
        overwrite:    true,
        quality:      'auto',
        fetch_format: 'auto',
      });
      await db.restaurant.update({ where: { id: restaurantId }, data: { ownerPortraitUrl: result.url } }).catch(() => {});
      return res.json({ success: true, url: result.url, path: result.url });
    } catch (e) {
      console.error('[owner] Cloudinary upload failed:', e.message);
      return res.status(500).json({ error: 'Cloud upload failed: ' + e.message });
    }
  }

  // Local fallback
  const ext      = path.extname(req.file.originalname).toLowerCase();
  const filename = 'owner' + (ext || '.jpg');
  saveLocalAsset('owner', filename, req.file.buffer);
  res.json({ success: true, filename, path: `/assets/owner/${filename}` });
});

// ── Asset management ──────────────────────────────────────────────────────────

app.get('/api/assets', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.query.restaurantId) || 1;

  if (cld.isConfigured()) {
    try {
      const result = { logo: null, photos: [], owner: null };

      // Get logo and owner from Restaurant DB record; fall back to Cloudinary path
      const restaurant = await db.restaurant.findUnique({ where: { id: restaurantId } }).catch(() => null);
      result.logo  = restaurant?.logoUrl  || null;
      result.owner = restaurant?.ownerPortraitUrl || null;

      // Cloudinary fallback lookups (supports restaurant 1 with old-style paths)
      const [logo, owner, photosNew, photosOld] = await Promise.all([
        result.logo  ? Promise.resolve(null) : cld.getAssetUrl(`restaurant-social-ai/${restaurantId}/logo`),
        result.owner ? Promise.resolve(null) : cld.getAssetUrl(`restaurant-social-ai/${restaurantId}/owner`),
        cld.listFolder(`restaurant-social-ai/${restaurantId}/photos/`),
        restaurantId === 1 ? cld.listFolder('restaurant-social-ai/photos/') : Promise.resolve([]),
      ]);
      if (!result.logo)  result.logo  = logo  || (restaurantId === 1 ? await cld.getAssetUrl('restaurant-social-ai/logo')  : null);
      if (!result.owner) result.owner = owner || (restaurantId === 1 ? await cld.getAssetUrl('restaurant-social-ai/owner') : null);
      result.photos = [...photosNew, ...photosOld].map(p => p.url);

      return res.json(result);
    } catch (e) {
      console.error('[assets] Cloudinary list failed:', e.message);
    }
  }

  // Local fallback
  const result  = { logo: null, photos: [], owner: null };
  const readDir = dir => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => !f.startsWith('.') && /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
    : [];

  const logoFiles = readDir(path.join(ASSETS_DIR, 'logo'));
  if (logoFiles.length) result.logo = `/assets/logo/${logoFiles[0]}`;
  result.photos = readDir(path.join(ASSETS_DIR, 'photos')).map(f => `/assets/photos/${f}`);
  const ownerFiles = readDir(path.join(ASSETS_DIR, 'owner'));
  if (ownerFiles.length) result.owner = `/assets/owner/${ownerFiles[0]}`;
  res.json(result);
});

app.delete('/api/assets/:type/:filename', async (req, res) => {
  const { type, filename } = req.params;
  const restaurantId = req.restaurantId || Number(req.query.restaurantId) || 1;
  if (!['logo', 'photos', 'owner'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });

  if (cld.isConfigured()) {
    try {
      const base = path.basename(filename, path.extname(filename));
      // Try per-restaurant path first; also clean up restaurant 1 old-style paths
      if (type === 'logo') {
        await cld.deleteAsset(`restaurant-social-ai/${restaurantId}/logo`);
        if (restaurantId === 1) await cld.deleteAsset('restaurant-social-ai/logo').catch(() => {});
        await db.restaurant.update({ where: { id: restaurantId }, data: { logoUrl: null } }).catch(() => {});
      } else if (type === 'owner') {
        await cld.deleteAsset(`restaurant-social-ai/${restaurantId}/owner`);
        if (restaurantId === 1) await cld.deleteAsset('restaurant-social-ai/owner').catch(() => {});
        await db.restaurant.update({ where: { id: restaurantId }, data: { ownerPortraitUrl: null } }).catch(() => {});
      } else {
        await cld.deleteAsset(`restaurant-social-ai/${restaurantId}/photos/${base}`);
        if (restaurantId === 1) await cld.deleteAsset(`restaurant-social-ai/photos/${base}`).catch(() => {});
      }
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Cloud delete failed: ' + e.message });
    }
  }

  // Local fallback
  const safe     = path.basename(filename);
  const filepath = path.join(ASSETS_DIR, type, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filepath);
  res.json({ success: true });
});

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(ASSETS_DIR, 'config.json');

function restaurantToConfig(r) {
  return {
    restaurantName: r.name,
    cuisineType:    r.cuisineType    || '',
    ownerName:      r.ownerName      || '',
    chefName:       r.chefName       || '',
    tagline:        r.tagline        || '',
    primaryColor:   r.brandColorPrimary || '#c8a84b',
    accentColor:    r.brandColorAccent  || '#e5c97a',
    bgColor:        r.brandColorBg      || '#090910',
    platforms:      r.platforms ? JSON.parse(r.platforms) : [],
    twinStyle:      r.twinStyle     || '',
    twinUsecase:    r.twinUsecase   || '',
    ownerScript:    r.ownerScript   || '',
    businessType:   r.businessType  || 'restaurant',
  };
}

app.post('/api/config', async (req, res) => {
  const { restaurantId: rId, restaurantName, cuisineType, ownerName, tagline,
          primaryColor, accentColor, bgColor, platforms, twinStyle, twinUsecase, ownerScript,
          businessType } = req.body;
  const restaurantId = req.restaurantId || Number(rId) || 1;
  const data = {};
  if (restaurantName !== undefined) data.name                = restaurantName;
  if (cuisineType    !== undefined) data.cuisineType         = cuisineType;
  if (ownerName      !== undefined) data.ownerName           = ownerName;
  if (tagline        !== undefined) data.tagline             = tagline;
  if (primaryColor   !== undefined) data.brandColorPrimary   = primaryColor;
  if (accentColor    !== undefined) data.brandColorAccent    = accentColor;
  if (bgColor        !== undefined) data.brandColorBg        = bgColor;
  if (platforms      !== undefined) data.platforms           = JSON.stringify(platforms);
  if (twinStyle      !== undefined) data.twinStyle           = twinStyle;
  if (twinUsecase    !== undefined) data.twinUsecase         = twinUsecase;
  if (ownerScript    !== undefined) data.ownerScript         = ownerScript;
  if (businessType   !== undefined) data.businessType        = businessType;
  try {
    await db.restaurant.update({ where: { id: restaurantId }, data });
    // Also write file fallback so local dev without DB still works
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...req.body }, null, 2));
    res.json({ success: true });
  } catch (e) {
    // DB update failed (e.g. restaurant not found) — fall back to file only
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...req.body }, null, 2));
    res.json({ success: true });
  }
});

app.get('/api/config', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.query.restaurantId) || 1;
  try {
    const r = await db.restaurant.findUnique({ where: { id: restaurantId } });
    if (r) return res.json(restaurantToConfig(r));
  } catch { /* fall through to file */ }
  // File fallback
  if (fs.existsSync(CONFIG_PATH)) {
    try { return res.json(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
    catch {}
  }
  res.json({});
});

// ── Weekly Brief ──────────────────────────────────────────────────────────────

function getMondayOfWeek(date = new Date()) {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

app.get('/api/weekly-brief', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.query.restaurantId) || 1;
  const weekOf       = getMondayOfWeek();
  try {
    const row = await db.weeklyBrief.findUnique({ where: { restaurantId_weekOf: { restaurantId, weekOf } } });
    res.json(row || { restaurantId, weekOf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/weekly-brief', async (req, res) => {
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;
  const weekOf       = getMondayOfWeek();
  const { featuredDish, event, promotion, notes } = req.body;
  try {
    const row = await db.weeklyBrief.upsert({
      where:  { restaurantId_weekOf: { restaurantId, weekOf } },
      update: { featuredDish, event, promotion, notes },
      create: { restaurantId, weekOf, featuredDish, event, promotion, notes },
    });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── AI Script generation ──────────────────────────────────────────────────────

app.post('/api/generate/script', async (req, res) => {
  const { topic, details, ownerName, restaurantName, cuisineType } = req.body;
  const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;

  // Fetch this week's brief for extra context
  let brief = {};
  try {
    brief = await db.weeklyBrief.findUnique({
      where: { restaurantId_weekOf: { restaurantId, weekOf: getMondayOfWeek() } }
    }) || {};
  } catch {}

  const briefContext = [
    brief.featuredDish && `Featured dish this week: ${brief.featuredDish}`,
    brief.event        && `Event: ${brief.event}`,
    brief.promotion    && `Promotion: ${brief.promotion}`,
    brief.notes        && `Extra notes: ${brief.notes}`,
  ].filter(Boolean).join('\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    const owner = ownerName || 'the chef';
    const name  = restaurantName || 'our restaurant';
    const extra = briefContext || (details ? `I'm excited to share: ${details}.` : '');
    return res.json({
      script: `Hello, I'm ${owner} from ${name}. ${extra} We pour our heart into every experience here, and I'd love to welcome you to our table soon.`,
      note: 'Template script — add ANTHROPIC_API_KEY to enable AI-written scripts.'
    });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: 'You write short spoken scripts for restaurant owner digital twin social videos. Output only the spoken words — no stage directions, no labels, no quotes.',
      messages: [{
        role: 'user',
        content: `Write a 15–20 second spoken script (40–55 words) for a restaurant owner video post on Instagram.

Owner: ${ownerName || 'the owner'}
Restaurant: ${restaurantName || 'the restaurant'}
Cuisine: ${cuisineType || 'fine dining'}
Topic: ${topic || 'welcome'}
Details: ${details || 'none'}
${briefContext ? `\nThis week's context:\n${briefContext}` : ''}

Requirements: first person, warm and personal, specific to the topic and any weekly context above, end with a natural invitation to visit or follow.`
      }]
    });

    res.json({ script: msg.content[0].text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate ──────────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { type, customScript, restaurantId: rId } = req.body;
  const restaurantId = req.restaurantId || Number(rId) || 1;
  if (!['video', 'twin', 'image'].includes(type))
    return res.status(400).json({ error: 'Invalid type. Use: video, twin, image' });

  let config = {};
  try {
    const [r, brief] = await Promise.all([
      db.restaurant.findUnique({ where: { id: restaurantId } }),
      db.weeklyBrief.findUnique({ where: { restaurantId_weekOf: { restaurantId, weekOf: getMondayOfWeek() } } }).catch(() => null),
    ]);
    if (r) {
      config = restaurantToConfig(r);
      config._logoUrl      = r.logoUrl;
      config._ownerUrl     = r.ownerPortraitUrl;
      config._weeklyBrief  = brief || {};
    }
  } catch { /* fall through */ }
  if (!config.restaurantName) {
    try {
      if (fs.existsSync(CONFIG_PATH)) config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch { }
  }

  const jobId = uuidv4();
  const job   = { id: jobId, type, status: 'generating', created: new Date().toISOString() };
  fs.writeFileSync(path.join(OUTPUT_DIR, `${jobId}_meta.json`), JSON.stringify(job, null, 2));

  res.json({ success: true, jobId, status: 'generating' });

  runGeneration(jobId, type, config, customScript, restaurantId);
});

// ── Auto-generate weekly content ──────────────────────────────────────────────

async function kickOffGeneration(restaurantId, config) {
  for (const type of ['video', 'twin', 'image']) {
    const jobId = uuidv4();
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${jobId}_meta.json`),
      JSON.stringify({ id: jobId, type, status: 'generating', created: new Date().toISOString(), auto: true }, null, 2)
    );
    const customScript = type === 'twin' ? (config.ownerScript || null) : null;
    runGeneration(jobId, type, { ...config }, customScript, restaurantId);
  }
}

async function runAutoGenerate() {
  try {
    const now  = new Date();
    const day  = now.getDay();  // 0=Sun,1=Mon,...,6=Sat
    const hour = now.getHours();

    const restaurants = await db.restaurant.findMany({
      where: { autoGenerateEnabled: true, autoGenerateDay: day, autoGenerateHour: hour },
    });
    if (!restaurants.length) return;

    console.log(`[autogenerate] Kicking off generation for ${restaurants.length} restaurant(s)`);
    for (const r of restaurants) {
      const brief = await db.weeklyBrief
        .findUnique({ where: { restaurantId_weekOf: { restaurantId: r.id, weekOf: getMondayOfWeek() } } })
        .catch(() => null);
      const config         = restaurantToConfig(r);
      config._logoUrl      = r.logoUrl;
      config._ownerUrl     = r.ownerPortraitUrl;
      config._weeklyBrief  = brief || {};
      await kickOffGeneration(r.id, config);
      console.log(`[autogenerate] Queued video+twin+image for restaurant ${r.id}`);
    }
  } catch (err) {
    console.error('[autogenerate] Error:', err.message);
  }
}

// Also expose as an API endpoint so the UI "Generate All" button can trigger it manually
app.post('/api/generate-all', async (req, res) => {
  const restaurantId = req.restaurantId || 1;
  try {
    const [r, brief] = await Promise.all([
      db.restaurant.findUnique({ where: { id: restaurantId } }),
      db.weeklyBrief.findUnique({ where: { restaurantId_weekOf: { restaurantId, weekOf: getMondayOfWeek() } } }).catch(() => null),
    ]);
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });
    const config         = restaurantToConfig(r);
    config._logoUrl      = r.logoUrl;
    config._ownerUrl     = r.ownerPortraitUrl;
    config._weeklyBrief  = brief || {};
    await kickOffGeneration(restaurantId, config);
    res.json({ success: true, message: 'Generation queued for video, twin, and image' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function runGeneration(jobId, type, config, customScript, restaurantId = 1) {
  try {
    const { generateVideo, generateTwinClip, generateImagePost } = require('./pipeline/1_generate_content');
    const { brandOverlay } = require('./pipeline/2_brand_overlay');

    // Inject cloud asset URLs (already set from DB if available; otherwise look up Cloudinary)
    if (cld.isConfigured() && (!config._logoUrl || !config._ownerUrl)) {
      const [logoNew, ownerNew] = await Promise.all([
        config._logoUrl  ? null : cld.getAssetUrl(`restaurant-social-ai/${restaurantId}/logo`),
        config._ownerUrl ? null : cld.getAssetUrl(`restaurant-social-ai/${restaurantId}/owner`),
      ]);
      // For restaurant 1, also fall back to legacy paths
      const [logoOld, ownerOld] = restaurantId === 1 ? await Promise.all([
        logoNew  || config._logoUrl  ? null : cld.getAssetUrl('restaurant-social-ai/logo'),
        ownerNew || config._ownerUrl ? null : cld.getAssetUrl('restaurant-social-ai/owner'),
      ]) : [null, null];
      if (!config._logoUrl)  config._logoUrl  = logoNew  || logoOld  || null;
      if (!config._ownerUrl) config._ownerUrl = ownerNew || ownerOld || null;
    }

    // For image posts and cinematic video: fetch food photo URLs
    if (type === 'image' || type === 'video') {
      let photoUrls = [];
      if (cld.isConfigured()) {
        try {
          const [newPhotos, oldPhotos] = await Promise.all([
            cld.listFolder(`restaurant-social-ai/${restaurantId}/photos/`),
            restaurantId === 1 ? cld.listFolder('restaurant-social-ai/photos/') : Promise.resolve([]),
          ]);
          photoUrls = [...newPhotos, ...oldPhotos].map(p => p.url).filter(Boolean);
          console.log(`[image] Found ${photoUrls.length} photos in Cloudinary for restaurant ${restaurantId}`);
        } catch (e) {
          console.warn('[image] Cloudinary photo fetch failed:', e.message);
        }
      } else {
        console.log('[image] Cloudinary not configured, trying local');
      }
      if (!photoUrls.length) {
        const photosDir = path.join(ASSETS_DIR, 'photos');
        if (fs.existsSync(photosDir)) {
          photoUrls = fs.readdirSync(photosDir)
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .map(f => `/assets/photos/${f}`);
          console.log(`[image] Found ${photoUrls.length} local photos`);
        }
      }
      config._photoUrls = photoUrls;
      console.log(`[image] Total photos available: ${photoUrls.length}`);
    }

    let result;
    if (type === 'video') {
      result = await generateVideo(config, jobId);
    } else if (type === 'twin') {
      result = await generateTwinClip(config, jobId, customScript);
    } else {
      result = await generateImagePost(config, jobId);
      console.log('[overlay] logoUrl:', config._logoUrl || 'NONE', '| primary:', config.primaryColor || 'NONE');
      if (result.files) {
        for (const file of result.files) {
          await brandOverlay(path.join(OUTPUT_DIR, file.filename), config, file.variant)
            .catch(e => console.warn('[overlay] skipped:', e.message));
        }
      }
    }

    const meta = { ...result, id: jobId, type, status: 'ready', created: new Date().toISOString() };
    fs.writeFileSync(path.join(OUTPUT_DIR, `${jobId}_meta.json`), JSON.stringify(meta, null, 2));
    console.log(`[generate] Job ${jobId} (${type}) complete`);
  } catch (err) {
    console.error(`[generate] Job ${jobId} failed:`, err.message);
    const meta = { id: jobId, type, status: 'error', error: err.message, created: new Date().toISOString() };
    fs.writeFileSync(path.join(OUTPUT_DIR, `${jobId}_meta.json`), JSON.stringify(meta, null, 2));
  }
}

// ── Output listing ────────────────────────────────────────────────────────────

app.get('/api/output', (req, res) => {
  if (!fs.existsSync(OUTPUT_DIR)) return res.json([]);
  const items = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('_meta.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json(items);
});

// ── Delete job ────────────────────────────────────────────────────────────────

app.delete('/api/output/:jobId', (req, res) => {
  const { jobId } = req.params;
  const metaPath = path.join(OUTPUT_DIR, `${jobId}_meta.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Job not found' });
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    // Delete associated media files
    const filesToDelete = [];
    if (meta.filename)      filesToDelete.push(path.join(OUTPUT_DIR, meta.filename));
    if (meta.thumbnailPath) filesToDelete.push(path.join(OUTPUT_DIR, path.basename(meta.thumbnailPath)));
    if (meta.files)         meta.files.forEach(f => filesToDelete.push(path.join(OUTPUT_DIR, f.filename)));
    filesToDelete.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    fs.unlinkSync(metaPath);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Approval ──────────────────────────────────────────────────────────────────

app.patch('/api/output/:jobId/approve', (req, res) => {
  const metaPath = path.join(OUTPUT_DIR, `${req.params.jobId}_meta.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Job not found' });
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const { caption } = req.body;
    meta.approval_status = 'approved';
    meta.approved_at     = new Date().toISOString();
    if (caption !== undefined) meta.caption = caption;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/output/:jobId/reject', (req, res) => {
  const metaPath = path.join(OUTPUT_DIR, `${req.params.jobId}_meta.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Job not found' });
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.approval_status = 'rejected';
    meta.rejected_at     = new Date().toISOString();
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Instagram caption generation ──────────────────────────────────────────────

app.post('/api/output/:jobId/caption', async (req, res) => {
  const metaPath = path.join(OUTPUT_DIR, `${req.params.jobId}_meta.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Job not found' });
  try {
    const meta   = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    let   config = {};
    try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role:    'user',
        content: `Write an Instagram caption for a restaurant video post.

Restaurant: ${config.restaurantName || 'our restaurant'}
Cuisine: ${config.cuisineType || ''}
Video script: ${meta.prompt || ''}

Rules:
- 2-3 sentences, warm and inviting tone
- Include a call to action (book a table, visit us, link in bio)
- Add 8-10 relevant hashtags at the end
- Return only the caption text`,
      }],
    });
    const caption = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';

    // Save caption to job meta
    meta.caption = caption;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    res.json({ caption });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Post to Instagram ─────────────────────────────────────────────────────────

app.post('/api/output/:jobId/post-instagram', async (req, res) => {
  const metaPath = path.join(OUTPUT_DIR, `${req.params.jobId}_meta.json`);
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Job not found' });

  const meta    = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const appUrl  = process.env.APP_URL || '';
  const caption = req.body.caption || meta.caption || '';

  if (!appUrl) return res.status(500).json({ error: 'APP_URL env var not set — needed to build public media URL' });
  if (!caption) return res.status(400).json({ error: 'Caption is required' });

  const mediaFile = meta.filename || (meta.files && meta.files[0]?.filename);
  if (!mediaFile) return res.status(400).json({ error: 'No media file on this job' });

  const publicUrl = `${appUrl}/output/${mediaFile}`;
  const isVideo   = mediaFile.endsWith('.mp4');

  res.json({ success: true, status: 'posting', message: 'Posting to Instagram in background...' });

  // Load per-restaurant IG credentials (fall back to env vars in pipeline)
  let igCreds = {};
  try {
    const restaurantId = req.restaurantId || Number(req.body.restaurantId) || 1;
    const r = await db.restaurant.findUnique({ where: { id: restaurantId } });
    if (r?.instagramUserId && r?.instagramAccessToken) {
      igCreds = { accountId: r.instagramUserId, accessToken: r.instagramAccessToken };
    }
  } catch { /* use env var fallback */ }

  // Post in background
  (async () => {
    try {
      const { postReel, postImage } = require('./pipeline/4_instagram');
      const result = isVideo ? await postReel(publicUrl, caption, igCreds) : await postImage(publicUrl, caption, igCreds);
      meta.instagram_media_id = result.mediaId;
      meta.instagram_url      = result.permalink;
      meta.instagram_posted_at = new Date().toISOString();
      meta.caption             = caption;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      console.log(`[instagram] Job ${req.params.jobId} posted:`, result.permalink);
    } catch (err) {
      console.error(`[instagram] Job ${req.params.jobId} failed:`, err.message);
      meta.instagram_error = err.message;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
  })();
});

// ── Caption generation ────────────────────────────────────────────────────────

app.post('/api/generate-caption', async (req, res) => {
  try {
    const {
      restaurantId,
      postType         = 'branded_image',
      contentDescription = '',
      occasion         = 'general',
    } = req.body;

    const rid = req.restaurantId || Number(restaurantId) || 1;
    const r   = await db.restaurant.findUnique({ where: { id: rid } });
    const name      = r?.name         || 'our restaurant';
    const cuisine   = r?.cuisineType  || '';
    const location  = r?.location     || '';
    const voiceTone = r?.voiceTone    || 'elegant';
    const inclLoc   = r?.includeLocation !== false;

    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const prompt = `You are writing an Instagram caption for ${name}${cuisine ? `, a ${cuisine} restaurant` : ''}.

Post type: ${postType.replace(/_/g, ' ')}
${contentDescription ? `Content: ${contentDescription}` : ''}
${occasion !== 'general' ? `Occasion: ${occasion}` : ''}
Brand voice: ${voiceTone}

Write an engaging Instagram caption that:
- Is 125-150 characters (Instagram optimal length)
- Includes 1-2 subtle relevant emojis
- Has a clear call-to-action (visit us, try our, join us, reserve your table, etc.)
- Matches the ${voiceTone} tone precisely
- NO hashtags (added separately)
${inclLoc && location ? `- Naturally mention ${location}` : ''}

Return ONLY the caption text, nothing else.`;

    const msg     = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: prompt }] });
    const caption = msg.content[0].text.trim();
    res.json({ caption });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-hashtags', async (req, res) => {
  try {
    const { restaurantId, dishType = '', occasion = 'general' } = req.body;
    const rid = req.restaurantId || Number(restaurantId) || 1;
    const r   = await db.restaurant.findUnique({ where: { id: rid } });

    const name     = (r?.name         || '').replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
    const cuisine  = (r?.cuisineType  || '').replace(/\s+/g, '');
    const location = (r?.location     || '').replace(/[\s,]+/g, '');

    // Start with restaurant's saved defaults, then build smart additions
    let defaults = [];
    try { if (r?.defaultHashtags) defaults = JSON.parse(r.defaultHashtags); } catch {}

    const tags = [...defaults];

    if (name)     tags.push(`#${name}`);
    if (location) tags.push(`#${location}Eats`, `#${location}Foodie`, `#${location}Restaurants`);
    if (cuisine)  tags.push(`#${cuisine}Food`, `#${cuisine}Restaurant`);

    const occasionTags = {
      welcome:         ['#GrandOpening', '#NewRestaurant', '#NowOpen'],
      weekend_promo:   ['#WeekendVibes', '#WeekendEats', '#SaturdayNightOut'],
      happy_hour:      ['#HappyHour', '#HappyHourDeals', '#DrinkSpecials'],
      holiday:         ['#HolidayDinner', '#SpecialOccasion', '#CelebrateInStyle'],
      new_menu_item:   ['#NewDish', '#ChefSpecial', '#MustTry'],
      behind_scenes:   ['#BehindTheScenes', '#KitchenLife', '#ChefLife'],
      general:         [],
    };
    tags.push(...(occasionTags[occasion] || []));

    if (dishType) tags.push('#' + dishType.replace(/\s+/g, ''));

    // Always include some general food tags
    tags.push('#FoodPhotography', '#Foodie', '#InstaFood', '#FoodLovers', '#FineDining', '#GourmetFood');

    // Deduplicate, filter empty, limit to 15
    const unique = [...new Set(tags.filter(Boolean))].slice(0, 15);
    res.json({ hashtags: unique });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Schedule ──────────────────────────────────────────────────────────────────

app.get('/api/schedule', (req, res) => {
  let config = {};
  try {
    if (fs.existsSync(CONFIG_PATH))
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { /* use empty config */ }
  const { buildSchedule } = require('./pipeline/3_mock_scheduler');
  res.json(buildSchedule(config));
});

// ── HeyGen voices ─────────────────────────────────────────────────────────────

app.get('/api/heygen/voices', async (req, res) => {
  if (!process.env.HEYGEN_API_KEY)
    return res.status(503).json({ error: 'HEYGEN_API_KEY not set' });
  try {
    const r = await fetch('https://api.heygen.com/v2/voices', {
      headers: { 'X-Api-Key': process.env.HEYGEN_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`HeyGen ${r.status}`);
    const data = await r.json();
    const voices = (data.data?.voices || []).map(v => ({
      voice_id:  v.voice_id,
      name:      v.name,
      language:  v.language,
      gender:    v.gender,
      preview_audio: v.preview_audio || null,
    }));
    res.json(voices);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DB-backed routes ──────────────────────────────────────────────────────────

app.use('/api/db/restaurants',      require('./routes/restaurants'));
app.use('/api/db/scheduled-posts',  require('./routes/scheduledPosts'));
app.use('/api/db/script-templates', require('./routes/scriptTemplates'));
app.use('/api/db/food-photos',      require('./routes/foodPhotos'));
app.use('/api/db/generation-jobs',  require('./routes/generationJobs'));
app.use('/api/generate-week',       require('./routes/generateWeek'));
app.use('/api/leads',               require('./routes/leads'));

// Instagram OAuth routes (not under /api/ so they bypass auth middleware)
const { router: igAuthRouter, refreshExpiringTokens } = require('./routes/instagramAuth');
app.use('/auth/instagram',      igAuthRouter);
app.use('/api/instagram',       igAuthRouter);

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ModernSocial.ai`);
  console.log(`  ─────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Data: ${DATA_DIR}\n`);
  require('./lib/jobQueue').startWorker();

  // Auto-publish cron: check every 5 minutes for due scheduled posts
  const { runAutoPublish } = require('./lib/autopublish');
  cron.schedule('*/5 * * * *', runAutoPublish);
  console.log('[autopublish] Cron started (every 5 minutes)');

  // Auto-generate cron: run every hour — kick off generation for restaurants whose day/hour matches now
  cron.schedule('0 * * * *', runAutoGenerate);
  console.log('[autogenerate] Cron started (hourly check)');

  // Token refresh cron: daily at midnight — refresh IG tokens expiring within 7 days
  cron.schedule('0 0 * * *', refreshExpiringTokens);
  console.log('[ig-token] Daily refresh cron started');
});
