const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');
const bcrypt  = require('bcryptjs');
const { createToken } = require('../lib/auth');

// GET /api/leads — list all leads
router.get('/', async (req, res) => {
  try {
    const leads = await db.lead.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(leads);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/leads — create a lead
router.post('/', async (req, res) => {
  const { name, email, phone, businessName, businessType, lastContactedAt, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const lead = await db.lead.create({
      data: {
        name,
        email:           email           || null,
        phone:           phone           || null,
        businessName:    businessName    || null,
        businessType:    businessType    || null,
        lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null,
        notes:           notes           || null,
      },
    });
    res.json(lead);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/leads/:id — update a lead
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { name, email, phone, businessName, businessType, lastContactedAt, notes, status } = req.body;
  const data = {};
  if (name            !== undefined) data.name            = name;
  if (email           !== undefined) data.email           = email || null;
  if (phone           !== undefined) data.phone           = phone || null;
  if (businessName    !== undefined) data.businessName    = businessName || null;
  if (businessType    !== undefined) data.businessType    = businessType || null;
  if (lastContactedAt !== undefined) data.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : null;
  if (notes           !== undefined) data.notes           = notes || null;
  if (status          !== undefined) data.status          = status;
  try {
    const lead = await db.lead.update({ where: { id }, data });
    res.json(lead);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/leads/:id — delete a lead
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.lead.delete({ where: { id } });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/leads/:id/convert — convert lead to a business account
router.post('/:id/convert', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const lead = await db.lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (lead.status === 'converted') return res.status(400).json({ error: 'Already converted' });

    // Create the restaurant record
    const restaurant = await db.restaurant.create({
      data: {
        name:         lead.businessName || lead.name,
        loginEmail:   lead.email ? lead.email.toLowerCase() : null,
        businessType: lead.businessType || 'restaurant',
      },
    });

    // Mark lead as converted and link it
    const updated = await db.lead.update({
      where: { id },
      data:  { status: 'converted', restaurantId: restaurant.id },
    });

    // Generate a login token for the new restaurant so the owner can be sent a link
    const token = createToken(restaurant.id);

    res.json({ success: true, lead: updated, restaurant, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
