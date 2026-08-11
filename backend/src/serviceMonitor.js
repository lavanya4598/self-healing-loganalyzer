/**
 * System service health monitor.
 *
 * Periodically checks a fixed, operator-configured list of systemd services
 * on each SSH target (read-only: `systemctl is-active`). If a service isn't
 * active, an anomaly + healing action is raised through the same
 * analysis/approval pipeline as collected logs, with the LLM asked to
 * suggest the restart command (shown to the human as a suggestion and
 * pre-filled into the Manual Command box - never auto-executed). A
 * deterministic `systemctl restart <service>` fallback is used if the LLM
 * is unavailable or returns nothing, so the feature still works without it.
 *
 * `action_type` is always forced to `service_down` here (never trusted from
 * the LLM/mock output) so it can never collide with the fixed-command
 * auto-heal path for the generic `restart_service` type - restarting the
 * *correct*, dynamically-detected service always requires a human to
 * review and click execute.
 *
 * OFF by default (SERVICE_MONITORING_ENABLED must be "true").
 */
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const store = require('./store');
const { broadcastEvent } = require('./websocket');
const { runOnTarget, listConfiguredTargets } = require('./selfHealing');
const { runAnalysis, provisionAnomaliesAndActions } = require('./logPipeline');

const enabled = String(process.env.SERVICE_MONITORING_ENABLED || 'false').toLowerCase() === 'true';
const intervalSeconds = parseInt(process.env.SERVICE_MONITOR_INTERVAL_SECONDS, 10) || 60;
const environment = process.env.LOG_COLLECTION_ENVIRONMENT || 'production';

// name:status pairs, one per configured service.
const SAFE_SERVICE_NAME = /^[A-Za-z0-9_.@-]+$/;

