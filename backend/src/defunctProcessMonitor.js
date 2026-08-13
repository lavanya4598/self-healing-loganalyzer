/**
 * Defunct (zombie) process monitor.
 *
 * Periodically checks each SSH target for processes in the 'Z' (zombie)
 * state (read-only: `ps -eo pid,ppid,stat,comm`). Zombie processes have
 * already exited but their parent hasn't reaped them yet - usually
 * harmless in small numbers, but a growing count indicates a buggy parent
 * process leaking process-table entries. Since the actual fix depends on
 * which parent process is at fault (varies every time - PIDs aren't
 * stable across checks), there's no safe generic auto-remediation: this
 * only detects and reports, raising an approval-gated action listing the
 * current zombies so a human can decide (e.g. restart/signal the parent).
 *
 * `action_type` is always forced to `zombie_process` here (never trusted
 * from the LLM/mock output), consistent with serviceMonitor.js.
 *
 * OFF by default (DEFUNCT_MONITORING_ENABLED must be "true").
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const store = require('./store');
const { broadcastEvent } = require('./websocket');
const { runOnTarget, listConfiguredTargets } = require('./selfHealing');
const { runAnalysis, provisionAnomaliesAndActions } = require('./logPipeline');

const enabled = String(process.env.DEFUNCT_MONITORING_ENABLED || 'false').toLowerCase() === 'true';
const intervalSeconds = parseInt(process.env.DEFUNCT_MONITOR_INTERVAL_SECONDS, 10) || 60;
const environment = process.env.LOG_COLLECTION_ENVIRONMENT || 'production';

// Read-only: list pid/ppid/comm for every process currently in zombie state.
const CHECK_COMMAND = "ps -eo pid,ppid,stat,comm --no-headers | awk '$3 ~ /Z/ {printf \"%s:%s:%s\\n\", $1, $2, $4}'";

async function getZombies(targetName) {
  const result = await runOnTarget(CHECK_COMMAND, targetName);
  if (!result.stdout) return [];
  return result.stdout.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [pid, ppid, comm] = line.split(':');
    return { pid, ppid, comm: comm || 'unknown' };
  });
}

// target -> { anomalyId, actionIds }, tracked while zombies remain present
// on that host so a recovery can be detected and the same outage isn't
// re-raised as a new anomaly on every poll. Tracked per-host rather than
// per-PID since zombie PIDs are never the same from one check to the next.
const zombieState = new Map();

async function raiseZombieAction(targetName, zombies) {
  const batchId = uuidv4();
  const listing = zombies.map(z => `pid ${z.pid} (ppid ${z.ppid}, ${z.comm})`).join(', ');
  const logLine = `CRITICAL DefunctProcessMonitor: ${zombies.length} zombie process(es) found on ${targetName} - ${listing}`;
  const batch = { batch_id: batchId, logs: [logLine], source: `defunct-monitor:${targetName}`, environment };
  const analysis = await runAnalysis(batch);

  if (!analysis.anomalies?.length) {
    analysis.anomalies = [{ id: uuidv4(), severity: 'medium', affected_components: ['process-table'], log_references: [logLine], confidence: 1 }];
    analysis.healing_actions = [{ anomaly_id: analysis.anomalies[0].id, risk_level: 'low' }];
  }

  // Title/description/approval level/action_type are ALWAYS enforced here,
  // never trusted from the LLM/mock response (which analyses a synthetic,
  // generic log line and can't know the real zombie PIDs) - see module doc
  // comment.
  const anomaly = analysis.anomalies[0];
  anomaly.title = `Defunct (zombie) processes on ${targetName}`;
  anomaly.description = `${zombies.length} process(es) in zombie state: ${listing}.`;
  anomaly.root_cause = 'Parent process has not reaped one or more exited child processes.';

  for (const action of analysis.healing_actions || []) {
    action.action_type = 'zombie_process';
    action.title = `Investigate zombie processes on ${targetName}`;
    action.description = 'No safe automatic fix - review the listed parent processes and decide whether to restart/signal them.';
    action.approval_level = 'L1';
    action.approval_reason = "Informational - reporting only, review manually before acting";
    action.commands = ["ps -eo pid,ppid,stat,comm | awk '$3 ~ /Z/'"];
  }

  const record = {
    id: batchId,
    source: batch.source,
    collectedBy: 'defunct-monitor-agent',
    collectedAt: new Date().toISOString(),
    lineCount: 1,
    environment,
    target_host: targetName,
    analysis,
  };
  store.analyses.set(batchId, record);
  await provisionAnomaliesAndActions(analysis, batchId, targetName);

  store.audit.push({
    event: 'defunct_processes_detected',
    user: 'defunct-monitor-agent',
    batchId,
    target: targetName,
    count: zombies.length,
    zombies,
    timestamp: new Date().toISOString(),
  });
  broadcastEvent('analysis_complete', record);

  return {
    anomalyId: analysis.anomalies[0].id,
    actionIds: (analysis.healing_actions || []).map(a => a.id).filter(Boolean),
  };
}

/** Marks the tracked anomaly/actions for a cleared host as resolved/completed. */
function resolveZombieRecovery(targetName, tracked) {
  const anomaly = store.anomalies.get(tracked.anomalyId);
  if (anomaly) {
    anomaly.status = 'resolved';
    store.anomalies.set(anomaly.id, anomaly);
  }
  for (const actionId of tracked.actionIds) {
    const action = store.actions.get(actionId);
    if (!action || ['completed', 'failed', 'rejected'].includes(action.status)) continue;
    action.status = 'completed';
    action.completed_at = new Date().toISOString();
    action.completed_by = 'defunct-monitor-agent';
    action.execution_result = { stdout: `No zombie processes remain on ${targetName} - auto-detected recovery.`, stderr: '', exit_code: 0 };
    store.actions.set(action.id, action);
    broadcastEvent('healing_completed', action);
  }
  store.audit.push({
    event: 'defunct_processes_cleared',
    user: 'defunct-monitor-agent',
    target: targetName,
    timestamp: new Date().toISOString(),
  });
}

