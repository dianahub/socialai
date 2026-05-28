const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

// POST /api/db/script-templates/generate-with-ai
// Must be before /:id routes so Express doesn't treat "generate-with-ai" as an id
router.post('/generate-with-ai', async (req, res) => {
  const { topic, details, businessId, restaurantId } = req.body;
  const bizId = businessId || restaurantId; // backward-compat

  let bizName     = 'our business';
  let ownerName   = 'the owner';
  let serviceType = 'business';

  if (bizId) {
    try {
      const r = await db.business.findUnique({ where: { id: Number(bizId) } });
      if (r) {
        bizName     = r.name         || bizName;
        ownerName   = r.ownerName    || ownerName;
        serviceType = r.cuisineType  || r.businessType || serviceType;
      }
    } catch {}
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      script: `Hello, I'm ${ownerName} from ${bizName}. ${details ? `I'm excited to share: ${details}. ` : ''}We pour our heart into every experience here — I'd love to welcome you soon.`,
      note: 'Template script — add ANTHROPIC_API_KEY to enable AI-written scripts.',
    });
  }

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system:     'You write short spoken scripts for business owner digital twin social videos. Output only the spoken words — no stage directions, no labels, no quotes.',
      messages: [{
        role:    'user',
        content: `Write a 15–20 second spoken script (40–55 words) for a business owner video post on Instagram.

Owner: ${ownerName}
Business: ${bizName}
Type: ${serviceType}
Topic: ${topic || 'welcome'}
Details: ${details || 'none'}

Requirements: first person, warm and personal, specific to the business type and topic, end with a natural invitation to visit or follow.`,
      }],
    });
    res.json({ script: msg.content[0].text.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/script-templates?businessId=&isActive=
router.get('/', async (req, res) => {
  const { businessId, isActive } = req.query;
  const where = {};
  if (businessId) where.businessId = Number(businessId);
  if (isActive !== undefined) where.isActive = isActive === 'true';
  try {
    const rows = await db.scriptTemplate.findMany({
      where,
      orderBy: [{ lastUsedAt: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/script-templates/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.scriptTemplate.findUnique({ where: { id: Number(req.params.id) } });
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (req.businessId !== undefined && row.businessId !== req.businessId)
      return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/script-templates
router.post('/', async (req, res) => {
  const { businessId, templateName, topic, scriptText, isActive = true } = req.body;
  if (!businessId)   return res.status(400).json({ error: 'businessId is required' });
  if (!templateName) return res.status(400).json({ error: 'templateName is required' });
  if (!scriptText)   return res.status(400).json({ error: 'scriptText is required' });
  try {
    const row = await db.scriptTemplate.create({
      data: {
        businessId: Number(businessId),
        templateName,
        topic:    topic    || null,
        scriptText,
        isActive: Boolean(isActive),
      },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/script-templates/:id
router.patch('/:id', async (req, res) => {
  const { templateName, topic, scriptText, isActive, lastUsedAt } = req.body;
  const data = {};
  if (templateName !== undefined) data.templateName = templateName;
  if (topic        !== undefined) data.topic        = topic || null;
  if (scriptText   !== undefined) data.scriptText   = scriptText;
  if (isActive     !== undefined) data.isActive     = Boolean(isActive);
  if (lastUsedAt   !== undefined) data.lastUsedAt   = lastUsedAt ? new Date(lastUsedAt) : null;
  try {
    if (req.businessId !== undefined) {
      const existing = await db.scriptTemplate.findUnique({ where: { id: Number(req.params.id) } });
      if (!existing || existing.businessId !== req.businessId)
        return res.status(404).json({ error: 'Not found' });
    }
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
    if (req.businessId !== undefined) {
      const existing = await db.scriptTemplate.findUnique({ where: { id: Number(req.params.id) } });
      if (!existing || existing.businessId !== req.businessId)
        return res.status(404).json({ error: 'Not found' });
    }
    await db.scriptTemplate.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
