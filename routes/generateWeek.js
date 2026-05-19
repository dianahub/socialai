const { Router } = require('express');
const db = require('../lib/db');
const { PRESETS, getOptimalHour } = require('../lib/schedulingPresets');

const router = Router();

// GET /api/generate-week/presets — return preset list for the frontend
router.get('/presets', (req, res) => {
  res.json(Object.values(PRESETS).map(({ id, label, preview }) => ({ id, label, preview })));
});

// Estimated generation time in seconds per job
const TYPE_EST_SECS = {
  owner_twin_video:    480,
  cinematic_video:     480,
  branded_image_feed:  30,
  branded_image_story: 30,
};

const ALL_TYPES = Object.keys(TYPE_EST_SECS);

// Returns day offsets (from startDate) on which to post
function dayOffsets(frequency, days) {
  const d = Number(days) || 7;
  switch (frequency) {
    case 'daily':          return Array.from({ length: d }, (_, i) => i);
    case 'twice_daily':    return Array.from({ length: d }, (_, i) => i);
    case 'every_other_day':return Array.from({ length: d }, (_, i) => i).filter(i => i % 2 === 0);
    case '3x_week':        return [0, 2, 4].filter(i => i < d);
    case '5x_week':        return [0, 1, 2, 3, 4].filter(i => i < d);
    default:               return [0, 2, 4].filter(i => i < d);
  }
}

// Distribute totalSlots across types according to mix percentages.
// Returns an interleaved array of type strings.
function buildTypeSequence(mix, totalSlots) {
  const validEntries = Object.entries(mix)
    .filter(([t, pct]) => ALL_TYPES.includes(t) && Number(pct) > 0);

  if (!validEntries.length) {
    return Array.from({ length: totalSlots }, (_, i) => ALL_TYPES[i % ALL_TYPES.length]);
  }

  const total = validEntries.reduce((s, [, p]) => s + Number(p), 0);
  const buckets = validEntries.map(([type, pct]) => ({
    type,
    count: Math.round((Number(pct) / total) * totalSlots),
  }));

  // Fix rounding drift
  const assigned = buckets.reduce((s, b) => s + b.count, 0);
  buckets[0].count += totalSlots - assigned;

  // Interleave: pull one from each bucket in round-robin, largest first
  const result = [];
  while (result.length < totalSlots) {
    const active = buckets.filter(b => b.count > 0).sort((a, b) => b.count - a.count);
    if (!active.length) break;
    for (const b of active) {
      if (result.length >= totalSlots) break;
      result.push(b.type);
      b.count--;
    }
  }
  return result;
}

// Shared logic: build the schedule plan without writing to DB
function buildPlan({ startDate, days = 7, postFrequency = '3x_week', contentMix, schedulePreset = 'smart', timezoneOffset = 0 }) {
  const preset = PRESETS[schedulePreset] || PRESETS.smart;
  const mix = contentMix || { owner_twin_video: 40, cinematic_video: 30, branded_image_feed: 20, branded_image_story: 10 };

  let start;
  if (startDate) {
    start = new Date(startDate + 'T00:00:00');
  } else {
    start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
  }

  if (postFrequency === '3x_week' || postFrequency === '5x_week') {
    const dow = start.getDay();
    if (dow !== 1) start.setDate(start.getDate() + (dow === 0 ? 1 : (8 - dow) % 7));
  }

  const isTwiceDaily = postFrequency === 'twice_daily';
  const offsets      = dayOffsets(postFrequency, days);
  const totalSlots   = isTwiceDaily ? offsets.length * 2 : offsets.length;
  const typeSeq      = buildTypeSequence(mix, totalSlots);

  const TYPE_ICON = { owner_twin_video: '👤', cinematic_video: '🎬', branded_image_feed: '🖼', branded_image_story: '📱' };
  const TYPE_LABEL = { owner_twin_video: 'Owner Twin Video', cinematic_video: 'Cinematic Video', branded_image_feed: 'Branded Feed Image', branded_image_story: 'Story Image' };

  let typeIdx = 0;
  let estSecs = 0;
  const posts = [];

  for (const offset of offsets) {
    const slotsThisDay = isTwiceDaily ? 2 : 1;
    for (let slot = 0; slot < slotsThisDay; slot++) {
      const postType = typeSeq[typeIdx++] || 'branded_image_feed';
      const scheduledTime = new Date(start);
      scheduledTime.setDate(start.getDate() + offset);
      let localHour = isTwiceDaily ? (slot === 0 ? 9 : 18) : getOptimalHour(postType, scheduledTime, preset);
      const utcHour = localHour + Math.round(timezoneOffset / 60);
      scheduledTime.setUTCHours(utcHour, 0, 0, 0);
      estSecs += TYPE_EST_SECS[postType] || 60;
      posts.push({ postType, scheduledTime: scheduledTime.toISOString(), icon: TYPE_ICON[postType], label: TYPE_LABEL[postType] });
    }
  }

  return { posts, estimatedMinutes: Math.ceil(estSecs / 60), startDate: start.toISOString() };
}

