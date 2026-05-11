const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

// GET /api/db/food-photos?restaurantId=
router.get('/', async (req, res) => {
  const { restaurantId } = req.query;
  const where = restaurantId ? { restaurantId: Number(restaurantId) } : {};
  try {
    const rows = await db.foodPhoto.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/food-photos
router.post('/', async (req, res) => {
  const { restaurantId, photoUrl, caption } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });
  if (!photoUrl)     return res.status(400).json({ error: 'photoUrl is required' });
  try {
    const row = await db.foodPhoto.create({
      data: { restaurantId: Number(restaurantId), photoUrl, caption: caption || null },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/db/food-photos/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.foodPhoto.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
