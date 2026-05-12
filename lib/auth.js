const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

// Auth is enabled only when JWT_SECRET is set in environment
function isAuthEnabled() {
  return !!SECRET;
}

function createToken(restaurantId) {
  return jwt.sign({ restaurantId }, SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, SECRET); } catch { return null; }
}

// Express middleware — validates Bearer token and sets req.restaurantId.
// If auth is disabled (no JWT_SECRET), passes through without checking.
// When auth is enabled, also overrides req.query.restaurantId and
// req.body.restaurantId so downstream route handlers use the verified ID.
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

  req.restaurantId = payload.restaurantId;

  // Override any client-supplied restaurantId values so routes stay scoped
  req.query = { ...req.query, restaurantId: String(payload.restaurantId) };
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body.restaurantId = payload.restaurantId;
  }

  next();
}

module.exports = { isAuthEnabled, createToken, verifyToken, requireAuth };
