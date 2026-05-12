const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

const VALID_STATUSES = ['pending', 'processing', 'completed', 'failed'];

// GET /api/db/generation-jobs?restaurantId=&status=
router.get('/', async (req, res) => {
  const { restaurantId, status } = req.query;
  const where = {};
  if (restaurantId) where.restaurantId = Number(restaurantId);
  if (status)       where.status       = status;
  try {
    const rows = await db.generationJob.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/generation-jobs/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.generationJob.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/generation-jobs  — create a new job record
router.post('/', async (req, res) => {
  const { restaurantId, jobType, externalJobId, status = 'pending' } = req.body;
  if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });
  if (!jobType)      return res.status(400).json({ error: 'jobType is required' });
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  try {
    const row = await db.generationJob.create({
      data: { restaurantId: Number(restaurantId), jobType, externalJobId: externalJobId || null, status },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/generation-jobs/:id  — update status / resultUrl
router.patch('/:id', async (req, res) => {
  const { status, resultUrl, externalJobId, errorMessage } = req.body;
  const data = {};
  if (status         !== undefined) {
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    data.status = status;
    if (status === 'completed' || status === 'failed') data.completedAt = new Date();
  }
  if (resultUrl     !== undefined) data.resultUrl     = resultUrl;
  if (externalJobId !== undefined) data.externalJobId = externalJobId;
  if (errorMessage  !== undefined) data.errorMessage  = errorMessage;
  try {
    const row = await db.generationJob.update({ where: { id: Number(req.params.id) }, data });
    res.json(row);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
