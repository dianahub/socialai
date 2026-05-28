const fs   = require('fs');
const path = require('path');
const os   = require('os');

const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

// Build a music prompt from business config
function buildMusicPrompt(config) {
  const type    = config.cuisineType || config.businessType || 'business';
  const name    = config.businessName || '';
  const tone    = config.voiceTone || 'professional';

  const vibeMap = {
    'fine dining':   'elegant ambient piano, sophisticated, cinematic, no vocals',
    'italian':       'warm acoustic guitar, mediterranean, uplifting, no vocals',
    'japanese':      'calm koto and flute, zen atmosphere, minimal, no vocals',
    'mexican':       'upbeat acoustic guitar, warm, festive but not loud, no vocals',
    'spa':           'soft ambient, relaxing, gentle piano, healing, no vocals',
    'gallery':       'modern ambient, artistic, contemplative, light electronic, no vocals',
    'salon':         'upbeat pop instrumental, trendy, light, energetic, no vocals',
    'bakery':        'cheerful acoustic, warm, cozy, light jazz, no vocals',
    'cafe':          'lo-fi hip hop, chill, relaxed, coffee shop vibe, no vocals',
    'fitness':       'energetic instrumental, motivational, upbeat, no vocals',
    'yoga':          'soft ambient, calming, meditative, no vocals',
  };

  const typeLower = type.toLowerCase();
  const vibe = Object.entries(vibeMap).find(([k]) => typeLower.includes(k))?.[1]
    || 'upbeat professional background music, modern, polished, no vocals';

  return `Background music for ${name} ${type} promotional video. ${vibe}. High quality, broadcast ready.`;
}

async function generateMusic(config, durationSecs) {
  if (!REPLICATE_TOKEN) {
    console.log('[musicGen] No REPLICATE_API_TOKEN — skipping music');
    return null;
  }

  const prompt = buildMusicPrompt(config);
  // MusicGen max is 30s per call; cap at 30, we'll loop in ffmpeg if video is longer
  const duration = Math.min(durationSecs, 30);
  console.log(`[musicGen] Generating ${duration}s track — "${prompt.slice(0, 80)}…"`);

  try {
    // Create prediction — use versioned endpoint (model-level endpoint returns 404)
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${REPLICATE_TOKEN}`,
        'Content-Type':  'application/json',
        'Prefer':        'wait=60',
      },
      body: JSON.stringify({
        version: '671ac645ce5e552cc0f9ed4256a1bd4832abbcea5827bfce92c5b34e27b6a8e6',
        input: {
          prompt,
          duration,
          model_version:     'stereo-large',
          output_format:     'mp3',
          normalization_strategy: 'peak',
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Replicate create failed: ${createRes.status} ${err.slice(0, 200)}`);
    }

    let prediction = await createRes.json();

    // Poll until done (Prefer:wait=60 may already return a completed prediction)
    const maxWait = 5 * 60 * 1000;
    const started = Date.now();
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed') {
      if (Date.now() - started > maxWait) throw new Error('MusicGen timed out');
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
      });
      prediction = await pollRes.json();
      console.log(`[musicGen] ${prediction.id} → ${prediction.status}`);
    }

    if (prediction.status === 'failed') throw new Error(`MusicGen failed: ${prediction.error}`);

    const audioUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!audioUrl) throw new Error('No audio URL in prediction output');

    // Download to temp file
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Download failed: ${audioRes.status}`);
    const buf      = Buffer.from(await audioRes.arrayBuffer());
    const tmpPath  = path.join(os.tmpdir(), `music_${Date.now()}.mp3`);
    fs.writeFileSync(tmpPath, buf);

    console.log(`[musicGen] Track saved: ${tmpPath} (${(buf.length / 1024).toFixed(0)} KB)`);
    return tmpPath;

  } catch (e) {
    console.warn('[musicGen] Failed — video will have no music:', e.message);
    return null;
  }
}

module.exports = { generateMusic };
