const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const store = require('../store');
const logger = require('../logger');
const { broadcastEvent } = require('../websocket');
const { runAnalysis, provisionAnomaliesAndActions } = require('../logPipeline');
const { collectNow } = require('../logCollector');
const { checkNow } = require('../serviceMonitor');
const { checkNow: checkDefunctNow } = require('../defunctProcessMonitor');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/logs/collect  – ask the log-collection agent to poll all
// configured VMs (host1, host2, ...) right now instead of waiting for the
// next scheduled interval. Read-only on the VM side (just pulls recent
// system logs); results flow through the same pipeline as a manual upload.
router.post('/collect', authenticate, async (req, res, next) => {
  try {
    const results = await collectNow();
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// POST /api/logs/check-services  – ask the service monitor to check all
// configured VMs' systemd services right now. Read-only (systemctl
// is-active); any newly-down service raises an approval-gated healing
// action with an LLM-suggested restart command.
router.post('/check-services', authenticate, async (req, res, next) => {
  try {
    const results = await checkNow();
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

// POST /api/logs/check-defunct  – ask the defunct-process monitor to scan
// all configured VMs for zombie ('Z' state) processes right now. Read-only
// (ps -eo pid,ppid,stat,comm); any host with zombies present raises an
// informational, approval-gated action listing the affected PIDs.
router.post('/check-defunct', authenticate, async (req, res, next) => {
  try {
    const results = await checkDefunctNow();
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

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
