require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

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

// ── Multer storage ────────────────────────────────────────────────────────────

const logoStorage = multer.diskStorage({
  destination: path.join(ASSETS_DIR, 'logo'),
  filename: (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname).toLowerCase())
});
const photosStorage = multer.diskStorage({
  destination: path.join(ASSETS_DIR, 'photos'),
  filename: (req, file, cb) =>
    cb(null, `photo_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});
const ownerStorage = multer.diskStorage({
  destination: path.join(ASSETS_DIR, 'owner'),
  filename: (req, file, cb) => cb(null, 'owner' + path.extname(file.originalname).toLowerCase())
});

const uploadLogo   = multer({ storage: logoStorage,   limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPhotos = multer({ storage: photosStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadOwner  = multer({ storage: ownerStorage,  limits: { fileSize: 10 * 1024 * 1024 } });

// ── Upload routes ─────────────────────────────────────────────────────────────

app.post('/api/upload/logo', uploadLogo.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const uploaded = path.join(ASSETS_DIR, 'logo', req.file.filename);
  const ext      = path.extname(req.file.filename).toLowerCase();

  // Convert anything that isn't JPEG/PNG/WebP to PNG so Sharp can always read it
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    const pngName = 'logo.png';
    const pngPath = path.join(ASSETS_DIR, 'logo', pngName);
    try {
      await require('sharp')(uploaded).png().toFile(pngPath);
      fs.unlinkSync(uploaded);
      return res.json({ success: true, filename: pngName, path: `/assets/logo/${pngName}` });
    } catch (e) {
      console.warn('[logo] Conversion failed, keeping original:', e.message);
    }
  }

  res.json({ success: true, filename: req.file.filename, path: `/assets/logo/${req.file.filename}` });
});

app.post('/api/upload/photos', uploadPhotos.array('files', 6), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received' });
  res.json({
    success: true,
    files: req.files.map(f => ({ filename: f.filename, path: `/assets/photos/${f.filename}` }))
  });
});

app.post('/api/upload/owner', uploadOwner.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.json({ success: true, filename: req.file.filename, path: `/assets/owner/${req.file.filename}` });
});

// ── Asset management ──────────────────────────────────────────────────────────

app.get('/api/assets', (req, res) => {
  const result = { logo: null, photos: [], owner: null };
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

app.delete('/api/assets/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  if (!['logo', 'photos', 'owner'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });
  const safe     = path.basename(filename);
  const filepath = path.join(ASSETS_DIR, type, safe);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filepath);
  res.json({ success: true });
});

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(ASSETS_DIR, 'config.json');

app.post('/api/config', (req, res) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.get('/api/config', (req, res) => {
  if (fs.existsSync(CONFIG_PATH)) {
    try { return res.json(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
    catch { return res.json({}); }
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
  const { type, customScript } = req.body;
  if (!['video', 'twin', 'image'].includes(type))
    return res.status(400).json({ error: 'Invalid type. Use: video, twin, image' });

  let config = {};
  try {
    if (fs.existsSync(CONFIG_PATH))
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch { /* use empty config */ }

  const jobId = uuidv4();
  const job   = { id: jobId, type, status: 'generating', created: new Date().toISOString() };
  fs.writeFileSync(path.join(OUTPUT_DIR, `${jobId}_meta.json`), JSON.stringify(job, null, 2));

  res.json({ success: true, jobId, status: 'generating' });

  runGeneration(jobId, type, config, customScript);
});

async function runGeneration(jobId, type, config, customScript) {
  try {
    const { generateVideo, generateTwinClip, generateImagePost } = require('./pipeline/1_generate_content');
    const { brandOverlay } = require('./pipeline/2_brand_overlay');

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

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Restaurant Social AI`);
  console.log(`  ─────────────────────────────`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Data: ${DATA_DIR}\n`);
});
