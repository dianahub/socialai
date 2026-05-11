/**
 * HeyGen content generation pipeline.
 *
 * Set HEYGEN_API_KEY in .env (or environment) to enable real generation.
 * Without a key: falls back to branded placeholder images via Sharp.
 *
 * HeyGen features used:
 *   generateVideo    → Avatar video  (presenter-style restaurant promo, 16:9)
 *   generateTwinClip → Talking Photo (owner photo animated with welcome script, 9:16)
 *   generateImagePost→ Sharp mock    (branded static posts — HeyGen is video-only)
 */

const fs       = require('fs');
const path     = require('path');
const sharp    = require('sharp');
const FormData = require('form-data');

const API_BASE    = 'https://api.heygen.com';
const UPLOAD_BASE = 'https://upload.heygen.com';
const API_KEY     = process.env.HEYGEN_API_KEY;

const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

// ── Script builders ──────────────────────────────────────────────────────────

function videoScript(cfg) {
  const name    = cfg.restaurantName || 'our restaurant';
  const cuisine = cfg.cuisineType    || 'fine dining';
  const tagline = cfg.tagline        || '';
  return `Welcome to ${name}, where ${cuisine} becomes an unforgettable experience. `
    + (tagline ? `${tagline}. ` : '')
    + `Every dish is crafted with passion, precision, and the finest ingredients. `
    + `We invite you to join us for an extraordinary evening.`;
}

function twinScript(cfg) {
  const owner   = cfg.ownerName      || 'our executive chef';
  const name    = cfg.restaurantName || 'our restaurant';
  const usecase = cfg.twinUsecase    || 'welcome message';

  const scripts = {
    'welcome message':
      `Hello, I'm ${owner}, and I'd like to personally welcome you to ${name}. `
      + `We've poured our hearts into creating a dining experience that goes beyond just food. `
      + `I look forward to seeing you at our table.`,
    "chef's table introduction":
      `I'm ${owner}, and I'm thrilled to introduce you to our chef's table at ${name}. `
      + `This is where I share my passion for ${cfg.cuisineType || 'fine dining'} in its most intimate form. `
      + `Join me for a truly unique culinary journey.`,
    'seasonal menu announcement':
      `I'm ${owner} of ${name}. I'm excited to announce our new seasonal menu, `
      + `inspired by the finest ingredients available right now. `
      + `Each dish tells a story of place and season. I can't wait for you to taste it.`,
    'thank you message':
      `I'm ${owner}, and I simply want to say thank you. `
      + `Your support of ${name} means everything to us. `
      + `We are committed to creating extraordinary moments for you.`,
    'behind the scenes story':
      `I'm ${owner}. Every night at ${name}, there's a story happening behind the scenes. `
      + `From sourcing the finest ingredients to the final plating, every detail matters. `
      + `Let me take you behind the curtain.`,
  };
  return scripts[usecase] || scripts['welcome message'];
}

// ── HeyGen API helpers ────────────────────────────────────────────────────────

async function heygenGet(endpoint) {
  if (!API_KEY) throw new Error('HEYGEN_API_KEY not set');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'X-Api-Key': API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HeyGen ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function heygenPost(endpoint, payload) {
  if (!API_KEY) throw new Error('HEYGEN_API_KEY not set');
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HeyGen ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Poll until video is complete; returns { videoUrl, thumbnailUrl }
async function waitForVideo(videoId, maxMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 6000));
    const resp = await heygenGet(`/v1/video_status.get?video_id=${videoId}`);
    const d    = resp.data || {};
    console.log(`[heygen] ${videoId} → ${d.status}`);
    if (d.status === 'completed') return { videoUrl: d.video_url, thumbnailUrl: d.thumbnail_url };
    if (d.status === 'failed')    throw new Error('HeyGen failed: ' + JSON.stringify(d.error || d));
  }
  throw new Error('HeyGen timed out after 10 min');
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  fs.writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

async function getDefaultAvatarId() {
  const resp    = await heygenGet('/v2/avatars');
  const avatars = resp.data?.avatars || [];
  if (!avatars.length) throw new Error('No avatars available on this account');
  return avatars[0].avatar_id;
}

