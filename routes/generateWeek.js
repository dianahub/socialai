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

const ALL_TYPES = Object.keys(TYPE_HOURS);

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

// POST /api/generate-week
router.post('/', async (req, res) => {
  try {
    const {
      restaurantId   = 1,
      startDate,
      days           = 7,
      postFrequency  = '3x_week',
      contentMix,
      schedulePreset = 'smart',
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

        let hour;
        if (isTwiceDaily) {
          hour = slot === 0 ? 9 : 18;  // AM: 9am (Reels break), PM: 6pm (dinner)
        } else {
          hour = getOptimalHour(postType, scheduledTime, preset);
        }
        scheduledTime.setHours(hour, 0, 0, 0);

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
