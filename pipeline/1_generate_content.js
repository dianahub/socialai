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
  const brief   = cfg._weeklyBrief   || {};

  let script = `Welcome to ${name}, where ${cuisine} becomes an unforgettable experience. `;
  if (tagline) script += `${tagline}. `;

  if (brief.featuredDish) {
    script += `This week, don't miss our ${brief.featuredDish}. `;
  } else {
    script += `Every dish is crafted with passion, precision, and the finest ingredients. `;
  }
  if (brief.event)     script += `Join us for ${brief.event}. `;
  if (brief.promotion) script += `${brief.promotion}. `;

  script += `We look forward to welcoming you.`;
  return script;
}

function twinScript(cfg) {
  const owner   = cfg.ownerName      || 'our executive chef';
  const name    = cfg.restaurantName || 'our restaurant';
  const usecase = cfg.twinUsecase    || 'welcome message';
  const brief   = cfg._weeklyBrief   || {};

  // If there's a weekly brief with specifics, use those instead of generic scripts
  if (brief.featuredDish || brief.event || brief.promotion) {
    let script = `Hello, I'm ${owner} from ${name}. `;
    if (brief.featuredDish) script += `This week I'm excited about our ${brief.featuredDish}. `;
    if (brief.event)        script += `We have ${brief.event} coming up. `;
    if (brief.promotion)    script += `${brief.promotion}. `;
    if (brief.notes)        script += `${brief.notes}. `;
    script += `I'd love to see you here.`;
    return script;
  }

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
    signal: AbortSignal.timeout(20000),
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
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HeyGen ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Poll until video is complete; returns { videoUrl, thumbnailUrl, captionUrl }
async function waitForVideo(videoId, maxMs = 10 * 60 * 1000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 6000));
    const resp = await heygenGet(`/v1/video_status.get?video_id=${videoId}`);
    const d    = resp.data || {};
    console.log(`[heygen] ${videoId} → ${d.status}`);
    if (d.status === 'completed') return {
      videoUrl:    d.video_url,
      thumbnailUrl: d.thumbnail_url,
      captionUrl:  d.caption_url || d.captionUrl || null,
    };
    if (d.status === 'failed') throw new Error('HeyGen failed: ' + JSON.stringify(d.error || d));
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

