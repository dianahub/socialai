const path = require('path');
const fs   = require('fs');
const db   = require('./db');
const cld  = require('./cloudinary');

function getMondayOfWeek(date = new Date()) {
  const d   = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

const DATA_DIR   = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve('.');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');

// On startup, reset any jobs left stuck in "processing" from a previous server run
async function cleanStuckJobs() {
  try {
    const { count } = await db.generationJob.updateMany({
      where: { status: 'processing' },
      data:  { status: 'failed', errorMessage: 'Server restarted during processing', completedAt: new Date() },
    });
    if (count > 0) console.log(`[queue] Reset ${count} stuck processing job(s) to failed`);
  } catch (e) {
    console.error('[queue] cleanStuckJobs failed:', e.message);
  }
}

let isProcessing = false;

async function processNextJob() {
  if (isProcessing) return;

  const job = await db.generationJob.findFirst({
    where:   { status: 'pending' },
    orderBy: { createdAt: 'asc' },
  }).catch(() => null);
  if (!job) return;

  // Atomically claim — guards against future multi-worker setups
  const { count } = await db.generationJob.updateMany({
    where: { id: job.id, status: 'pending' },
    data:  { status: 'processing' },
  }).catch(() => ({ count: 0 }));
  if (count === 0) return;

  isProcessing = true;
  console.log(`[queue] Job ${job.id} (${job.jobType}) started`);

  try {
    const business = await db.business.findUnique({ where: { id: job.businessId } });
    if (!business) throw new Error('Business not found');

    const weekOf       = getMondayOfWeek();
    const weeklyBrief  = await db.weeklyBrief.findUnique({
      where: { businessId_weekOf: { businessId: job.businessId, weekOf } },
    }).catch(() => null);

    const config = {
      businessName:  business.name,
      cuisineType:   business.cuisineType  || 'Fine Dining',
      primaryColor:  business.brandColorPrimary || '#c8a84b',
      accentColor:   business.brandColorAccent  || '#e5c97a',
      ownerName:     business.ownerName    || null,
      tagline:       business.tagline      || null,
      ownerVoiceId:  business.ownerVoiceId || null,
      voiceTone:     business.voiceTone    || null,
      _weeklyBrief:  weeklyBrief || {},
    };

    // Inject cloud asset URLs
    if (cld.isConfigured()) {
      const needsPhotos = job.jobType === 'cinematic_video' || job.jobType.startsWith('branded_image');

      const fetches = [
        cld.getAssetUrl(`restaurant-social-ai/${job.businessId}/logo`).catch(() => null),
        cld.getAssetUrl(`restaurant-social-ai/${job.businessId}/owner`).catch(() => null),
        needsPhotos ? cld.listFolder(`restaurant-social-ai/${job.businessId}/photos/`).catch(() => []) : Promise.resolve([]),
        // Legacy shared folder only for business 1 — never bleed into other accounts
        (needsPhotos && job.businessId === 1) ? cld.listFolder('restaurant-social-ai/photos/').catch(() => []) : Promise.resolve([]),
      ];

      const [logoUrl, ownerUrl, perBusinessPhotos, sharedPhotos] = await Promise.all(fetches);

      // Logo: per-business path first, then legacy unscoped path only for business 1
      const resolvedLogoUrl = logoUrl
        || business.logoUrl
        || (job.businessId === 1 ? await cld.getAssetUrl('restaurant-social-ai/logo').catch(() => null) : null);
      // Owner: DB portrait URL first, then per-business Cloudinary, then legacy only for business 1
      const resolvedOwnerUrl = business.ownerPortraitUrl
        || ownerUrl
        || (job.businessId === 1 ? await cld.getAssetUrl('restaurant-social-ai/owner').catch(() => null) : null);

      if (resolvedLogoUrl)  config._logoUrl  = resolvedLogoUrl;
      if (resolvedOwnerUrl) config._ownerUrl = resolvedOwnerUrl;
      if (business.heygenAvatarId) config.heygenAvatarId = business.heygenAvatarId;

      if (needsPhotos) {
        const allPhotos = [...perBusinessPhotos, ...sharedPhotos];
        config._photoUrls = allPhotos.map(p => p.url).filter(Boolean);
        console.log(`[queue] Loaded ${config._photoUrls.length} food photo(s) for job ${job.id}`);
      }
    }

    // Load script text — priority: customScript > scriptTemplate > ownerScript
    let scriptText = null;
    if (job.scheduledPostId) {
      const post = await db.scheduledPost.findUnique({
        where:   { id: job.scheduledPostId },
        include: { scriptTemplate: true },
      });
      if (post?.customScript) {
        scriptText = post.customScript;
      } else if (post?.scriptTemplate) {
        scriptText = post.scriptTemplate.scriptText;
        await db.scriptTemplate.update({
          where: { id: post.scriptTemplate.id },
          data:  { lastUsedAt: new Date() },
        }).catch(() => {});
      }
    }
    if (!scriptText && business.ownerScript) {
      scriptText = business.ownerScript;
    }

    const { generateVideo, generateTwinClip, generateImagePost } = require('../pipeline/1_generate_content');
    const { brandOverlay } = require('../pipeline/2_brand_overlay');

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const fileId = `dbj${job.id}_${Date.now()}`;
    let resultUrl = null;

    if (job.jobType === 'owner_twin_video') {
      const result = await generateTwinClip(config, fileId, scriptText);
      resultUrl = result.path;
    } else if (job.jobType === 'cinematic_video') {
      const result = await generateVideo(config, fileId);
      resultUrl = result.path;
    } else if (job.jobType === 'branded_image_feed') {
      const result = await generateImagePost(config, fileId);
      for (const f of (result.files || [])) {
        await brandOverlay(path.join(OUTPUT_DIR, f.filename), config, f.variant).catch(() => {});
      }
      const pick = result.files?.find(f => f.variant === 'feed') || result.files?.[0];
      resultUrl = pick?.path || null;
    } else if (job.jobType === 'branded_image_story') {
      const result = await generateImagePost(config, fileId);
      for (const f of (result.files || [])) {
        await brandOverlay(path.join(OUTPUT_DIR, f.filename), config, f.variant).catch(() => {});
      }
      const pick = result.files?.find(f => f.variant === 'story') || result.files?.[0];
      resultUrl = pick?.path || null;
    }

    await db.generationJob.update({
      where: { id: job.id },
      data:  { status: 'completed', resultUrl, completedAt: new Date() },
    });

    if (job.scheduledPostId && resultUrl) {
      await db.scheduledPost.update({
        where: { id: job.scheduledPostId },
        data:  { contentUrl: resultUrl, status: 'scheduled' },
      }).catch(() => {});
    }

    console.log(`[queue] Job ${job.id} (${job.jobType}) completed → ${resultUrl}`);
  } catch (err) {
    console.error(`[queue] Job ${job.id} failed:`, err.message);
    await db.generationJob.update({
      where: { id: job.id },
      data:  { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    }).catch(() => {});

    if (job.scheduledPostId) {
      await db.scheduledPost.update({
        where: { id: job.scheduledPostId },
        data:  { status: 'failed' },
      }).catch(() => {});
    }
  } finally {
    isProcessing = false;
  }
}

function startWorker() {
  cleanStuckJobs();
  setInterval(processNextJob, 10_000);
  console.log('[queue] Background worker started (10s poll interval)');
}

module.exports = { startWorker };
