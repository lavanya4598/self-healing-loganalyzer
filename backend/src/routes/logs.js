const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { authenticate } = require('../middleware/auth');
const store = require('../store');
const { aiServiceUrl } = require('../config');
const logger = require('../logger');
const { broadcastEvent } = require('../websocket');
const { analyzeLogsMock } = require('../mockAnalyzer');
const { tryAutoHeal } = require('../selfHealing');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * Try the real Python AI service first; if it's unreachable (e.g. not
 * installed/running), fall back to the local rule-based mock analyzer so
 * the app remains fully usable without Python.
 */
async function runAnalysis(batch) {
  try {
    const { data } = await axios.post(`${aiServiceUrl}/analyze`, batch, { timeout: 50000 });
    return data;
  } catch (err) {
    const detail = err.response?.data?.error || err.message;
    logger.warn(`AI service unavailable, using mock analyzer: ${detail}`);
    const reason = /429|quota|rate.?limit/i.test(detail) ? 'rate-limited, please retry shortly' : detail;
    return { ...analyzeLogsMock(batch.logs, reason), batch_id: batch.batch_id };
  }
}

/**
 * Persists anomalies + healing actions for a batch and, for L1 (auto-
 * approved) actions only, attempts self-healing auto-execution immediately
 * (see selfHealing.js). L2/L3 actions always wait for a human approval
 * first - the agent then executes automatically once approved (see
 * routes/approvals.js) rather than being run here pre-approval. Actions
 * that aren't eligible for auto-execution (feature disabled, unconfigured
 * action_type, or a security-sensitive type like rotate_credentials) fall
 * back unchanged to the existing manual approval workflow.
 */
async function provisionAnomaliesAndActions(analysis, batchId, targetHost) {
  for (const anomaly of analysis.anomalies || []) {
    anomaly.batch_id = batchId;
    anomaly.status = 'open';
    anomaly.created_at = new Date().toISOString();
    anomaly.target_host = targetHost;
    store.anomalies.set(anomaly.id, anomaly);

    for (const action of analysis.healing_actions || []) {
      if (action.anomaly_id !== anomaly.id) continue;

      action.id = uuidv4();
      action.batch_id = batchId;
      action.created_at = new Date().toISOString();
      action.target_host = targetHost;

      // Only L1 (auto-approved, low-risk) actions may auto-execute before a
      // human has looked at them. L2/L3 always go through approval first.
      const healResult = action.approval_level === 'L1'
        ? await tryAutoHeal(action.action_type, targetHost)
        : null;

      if (healResult) {
        action.status = healResult.success ? 'completed' : 'failed';
        action.auto_executed = true;
        action.executed_command = healResult.command;
        action.execution_result = { stdout: healResult.stdout, stderr: healResult.stderr, exit_code: healResult.code };
        action.completed_at = new Date().toISOString();
        action.completed_by = 'self-healing-engine';
        store.actions.set(action.id, action);

        anomaly.status = healResult.success ? 'resolved' : 'open';
        store.anomalies.set(anomaly.id, anomaly);

        store.audit.push({
          event: healResult.success ? 'self_healing_executed' : 'self_healing_failed',
          action_id: action.id,
          anomaly_id: anomaly.id,
          command: healResult.command,
          user: 'self-healing-engine',
          timestamp: new Date().toISOString(),
        });

        broadcastEvent(healResult.success ? 'healing_completed' : 'healing_failed', action);
      } else {
        action.status = action.approval_level === 'L1' ? 'auto_approved' : 'pending_approval';
        store.actions.set(action.id, action);
      }
    }
  }
}

// POST /api/logs/upload  – upload a log file
router.post('/upload', authenticate, upload.single('logfile'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const content = req.file.buffer.toString('utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const batchId = uuidv4();

    const batch = {
      batch_id: batchId,
      logs: lines,
      source: req.body.source || req.file.originalname,
      environment: req.body.environment || 'production',
    };
    const targetHost = req.body.target_host || undefined;

    // Kick off analysis in AI service (falls back to mock analyzer if unavailable)
    const analysis = await runAnalysis(batch);

    // Persist analysis
    const record = {
      id: batchId,
      filename: req.file.originalname,
      uploadedBy: req.user.id,
      uploadedAt: new Date().toISOString(),
      lineCount: lines.length,
      source: batch.source,
      environment: batch.environment,
      target_host: targetHost,
      analysis,
    };
    store.analyses.set(batchId, record);

    // Store anomalies + actions, attempting self-healing auto-execution where eligible
    await provisionAnomaliesAndActions(analysis, batchId, targetHost);

    // Audit trail
    store.audit.push({
      event: 'log_uploaded',
      user: req.user.username,
      batchId,
      timestamp: new Date().toISOString(),
    });

    // Notify connected clients via WebSocket
    broadcastEvent('analysis_complete', record);

    res.status(201).json(record);
  } catch (err) {
    logger.error(`Log upload failed: ${err.message}`);
    next(err);
  }
});

// POST /api/logs/ingest  – direct JSON log ingestion
router.post('/ingest', authenticate, async (req, res, next) => {
  try {
    const { logs, source, environment, target_host } = req.body;
    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: 'logs array is required' });
    }

    const batchId = uuidv4();
    const batch = { batch_id: batchId, logs, source: source || 'api', environment: environment || 'production' };
    const analysis = await runAnalysis(batch);

    const record = {
      id: batchId,
      source: source || 'api',
      ingestedBy: req.user.id,
      ingestedAt: new Date().toISOString(),
      lineCount: logs.length,
      environment: batch.environment,
      target_host: target_host || undefined,
      analysis,
    };
    store.analyses.set(batchId, record);

    await provisionAnomaliesAndActions(analysis, batchId, target_host || undefined);

    store.audit.push({ event: 'log_ingested', user: req.user.username, batchId, timestamp: new Date().toISOString() });
    broadcastEvent('analysis_complete', record);

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// GET /api/logs  – list analyses
router.get('/', authenticate, (req, res) => {
  const list = [...store.analyses.values()].sort(
    (a, b) => new Date(b.uploadedAt || b.ingestedAt) - new Date(a.uploadedAt || a.ingestedAt),
  );
  res.json({ data: list, total: list.length });
});

// GET /api/logs/:id
router.get('/:id', authenticate, (req, res) => {
  const record = store.analyses.get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Analysis not found' });
  res.json(record);
});

module.exports = router;
