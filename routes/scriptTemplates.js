const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

// GET /api/db/script-templates?restaurantId=&isActive=
router.get('/', async (req, res) => {
  const { restaurantId, isActive } = req.query;
  const where = {};
  if (restaurantId) where.restaurantId = Number(restaurantId);
  if (isActive !== undefined) where.isActive = isActive === 'true';
  try {
    const rows = await db.scriptTemplate.findMany({ where, orderBy: { templateName: 'asc' } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/script-templates/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.scriptTemplate.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/script-templates
router.post('/', async (req, res) => {
  const { restaurantId, templateName, scriptText, isActive = true } = req.body;
  if (!restaurantId)  return res.status(400).json({ error: 'restaurantId is required' });
  if (!templateName)  return res.status(400).json({ error: 'templateName is required' });
  if (!scriptText)    return res.status(400).json({ error: 'scriptText is required' });
  try {
    const row = await db.scriptTemplate.create({
      data: { restaurantId: Number(restaurantId), templateName, scriptText, isActive: Boolean(isActive) },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/script-templates/:id
router.patch('/:id', async (req, res) => {
  const { templateName, scriptText, isActive } = req.body;
  const data = {};
  if (templateName !== undefined) data.templateName = templateName;
  if (scriptText   !== undefined) data.scriptText   = scriptText;
  if (isActive     !== undefined) data.isActive      = Boolean(isActive);
  try {
    const row = await db.scriptTemplate.update({ where: { id: Number(req.params.id) }, data });
    res.json(row);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/db/script-templates/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.scriptTemplate.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
