const logger = require('../logger');

/**
 * Global error handler — never leaks stack traces in production.
 */
function errorHandler(err, req, res, _next) {
  logger.error({ message: err.message, stack: err.stack, path: req.path });
  const status = err.status || 500;
  const message =
    process.env.NODE_ENV === 'production' && status === 500
      ? 'Internal server error'
      : err.message;
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
