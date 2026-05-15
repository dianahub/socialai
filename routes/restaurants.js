const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

// GET /api/db/restaurants
router.get('/', async (req, res) => {
  try {
    if (req.restaurantId !== undefined) {
      const row = await db.restaurant.findUnique({ where: { id: req.restaurantId } });
      return res.json(row ? [row] : []);
    }
    const rows = await db.restaurant.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/restaurants/:id
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (req.restaurantId !== undefined && req.restaurantId !== id)
      return res.status(404).json({ error: 'Not found' });
    const row = await db.restaurant.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/restaurants
router.post('/', async (req, res) => {
  const { name, cuisineType, location, ownerName, tagline, brandColorPrimary, brandColorAccent,
          brandColorBg, platforms, twinStyle, twinUsecase, ownerScript,
          logoUrl, ownerPortraitUrl, instagramAccessToken, instagramUserId,
          autoPublishEnabled } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const row = await db.restaurant.create({
      data: { name, cuisineType, location, ownerName, tagline, brandColorPrimary, brandColorAccent,
              brandColorBg, platforms, twinStyle, twinUsecase, ownerScript,
              logoUrl, ownerPortraitUrl, instagramAccessToken, instagramUserId,
              autoPublishEnabled: Boolean(autoPublishEnabled) },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/restaurants/:id
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (req.restaurantId !== undefined && req.restaurantId !== id)
    return res.status(404).json({ error: 'Not found' });
  const allowed = ['name','cuisineType','location','ownerName','tagline','brandColorPrimary',
                   'brandColorAccent','brandColorBg','platforms','twinStyle','twinUsecase',
                   'ownerScript','logoUrl','ownerPortraitUrl','instagramAccessToken',
                   'instagramUserId','tokenExpiresAt','autoPublishEnabled',
                   'voiceTone','defaultHashtags','includeLocation','ownerVoiceId'];
  const data = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
  try {
    const row = await db.restaurant.update({ where: { id }, data });
    res.json(row);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/db/restaurants/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (req.restaurantId !== undefined && req.restaurantId !== id)
    return res.status(404).json({ error: 'Not found' });
  try {
    await db.restaurant.delete({ where: { id } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
