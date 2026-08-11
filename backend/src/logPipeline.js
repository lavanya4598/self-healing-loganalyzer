/**
 * Shared log-analysis pipeline: run a batch of log lines through the AI
 * service (falling back to the local mock analyzer) and provision the
 * resulting anomalies/healing actions. Used by both the manual
 * upload/ingest routes (routes/logs.js) and the automatic log-collection
 * agent (logCollector.js) so the two paths behave identically.
 */
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const store = require('./store');
const { aiServiceUrl } = require('./config');
const logger = require('./logger');
const { broadcastEvent } = require('./websocket');
const { analyzeLogsMock } = require('./mockAnalyzer');
const { tryAutoHeal } = require('./selfHealing');

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

module.exports = { runAnalysis, provisionAnomaliesAndActions };
