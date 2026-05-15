const sharp  = require('sharp');
const path   = require('path');
const fs     = require('fs');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.');

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

async function brandOverlay(filePath, config = {}, variant = 'feed') {
  if (!fs.existsSync(filePath)) {
    console.warn('[brandOverlay] File not found, skipping:', filePath);
    return filePath;
  }

  const bg = config.bgColor || '#090910';
  const { r, g, b } = hexToRgb(bg);

  const meta = await sharp(filePath).metadata();
  const { width, height } = meta;

  // ── Logo — cached across variants so we only download once per job ─────────
  if (config._logoCached === undefined) {
    config._logoCached = null;
    if (config._logoUrl) {
      try {
        const resp = await fetch(config._logoUrl);
        if (resp.ok) {
          config._logoCached = Buffer.from(await resp.arrayBuffer());
          console.log('[brandOverlay] logo downloaded, size:', config._logoCached.length);
        } else {
          console.warn('[brandOverlay] logo fetch non-ok:', resp.status);
        }
      } catch (e) {
        console.warn('[brandOverlay] logo download failed:', e.message);
      }
    }
    if (!config._logoCached) {
      const logoDir   = path.join(DATA_DIR, 'assets', 'logo');
      const logoFiles = fs.existsSync(logoDir)
        ? fs.readdirSync(logoDir).filter(f => !f.startsWith('.'))
        : [];
      if (logoFiles.length) {
        try { config._logoCached = fs.readFileSync(path.join(logoDir, logoFiles[0])); }
        catch (e) { console.warn('[brandOverlay] local logo read failed:', e.message); }
      }
    }
  }

  if (!config._logoCached) {
    console.log('[brandOverlay] no logo available, skipping overlay');
    return filePath;
  }

  // ── Small logo badge in bottom-right corner ───────────────────────────────
  const logoMaxH  = Math.round(height * 0.14);   // 14% of image height
  const padding   = Math.round(logoMaxH * 0.35);
  const margin    = Math.round(width * 0.03);

  const logoBuffer = await sharp(config._logoCached)
    .resize(null, logoMaxH, { fit: 'inside' })
    .toBuffer();
  const lMeta = await sharp(logoBuffer).metadata();

  const boxW = lMeta.width  + padding * 2;
  const boxH = lMeta.height + padding * 2;

  // Dark background box
  const boxBuffer = await sharp({
    create: { width: boxW, height: boxH, channels: 4, background: { r, g, b, alpha: 0.88 } }
  }).png().toBuffer();

  const boxLeft = width  - boxW - margin;
  const boxTop  = height - boxH - margin;

  const dir     = path.dirname(filePath);
  const base    = path.basename(filePath, path.extname(filePath));
  const tmpPath = path.join(dir, `${base}_tmp.jpg`);

  try {
    await sharp(filePath)
      .composite([
        { input: boxBuffer,    left: boxLeft,            top: boxTop },
        { input: logoBuffer,   left: boxLeft + padding,  top: boxTop + padding },
      ])
      .jpeg({ quality: 92 })
      .toFile(tmpPath);

    fs.renameSync(tmpPath, filePath.replace(/\.(png|webp)$/i, '.jpg'));
    console.log('[brandOverlay] Applied to', path.basename(filePath));
  } catch (err) {
    console.error('[brandOverlay] Failed:', err.message);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }

  return filePath;
}

module.exports = { brandOverlay };