async function getDefaultVoiceId() {
  try {
    const resp   = await heygenGet('/v2/voices');
    const voices = resp.data?.voices || [];
    // Prefer English
    const en = voices.find(v => v.language?.startsWith('en') && v.gender === 'male')
            || voices.find(v => v.language?.startsWith('en'))
            || voices[0];
    return en?.voice_id || null;
  } catch {
    return null;
  }
}

// Upload owner photo to HeyGen; returns talking_photo_id
async function uploadTalkingPhoto(imagePath) {
  const axios    = require('axios');

  // HeyGen requires 512–1024px wide; resize to fit that range
  const meta    = await sharp(imagePath).metadata();
  const needsResize = meta.width < 512 || meta.width > 1024;
  const resized = needsResize
    ? sharp(imagePath).resize(1024, null, { fit: 'inside' })
    : sharp(imagePath);
  const jpegBuf = await resized.jpeg({ quality: 88 }).toBuffer();
  console.log('[uploadTalkingPhoto] jpeg size:', jpegBuf.length, 'dims:', meta.width, 'x', meta.height);

  const form = new FormData();
  form.append('file', jpegBuf, {
    filename:    'owner.jpg',
    contentType: 'image/jpeg',
    knownLength: jpegBuf.length,
  });

  let resp;
  try {
    resp = await axios.post(`${UPLOAD_BASE}/v1/talking_photo`, form, {
      headers: {
        'X-Api-Key': API_KEY,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (axiosErr) {
    const body = axiosErr.response?.data;
    console.error('[uploadTalkingPhoto] HeyGen error body:', JSON.stringify(body).slice(0, 500));
    throw axiosErr;
  }

  console.log('[uploadTalkingPhoto] response:', resp.status, JSON.stringify(resp.data).slice(0, 200));
  return resp.data?.data?.talking_photo_id;
}

// ── Mock image generator (Sharp) ─────────────────────────────────────────────

const hexToRgb = hex => ({
  r: parseInt(hex.slice(1, 3), 16) || 0,
  g: parseInt(hex.slice(3, 5), 16) || 0,
  b: parseInt(hex.slice(5, 7), 16) || 0,
});

async function mockImage(cfg, jobId, variant, overlayLabel, modelLabel) {
  const dims = {
    feed:      { w: 1080, h: 1080 },
    story:     { w: 1080, h: 1920 },
    thumbnail: { w: 1280, h: 720  },
    video:     { w: 1920, h: 1080 },
    twin:      { w: 1080, h: 1080 },
  };
  const { w, h } = dims[variant] || dims.feed;

  const primary = cfg.primaryColor   || '#c8a84b';
  const accent  = cfg.accentColor    || '#e5c97a';
  const name    = cfg.restaurantName || 'Restaurant';
  const pr      = hexToRgb(primary);

  const fs_ = {
    title:    Math.round(Math.min(w, h) * 0.065),
    subtitle: Math.round(Math.min(w, h) * 0.028),
    caption:  Math.round(Math.min(w, h) * 0.022),
    label:    Math.round(Math.min(w, h) * 0.018),
    icon:     Math.round(Math.min(w, h) * 0.12),
  };

  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%"   stop-color="#090910"/>
        <stop offset="45%"  stop-color="#161622"/>
        <stop offset="100%" stop-color="#0d0d16"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="45%" r="40%">
        <stop offset="0%"   stop-color="${primary}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="transparent" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#bg)"/>
    <rect width="${w}" height="${h}" fill="url(#glow)"/>
    <line x1="${w*0.08}" y1="${h*0.35}" x2="${w*0.92}" y2="${h*0.35}" stroke="${primary}" stroke-width="0.5" opacity="0.35"/>
    <line x1="${w*0.08}" y1="${h*0.65}" x2="${w*0.92}" y2="${h*0.65}" stroke="${primary}" stroke-width="0.5" opacity="0.35"/>
    <path d="M${w*0.06} ${h*0.32} L${w*0.06} ${h*0.28} L${w*0.10} ${h*0.28}" stroke="${primary}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <path d="M${w*0.94} ${h*0.32} L${w*0.94} ${h*0.28} L${w*0.90} ${h*0.28}" stroke="${primary}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <path d="M${w*0.06} ${h*0.68} L${w*0.06} ${h*0.72} L${w*0.10} ${h*0.72}" stroke="${primary}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <path d="M${w*0.94} ${h*0.68} L${w*0.94} ${h*0.72} L${w*0.90} ${h*0.72}" stroke="${primary}" stroke-width="1.5" fill="none" opacity="0.5"/>
    <text x="50%" y="40%" font-family="Georgia,serif" font-size="${fs_.icon}" fill="${primary}" text-anchor="middle" dominant-baseline="middle" opacity="0.7">${overlayLabel}</text>
    <text x="50%" y="54%" font-family="Georgia,serif" font-size="${fs_.title}" fill="${accent}" text-anchor="middle" dominant-baseline="middle" font-weight="600">${name.length > 20 ? name.slice(0,20)+'…' : name}</text>
    <text x="50%" y="60%" font-family="Arial,sans-serif" font-size="${fs_.subtitle}" fill="#8a8780" text-anchor="middle" dominant-baseline="middle">${(cfg.cuisineType||'Fine Dining').toUpperCase()}</text>
    <text x="50%" y="66%" font-family="Georgia,serif" font-size="${fs_.caption}" fill="${primary}" text-anchor="middle" dominant-baseline="middle" font-style="italic">${cfg.tagline ? (cfg.tagline.length>40?cfg.tagline.slice(0,40)+'…':cfg.tagline) : 'An extraordinary culinary experience'}</text>
    <rect x="0" y="${h*0.88}" width="${w}" height="${h*0.12}" fill="rgba(${pr.r},${pr.g},${pr.b},0.08)"/>
    <line x1="0" y1="${h*0.88}" x2="${w}" y2="${h*0.88}" stroke="${primary}" stroke-width="0.5" opacity="0.3"/>
    <text x="50%" y="${h*0.935}" font-family="'Courier New',monospace" font-size="${fs_.label}" fill="#4a4843" text-anchor="middle" dominant-baseline="middle">${modelLabel} · ${w}×${h} · MOCK MODE</text>
  </svg>`;

  const filename   = `${jobId}_${variant}.jpg`;
  const outputPath = path.join(OUTPUT_DIR, filename);

  try {
    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(outputPath);
  } catch (svgErr) {
    console.warn('[mock] SVG render failed, using solid color fallback:', svgErr.message);
    await sharp({
      create: { width: w, height: h, channels: 3, background: { r: 18, g: 18, b: 28 } }
    }).jpeg({ quality: 88 }).toFile(outputPath);
  }

  return { filename, path: `/output/${filename}`, width: w, height: h };
}

// ── Public API ────────────────────────────────────────────────────────────────

async function generateVideo(config, jobId) {
  const script = videoScript(config);
  console.log('[generateVideo] script:', script.slice(0, 80) + '…');

  if (API_KEY) {
    try {
      const [avatarId, voiceId] = await Promise.all([getDefaultAvatarId(), getDefaultVoiceId()]);

      const voiceInput = { type: 'text', input_text: script, speed: 1.0 };
      if (voiceId) voiceInput.voice_id = voiceId;

      const resp = await heygenPost('/v2/video/generate', {
        video_inputs: [{
          character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
          voice: voiceInput,
          background: { type: 'color', value: '#0a0a14' },
        }],
        aspect_ratio: '16:9',
        test: false,
      });

      const videoId = resp.data?.video_id;
      if (!videoId) throw new Error('No video_id returned');

      const { videoUrl, thumbnailUrl } = await waitForVideo(videoId);
      const filename  = `${jobId}_video.mp4`;
      const thumbFile = `${jobId}_video_thumb.jpg`;

      await downloadFile(videoUrl, path.join(OUTPUT_DIR, filename));
      if (thumbnailUrl) await downloadFile(thumbnailUrl, path.join(OUTPUT_DIR, thumbFile)).catch(() => {});

      return {
        filename,
        path:          `/output/${filename}`,
        thumbnailPath: thumbnailUrl ? `/output/${thumbFile}` : null,
        type:          'video',
        platform:      config.platforms || ['instagram', 'tiktok'],
        model:         'HeyGen Avatar',
        prompt:        script,
      };
    } catch (err) {
      console.error('[generateVideo] HeyGen error:', err.message, '— falling back to mock');
    }
  } else {
    console.log('[generateVideo] No API key — mock mode');
  }

  const file = await mockImage(config, jobId, 'video', '▶', 'HeyGen Avatar');
  return {
    ...file,
    thumbnailPath: file.path,
    type:     'video',
    platform: config.platforms || ['instagram', 'tiktok'],
    model:    'HeyGen Avatar (mock)',
    prompt:   script,
    note:     'Placeholder. Set HEYGEN_API_KEY for real avatar video.',
  };
}

async function generateTwinClip(config, jobId, customScript) {
  const script = customScript || twinScript(config);
  console.log('[generateTwinClip] script:', script.slice(0, 80) + '…');

  if (API_KEY) {
    try {
      const voiceId = await getDefaultVoiceId();
      const voiceInput = { type: 'text', input_text: script, speed: 1.0 };
      if (voiceId) voiceInput.voice_id = voiceId;

      let character;
      let modelLabel = 'HeyGen Avatar';

      const ownerDir   = path.join(ASSETS_DIR, 'owner');
      const ownerFiles = fs.existsSync(ownerDir)
        ? fs.readdirSync(ownerDir).filter(f => !f.startsWith('.') && /\.(jpg|jpeg|png|webp)$/i.test(f))
        : [];

      if (ownerFiles.length) {
        const ownerFilename = ownerFiles[0];
        try {
          const talkingPhotoId = await uploadTalkingPhoto(path.join(ownerDir, ownerFilename));
          if (talkingPhotoId) {
            character  = { type: 'talking_photo', talking_photo_id: talkingPhotoId };
            modelLabel = 'HeyGen Talking Photo';
            console.log('[generateTwinClip] Talking photo uploaded:', talkingPhotoId);
          }
        } catch (uploadErr) {
          console.warn('[generateTwinClip] Talking photo upload failed:', uploadErr.message);
        }
      }

      // If no owner photo or both approaches failed — skip avatar fallback, go to mock
      if (!character) {
        console.warn('[generateTwinClip] No owner photo available — using mock');
        throw new Error('Owner photo required for twin video. Please upload a photo on the Assets page.');
      }

      const resp = await heygenPost('/v2/video/generate', {
        video_inputs: [{
          character,
          voice: voiceInput,
          background: { type: 'color', value: '#0a0a14' },
        }],
        aspect_ratio: '9:16',
        test: false,
      });

      const videoId = resp.data?.video_id;
      if (!videoId) throw new Error('No video_id returned');

      const { videoUrl, thumbnailUrl } = await waitForVideo(videoId);
      const filename  = `${jobId}_twin.mp4`;
      const thumbFile = `${jobId}_twin_thumb.jpg`;

      await downloadFile(videoUrl, path.join(OUTPUT_DIR, filename));
      if (thumbnailUrl) await downloadFile(thumbnailUrl, path.join(OUTPUT_DIR, thumbFile)).catch(() => {});

      return {
        filename,
        path:          `/output/${filename}`,
        thumbnailPath: thumbnailUrl ? `/output/${thumbFile}` : null,
        type:          'twin',
        platform:      config.platforms || ['instagram', 'facebook'],
        model:         modelLabel,
        prompt:        script,
      };
    } catch (err) {
      console.error('[generateTwinClip] HeyGen error:', err.message, '— falling back to mock');
    }
  } else {
    console.log('[generateTwinClip] No API key — mock mode');
  }

  const file = await mockImage(config, jobId, 'twin', '👤', 'HeyGen Talking Photo');
  return {
    ...file,
    thumbnailPath: file.path,
    type:     'twin',
    platform: config.platforms || ['instagram', 'facebook'],
    model:    'HeyGen Talking Photo (mock)',
    prompt:   script,
    note:     'Placeholder. Set HEYGEN_API_KEY + upload owner photo for real talking avatar.',
  };
}

async function generateImagePost(config, jobId) {
  // HeyGen is video-only. Image posts are generated as branded assets locally.
  console.log('[generateImagePost] Building branded image posts via Sharp');

  const files = [];
  for (const variant of ['feed', 'story', 'thumbnail']) {
    const prompt = `${config.restaurantName || 'Restaurant'} — ${config.cuisineType || 'Fine Dining'} — ${variant}`;
    const file   = await mockImage(config, jobId, variant, '✦', 'Branded');
    files.push({ ...file, variant, prompt, model: 'Branded Mock' });
  }

  return {
    type:     'image',
    platform: config.platforms || ['instagram'],
    files,
    note:     'Branded image posts (local). Add Flux or DALL-E integration for AI food photography.',
  };
}

module.exports = { generateVideo, generateTwinClip, generateImagePost };
