require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const cld     = require('./lib/cloudinary');
const db      = require('./lib/db');

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
  const restaurantId = Number(req.body.restaurantId) || 1;

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
  const restaurantId = Number(req.body.restaurantId) || 1;

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
  const restaurantId = Number(req.body.restaurantId) || 1;

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
  const restaurantId = Number(req.query.restaurantId) || 1;

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
  const restaurantId = Number(req.query.restaurantId) || 1;
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
    tagline:        r.tagline        || '',
    primaryColor:   r.brandColorPrimary || '#c8a84b',
    accentColor:    r.brandColorAccent  || '#e5c97a',
    bgColor:        r.brandColorBg      || '#090910',
    platforms:      r.platforms ? JSON.parse(r.platforms) : [],
    twinStyle:      r.twinStyle     || '',
    twinUsecase:    r.twinUsecase   || '',
    ownerScript:    r.ownerScript   || '',
  };
}

app.post('/api/config', async (req, res) => {
  const { restaurantId: rId, restaurantName, cuisineType, ownerName, tagline,
          primaryColor, accentColor, bgColor, platforms, twinStyle, twinUsecase, ownerScript } = req.body;
  const restaurantId = Number(rId) || 1;
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
  const restaurantId = Number(req.query.restaurantId) || 1;
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

// ── AI Script generation ──────────────────────────────────────────────────────

app.post('/api/generate/script', async (req, res) => {
  const { topic, details, ownerName, restaurantName, cuisineType } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    const owner = ownerName || 'the chef';
    const name  = restaurantName || 'our restaurant';
    return res.json({
      script: `Hello, I'm ${owner} from ${name}. ${details ? `I'm excited to share: ${details}. ` : ''}We pour our heart into every experience here, and I'd love to welcome you to our table soon.`,
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

Requirements: first person, warm and personal, specific to the topic, end with a natural invitation to visit or follow.`
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
  const restaurantId = Number(rId) || 1;
  if (!['video', 'twin', 'image'].includes(type))
    return res.status(400).json({ error: 'Invalid type. Use: video, twin, image' });

  let config = {};
  try {
    const r = await db.restaurant.findUnique({ where: { id: restaurantId } });
    if (r) {
      config = restaurantToConfig(r);
      config._logoUrl  = r.logoUrl;
      config._ownerUrl = r.ownerPortraitUrl;
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

    let result;
    if (type === 'video') {
      result = await generateVideo(config, jobId);
    } else if (type === 'twin') {
      result = await generateTwinClip(config, jobId, customScript);
    } else {
      result = await generateImagePost(config, jobId);
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

  // Post in background
  (async () => {
    try {
      const { postReel, postImage } = require('./pipeline/4_instagram');
      const result = isVideo ? await postReel(publicUrl, caption) : await postImage(publicUrl, caption);
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

// ── DB-backed routes ──────────────────────────────────────────────────────────

app.use('/api/db/restaurants',      require('./routes/restaurants'));
app.use('/api/db/scheduled-posts',  require('./routes/scheduledPosts'));
app.use('/api/db/script-templates', require('./routes/scriptTemplates'));
app.use('/api/db/food-photos',      require('./routes/foodPhotos'));
app.use('/api/db/generation-jobs',  require('./routes/generationJobs'));
app.use('/api/generate-week',       require('./routes/generateWeek'));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Restaurant Social AI`);
  console.log(`  ─────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Data: ${DATA_DIR}\n`);
  require('./lib/jobQueue').startWorker();
});
