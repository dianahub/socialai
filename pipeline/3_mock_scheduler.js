/**
 * Builds a realistic 7-day (Mon–Sun) social media posting schedule from restaurant config.
 * Assigns content types to time slots, rotates across platforms, varies cadence by day.
 */

const PLATFORM_CAPTIONS = {
  instagram: {
    image:  (name, cuisine, tagline, chef) =>
      `Every plate is a canvas. ✨ ${tagline || `Experience the artistry of ${cuisine} at ${name}`}. Link in bio to reserve your table.\n\n#${hashify(name)} #finedining #${hashify(cuisine)} #foodart #gastronomy`,
    video:  (name, cuisine, tagline, chef) =>
      `Step inside ${name}. 🎬 This is ${cuisine} the way it was meant to be experienced. Sound on.\n\n#${hashify(name)} #cinematic #cheflife #finedining #luxurydining`,
    story:  (name, cuisine, tagline, chef) =>
      `Tonight's specials ↑ Swipe to see what ${chef || 'our chef'} has created for you.`,
    twin:   (name, cuisine, tagline, chef) =>
      `A personal welcome from ${chef || 'our chef'}. "Every evening at ${name} is crafted just for you." 🍽️\n\n#${hashify(name)} #chef #hospitality`,
  },
  facebook: {
    image:  (name, cuisine, tagline, chef) =>
      `We believe dining is an experience, not just a meal. Join us at ${name} for an unforgettable evening of ${cuisine}.\n\n${tagline ? `"${tagline}"` : ''}\n\nBook your table: link in bio`,
    video:  (name, cuisine, tagline, chef) =>
      `Take a look inside ${name} — where ${cuisine} meets atmosphere. We'd love to have you join us.`,
    twin:   (name, cuisine, tagline, chef) =>
      `${chef || 'Our executive chef'} has a message for you. Thank you for your continued support of ${name}.`,
  },
  tiktok: {
    video:  (name, cuisine, tagline, chef) =>
      `POV: You just sat down at ${name} 😍 #${hashify(name)} #finedining #chefsoftiktok #foodtok #luxuryfood`,
    image:  (name, cuisine, tagline, chef) =>
      `Rating: 11/10 ⭐ Would eat again. #${hashify(name)} #foodie #finedining #${hashify(cuisine)}`,
  },
  linkedin: {
    image:  (name, cuisine, tagline, chef) =>
      `${name} is proud to announce our new seasonal tasting menu, developed in partnership with local farmers and artisanal producers.\n\nOur commitment to culinary excellence and sustainable sourcing continues.\n\n#hospitality #finedining #sustainability #culinaryarts`,
    twin:   (name, cuisine, tagline, chef) =>
      `Leadership perspective from ${chef || 'our Executive Chef'}: On the philosophy behind ${name}'s approach to ${cuisine} and why provenance matters in every dish.`,
  },
  x: {
    image:  (name, cuisine, tagline, chef) =>
      `${name}: where ${cuisine} becomes poetry. ${tagline ? `"${tagline}"` : ''} 🍽️`,
    video:  (name, cuisine, tagline, chef) =>
      `Watch what happens when culinary art meets passion. This is ${name}. 🎬`,
  },
};

function hashify(str) {
  return (str || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function getCaption(platform, type, name, cuisine, tagline, chef) {
  const platformCaps = PLATFORM_CAPTIONS[platform];
  if (!platformCaps) return `${name} — ${tagline || cuisine}`;
  const fn = platformCaps[type] || platformCaps.image;
  if (!fn) return `${name} — ${tagline || cuisine}`;
  return fn(name, cuisine, tagline, chef);
}

// Post slot templates: [dayOfWeek (0=Mon), hour, platform, type]
const SLOT_TEMPLATES = [
  [0,  8,  'instagram', 'image'],
  [0,  12, 'facebook',  'image'],
  [0,  18, 'instagram', 'story'],
  [1,  10, 'instagram', 'video'],
  [1,  14, 'linkedin',  'image'],
  [2,  8,  'tiktok',    'video'],
  [2,  19, 'instagram', 'image'],
  [3,  12, 'facebook',  'twin'],
  [3,  16, 'instagram', 'twin'],
  [3,  20, 'tiktok',    'image'],
  [4,  9,  'linkedin',  'twin'],
  [4,  17, 'instagram', 'image'],
  [4,  20, 'instagram', 'video'],
  [5,  10, 'instagram', 'image'],
  [5,  14, 'facebook',  'video'],
  [5,  19, 'x',         'image'],
  [6,  11, 'instagram', 'video'],
  [6,  15, 'tiktok',    'video'],
  [6,  18, 'instagram', 'story'],
];

// Status distribution: earlier days already "published", later days "ready" or "generating"
function deriveStatus(dayIndex, hour) {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun…6=Sat
  const currentHour = now.getHours();
  // Convert Sunday-first to Monday-first
  const todayMonday = (dayOfWeek + 6) % 7;

  if (dayIndex < todayMonday) return 'published';
  if (dayIndex === todayMonday && hour < currentHour) return 'published';
  if (dayIndex === todayMonday) return 'ready';
  if (dayIndex <= todayMonday + 1) return 'ready';
  return Math.random() > 0.6 ? 'ready' : 'generating';
}

function buildSchedule(config = {}) {
  const name       = config.restaurantName || 'Restaurant';
  const cuisine    = config.cuisineType    || 'Fine Dining';
  const tagline    = config.tagline        || '';
  const chef       = config.ownerName      || 'Executive Chef';
  const platforms  = config.platforms      || ['instagram', 'facebook', 'tiktok'];

  // Week starting Monday
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7));
  monday.setHours(0, 0, 0, 0);

  // Build day buckets
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return {
      day:       i,
      dayLabel:  date.toLocaleDateString('en-US', { weekday: 'long' }),
      dateLabel: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      date:      date.toISOString(),
      posts:     [],
    };
  });

  // Fill in slots, filtering by active platforms
  let postIdx = 0;
  for (const [dayIdx, hour, platform, type] of SLOT_TEMPLATES) {
    if (!platforms.includes(platform)) continue;

    const date = new Date(monday);
    date.setDate(monday.getDate() + dayIdx);
    date.setHours(hour, 0, 0, 0);

    const caption = getCaption(platform, type, name, cuisine, tagline, chef);

    days[dayIdx].posts.push({
      id:          `post_${dayIdx}_${postIdx++}`,
      platform,
      type,
      hour,
      timeLabel:   `${String(hour).padStart(2, '0')}:00`,
      date:        date.toISOString(),
      caption,
      captionPreview: caption.slice(0, 80) + (caption.length > 80 ? '…' : ''),
      status:      deriveStatus(dayIdx, hour),
    });
  }

  return days;
}

module.exports = { buildSchedule };
