require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { PrismaLibSql }  = require('@prisma/adapter-libsql');
const { PrismaClient }  = require('../lib/generated/prisma');

const url     = process.env.DATABASE_URL || 'file:./data/restaurant.db';
const adapter = new PrismaLibSql({ url });
const db      = new PrismaClient({ adapter });

async function main() {
  // ── Business ──────────────────────────────────────────────────────────────
  const restaurant = await db.business.upsert({
    where: { id: 1 },
    update: {},
    create: {
      name:                'Osteria della Luna',
      cuisineType:         'Modern Italian',
      location:            'San Francisco, CA',
      brandColorPrimary:   '#1a1209',
      brandColorAccent:    '#c8a84b',
      logoUrl:             'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/logo',
      ownerPortraitUrl:    'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/owner',
      instagramUserId:     null,
      instagramAccessToken: null,
      autoPublishEnabled:  false,
    },
  });

  console.log(`Restaurant: ${restaurant.name} (id=${restaurant.id})`);

  // ── Food photos ─────────────────────────────────────────────────────────────
  const photoData = [
    { photoUrl: 'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/photos/photo_truffle_pasta', caption: 'House-made tagliatelle with black truffle and aged Parmigiano' },
    { photoUrl: 'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/photos/photo_branzino',      caption: 'Pan-seared branzino with saffron beurre blanc and microgreens' },
    { photoUrl: 'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/photos/photo_tiramisu',      caption: 'Deconstructed tiramisu with espresso granita and mascarpone foam' },
    { photoUrl: 'https://res.cloudinary.com/dlbqagijb/image/upload/restaurant-social-ai/photos/photo_dining_room',   caption: 'Our candlelit dining room — intimate, warm, and always welcoming' },
  ];

  for (const photo of photoData) {
    await db.foodPhoto.create({ data: { businessId: restaurant.id, ...photo } });
  }
  console.log(`Seeded ${photoData.length} food photos`);

  // ── Script templates ─────────────────────────────────────────────────────────
  const templates = [
    {
      templateName: 'welcome',
      scriptText:   "Good evening. I'm Marco, the chef and owner of Osteria della Luna. Every night we pour our whole heart into this kitchen — because for us, cooking is love made visible. Come join us for an evening you won't forget.",
      isActive:     true,
    },
    {
      templateName: 'weekend_promo',
      scriptText:   "This weekend only, we're featuring our truffle tasting menu — five courses paired with exceptional Barolo. Only twelve seats available. Reserve your table tonight through the link in bio.",
      isActive:     true,
    },
    {
      templateName: 'special_announcement',
      scriptText:   "I'm thrilled to share that Osteria della Luna has been named one of San Francisco's top ten restaurants for the third year running. None of this is possible without you. Thank you for making our table your table.",
      isActive:     true,
    },
    {
      templateName: 'seasonal_menu',
      scriptText:   "Spring has arrived, and so has our new seasonal menu. Morel mushrooms from Sonoma, spot prawns from the bay, and the first strawberries of the season. Nature sets the menu — we just cook it with love.",
      isActive:     true,
    },
    {
      templateName: 'behind_the_scenes',
      scriptText:   "5 AM in the kitchen — this is where the magic begins. Pasta dough stretching, stocks simmering, the smell of fresh bread. By the time you arrive tonight, twelve hours of preparation will be waiting on your plate.",
      isActive:     false,
    },
  ];

  const createdTemplates = [];
  for (const t of templates) {
    const tmpl = await db.scriptTemplate.create({ data: { businessId: restaurant.id, ...t } });
    createdTemplates.push(tmpl);
  }
  console.log(`Seeded ${createdTemplates.length} script templates`);

  // ── Scheduled posts (next 7 days) ──────────────────────────────────────────
  const now   = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  function slot(daysOffset, hour) {
    const d = new Date(today);
    d.setDate(today.getDate() + daysOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  }

  const welcomeTemplate  = createdTemplates.find(t => t.templateName === 'welcome');
  const weekendTemplate  = createdTemplates.find(t => t.templateName === 'weekend_promo');
  const seasonalTemplate = createdTemplates.find(t => t.templateName === 'seasonal_menu');

  const posts = [
    // Today
    {
      postType:        'branded_image_feed',
      contentUrl:      null,
      caption:         'Every plate is a canvas. ✨ Experience the artistry of Modern Italian at Osteria della Luna. Link in bio to reserve your table.\n\n#OsteriaDellaLuna #finedining #ModernItalian #foodart #gastronomy',
      scheduledTime:   slot(0, 8),
      status:          now.getHours() >= 8 ? 'published' : 'scheduled',
      scriptTemplateId: null,
    },
    {
      postType:        'owner_twin_video',
      contentUrl:      null,
      caption:         'A personal welcome from Chef Marco. "Every evening at Osteria della Luna is crafted just for you." 🍽️\n\n#OsteriaDellaLuna #chef #hospitality',
      scheduledTime:   slot(0, 18),
      status:          now.getHours() >= 18 ? 'published' : 'scheduled',
      scriptTemplateId: welcomeTemplate?.id ?? null,
    },
    // Day +1
    {
      postType:        'cinematic_video',
      contentUrl:      null,
      caption:         'Step inside Osteria della Luna. 🎬 This is Modern Italian the way it was meant to be experienced. Sound on.\n\n#OsteriaDellaLuna #cinematic #cheflife #finedining',
      scheduledTime:   slot(1, 10),
      status:          'scheduled',
      scriptTemplateId: null,
    },
    {
      postType:        'branded_image_story',
      contentUrl:      null,
      caption:         "Tonight's specials ↑ Swipe to see what Chef Marco has created for you.",
      scheduledTime:   slot(1, 19),
      status:          'draft',
      scriptTemplateId: null,
    },
    // Day +2
    {
      postType:        'branded_image_feed',
      contentUrl:      null,
      caption:         'Truffle season is here. Our house-made tagliatelle with black truffle is back on the menu for a limited time. Book now — link in bio. 🍝\n\n#truffle #pasta #finedining #OsteriaDellaLuna',
      scheduledTime:   slot(2, 12),
      status:          'draft',
      scriptTemplateId: null,
    },
    {
      postType:        'owner_twin_video',
      contentUrl:      null,
      caption:         'Spring has arrived at Osteria della Luna. Morel mushrooms, spot prawns, and the first strawberries of the season. Come taste the new menu. 🌱\n\n#seasonal #OsteriaDellaLuna #farmtotable',
      scheduledTime:   slot(2, 18),
      status:          'draft',
      scriptTemplateId: seasonalTemplate?.id ?? null,
    },
    // Day +3 (weekend promo)
    {
      postType:        'owner_twin_video',
      contentUrl:      null,
      caption:         'This weekend only: our truffle tasting menu paired with exceptional Barolo. Only 12 seats. Reserve now — link in bio. 🍷\n\n#tastingmenu #Barolo #OsteriaDellaLuna #weekendspecial',
      scheduledTime:   slot(3, 14),
      status:          'draft',
      scriptTemplateId: weekendTemplate?.id ?? null,
    },
    {
      postType:        'branded_image_feed',
      contentUrl:      null,
      caption:         'Saturday night at Osteria della Luna. Where fine Italian cuisine meets warm San Francisco hospitality. ✨\n\n#Saturday #OsteriaDellaLuna #SF #finedining',
      scheduledTime:   slot(3, 19),
      status:          'draft',
      scriptTemplateId: null,
    },
    // Day +4 (Sunday)
    {
      postType:        'cinematic_video',
      contentUrl:      null,
      caption:         'Sunday at Osteria della Luna. Slower pace, longer tables, deeper conversations. Join us for Sunday brunch. Link in bio 🌅\n\n#SundayBrunch #OsteriaDellaLuna #Italian',
      scheduledTime:   slot(4, 11),
      status:          'draft',
      scriptTemplateId: null,
    },
    {
      postType:        'branded_image_story',
      contentUrl:      null,
      caption:         'New week, new menu highlights. Swipe up to see what we have in store ↑',
      scheduledTime:   slot(4, 18),
      status:          'draft',
      scriptTemplateId: null,
    },
  ];

  for (const p of posts) {
    await db.scheduledPost.create({ data: { businessId: restaurant.id, ...p } });
  }
  console.log(`Seeded ${posts.length} scheduled posts`);

  // ── Generation jobs ──────────────────────────────────────────────────────────
  const jobs = [
    { jobType: 'owner_twin_video',    externalJobId: 'heygen_abc123', status: 'completed', resultUrl: null },
    { jobType: 'cinematic_video',     externalJobId: 'heygen_def456', status: 'completed', resultUrl: null },
    { jobType: 'branded_image_feed',  externalJobId: null,            status: 'completed', resultUrl: null },
    { jobType: 'branded_image_story', externalJobId: null,            status: 'pending',   resultUrl: null },
  ];

  for (const j of jobs) {
    await db.generationJob.create({
      data: {
        businessId:    restaurant.id,
        completedAt:   j.status === 'completed' ? new Date() : null,
        ...j,
      },
    });
  }
  console.log(`Seeded ${jobs.length} generation jobs`);

  console.log('\nSeed complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
