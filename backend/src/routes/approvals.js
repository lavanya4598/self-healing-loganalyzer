const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { authenticate, requireApprovalRole } = require('../middleware/auth');
const store = require('../store');
const { aiServiceUrl } = require('../config');
const logger = require('../logger');
const { broadcastEvent } = require('../websocket');
const { generateHealingPlanMock } = require('../mockAnalyzer');
const { tryAutoHeal, runManualCommand, isConfigured, remoteCommandAvailable, listConfiguredTargets } = require('../selfHealing');

function withRemoteExecutable(action) {
  const target = action.target_host;
  return {
    ...action,
    remote_executable: isConfigured(target) && remoteCommandAvailable(action.action_type),
    manual_execution_available: isConfigured(target),
  };
}

const router = express.Router();

/**
 * Try the real Python AI service for plan generation; fall back to the
 * local mock plan generator if it's unreachable.
 */
async function runHealingPlan(anomaly, action, environment, approvedBy, approvalLevel) {
  try {
    const { data } = await axios.post(`${aiServiceUrl}/healing/plan`, {
      anomaly,
      action,
      environment,
      approved_by: approvedBy,
      approval_level: approvalLevel,
    }, { timeout: 50000 });
    return data;
  } catch (err) {
    logger.warn(`AI service unavailable, using mock healing plan: ${err.message}`);
    return {
      ...generateHealingPlanMock(anomaly, action),
      healing_id: uuidv4(),
      approved_by: approvedBy,
      approval_level: approvalLevel,
      generated_at: new Date().toISOString(),
    };
  }
}

// GET /api/approvals  – list pending approvals for the current user's role
router.get('/', authenticate, (req, res) => {
  const { status } = req.query;
  let actions = [...store.actions.values()];

  if (status) {
    actions = actions.filter(a => a.status === status);
  }

  // Filter to actions the user can approve
  const roleCanApprove = {
    admin: ['L1', 'L2', 'L3'],
    manager: ['L3'],
    team_lead: ['L2'],
    engineer: [],
  };
  const levels = roleCanApprove[req.user.role] || [];
  actions = actions.filter(a => levels.includes(a.approval_level));

  actions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ data: actions.map(withRemoteExecutable), total: actions.length });
});

// GET /api/approvals/targets  – list configured self-healing SSH target VMs,
// so the frontend can offer a real dropdown (e.g. "vm1", "vm2") instead of
// guessing names. Available to any authenticated user (read-only, no
// connection details are returned - just the names).
router.get('/targets', authenticate, (req, res) => {
  res.json({ data: listConfiguredTargets() });
});

// GET /api/approvals/all  – all actions regardless of role (admin only)
router.get('/all', authenticate, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const list = [...store.actions.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  res.json({ data: list.map(withRemoteExecutable), total: list.length });
});

// GET /api/approvals/:actionId/plan  – fetch the previously-generated healing
// plan for an already-approved action (so it's still visible after a page
// refresh, not just immediately after clicking Approve).
router.get('/:actionId/plan', authenticate, (req, res) => {
  const action = store.actions.get(req.params.actionId);
  if (!action) return res.status(404).json({ error: 'Action not found' });
  if (!action.plan_id) return res.status(404).json({ error: 'No healing plan has been generated for this action yet' });

  const plan = store.plans.get(action.plan_id);
  if (!plan) return res.status(404).json({ error: 'Healing plan not found' });

  res.json(plan);
});

