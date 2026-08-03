const express = require('express');
const { authenticate } = require('../middleware/auth');
const store = require('../store');

const router = express.Router();

// Keyword patterns used to classify anomalies by what actually shows up in the
// logs the user uploaded (not internal system/AI-service events).
const KEYWORD_PATTERNS = {
  error: /\berror\b|\bfail(ed|ure)?\b|exception/i,
  timeout: /timeout|timed out|deadline exceeded/i,
  disconnected: /disconnect|econnrefused|connection refused|connection reset|unreachable|connection closed/i,
};

function anomalyText(a) {
  return [a.title, a.description, a.root_cause, ...(a.log_references || [])].join(' ');
}

function matchesKeyword(anomaly, keyword) {
  const pattern = KEYWORD_PATTERNS[keyword];
  return pattern ? pattern.test(anomalyText(anomaly)) : false;
}

// GET /api/dashboard/stats
router.get('/stats', authenticate, (req, res) => {
  const anomalies = [...store.anomalies.values()];
  const actions = [...store.actions.values()];

  const stats = {
    anomalies: {
      total: anomalies.length,
      open: anomalies.filter(a => a.status === 'open').length,
      in_progress: anomalies.filter(a => a.status === 'in_progress').length,
      resolved: anomalies.filter(a => a.status === 'resolved').length,
      by_severity: {
        critical: anomalies.filter(a => a.severity === 'critical').length,
        high: anomalies.filter(a => a.severity === 'high').length,
        medium: anomalies.filter(a => a.severity === 'medium').length,
        low: anomalies.filter(a => a.severity === 'low').length,
      },
    },
    actions: {
      total: actions.length,
      pending_approval: actions.filter(a => a.status === 'pending_approval').length,
      auto_approved: actions.filter(a => a.status === 'auto_approved').length,
      approved: actions.filter(a => a.status === 'approved').length,
      completed: actions.filter(a => a.status === 'completed').length,
      rejected: actions.filter(a => a.status === 'rejected').length,
      failed: actions.filter(a => a.status === 'failed').length,
      by_level: {
        L1: actions.filter(a => a.approval_level === 'L1').length,
        L2: actions.filter(a => a.approval_level === 'L2').length,
        L3: actions.filter(a => a.approval_level === 'L3').length,
      },
    },
    analyses: {
      total: store.analyses.size,
    },
    log_patterns: {
      errors: anomalies.filter(a => matchesKeyword(a, 'error')).length,
      timeouts: anomalies.filter(a => matchesKeyword(a, 'timeout')).length,
      disconnected: anomalies.filter(a => matchesKeyword(a, 'disconnected')).length,
    },
    recent_audit: store.audit
      .filter(entry => entry.event !== 'ws_connected' && entry.event !== 'ws_disconnected')
      .slice(-20)
      .reverse(),
    generated_at: new Date().toISOString(),
  };

  res.json(stats);
});

// GET /api/dashboard/audit
router.get('/audit', authenticate, (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const events = store.audit.slice(-limit).reverse();
  res.json({ data: events, total: store.audit.length });
});

module.exports = router;
