/**
 * Automatic log-collection agent.
 *
 * Periodically SSHes into each configured self-healing target (host1,
 * host2, ...) and pulls recent system logs, then runs them through the
 * exact same analysis -> anomaly -> healing-action pipeline as a manual
 * upload (see logPipeline.js) - so auto-collected issues get the same
 * L1/L2/L3 approval treatment and, once approved, the same agent-driven
 * remediation on the VM they came from.
 *
 * Read-only on the VM side: it only ever runs a fixed, operator-configured
 * "list recent logs" command (LOG_COLLECTION_CMD_<TARGET>, default
 * `journalctl`) - never anything derived from log content or the LLM.
 *
 * OFF by default (LOG_COLLECTION_ENABLED must be "true").
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const store = require('./store');
const { broadcastEvent } = require('./websocket');
const { runOnTarget, listConfiguredTargets } = require('./selfHealing');
const { runAnalysis, provisionAnomaliesAndActions } = require('./logPipeline');

const enabled = String(process.env.LOG_COLLECTION_ENABLED || 'false').toLowerCase() === 'true';
const intervalSeconds = parseInt(process.env.LOG_COLLECTION_INTERVAL_SECONDS, 10) || 60;
const lines = parseInt(process.env.LOG_COLLECTION_LINES, 10) || 200;
const environment = process.env.LOG_COLLECTION_ENVIRONMENT || 'production';

// Per-target dedupe: remember lines we've already ingested so the same
// journal entries aren't re-analyzed (and re-alerted on) every poll.
// Capped so memory doesn't grow unbounded on a long-running process.
const SEEN_CAP = 5000;
const seenByTarget = new Map(); // targetName -> { set: Set<string>, order: string[] }

function seenState(targetName) {
  if (!seenByTarget.has(targetName)) seenByTarget.set(targetName, { set: new Set(), order: [] });
  return seenByTarget.get(targetName);
}

function markSeen(targetName, line) {
  const state = seenState(targetName);
  if (state.set.has(line)) return;
  state.set.add(line);
  state.order.push(line);
  if (state.order.length > SEEN_CAP) {
    const oldest = state.order.shift();
    state.set.delete(oldest);
  }
}

function collectCommand(targetName) {
  const override = process.env[`LOG_COLLECTION_CMD_${targetName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  return override || `journalctl -n ${lines} --no-pager -o short-iso 2>/dev/null || tail -n ${lines} /var/log/messages`;
}

/**
 * Polls a single target: fetches recent logs, filters out ones already
 * seen, and - if there's anything new - runs it through the normal
 * analysis/provisioning pipeline exactly like a manual log upload.
 */
async function pollTarget(targetName) {
  const result = await runOnTarget(collectCommand(targetName), targetName);
  if (!result.success) {
    logger.warn(`Log collection from '${targetName}' failed: ${result.stderr || 'unknown error'}`);
    return { target: targetName, collected: 0, error: result.stderr || 'collection failed' };
  }

  const allLines = result.stdout.split('\n').map(l => l.trim()).filter(Boolean);
  const newLines = allLines.filter(l => !seenState(targetName).set.has(l));
  newLines.forEach(l => markSeen(targetName, l));

  if (newLines.length === 0) {
    return { target: targetName, collected: 0 };
  }

  const batchId = uuidv4();
  const batch = { batch_id: batchId, logs: newLines, source: `agent:${targetName}`, environment };
  const analysis = await runAnalysis(batch);

  const record = {
    id: batchId,
    source: batch.source,
    collectedBy: 'log-collection-agent',
    collectedAt: new Date().toISOString(),
    lineCount: newLines.length,
    environment,
    target_host: targetName,
    analysis,
  };
  store.analyses.set(batchId, record);

  await provisionAnomaliesAndActions(analysis, batchId, targetName);

  store.audit.push({
    event: 'log_collected',
    user: 'log-collection-agent',
    batchId,
    target: targetName,
    lineCount: newLines.length,
    timestamp: new Date().toISOString(),
  });

  broadcastEvent('analysis_complete', record);
  return { target: targetName, collected: newLines.length, anomalies: analysis.anomalies?.length ?? 0 };
}

let running = false;

/** Polls every configured target once, right now. Used by the interval timer and the manual "Collect Now" API. */
async function collectNow() {
  if (running) {
    logger.warn('Log collection already in progress - skipping overlapping run');
    return listConfiguredTargets().map(target => ({ target, collected: 0, skipped: 'collection already in progress' }));
  }
  running = true;
  try {
    const targets = listConfiguredTargets();
    const results = [];
    for (const target of targets) {
      try {
        results.push(await pollTarget(target));
      } catch (err) {
        logger.error(`Log collection error for '${target}': ${err.message}`);
        results.push({ target, collected: 0, error: err.message });
      }
    }
    return results;
  } finally {
    running = false;
  }
}

let timer = null;

function startLogCollector() {
  if (!enabled) {
    logger.info('Log collection agent disabled (LOG_COLLECTION_ENABLED=false)');
    return;
  }
  if (listConfiguredTargets().length === 0) {
    logger.warn('LOG_COLLECTION_ENABLED=true but no self-healing SSH targets are configured - nothing to collect');
    return;
  }
  logger.info(`Log collection agent started - polling every ${intervalSeconds}s: ${listConfiguredTargets().join(', ')}`);
  timer = setInterval(() => {
    collectNow().catch(err => logger.error(`Log collection cycle failed: ${err.message}`));
  }, intervalSeconds * 1000);
  timer.unref?.();
}

function stopLogCollector() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startLogCollector, stopLogCollector, collectNow };