// POST /api/approvals/:actionId/approve
router.post('/:actionId/approve', authenticate, async (req, res, next) => {
  try {
    const action = store.actions.get(req.params.actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    if (action.status !== 'pending_approval') {
      return res.status(400).json({ error: `Action is already in state: ${action.status}` });
    }

    // Check the user has the right role for this level
    const levelRoles = { L2: ['team_lead', 'admin'], L3: ['manager', 'admin'] };
    const required = levelRoles[action.approval_level] || [];
    if (required.length > 0 && !required.includes(req.user.role)) {
      return res.status(403).json({ error: `${action.approval_level} requires: ${required.join(' or ')}` });
    }

    // Fetch the anomaly for the healing plan request
    const anomaly = store.anomalies.get(action.anomaly_id);
    if (!anomaly) return res.status(404).json({ error: 'Associated anomaly not found' });

    // Generate healing plan via AI service (falls back to mock plan if unavailable)
    const plan = await runHealingPlan(
      anomaly,
      action,
      anomaly.environment || 'production',
      req.user.username,
      action.approval_level,
    );

    // Update action status
    action.status = 'approved';
    action.approved_by = req.user.username;
    action.approved_at = new Date().toISOString();
    action.plan_id = plan.healing_id;
    store.actions.set(action.id, action);

    // Store plan
    store.plans.set(plan.healing_id, { ...plan, action_id: action.id, anomaly_id: action.anomaly_id });

    // Update anomaly status
    if (anomaly) {
      anomaly.status = 'in_progress';
      store.anomalies.set(anomaly.id, anomaly);
    }

    // Audit
    store.audit.push({
      event: 'action_approved',
      action_id: action.id,
      anomaly_id: action.anomaly_id,
      approved_by: req.user.username,
      approval_level: action.approval_level,
      timestamp: new Date().toISOString(),
    });

    broadcastEvent('action_approved', { action, plan });

    // Agent-driven execution: now that a human has approved this L2/L3
    // action, let the self-healing engine run the fixed operator-configured
    // command for this action_type immediately - no separate "Execute Now"
    // click required. Falls back to leaving it in 'approved' state (for the
    // manual "Execute Now" button or the manual-command addon) if no fixed
    // command is configured for this action_type/target.
    const healResult = await tryAutoHeal(action.action_type, action.target_host);
    if (healResult) {
      action.status = healResult.success ? 'completed' : 'failed';
      action.auto_executed = true;
      action.executed_command = healResult.command;
      action.execution_result = { stdout: healResult.stdout, stderr: healResult.stderr, exit_code: healResult.code };
      action.completed_at = new Date().toISOString();
      action.completed_by = 'self-healing-engine';
      store.actions.set(action.id, action);

      if (anomaly) {
        anomaly.status = healResult.success ? 'resolved' : 'open';
        store.anomalies.set(anomaly.id, anomaly);
      }

      store.audit.push({
        event: healResult.success ? 'self_healing_executed' : 'self_healing_failed',
        action_id: action.id,
        anomaly_id: action.anomaly_id,
        command: healResult.command,
        user: 'self-healing-engine',
        timestamp: new Date().toISOString(),
      });

      broadcastEvent(healResult.success ? 'healing_completed' : 'healing_failed', action);
    }

    res.json({ action, plan });
  } catch (err) {
    logger.error(`Approval failed: ${err.message}`);
    next(err);
  }
});

// POST /api/approvals/:actionId/reject
router.post('/:actionId/reject', authenticate, async (req, res, next) => {
  try {
    const action = store.actions.get(req.params.actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    if (action.status !== 'pending_approval') {
      return res.status(400).json({ error: `Action is already in state: ${action.status}` });
    }

    action.status = 'rejected';
    action.rejected_by = req.user.username;
    action.rejected_at = new Date().toISOString();
    action.rejection_reason = req.body.reason || 'No reason provided';
    store.actions.set(action.id, action);

    store.audit.push({
      event: 'action_rejected',
      action_id: action.id,
      rejected_by: req.user.username,
      reason: action.rejection_reason,
      timestamp: new Date().toISOString(),
    });

    broadcastEvent('action_rejected', action);
    res.json(action);
  } catch (err) {
    next(err);
  }
});

// POST /api/approvals/:actionId/complete  – mark execution as done
router.post('/:actionId/complete', authenticate, async (req, res, next) => {
  try {
    const action = store.actions.get(req.params.actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    const { success, notes } = req.body;

    action.status = success ? 'completed' : 'failed';
    action.completed_at = new Date().toISOString();
    action.completed_by = req.user.username;
    action.completion_notes = notes || '';
    store.actions.set(action.id, action);

    const anomaly = store.anomalies.get(action.anomaly_id);
    if (anomaly) {
      anomaly.status = success ? 'resolved' : 'open';
      store.anomalies.set(anomaly.id, anomaly);
    }

    // Send feedback to AI for learning
    if (action.plan_id) {
      const plan = store.plans.get(action.plan_id);
      try {
        await axios.post(`${aiServiceUrl}/healing/feedback`, {
          anomaly: anomaly || {},
          action,
          plan: plan || {},
          success,
        });
      } catch (e) {
        logger.warn(`Feedback submission failed: ${e.message}`);
      }
    }

    store.audit.push({
      event: success ? 'healing_completed' : 'healing_failed',
      action_id: action.id,
      anomaly_id: action.anomaly_id,
      user: req.user.username,
      timestamp: new Date().toISOString(),
    });

    broadcastEvent('healing_' + (success ? 'completed' : 'failed'), action);
    res.json(action);
  } catch (err) {
    next(err);
  }
});

// POST /api/approvals/:actionId/execute  – human-triggered remote execution
// of an already-approved action. Deliberately reuses the exact same
// fixed/operator-configured command lookup as the automatic self-healing
// engine (selfHealing.js) - it NEVER runs the LLM-suggested `action.commands`
// text over SSH, only a command the operator explicitly configured for this
// action_type via SELF_HEAL_CMD_<ACTION_TYPE>. This is a separate, explicit
// step from approval so nothing runs on a remote host without a human
// deliberately clicking "Execute Now".
router.post('/:actionId/execute', authenticate, async (req, res, next) => {
  try {
    const action = store.actions.get(req.params.actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    if (action.status !== 'approved' && action.status !== 'auto_approved') {
      return res.status(400).json({ error: `Action must be approved before it can be executed remotely (current status: ${action.status})` });
    }

    // Same role gating as approval, since remote execution is at least as
    // sensitive as approving.
    const levelRoles = { L2: ['team_lead', 'admin'], L3: ['manager', 'admin'] };
    const required = levelRoles[action.approval_level] || [];
    if (required.length > 0 && !required.includes(req.user.role)) {
      return res.status(403).json({ error: `${action.approval_level} requires: ${required.join(' or ')}` });
    }

    if (!isConfigured(action.target_host) || !remoteCommandAvailable(action.action_type)) {
      return res.status(400).json({
        error: 'No fixed remote command is configured for this action type, or self-healing SSH is not enabled/configured on the server.',
      });
    }

    const result = await tryAutoHeal(action.action_type, action.target_host);
    if (!result) {
      return res.status(400).json({ error: 'Remote execution is not available for this action right now.' });
    }

    action.status = result.success ? 'completed' : 'failed';
    action.remotely_executed = true;
    action.executed_command = result.command;
    action.execution_result = { stdout: result.stdout, stderr: result.stderr, exit_code: result.code };
    action.completed_at = new Date().toISOString();
    action.completed_by = req.user.username;
    store.actions.set(action.id, action);

    const anomaly = store.anomalies.get(action.anomaly_id);
    if (anomaly) {
      anomaly.status = result.success ? 'resolved' : 'open';
      store.anomalies.set(anomaly.id, anomaly);
    }

    store.audit.push({
      event: result.success ? 'remote_execution_completed' : 'remote_execution_failed',
      action_id: action.id,
      anomaly_id: action.anomaly_id,
      command: result.command,
      user: req.user.username,
      timestamp: new Date().toISOString(),
    });

    broadcastEvent('healing_' + (result.success ? 'completed' : 'failed'), action);
    res.json(action);
  } catch (err) {
    next(err);
  }
});

// POST /api/approvals/:actionId/execute-manual  – ADDON: human-typed manual
// command execution on the target VM. Unlike /execute (which only ever runs
// a fixed, operator-preconfigured command), this lets an already-privileged,
// authenticated approver type the exact command themselves - useful when no
// fixed command has been configured for this action_type, or the operator
// needs a one-off remediation on one of their VMs. The command is authored
// by the human calling this endpoint (not the LLM), so it is not treated as
// untrusted input, but it is still gated behind the same approval-role
// checks as /execute, requires the action to already be approved, is never
// allowed for rotate_credentials, and is always logged in the audit trail
// with the exact command and who ran it.
router.post('/:actionId/execute-manual', authenticate, async (req, res, next) => {
  try {
    const action = store.actions.get(req.params.actionId);
    if (!action) return res.status(404).json({ error: 'Action not found' });

    if (action.status !== 'approved' && action.status !== 'auto_approved') {
      return res.status(400).json({ error: `Action must be approved before a manual command can be run (current status: ${action.status})` });
    }

    if (action.action_type === 'rotate_credentials') {
      return res.status(400).json({ error: 'Credential rotation can never be executed through this app - run it manually outside this system.' });
    }

    // Same role gating as approval/execute - manual command execution is at
    // least as sensitive.
    const levelRoles = { L2: ['team_lead', 'admin'], L3: ['manager', 'admin'] };
    const required = levelRoles[action.approval_level] || [];
    if (required.length > 0 && !required.includes(req.user.role)) {
      return res.status(403).json({ error: `${action.approval_level} requires: ${required.join(' or ')}` });
    }

    const { command, target } = req.body;
    if (!command || typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({ error: 'command is required' });
    }

    const targetHost = target || action.target_host;
    if (!isConfigured(targetHost)) {
      return res.status(400).json({ error: 'Self-healing SSH is not enabled/configured for this target on the server.' });
    }

    const result = await runManualCommand(command, targetHost);

    action.status = result.success ? 'completed' : 'failed';
    action.manually_executed = true;
    action.executed_command = result.command;
    action.execution_result = { stdout: result.stdout, stderr: result.stderr, exit_code: result.code };
    action.completed_at = new Date().toISOString();
    action.completed_by = req.user.username;
    store.actions.set(action.id, action);

    const anomaly = store.anomalies.get(action.anomaly_id);
    if (anomaly) {
      anomaly.status = result.success ? 'resolved' : 'open';
      store.anomalies.set(anomaly.id, anomaly);
    }

    store.audit.push({
      event: result.success ? 'manual_execution_completed' : 'manual_execution_failed',
      action_id: action.id,
      anomaly_id: action.anomaly_id,
      command: result.command,
      target: result.target,
      user: req.user.username,
      timestamp: new Date().toISOString(),
    });

    broadcastEvent('healing_' + (result.success ? 'completed' : 'failed'), action);
    res.json(action);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
