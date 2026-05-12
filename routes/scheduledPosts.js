const { Router } = require('express');
const db = require('../lib/db');

const router = Router();

const VALID_TYPES    = ['owner_twin_video', 'cinematic_video', 'branded_image_feed', 'branded_image_story'];
const VALID_STATUSES = ['draft', 'scheduled', 'published', 'failed'];

// GET /api/db/scheduled-posts?restaurantId=&status=&from=&to=
router.get('/', async (req, res) => {
  const { restaurantId, status, from, to } = req.query;
  const where = {};
  if (restaurantId) where.restaurantId = Number(restaurantId);
  if (status)       where.status       = status;
  if (from || to) {
    where.scheduledTime = {};
    if (from) where.scheduledTime.gte = new Date(from);
    if (to)   where.scheduledTime.lte = new Date(to);
  }
  try {
    const rows = await db.scheduledPost.findMany({
      where,
      orderBy:  { scheduledTime: 'asc' },
      include:  { scriptTemplate: { select: { id: true, templateName: true } } },
    });
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/scheduled-posts/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await db.scheduledPost.findUnique({
      where:   { id: Number(req.params.id) },
      include: { scriptTemplate: true },
    });
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/scheduled-posts
router.post('/', async (req, res) => {
  const { restaurantId, postType, contentUrl, caption, scheduledTime,
          status = 'draft', scriptTemplateId } = req.body;

  if (!restaurantId)   return res.status(400).json({ error: 'restaurantId is required' });
  if (!postType)       return res.status(400).json({ error: 'postType is required' });
  if (!scheduledTime)  return res.status(400).json({ error: 'scheduledTime is required' });
  if (!VALID_TYPES.includes(postType))
    return res.status(400).json({ error: `postType must be one of: ${VALID_TYPES.join(', ')}` });
  if (!VALID_STATUSES.includes(status))
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });

  try {
    const row = await db.scheduledPost.create({
      data: {
        restaurantId:    Number(restaurantId),
        postType,
        contentUrl:      contentUrl || null,
        caption:         caption    || null,
        scheduledTime:   new Date(scheduledTime),
        status,
        scriptTemplateId: scriptTemplateId ? Number(scriptTemplateId) : null,
      },
    });
    res.status(201).json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/scheduled-posts/:id
router.patch('/:id', async (req, res) => {
  const { postType, contentUrl, caption, scheduledTime, status, instagramPostId, scriptTemplateId } = req.body;
  const data = {};
  if (postType       !== undefined) data.postType        = postType;
  if (contentUrl     !== undefined) data.contentUrl      = contentUrl;
  if (caption        !== undefined) data.caption         = caption;
  if (scheduledTime  !== undefined) data.scheduledTime   = new Date(scheduledTime);
  if (status         !== undefined) {
    if (!VALID_STATUSES.includes(status))
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    data.status = status;
    if (status === 'published' && !req.body.publishedAt) data.publishedAt = new Date();
  }
  if (instagramPostId !== undefined) data.instagramPostId = instagramPostId;
  if (scriptTemplateId !== undefined) data.scriptTemplateId = scriptTemplateId ? Number(scriptTemplateId) : null;

  try {
    const row = await db.scheduledPost.update({ where: { id: Number(req.params.id) }, data });
    res.json(row);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/db/scheduled-posts/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.scheduledPost.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true });
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/db/scheduled-posts/:id/post-now — publish immediately, bypassing schedule
router.post('/:id/post-now', async (req, res) => {
  const postId = Number(req.params.id);
  try {
    const post = await db.scheduledPost.findUnique({ where: { id: postId } });
    if (!post)           return res.status(404).json({ error: 'Not found' });
    if (!post.contentUrl) return res.status(400).json({ error: 'No content URL on this post — attach media first' });

    res.json({ success: true, message: 'Publishing to Instagram in background…' });

    const { publishPost } = require('../lib/autopublish');
    publishPost(postId).catch(err =>
      console.error(`[post-now] Post ${postId} failed: ${err.message}`)
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
