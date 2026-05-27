const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

// Auth is enabled only when JWT_SECRET is set in environment
function isAuthEnabled() {
  return !!SECRET;
}

function createToken(businessId) {
  return jwt.sign({ businessId }, SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Express middleware — validates Bearer token and sets req.businessId.
// If auth is disabled (no JWT_SECRET), passes through without checking.
// When auth is enabled, also overrides req.query.businessId and
// req.body.businessId so downstream route handlers use the verified ID.
function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = verifyToken(header.slice(7));
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // Read both businessId (new) and restaurantId (old tokens) for backward compat
  req.businessId = payload.businessId || payload.restaurantId;

  // Override any client-supplied businessId values so routes stay scoped
  req.query = { ...req.query, businessId: String(req.businessId) };
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body.businessId = req.businessId;
  }

  next();
}

module.exports = { isAuthEnabled, createToken, verifyToken, requireAuth };
