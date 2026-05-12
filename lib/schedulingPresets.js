// Research-backed optimal posting times for restaurants on Instagram

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Best days: Wed(3) > Fri(5) > Tue(2) > Mon(1) > Thu(4) > Sat(6) > Sun(0)

// Optimal hour by day of week for each content category
const FEED_HOUR  = { 0: 12, 1: 17, 2: 12, 3: 12, 4: 17, 5: 17, 6: 11 };
const STORY_HOUR = { 0: 9,  1: 9,  2: 9,  3: 9,  4: 9,  5: 9,  6: 9  };
const REEL_HOUR  = { 0: 12, 1: 9,  2: 12, 3: 12, 4: 15, 5: 12, 6: 9  };

// Human-readable optimal windows by DOW (for calendar hints)
const OPTIMAL_WINDOWS = {
  0: ['12pm'],
  1: ['11am – 1pm', '5pm – 7pm'],
  2: ['11am – 1pm', '5pm – 7pm'],
  3: ['11am – 1pm', '5pm – 7pm'],
  4: ['11am – 1pm', '5pm – 7pm'],
  5: ['11am – 1pm', '5pm – 7pm'],
  6: ['10am – 12pm'],
};

const VIDEO_TYPES = new Set(['owner_twin_video', 'cinematic_video']);
const STORY_TYPES = new Set(['branded_image_story']);

function getOptimalHour(postType, date, preset = null) {
  if (preset?.fixedHour !== undefined) return preset.fixedHour;
  const dow = new Date(date).getDay();
  if (preset?.hourByDow?.[dow] !== undefined) return preset.hourByDow[dow];
  if (STORY_TYPES.has(postType)) return STORY_HOUR[dow] ?? 9;
  if (VIDEO_TYPES.has(postType)) return REEL_HOUR[dow]  ?? 12;
  return FEED_HOUR[dow] ?? 17;
}

const PRESETS = {
  smart: {
    id:      'smart',
    label:   'Smart (day-aware)',
    preview: 'Best time chosen per day of week — Wed 12pm, Fri 5pm, etc.',
  },
  optimal_3x: {
    id:        'optimal_3x',
    label:     '3× Week Optimal',
    preview:   'Mon 5pm · Wed 12pm · Fri 5pm',
    hourByDow: { 1: 17, 3: 12, 5: 17 },
  },
  lunch: {
    id:        'lunch',
    label:     'Daily Lunch Push',
    preview:   'Every day at 11am',
    fixedHour: 11,
  },
  evening: {
    id:        'evening',
    label:     'Evening Engagement',
    preview:   'Every day at 6pm',
    fixedHour: 18,
  },
  mixed: {
    id:        'mixed',
    label:     'Mixed Schedule',
    preview:   'Mon/Wed/Fri 12pm · Tue/Thu 6pm',
    hourByDow: { 1: 12, 2: 18, 3: 12, 4: 18, 5: 12 },
  },
};

module.exports = { PRESETS, getOptimalHour, OPTIMAL_WINDOWS, DOW_NAMES };