// Return the voice ID for an avatar. For Avatar Looks (not in /v2/avatars list),
// falls back to searching /v2/voices by owner name so cloned voices are auto-matched.
async function getAvatarVoiceId(avatarId, ownerName) {
  try {
    const resp    = await heygenGet('/v2/avatars');
    const avatars = resp.data?.avatars || [];
    const avatar  = avatars.find(a => a.avatar_id === avatarId);
    const voiceId = avatar?.default_voice_id || avatar?.voice_id || null;
    if (voiceId) {
      console.log(`[heygen] Avatar ${avatarId} has built-in voice: ${voiceId}`);
      return voiceId;
    }
    // Avatar Look IDs won't appear in /v2/avatars — search cloned voices by owner name
    if (ownerName) {
      const vresp  = await heygenGet('/v2/voices');
      const voices = vresp.data?.voices || [];
      const nameLower = ownerName.toLowerCase();
      // Prefer exact name match, then partial match; skip generic stock names
      const match = voices.find(v => v.name?.toLowerCase() === nameLower)
                 || voices.find(v => v.name?.toLowerCase().includes(nameLower.split(' ')[0].toLowerCase()));
      if (match) {
        console.log(`[heygen] Found cloned voice by owner name "${ownerName}": ${match.name} (${match.voice_id})`);
        return match.voice_id;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function getDefaultVoiceId(preferredVoiceId) {
  try {
    const resp   = await heygenGet('/v2/voices');
    const voices = resp.data?.voices || [];
    if (preferredVoiceId) {
      const match = voices.find(v => v.voice_id === preferredVoiceId);
      if (match) {
        console.log(`[heygen] Using saved voice: ${match.name || match.voice_id} (${match.gender || '?'})`);
        return match.voice_id;
      }
      console.warn(`[heygen] Saved voice ID "${preferredVoiceId}" not found in /v2/voices — falling back`);
    }
    // Prefer English female, then any English
    const en = voices.find(v => v.language?.startsWith('en') && v.gender === 'female')
            || voices.find(v => v.language?.startsWith('en'))
            || voices[0];
    console.log(`[heygen] Fallback voice: ${en?.name || en?.voice_id} (${en?.gender || '?'})`);
    return en?.voice_id || null;
  } catch {
    return null;
  }
}

// Upload owner photo to HeyGen; returns talking_photo_id
async function uploadTalkingPhoto(imagePath) {
  const axios = require('axios');
  const os    = require('os');

  // Resize to 1024px wide max, save to temp file, send as stream
  const meta    = await sharp(imagePath).metadata();
  const tmpPath = path.join(os.tmpdir(), `owner_${Date.now()}.jpg`);
  const needsResize = meta.width < 512 || meta.width > 1024;
  if (needsResize) {
    await sharp(imagePath).resize(1024, null, { fit: 'inside' }).jpeg({ quality: 88 }).toFile(tmpPath);
  } else {
    await sharp(imagePath).jpeg({ quality: 88 }).toFile(tmpPath);
  }
  const stat = fs.statSync(tmpPath);
  console.log('[uploadTalkingPhoto] temp file size:', stat.size, 'original dims:', meta.width, 'x', meta.height);

  const imageBuffer = fs.readFileSync(tmpPath);
  fs.unlink(tmpPath, () => {});

  let resp;
  try {
    resp = await axios.post(`${UPLOAD_BASE}/v1/talking_photo`, imageBuffer, {
      headers: {
        'X-Api-Key':    API_KEY,
        'Content-Type': 'image/jpeg',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000,
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
  console.log('[generateVideo] Building food-photo slideshow');

  const ffmpegStatic = require('ffmpeg-static');
  const ffmpeg       = require('fluent-ffmpeg');
  ffmpeg.setFfmpegPath(ffmpegStatic);

  const os = require('os');

  // ── Gather food photos ───────────────────────────────────────────────────
  const photoUrls = (config._photoUrls || []).slice(0, 6);   // up to 6 slides
  if (!photoUrls.length) {
    console.log('[generateVideo] No food photos — falling back to mock');
    const file = await mockImage(config, jobId, 'video', '▶', 'Slideshow');
    return { ...file, thumbnailPath: file.path, type: 'video',
             platform: config.platforms || ['instagram', 'tiktok'],
             model: 'Slideshow (no photos)', prompt: '' };
  }

  // ── Download + prepare frames at 1920×1080 with logo badge ──────────────
  const tmpDir    = path.join(os.tmpdir(), `slide_${jobId}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Cache logo once
  let logoBuf = null;
  if (config._logoCached !== undefined) {
    logoBuf = config._logoCached;
  } else if (config._logoUrl) {
    try {
      const r = await fetch(config._logoUrl, { signal: AbortSignal.timeout(10000) });
      if (r.ok) logoBuf = Buffer.from(await r.arrayBuffer());
    } catch {}
  }

  const framePaths = [];
  for (let i = 0; i < photoUrls.length; i++) {
    try {
      const url    = cloudinaryTransformUrl(photoUrls[i], 1920, 1080) || photoUrls[i];
      const resp   = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) continue;
      let buf = Buffer.from(await resp.arrayBuffer());

      // Ensure exact 1920×1080
      buf = await sharp(buf).resize(1920, 1080, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toBuffer();

      // Stamp logo badge bottom-right
      if (logoBuf) {
        try {
          const logoH   = Math.round(1080 * 0.14);
          const padding = Math.round(logoH * 0.35);
          const margin  = Math.round(1920 * 0.03);
          const logo    = await sharp(logoBuf).resize(null, logoH, { fit: 'inside' }).toBuffer();
          const lMeta   = await sharp(logo).metadata();
          const boxW    = lMeta.width + padding * 2;
          const boxH    = lMeta.height + padding * 2;
          const { r: br, g: bg, b: bb } = hexToRgb(config.bgColor || '#090910');
          const box     = await sharp({ create: { width: boxW, height: boxH, channels: 4,
                            background: { r: br, g: bg, b: bb, alpha: 0.88 } } }).png().toBuffer();
          buf = await sharp(buf).composite([
            { input: box,  left: 1920 - boxW - margin,           top: 1080 - boxH - margin },
            { input: logo, left: 1920 - boxW - margin + padding, top: 1080 - boxH - margin + padding },
          ]).jpeg({ quality: 90 }).toBuffer();
        } catch {}
      }

      const framePath = path.join(tmpDir, `frame_${String(i).padStart(2,'0')}.jpg`);
      fs.writeFileSync(framePath, buf);
      framePaths.push(framePath);
    } catch (e) {
      console.warn(`[generateVideo] Frame ${i} failed:`, e.message);
    }
  }

  if (!framePaths.length) {
    console.warn('[generateVideo] All frames failed — falling back to mock');
    const file = await mockImage(config, jobId, 'video', '▶', 'Slideshow');
    return { ...file, thumbnailPath: file.path, type: 'video',
             platform: config.platforms || ['instagram', 'tiktok'],
             model: 'Slideshow (frames failed)', prompt: '' };
  }

  // ── Build slideshow with ffmpeg ──────────────────────────────────────────
  const filename   = `${jobId}_video.mp4`;
  const outputPath = path.join(OUTPUT_DIR, filename);
  const thumbFile  = `${jobId}_video_thumb.jpg`;
  const thumbPath  = path.join(OUTPUT_DIR, thumbFile);

  const slideSec   = 4;
  const n          = framePaths.length;
  const videoDurSec = n * slideSec - 0.5 * (n - 1); // total with crossfades

  // Generate background music in parallel with frame prep
  const { generateMusic } = require('../lib/musicGen');
  const musicPath = await generateMusic(config, videoDurSec);

  // Build xfade filter chain: each input scaled + padded, then chained fades
  await new Promise((resolve, reject) => {
    const ffmpegTimeout = setTimeout(() => reject(new Error('ffmpeg timed out after 5 minutes')), 5 * 60 * 1000);
    let cmd = ffmpeg();
    for (const fp of framePaths) {
      cmd = cmd.input(fp).inputOptions(['-loop 1', `-t ${slideSec}`]);
    }

    // Scale every input to exactly 1920x1080 then build xfade chain
    const filterParts = [];
    for (let i = 0; i < n; i++) {
      filterParts.push(`[${i}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1[v${i}]`);
    }

    let prev = '[v0]';
    for (let i = 1; i < n; i++) {
      const offset = i * slideSec - 0.5 * i;
      const out    = i === n - 1 ? '[vout]' : `[x${i}]`;
      filterParts.push(`${prev}[v${i}]xfade=transition=fade:duration=0.5:offset=${offset}${out}`);
      prev = `[x${i}]`;
    }
    if (n === 1) filterParts.push('[v0]copy[vout]');

    const fadeStart = Math.max(0, videoDurSec - 2);

    if (musicPath) {
      // Mix music: loop if shorter than video, fade out last 2s, trim to video length
      cmd.input(musicPath);
      const audioIdx = n; // music is input after all frames
      filterParts.push(
        `[${audioIdx}:a]aloop=loop=-1:size=2e+09,afade=t=out:st=${fadeStart}:d=2,atrim=duration=${videoDurSec}[aout]`
      );
      cmd
        .complexFilter(filterParts.join(';'))
        .outputOptions(['-map [vout]', '-map [aout]', '-c:v libx264', '-c:a aac', '-b:a 192k',
                        '-pix_fmt yuv420p', '-crf 23', '-preset fast', '-movflags +faststart', '-r 25']);
    } else {
      cmd
        .complexFilter(filterParts.join(';'))
        .outputOptions(['-map [vout]', '-c:v libx264', '-pix_fmt yuv420p',
                        '-crf 23', '-preset fast', '-movflags +faststart', '-r 25']);
    }

    cmd
      .output(outputPath)
      .on('start', cmd => console.log('[generateVideo] ffmpeg start:', cmd.slice(0, 120)))
      .on('end',   ()  => { clearTimeout(ffmpegTimeout); resolve(); })
      .on('error', err => { clearTimeout(ffmpegTimeout); reject(err); })
      .run();
  });

  // Cleanup music temp file
  if (musicPath) try { fs.unlinkSync(musicPath); } catch {}

  // Thumbnail = first frame
  fs.copyFileSync(framePaths[0], thumbPath);

  // Cleanup temp frames
  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}

  console.log('[generateVideo] Slideshow complete:', filename);

  return {
    filename,
    path:          `/output/${filename}`,
    thumbnailPath: `/output/${thumbFile}`,
    type:          'video',
    platform:      config.platforms || ['instagram', 'tiktok'],
    model:         'Photo Slideshow',
    prompt:        `${framePaths.length} photos · ${slideSec}s/slide`,
  };
}

async function generateTwinClip(config, jobId, customScript) {
  const script = customScript || twinScript(config);
  console.log('[generateTwinClip] script:', script.slice(0, 80) + '…');

  if (API_KEY) {
    try {
      let character;
      let modelLabel = 'HeyGen Avatar';

      if (!config.heygenAvatarId) {
        throw new Error('No HeyGen avatar ID set. Add your HeyGen Avatar ID in the Assets page to generate twin videos.');
      }

      const uiStyle  = config.heygenAvatarStyle || 'full';
      // HeyGen API accepts: normal, circle, closeUp, full, voiceOnly
      // 'full' records the avatar vertically and fills the 9:16 portrait frame without bars.
      // 'normal' is landscape-shot and gets letterboxed inside the portrait canvas.
      const apiStyle = ['circle','closeUp','full','normal','voiceOnly'].includes(uiStyle) ? uiStyle : 'full';
      character  = { type: 'avatar', avatar_id: config.heygenAvatarId, avatar_style: apiStyle };
      modelLabel = 'HeyGen Video Avatar';
      console.log(`[generateTwinClip] Using avatar ${config.heygenAvatarId} style=${apiStyle} (ui=${uiStyle})`);

      // Use avatar's own cloned voice; for Avatar Looks, match by owner name; then fallback
      const avatarVoiceId = await getAvatarVoiceId(config.heygenAvatarId, config.ownerName);
      const resolvedVoiceId = avatarVoiceId || config.ownerVoiceId || await getDefaultVoiceId(null);
      const voiceInput = { type: 'text', input_text: script, speed: 1.0 };
      if (resolvedVoiceId) voiceInput.voice_id = resolvedVoiceId;
      console.log(`[generateTwinClip] Voice: ${resolvedVoiceId || 'none'} (source: ${avatarVoiceId ? 'avatar' : config.ownerVoiceId ? 'saved' : 'fallback'})`);

      // Background: image/video URL takes priority over default dark color
      let background;
      const bgUrl = (config.twinBackgroundUrl || '').trim();
      if (bgUrl) {
        const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(bgUrl);
        background = { type: isVideo ? 'video' : 'image', url: bgUrl };
      } else {
        background = { type: 'color', value: '#0a0a14' };
      }

      const resp = await heygenPost('/v2/video/generate', {
        video_inputs: [{
          character,
          voice: voiceInput,
          background,
        }],
        dimension:    { width: 1080, height: 1920 },
        aspect_ratio: '9:16',
        caption: true,
        test: false,
      });

      const videoId = resp.data?.video_id;
      if (!videoId) throw new Error('No video_id returned');

      const { videoUrl, thumbnailUrl, captionUrl } = await waitForVideo(videoId);
      const filename  = `${jobId}_twin.mp4`;
      const thumbFile = `${jobId}_twin_thumb.jpg`;
      const outPath   = path.join(OUTPUT_DIR, filename);

      // Burn captions; fall back to plain download if anything fails
      const burned = await burnTwinCaptions(videoUrl, captionUrl, script, outPath);
      if (!burned) await downloadFile(videoUrl, outPath);
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

function cloudinaryTransformUrl(url, w, h) {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  return url.replace('/upload/', `/upload/c_fill,w_${w},h_${h},g_center/`);
}

async function generateImagePost(config, jobId) {
  console.log('[generateImagePost] Building branded image posts via Sharp');

  const dims = {
    feed:      { w: 1080, h: 1080 },
    story:     { w: 1080, h: 1920 },
    thumbnail: { w: 1280, h: 720  },
  };

  const photoUrls = config._photoUrls || [];
  const baseUrl   = photoUrls.length
    ? photoUrls[Math.floor(Math.random() * photoUrls.length)]
    : null;

  if (baseUrl) console.log('[generateImagePost] Using food photo:', baseUrl.slice(-60));

  const files = [];
  for (const variant of ['feed', 'story', 'thumbnail']) {
    const { w, h } = dims[variant];
    const filename   = `${jobId}_${variant}.jpg`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    const prompt     = `${config.restaurantName || 'Restaurant'} — ${config.cuisineType || 'Fine Dining'} — ${variant}`;

    if (baseUrl) {
      try {
        const transformUrl = cloudinaryTransformUrl(baseUrl, w, h);
        const fetchUrl     = transformUrl || baseUrl;
        let imgBuffer      = null;

        if (fetchUrl.startsWith('/')) {
          const localPath = path.join(DATA_DIR, fetchUrl);
          if (fs.existsSync(localPath)) imgBuffer = fs.readFileSync(localPath);
        } else {
          const resp = await fetch(fetchUrl);
          if (resp.ok) imgBuffer = Buffer.from(await resp.arrayBuffer());
        }

        if (imgBuffer) {
          if (transformUrl) {
            fs.writeFileSync(outputPath, imgBuffer);
          } else {
            await sharp(imgBuffer).resize(w, h, { fit: 'cover', position: 'centre' }).jpeg({ quality: 90 }).toFile(outputPath);
          }
          files.push({ filename, path: `/output/${filename}`, width: w, height: h, variant, prompt, model: 'Branded' });
          continue;
        }
      } catch (e) {
        console.warn('[generateImagePost] Variant', variant, 'failed:', e.message);
      }
    }

    // Fall back to SVG mock
    const file = await mockImage(config, jobId, variant, '✦', 'Branded');
    files.push({ ...file, variant, prompt, model: 'Branded Mock' });
  }

  return {
    type:     'image',
    platform: config.platforms || ['instagram'],
    files,
    note: photoUrls.length ? null : 'Upload photos on the Assets page for real images.',
  };
}

// ── Caption burning ───────────────────────────────────────────────────────────

const TWIN_TEMP_DIR = '/tmp/restaurant_twin_videos';

function _findCaptionFfmpeg() {
  const { execFileSync } = require('child_process');

  // Return true if this ffmpeg binary has the drawtext filter compiled in
  function hasDrawtext(bin) {
    try {
      const out = execFileSync(bin, ['-filters'], { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return out.includes('drawtext');
    } catch { return false; }
  }

  const candidates = [];

  // npm bundled binaries
  try { const p = require('ffmpeg-static');                  if (p) candidates.push(p); } catch {}
  try { const p = require('@ffmpeg-installer/ffmpeg').path;  if (p) candidates.push(p); } catch {}

  // Nix profile paths Railway installs ffmpeg to
  candidates.push(
    '/root/.nix-profile/bin/ffmpeg',
    '/nix/var/nix/profiles/default/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  );

  // Also check whatever bash resolves as 'ffmpeg'
  try {
    const p = execFileSync('bash', ['-c', 'which ffmpeg'], { timeout: 5000, encoding: 'utf8' }).trim();
    if (p) candidates.push(p);
  } catch {}

  // Return the first binary that actually has drawtext
  for (const p of candidates) {
    if (p && fs.existsSync(p) && hasDrawtext(p)) {
      console.log(`[twin captions] Using ffmpeg with drawtext: ${p}`);
      return p;
    }
  }

  // Last resort: return first existing binary even without drawtext (will fail gracefully)
  for (const p of candidates) {
    if (p && fs.existsSync(p)) {
      console.warn(`[twin captions] No drawtext-capable ffmpeg found, using ${p} (captions may fail)`);
      return p;
    }
  }

  return null;
}

function _findCaptionFont() {
  // 1. Bundled alongside this file — always available on Railway
  const bundled = path.join(__dirname, 'DejaVuSans.ttf');
  if (fs.existsSync(bundled) && fs.statSync(bundled).size > 100000) return bundled;

  // 2. Standard system paths
  for (const p of [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
  ]) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Nix store (if dejavu_fonts ever gets re-added to nixpacks.toml)
  try {
    const { execFileSync: efs } = require('child_process');
    const out = efs('find', ['/nix/store', '-name', 'DejaVuSans.ttf', '-type', 'f'],
      { timeout: 10000, encoding: 'utf8' });
    const p = out.trim().split('\n')[0];
    if (p && fs.existsSync(p)) return p;
  } catch {}

  return null;
}

function _vttToSrt(vtt) {
  const lines = vtt.trim().split('\n');
  const out   = [];
  let counter = 1;
  let i       = 0;
  while (i < lines.length && !lines[i].match(/\d+:\d+.*-->/)) i++;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.match(/\d+:\d+.*-->/)) {
      let timing = line.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2');
      timing     = timing.replace(/^(\d{2}:\d{2}),(\d{3})/, '00:$1,$2');
      out.push(String(counter), timing);
      counter++;
      i++;
      while (i < lines.length && lines[i].trim()) { out.push(lines[i].trim()); i++; }
      out.push('');
    } else {
      i++;
    }
  }
  return out.join('\n');
}

function _srtTs(secs) {
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`;
}

function _scriptToSrt(script, wordsPerSec = 2.5) {
  const words  = script.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const chunks = [];
  for (let i = 0; i < words.length; i += 6) chunks.push(words.slice(i, i + 6));
  const lines = [];
  let t = 0;
  chunks.forEach((chunk, idx) => {
    const dur = chunk.length / wordsPerSec;
    lines.push(String(idx + 1), `${_srtTs(t)} --> ${_srtTs(t + dur)}`, chunk.join(' '), '');
    t += dur;
  });
  return lines.join('\n');
}

async function _getSrtContent(captionUrl, script) {
  if (captionUrl) {
    try {
      const resp = await fetch(captionUrl, { signal: AbortSignal.timeout(15000) });
      if (resp.ok) {
        const converted = _vttToSrt(await resp.text());
        if (converted.trim()) {
          console.log('[twin captions] Using HeyGen VTT captions');
          return converted;
        }
      }
    } catch (e) {
      console.warn('[twin captions] VTT fetch failed:', e.message);
    }
  }
  console.log('[twin captions] Generating estimated timing from script');
  return _scriptToSrt(script);
}

function _buildDrawtextFilters(srt, capDir, fontFile) {
  const fontPart = fontFile ? `:fontfile=${fontFile}` : '';
  const blocks   = srt.trim().split(/\n\s*\n/);
  const filters  = [];
  for (const block of blocks) {
    const lines     = block.trim().split('\n');
    const timingIdx = lines.findIndex(l => l.includes('-->'));
    if (timingIdx === -1) continue;
    const text = lines.slice(timingIdx + 1).join(' ').trim().slice(0, 80);
    if (!text) continue;
    const m = lines[timingIdx].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const ts = (h, mi, s, ms) => +h * 3600 + +mi * 60 + +s + +ms / 1000;
    const t0 = ts(m[1], m[2], m[3], m[4]);
    const t1 = ts(m[5], m[6], m[7], m[8]);
    // Write cue to file — avoids all ffmpeg text-escaping issues
    const cuePath = path.join(capDir, `cue_${filters.length}.txt`);
    fs.writeFileSync(cuePath, text, 'utf8');
    filters.push(
      `drawtext=textfile='${cuePath}'` +
      `:enable='between(t,${t0.toFixed(3)},${t1.toFixed(3)})'` +
      `:fontsize=28${fontPart}` +
      `:fontcolor=white:x=(w-text_w)/2:y=1002` +
      `:shadowx=2:shadowy=2:shadowcolor=black@0.9`
    );
  }
  return filters.join(',');
}

async function burnTwinCaptions(videoUrl, captionUrl, script, outPath) {
  const ffmpegBin = _findCaptionFfmpeg();
  if (!ffmpegBin) {
    console.log('[twin captions] ffmpeg not found — skipping');
    return false;
  }
  const { spawnSync } = require('child_process');
  fs.mkdirSync(TWIN_TEMP_DIR, { recursive: true });
  const id      = require('crypto').randomUUID();
  const rawPath = path.join(TWIN_TEMP_DIR, `${id}_raw.mp4`);
  const capDir  = path.join(TWIN_TEMP_DIR, `${id}_caps`);
  try {
    fs.mkdirSync(capDir, { recursive: true });
    console.log('[twin captions] Downloading video...');
    await downloadFile(videoUrl, rawPath);
    const rawSize = fs.statSync(rawPath).size;
    console.log(`[twin captions] Raw video size: ${(rawSize / 1024 / 1024).toFixed(2)} MB`);
    if (rawSize < 50000) throw new Error(`Raw video too small (${rawSize} bytes) — HeyGen may have returned empty content`);

    const srt = await _getSrtContent(captionUrl, script);
    if (!srt.trim()) return false;

    const fontFile = _findCaptionFont();
    if (fontFile) console.log(`[twin captions] Font: ${fontFile}`);

    const drawtextFilters = _buildDrawtextFilters(srt, capDir, fontFile);
    if (!drawtextFilters) { console.log('[twin captions] No cues — skipping'); return false; }

    // Detect and remove baked-in black bars from HeyGen output
    let cropFilter = '';
    try {
      const detectResult = spawnSync(ffmpegBin,
        ['-i', rawPath, '-vf', 'cropdetect=24:2:0', '-frames:v', '90', '-f', 'null', '/dev/null'],
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 }
      );
      const detectOut = (detectResult.stderr || Buffer.alloc(0)).toString();
      const cropMatches = [...detectOut.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)];
      if (cropMatches.length) {
        const [cw, ch, cx, cy] = cropMatches[cropMatches.length - 1][1].split(':').map(Number);
        // Crop if any bars detected in width OR height (>= 1% trimmed)
        const rawW = 1080, rawH = 1920;
        if (cw < rawW * 0.99 || ch < rawH * 0.99) {
          cropFilter = `crop=${cw}:${ch}:${cx}:${cy},`;
          console.log(`[twin captions] Cropping bars: ${cw}x${ch} at ${cx},${cy} (original ${rawW}x${rawH})`);
        } else {
          console.log(`[twin captions] No bars detected (crop=${cw}x${ch})`);
        }
      }
    } catch (e) {
      console.warn('[twin captions] cropdetect failed, skipping crop:', e.message);
    }

    const vf = cropFilter + drawtextFilters;
    const cueCount = (drawtextFilters.match(/drawtext=/g) || []).length;
    console.log(`[twin captions] Burning ${cueCount} cues...`);

    const result = spawnSync(ffmpegBin,
      ['-y', '-i', rawPath, '-vf', vf, '-c:v', 'libx264', '-crf', '23', '-c:a', 'copy', '-preset', 'fast', outPath],
      { timeout: 180000, maxBuffer: 50 * 1024 * 1024 }
    );
    const stderr = (result.stderr || Buffer.alloc(0)).toString();
    if (result.status !== 0) {
      console.error('[twin captions] ffmpeg failed:', stderr.slice(-2000));
      return false;
    }
    const outSize = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
    if (outSize < 50000) {
      console.error(`[twin captions] Output too small (${outSize} bytes), stderr:`, stderr.slice(-1000));
      return false;
    }
    console.log(`[twin captions] Captions burned → ${outPath} (${(outSize / 1024 / 1024).toFixed(2)} MB)`);
    return true;
  } catch (e) {
    console.error('[twin captions] Error:', e.message);
    return false;
  } finally {
    try { fs.unlinkSync(rawPath); } catch {}
    try { fs.rmSync(capDir, { recursive: true }); } catch {}
  }
}

module.exports = { generateVideo, generateTwinClip, generateImagePost };
