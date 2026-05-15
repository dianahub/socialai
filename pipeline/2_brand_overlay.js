/**
 * Brand overlay pipeline — adds logo watermark + caption bar to generated images.
 *
 * Logo: bottom-right corner, 15% of image width
 * Caption bar: bottom strip with primary color background, restaurant name in accent color
 * Export at original resolution (caller resizes to 1080x1080 feed or 1080x1920 story)
 */

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

  const primary  = config.primaryColor  || '#c8a84b';
  const bg       = config.bgColor       || '#090910';
  const name     = config.restaurantName || '';

  let image = sharp(filePath);
  const meta = await image.metadata();
  const { width, height } = meta;

  const composites = [];

  // ── Logo (bottom-right, 15% width) ────────────────────────────────────────
  let rawLogoBuffer = null;

  if (config._logoUrl) {
    try {
      const resp = await fetch(config._logoUrl);
      console.log('[brandOverlay] logo fetch status:', resp.status, config._logoUrl.slice(-50));
      if (resp.ok) {
        rawLogoBuffer = Buffer.from(await resp.arrayBuffer());
        console.log('[brandOverlay] logo buffer size:', rawLogoBuffer.length);
      } else {
        console.warn('[brandOverlay] logo fetch non-ok:', resp.status);
      }
    } catch (e) {
      console.warn('[brandOverlay] Logo URL download failed:', e.message);
    }
  } else {
    console.log('[brandOverlay] no logoUrl in config');
  } else {
    const logoDir   = path.join(DATA_DIR, 'assets', 'logo');
    const logoFiles = fs.existsSync(logoDir)
      ? fs.readdirSync(logoDir).filter(f => !f.startsWith('.'))
      : [];
    if (logoFiles.length) {
      try { rawLogoBuffer = fs.readFileSync(path.join(logoDir, logoFiles[0])); }
      catch (e) { console.warn('[brandOverlay] Logo read failed:', e.message); }
    }
  }

  if (rawLogoBuffer) {
    try {
      const logoWidth  = Math.round(width * 0.15);
      const margin     = Math.round(width * 0.02);
      const logoBuffer = await sharp(rawLogoBuffer).resize(logoWidth, null, { fit: 'inside' }).toBuffer();
      const logoMeta   = await sharp(logoBuffer).metadata();
      composites.push({
        input: logoBuffer,
        left: width  - logoWidth       - margin,
        top:  height - logoMeta.height - margin - Math.round(height * 0.1),
      });
    } catch (e) {
      console.warn('[brandOverlay] Logo composite failed:', e.message);
    }
  }

  // ── Caption bar (bottom 10%, primary bg, accent text) ─────────────────────
  const barH = Math.round(height * 0.1);
  const { r, g, b } = hexToRgb(bg);
  const fontSize = Math.max(16, Math.round(barH * 0.38));

  const captionSvg = `<svg width="${width}" height="${barH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${barH}" fill="rgba(${r},${g},${b},0.92)"/>
    <text
      x="${Math.round(width * 0.04)}"
      y="${Math.round(barH * 0.5)}"
      font-family="Georgia, 'Times New Roman', serif"
      font-size="${fontSize}"
      fill="${primary}"
      dominant-baseline="middle"
      font-style="italic"
    >${name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</text>
  </svg>`;

  try {
    composites.push({
      input: Buffer.from(captionSvg),
      left: 0,
      top:  height - barH,
    });
  } catch (e) {
    console.warn('[brandOverlay] Caption SVG failed:', e.message);
  }

  if (!composites.length) return filePath;

  // Write to temp file then replace
  const dir  = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const tmpPath = path.join(dir, `${base}_tmp.jpg`);

  try {
    await sharp(filePath)
      .composite(composites)
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
