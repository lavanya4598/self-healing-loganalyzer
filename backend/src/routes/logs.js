const express = require('express');
const multer = require('multer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const store = require('../store');
const logger = require('../logger');
const { aiServiceUrl } = require('../config');
const { broadcastEvent } = require('../websocket');
const { runAnalysis, provisionAnomaliesAndActions } = require('../logPipeline');
const { collectNow } = require('../logCollector');
const { checkNow } = require('../serviceMonitor');
const { checkNow: checkDefunctNow } = require('../defunctProcessMonitor');
const { gatherContext, buildContextText, answerQueryMock } = require('../logQuery');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Cap on raw log lines kept per analysis record (for later natural-language
// querying) so store.json doesn't grow unbounded on very large uploads.
const MAX_STORED_LOG_LINES = 1000;

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
      logs: lines.slice(0, MAX_STORED_LOG_LINES),
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
      logs: logs.slice(0, MAX_STORED_LOG_LINES),
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

// POST /api/logs/query  – ask a natural-language question about previously
// ingested logs/anomalies. Retrieval is a simple keyword-overlap search (no
// vector DB) over stored analyses/anomalies; the top matches are handed to
// the LLM as context only (never as instructions - see AI service prompt).
// An optional `history` (recent Q&A turns from this same chat) lets
// follow-ups like "how can I fix that" resolve against the prior question's
// topic instead of being searched in isolation. Falls back to a plain
// keyword-match summary if the AI service is unavailable, same resilience
// pattern as /analyze.
const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_TEXT_LENGTH = 500;

router.post('/query', authenticate, async (req, res, next) => {
  try {
    const question = (req.body.question || '').trim();
    if (!question) return res.status(400).json({ error: 'question is required' });
    const targetHost = req.body.target_host || undefined;

    const history = Array.isArray(req.body.history)
      ? req.body.history
          .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
          .slice(-MAX_HISTORY_TURNS)
          .map(h => ({ role: h.role, text: h.text.slice(0, MAX_HISTORY_TEXT_LENGTH) }))
      : [];

    // Broaden retrieval with recent user turns too, so a pronoun-only
    // follow-up ("how do I fix that?") still matches the right anomaly.
    const searchText = [...history.filter(h => h.role === 'user').map(h => h.text), question].join(' ');

    const context = gatherContext(searchText, targetHost);
    const contextText = buildContextText(context);

    let answer;
    let mock = false;
    try {
      const { data } = await axios.post(`${aiServiceUrl}/ask`, { question, context: contextText, history }, { timeout: 30000 });
      answer = data.answer;
    } catch (err) {
      const detail = err.response?.data?.error || err.message;
      logger.warn(`AI service unavailable for /logs/query, using keyword fallback: ${detail}`);
      answer = answerQueryMock(question, context);
      mock = true;
    }

    store.audit.push({ event: 'log_query', user: req.user.username, question, timestamp: new Date().toISOString() });

    res.json({
      answer,
      mock,
      matched_anomalies: context.topAnomalies.map(a => ({ id: a.id, title: a.title, severity: a.severity })),
      matched_log_lines: context.topLogs.slice(0, 10).map(l => l.line),
      scanned_analyses: context.scannedAnalyses,
    });
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
