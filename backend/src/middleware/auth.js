const jwt = require('jsonwebtoken');
const { jwtSecret, approvalRoles } = require('../config');

/**
 * Middleware: verify Bearer JWT and attach user to req.user.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Middleware factory: check that the user's role is allowed to approve
 * actions at the given level.
 */
function requireApprovalRole(level) {
  return (req, res, next) => {
    const allowed = approvalRoles[level] || [];
    // L1 is auto-approved – no role restriction
    if (allowed.length === 0) return next();
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Insufficient privileges. ${level} approval requires role: ${allowed.join(' or ')}`,
      });
    }
    next();
  };
}

module.exports = { authenticate, requireApprovalRole };
