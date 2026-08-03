const express = require('express');
const { authenticate } = require('../middleware/auth');
const store = require('../store');

const router = express.Router();

// Keyword patterns to filter anomalies by what actually appears in the
// uploaded log content (title/description/root_cause/log_references).
const KEYWORD_PATTERNS = {
  error: /\berror\b|\bfail(ed|ure)?\b|exception/i,
  timeout: /timeout|timed out|deadline exceeded/i,
  disconnected: /disconnect|econnrefused|connection refused|connection reset|unreachable|connection closed/i,
};

function matchesKeyword(anomaly, keyword) {
  const pattern = KEYWORD_PATTERNS[keyword];
  if (!pattern) return true;
  const text = [anomaly.title, anomaly.description, anomaly.root_cause, ...(anomaly.log_references || [])].join(' ');
  return pattern.test(text);
}

// GET /api/anomalies
router.get('/', authenticate, (req, res) => {
  const { status, severity, batch_id, keyword } = req.query;
  let list = [...store.anomalies.values()];

  if (status) list = list.filter(a => a.status === status);
  if (severity) list = list.filter(a => a.severity === severity);
  if (batch_id) list = list.filter(a => a.batch_id === batch_id);
  if (keyword) list = list.filter(a => matchesKeyword(a, keyword));

  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const withActions = list.map(a => ({ ...a, actions: [...store.actions.values()].filter(act => act.anomaly_id === a.id) }));
  res.json({ data: withActions, total: withActions.length });
});

// GET /api/anomalies/:id
router.get('/:id', authenticate, (req, res) => {
  const anomaly = store.anomalies.get(req.params.id);
  if (!anomaly) return res.status(404).json({ error: 'Anomaly not found' });

  // Attach related actions
  const actions = [...store.actions.values()].filter(a => a.anomaly_id === req.params.id);
  res.json({ ...anomaly, actions });
});

// PATCH /api/anomalies/:id/status
router.patch('/:id/status', authenticate, (req, res) => {
  const anomaly = store.anomalies.get(req.params.id);
  if (!anomaly) return res.status(404).json({ error: 'Anomaly not found' });

  const { status } = req.body;
  const allowed = ['open', 'in_progress', 'resolved', 'dismissed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${allowed.join(', ')}` });
  }

  anomaly.status = status;
  anomaly.updated_at = new Date().toISOString();
  anomaly.updated_by = req.user.username;
  store.anomalies.set(anomaly.id, anomaly);

  store.audit.push({
    event: 'anomaly_status_changed',
    anomaly_id: anomaly.id,
    status,
    user: req.user.username,
    timestamp: new Date().toISOString(),
  });

  res.json(anomaly);
});

module.exports = router;