function servicesFor(targetName) {
  const override = process.env[`MONITORED_SERVICES_${targetName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  const raw = override || process.env.MONITORED_SERVICES || '';
  return raw.split(',').map(s => s.trim()).filter(s => s && SAFE_SERVICE_NAME.test(s));
}

// target:service -> { anomalyId, actionIds }, tracked while the service
// remains down so a recovery can be detected and the same outage isn't
// re-raised as a new anomaly on every poll.
const downState = new Map();

async function getServiceStatuses(targetName, services) {
  const command = services
    .map(s => `printf '%s:%s\\n' '${s}' "$(systemctl is-active '${s}' 2>/dev/null || echo unknown)"`)
    .join('; ');
  const result = await runOnTarget(command, targetName);
  if (!result.stdout) return services.map(s => ({ service: s, status: 'unknown' }));
  const byName = new Map(
    result.stdout.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
      const idx = line.indexOf(':');
      return idx === -1 ? [line, 'unknown'] : [line.slice(0, idx), line.slice(idx + 1)];
    }),
  );
  return services.map(s => ({ service: s, status: byName.get(s) || 'unknown' }));
}

async function raiseServiceDownAction(targetName, service, status) {
  const batchId = uuidv4();
  const logLine = `CRITICAL ServiceMonitor: systemd service '${service}' is ${status} on ${targetName} - immediate restart required`;
  const batch = { batch_id: batchId, logs: [logLine], source: `service-monitor:${targetName}`, environment };
  const analysis = await runAnalysis(batch);

  if (!analysis.anomalies?.length) {
    analysis.anomalies = [{ id: uuidv4(), severity: 'high', affected_components: [service], log_references: [logLine], confidence: 1 }];
    analysis.healing_actions = [{ anomaly_id: analysis.anomalies[0].id, risk_level: 'medium' }];
  }

  // Title/description and approval level/action_type are ALWAYS enforced
  // here, never trusted from the LLM/mock response (which analyses a
  // synthetic, generic log line and can't know the real service name) -
  // see module doc comment. This guarantees every service-down alert names
  // the actual service instead of a generic "unclassified" label.
  const anomaly = analysis.anomalies[0];
  anomaly.title = `Service '${service}' is down`;
  anomaly.description = `systemd reports '${service}' as ${status} on ${targetName}.`;
  anomaly.root_cause = `systemctl is-active reported status '${status}'`;

  for (const action of analysis.healing_actions || []) {
    action.action_type = 'service_down';
    action.title = `Restart '${service}' on ${targetName}`;
    action.description = `Suggested fix - restart the '${service}' service.`;
    action.approval_level = 'L2';
    action.approval_reason = "Enforced to L2 - restarting a dynamically-detected service always requires human approval";
    action.commands = [`sudo systemctl restart ${service}`];
  }

  const record = {
    id: batchId,
    source: batch.source,
    collectedBy: 'service-monitor-agent',
    collectedAt: new Date().toISOString(),
    lineCount: 1,
    environment,
    target_host: targetName,
    analysis,
  };
  store.analyses.set(batchId, record);
  await provisionAnomaliesAndActions(analysis, batchId, targetName);

  store.audit.push({
    event: 'service_down_detected',
    user: 'service-monitor-agent',
    batchId,
    target: targetName,
    service,
    status,
    timestamp: new Date().toISOString(),
  });
  broadcastEvent('analysis_complete', record);

  return {
    anomalyId: analysis.anomalies[0].id,
    actionIds: (analysis.healing_actions || []).map(a => a.id).filter(Boolean),
  };
}

/** Marks the tracked anomaly/actions for a recovered service as resolved/completed. */
function resolveServiceRecovery(targetName, service, tracked) {
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
    action.completed_by = 'service-monitor-agent';
    action.execution_result = { stdout: `Service '${service}' is active again on ${targetName} - auto-detected recovery.`, stderr: '', exit_code: 0 };
    store.actions.set(action.id, action);
    broadcastEvent('healing_completed', action);
  }
  store.audit.push({
    event: 'service_recovered',
    user: 'service-monitor-agent',
    target: targetName,
    service,
    timestamp: new Date().toISOString(),
  });
}

async function checkTarget(targetName) {
  const services = servicesFor(targetName);
  if (!services.length) return { target: targetName, checked: 0 };

  const statuses = await getServiceStatuses(targetName, services);
  const results = [];
  for (const { service, status } of statuses) {
    const key = `${targetName}:${service}`;
    const isDown = status !== 'active';
    if (isDown && !downState.has(key)) {
      try {
        const tracked = await raiseServiceDownAction(targetName, service, status);
        downState.set(key, tracked);
        results.push({ service, status, raised: true });
      } catch (err) {
        logger.error(`Service monitor failed to raise action for '${service}' on '${targetName}': ${err.message}`);
        results.push({ service, status, error: err.message });
      }
    } else if (!isDown && downState.has(key)) {
      resolveServiceRecovery(targetName, service, downState.get(key));
      downState.delete(key);
      results.push({ service, status, recovered: true });
    } else {
      results.push({ service, status });
    }
  }
  return { target: targetName, checked: services.length, results };
}

let running = false;

async function checkNow() {
  if (running) {
    logger.warn('Service check already in progress - skipping overlapping run');
    return listConfiguredTargets().map(target => ({ target, checked: 0, skipped: 'check already in progress' }));
  }
  running = true;
  try {
    const results = [];
    for (const target of listConfiguredTargets()) {
      try {
        results.push(await checkTarget(target));
      } catch (err) {
        logger.error(`Service check error for '${target}': ${err.message}`);
        results.push({ target, checked: 0, error: err.message });
      }
    }
    return results;
  } finally {
    running = false;
  }
}

let timer = null;

function startServiceMonitor() {
  if (!enabled) {
    logger.info('Service monitoring disabled (SERVICE_MONITORING_ENABLED=false)');
    return;
  }
  const anyServices = listConfiguredTargets().some(t => servicesFor(t).length > 0);
  if (!anyServices) {
    logger.warn('SERVICE_MONITORING_ENABLED=true but MONITORED_SERVICES is empty - nothing to check');
    return;
  }
  logger.info(`Service monitor started - polling every ${intervalSeconds}s`);
  timer = setInterval(() => {
    checkNow().catch(err => logger.error(`Service check cycle failed: ${err.message}`));
  }, intervalSeconds * 1000);
  timer.unref?.();
}

function stopServiceMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startServiceMonitor, stopServiceMonitor, checkNow };