// POST /api/generate-week/preview — returns planned schedule without creating anything
router.post('/preview', (req, res) => {
  try {
    res.json(buildPlan(req.body));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-week
router.post('/', async (req, res) => {
  try {
    const {
      restaurantId    = 1,
      startDate,
      days            = 7,
      postFrequency   = '3x_week',
      contentMix,
      schedulePreset  = 'smart',
      timezoneOffset  = 0,   // minutes behind UTC sent by browser (e.g. 240 for UTC-4)
      force           = false,
    } = req.body;

    const preset = PRESETS[schedulePreset] || PRESETS.smart;

    const mix = contentMix || {
      owner_twin_video:    40,
      cinematic_video:     30,
      branded_image_feed:  20,
      branded_image_story: 10,
    };

    // Parse start date (default: tomorrow)
    let start;
    if (startDate) {
      start = new Date(startDate + 'T00:00:00');
    } else {
      start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(0, 0, 0, 0);
    }

    // For Mon/Wed/Fri and Mon–Fri modes, snap to nearest upcoming Monday
    // so posts land neatly in one calendar week instead of spanning two
    if (postFrequency === '3x_week' || postFrequency === '5x_week') {
      const dow = start.getDay(); // 0=Sun, 1=Mon … 6=Sat
      if (dow !== 1) {
        const daysUntilMonday = dow === 0 ? 1 : (8 - dow) % 7;
        start.setDate(start.getDate() + daysUntilMonday);
      }
    }

    // Check / clear existing posts in the target window
    const windowEnd = new Date(start);
    windowEnd.setDate(start.getDate() + Number(days));
    const existingPosts = await db.scheduledPost.findMany({
      where: {
        restaurantId:  Number(restaurantId),
        scheduledTime: { gte: start, lt: windowEnd },
      },
      select: { id: true },
    });
    if (existingPosts.length > 0) {
      if (!force) {
        return res.status(409).json({
          error: `${existingPosts.length} post(s) already scheduled in this window. Delete them first or pick a different start date.`,
          existing: existingPosts.length,
        });
      }
      // force=true: delete existing jobs + posts before recreating
      const postIds = existingPosts.map(p => p.id);
      await db.generationJob.deleteMany({ where: { scheduledPostId: { in: postIds } } });
      await db.scheduledPost.deleteMany({ where: { id: { in: postIds } } });
    }

    const isTwiceDaily = postFrequency === 'twice_daily';
    const offsets      = dayOffsets(postFrequency, days);
    const totalSlots   = isTwiceDaily ? offsets.length * 2 : offsets.length;

    const typeSeq  = buildTypeSequence(mix, totalSlots);
    let typeIdx    = 0;
    let tmplIdx    = 0;

    // Load active script templates sorted by lastUsedAt ASC (never used first → true round-robin)
    const templates = await db.scriptTemplate.findMany({
      where:   { restaurantId: Number(restaurantId), isActive: true },
      orderBy: [{ lastUsedAt: 'asc' }, { id: 'asc' }],
    });

    const createdPosts = [];
    const createdJobs  = [];
    let   estSecs      = 0;

    for (const offset of offsets) {
      const slotsThisDay = isTwiceDaily ? 2 : 1;

      for (let slot = 0; slot < slotsThisDay; slot++) {
        const postType = typeSeq[typeIdx++] || 'branded_image_feed';

        // Compute date first so we can inspect the day of week for smart scheduling
        const scheduledTime = new Date(start);
        scheduledTime.setDate(start.getDate() + offset);

        let localHour;
        if (isTwiceDaily) {
          localHour = slot === 0 ? 9 : 18;
        } else {
          localHour = getOptimalHour(postType, scheduledTime, preset);
        }
        // Store as UTC so the user's local time matches the intended optimal hour
        const utcHour = localHour + Math.round(timezoneOffset / 60);
        scheduledTime.setUTCHours(utcHour, 0, 0, 0);

        // Rotate through active script templates for video types
        let scriptTemplateId = null;
        if ((postType === 'owner_twin_video' || postType === 'cinematic_video') && templates.length) {
          scriptTemplateId = templates[tmplIdx % templates.length].id;
          tmplIdx++;
        }

        const post = await db.scheduledPost.create({
          data: {
            restaurantId:    Number(restaurantId),
            postType,
            scheduledTime,
            status:          'draft',
            scriptTemplateId,
          },
        });
        createdPosts.push(post);

        const job = await db.generationJob.create({
          data: {
            restaurantId:    Number(restaurantId),
            jobType:         postType,
            status:          'pending',
            scheduledPostId: post.id,
          },
        });
        createdJobs.push(job);

        estSecs += TYPE_EST_SECS[postType] || 60;
      }
    }

    res.status(201).json({
      scheduledPosts:   createdPosts,
      generationJobs:   createdJobs,
      totalPosts:       createdPosts.length,
      estimatedMinutes: Math.ceil(estSecs / 60),
      message: `Created ${createdPosts.length} posts. Generation queued — check back in ~${Math.ceil(estSecs / 60)} min.`,
    });
  } catch (err) {
    console.error('[generate-week]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