async function checkTarget(targetName) {
  const zombies = await getZombies(targetName);
  const tracked = zombieState.get(targetName);
  // Only still "handled" if at least one tracked action is still open
  // (pending/approved) - if a human already closed all of them out while
  // zombies are still present, treat it as untracked so a fresh actionable
  // alert gets raised instead of silently reporting "already known".
  const stillOpen = tracked?.actionIds?.some(id => {
    const action = store.actions.get(id);
    return action && !['completed', 'failed', 'rejected'].includes(action.status);
  });

  if (zombies.length > 0 && (!zombieState.has(targetName) || !stillOpen)) {
    try {
      const raised = await raiseZombieAction(targetName, zombies);
      zombieState.set(targetName, raised);
      return { target: targetName, count: zombies.length, zombies, raised: true };
    } catch (err) {
      logger.error(`Defunct process monitor failed to raise action for '${targetName}': ${err.message}`);
      return { target: targetName, count: zombies.length, zombies, error: err.message };
    }
  }
  if (zombies.length === 0 && zombieState.has(targetName)) {
    resolveZombieRecovery(targetName, zombieState.get(targetName));
    zombieState.delete(targetName);
    return { target: targetName, count: 0, recovered: true };
  }
  return { target: targetName, count: zombies.length, zombies };
}

let running = false;

async function checkNow() {
  if (running) {
    logger.warn('Defunct process check already in progress - skipping overlapping run');
    return listConfiguredTargets().map(target => ({ target, count: 0, skipped: 'check already in progress' }));
  }
  running = true;
  try {
    const results = [];
    for (const target of listConfiguredTargets()) {
      try {
        results.push(await checkTarget(target));
      } catch (err) {
        logger.error(`Defunct process check error for '${target}': ${err.message}`);
        results.push({ target, count: 0, error: err.message });
      }
    }
    return results;
  } finally {
    running = false;
  }
}

let timer = null;

function startDefunctProcessMonitor() {
  if (!enabled) {
    logger.info('Defunct process monitoring disabled (DEFUNCT_MONITORING_ENABLED=false)');
    return;
  }
  if (!listConfiguredTargets().length) {
    logger.warn('DEFUNCT_MONITORING_ENABLED=true but no SSH targets are configured - nothing to check');
    return;
  }
  logger.info(`Defunct process monitor started - polling every ${intervalSeconds}s`);
  timer = setInterval(() => {
    checkNow().catch(err => logger.error(`Defunct process check cycle failed: ${err.message}`));
  }, intervalSeconds * 1000);
  timer.unref?.();
}

function stopDefunctProcessMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startDefunctProcessMonitor, stopDefunctProcessMonitor, checkNow };
