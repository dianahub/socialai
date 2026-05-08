require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure runtime directories exist
['assets/logo', 'assets/photos', 'assets/owner', 'output', 'public'].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

app.use(express.json());
app.use(express.static('public'));
app.use('/assets', express.static('assets'));
app.use('/output', express.static('output'));

// ── Multer storage ──────────────────────────────────────────────────────────

const logoStorage = multer.diskStorage({
  destination: 'assets/logo',
  filename: (req, file, cb) => cb(null, 'logo' + path.extname(file.originalname).toLowerCase())
});

const photosStorage = multer.diskStorage({
  destination: 'assets/photos',
  filename: (req, file, cb) =>
    cb(null, `photo_${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
});

const ownerStorage = multer.diskStorage({
  destination: 'assets/owner',
  filename: (req, file, cb) => cb(null, 'owner' + path.extname(file.originalname).toLowerCase())
});

const uploadLogo   = multer({ storage: logoStorage,   limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPhotos = multer({ storage: photosStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadOwner  = multer({ storage: ownerStorage,  limits: { fileSize: 10 * 1024 * 1024 } });

// ── Upload routes ───────────────────────────────────────────────────────────

app.post('/api/upload/logo', uploadLogo.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
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

// ── Asset management ────────────────────────────────────────────────────────

app.get('/api/assets', (req, res) => {
  const result = { logo: null, photos: [], owner: null };

  const readDir = (dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => !f.startsWith('.') && /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
    : [];

  const logoFiles = readDir('assets/logo');
  if (logoFiles.length) result.logo = `/assets/logo/${logoFiles[0]}`;

  result.photos = readDir('assets/photos').map(f => `/assets/photos/${f}`);

  const ownerFiles = readDir('assets/owner');
  if (ownerFiles.length) result.owner = `/assets/owner/${ownerFiles[0]}`;

  res.json(result);
});

app.delete('/api/assets/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  if (!['logo', 'photos', 'owner'].includes(type))
    return res.status(400).json({ error: 'Invalid type' });

  // Prevent path traversal
  const safe = path.basename(filename);
  const filepath = path.join('assets', type, safe);

  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File not found' });
  fs.unlinkSync(filepath);
  res.json({ success: true });
});

// ── Config ──────────────────────────────────────────────────────────────────

app.post('/api/config', (req, res) => {
  fs.writeFileSync('assets/config.json', JSON.stringify(req.body, null, 2));
  res.json({ success: true });
});

app.get('/api/config', (req, res) => {
  if (fs.existsSync('assets/config.json')) {
    try {
      return res.json(JSON.parse(fs.readFileSync('assets/config.json', 'utf8')));
    } catch {
      return res.json({});
    }
  }
  res.json({});
});

// ── Generate ────────────────────────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  const { type } = req.body;
  if (!['video', 'twin', 'image'].includes(type))
    return res.status(400).json({ error: 'Invalid type. Use: video, twin, image' });

  let config = {};
  try {
    if (fs.existsSync('assets/config.json'))
      config = JSON.parse(fs.readFileSync('assets/config.json', 'utf8'));
  } catch { /* use empty config */ }

  const jobId = uuidv4();
  const job = { id: jobId, type, status: 'generating', created: new Date().toISOString() };
  fs.writeFileSync(`output/${jobId}_meta.json`, JSON.stringify(job, null, 2));

  // Respond immediately; generation runs in background
  res.json({ success: true, jobId, status: 'generating' });

  runGeneration(jobId, type, config);
});

async function runGeneration(jobId, type, config) {
  try {
    const { generateVideo, generateTwinClip, generateImagePost } = require('./pipeline/1_generate_content');
    const { brandOverlay } = require('./pipeline/2_brand_overlay');

    let result;
    if (type === 'video') {
      result = await generateVideo(config, jobId);
    } else if (type === 'twin') {
      result = await generateTwinClip(config, jobId);
    } else {
      result = await generateImagePost(config, jobId);
      // Apply brand overlay to each image variant
      if (result.files) {
        for (const file of result.files) {
          await brandOverlay(`.${file.path}`, config, file.variant).catch(e =>
            console.warn('[overlay] skipped:', e.message)
          );
        }
      }
    }

    const meta = { ...result, id: jobId, type, status: 'ready', created: new Date().toISOString() };
    fs.writeFileSync(`output/${jobId}_meta.json`, JSON.stringify(meta, null, 2));
    console.log(`[generate] Job ${jobId} (${type}) complete`);
  } catch (err) {
    console.error(`[generate] Job ${jobId} failed:`, err.message);
    const meta = { id: jobId, type, status: 'error', error: err.message, created: new Date().toISOString() };
    fs.writeFileSync(`output/${jobId}_meta.json`, JSON.stringify(meta, null, 2));
  }
}

// ── Output listing ──────────────────────────────────────────────────────────

app.get('/api/output', (req, res) => {
  if (!fs.existsSync('output')) return res.json([]);
  const items = fs.readdirSync('output')
    .filter(f => f.endsWith('_meta.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(`output/${f}`, 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  res.json(items);
});

// ── Schedule ────────────────────────────────────────────────────────────────

app.get('/api/schedule', (req, res) => {
  let config = {};
  try {
    if (fs.existsSync('assets/config.json'))
      config = JSON.parse(fs.readFileSync('assets/config.json', 'utf8'));
  } catch { /* use empty config */ }

  const { buildSchedule } = require('./pipeline/3_mock_scheduler');
  res.json(buildSchedule(config));
});

// ── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Restaurant Social AI`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Running at http://localhost:${PORT}\n`);
});
