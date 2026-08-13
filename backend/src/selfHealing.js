/**
 * Self-healing execution engine.
 *
 * IMPORTANT SECURITY DESIGN:
 * - The AI (Gemini) NEVER supplies the command that actually gets executed
 *   for *automatic* healing. `action.commands` (LLM free text) is shown to
 *   humans as a suggestion only and is never passed to a shell here.
 *   Auto-execution only ever runs a fixed, operator-configured command per
 *   `action_type`, configured via environment variables
 *   (SELF_HEAL_CMD_<ACTION_TYPE>). This avoids using untrusted/LLM-generated
 *   text as a shell command (OWASP injection risk), even though log content
 *   indirectly influences which anomaly/action_type gets picked.
 * - `rotate_credentials` can NEVER be auto-executed, regardless of config -
 *   credential rotation is security-critical and always requires a human to
 *   review and run it manually via the existing approval workflow.
 * - This whole engine is OFF by default (`SELF_HEALING_ENABLED` must be set
 *   to `true`) and only activates for an action_type if the operator has
 *   configured a command for it - unconfigured types silently fall back to
 *   the existing human-approval workflow, they are never blocked or errored.
 * - A separate "manual execution" path (see `runManualCommand`) lets an
 *   already-privileged, authenticated human (SDM / Service Manager /
 *   Incident Manager - whoever is entitled to approve the action) type an
 *   exact command to run on the target VM for actions that don't have a
 *   fixed command configured.
 *   That command is authored by the human, not the LLM, so it's a
 *   deliberate, attributable operator action - not an injection risk - but
 *   it is still logged loudly and gated by the same approval-role checks and
 *   by requiring the action to already be approved (enforced by the caller
 *   in routes/approvals.js).
 *
 * MULTI-HOST SUPPORT:
 * Targets are named SSH destinations (e.g. two local CentOS VMs). Configure
 * one or more via SELF_HEAL_TARGETS=vm1,vm2 plus per-target env vars
 * (SELF_HEAL_SSH_HOST_VM1, SELF_HEAL_SSH_USER_VM1, ...). A single unnamed
 * "default" target is also supported via the legacy, unsuffixed
 * SELF_HEAL_SSH_HOST/... vars for backwards compatibility. Anomalies/actions
 * carry an optional `target_host` (set at log upload/ingest time) that
 * selects which VM to run against; if omitted, `default` is used.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });

const { NodeSSH } = require('node-ssh');
const logger = require('./logger');

const NEVER_AUTO_EXECUTE = new Set(['rotate_credentials']);
const DEFAULT_TARGET = 'default';

const selfHealingEnabled = String(process.env.SELF_HEALING_ENABLED || 'false').toLowerCase() === 'true';

function envKey(prefix, targetName) {
  if (targetName === DEFAULT_TARGET) return prefix; // legacy unsuffixed vars
  const suffix = targetName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `${prefix}_${suffix}`;
}

function buildSshConfig(targetName) {
  return {
    host: process.env[envKey('SELF_HEAL_SSH_HOST', targetName)] || '',
    port: parseInt(process.env[envKey('SELF_HEAL_SSH_PORT', targetName)], 10) || 22,
    username: process.env[envKey('SELF_HEAL_SSH_USER', targetName)] || '',
    privateKeyPath: process.env[envKey('SELF_HEAL_SSH_PRIVATE_KEY_PATH', targetName)] || '',
    password: process.env[envKey('SELF_HEAL_SSH_PASSWORD', targetName)] || '',
    passphrase: process.env[envKey('SELF_HEAL_SSH_PASSPHRASE', targetName)] || undefined,
  };
}

// Names of all configured targets - always includes 'default' (populated
// from legacy vars if set) plus anything listed in SELF_HEAL_TARGETS.
function configuredTargetNames() {
  const extra = String(process.env.SELF_HEAL_TARGETS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return [DEFAULT_TARGET, ...extra];
}

const targetConfigs = new Map(configuredTargetNames().map(name => [name, buildSshConfig(name)]));

function resolveTarget(targetName) {
  const name = targetName && targetConfigs.has(targetName) ? targetName : DEFAULT_TARGET;
  return { name, config: targetConfigs.get(name) };
}

/**
 * Target names that have real SSH connection details configured - used by
 * the frontend to offer a dropdown of actual VMs instead of guessing names,
 * and by the log-collection agent to know which hosts to poll.
 */
function listConfiguredTargets() {
  return [...targetConfigs.entries()]
    .filter(([, cfg]) => hasCreds(cfg))
    .map(([name]) => name);
}

// Whether a target has usable SSH connection details - independent of
// SELF_HEALING_ENABLED, which only gates whether *remediation* commands are
// allowed to run. Log collection (read-only) uses this directly so it can
// work even when auto-remediation is deliberately left off.
function hasCreds(config) {
  return !!config.host && !!config.username && (!!config.privateKeyPath || !!config.password);
}

function isConfigured(targetName) {
  if (!selfHealingEnabled) return false;
  const { config } = resolveTarget(targetName);
  return hasCreds(config);
}

/**
 * Runs an arbitrary command on the named target over SSH, regardless of the
 * SELF_HEALING_ENABLED flag - used for read-only operations like log
 * collection, not remediation. Callers that perform remediation must keep
 * gating on `isConfigured`/`selfHealingEnabled` themselves; this is
 * intentionally the lower-level primitive.
 */
async function runOnTarget(command, targetName) {
  const { name, config } = resolveTarget(targetName);
  if (!hasCreds(config)) {
    return { success: false, command, target: name, stdout: '', stderr: `SSH target '${name}' is not fully configured`, code: null };
  }
  return execOverSsh(config, command, name);
}

// Fixed, operator-controlled commands - one static command per action_type.
// Never built from LLM output. Only types with an explicit env var (or a
// generic, clearly-labelled default below) are eligible for auto-execution;
// everything else falls back to the manual human-approval workflow.
function commandFor(actionType) {
  if (NEVER_AUTO_EXECUTE.has(actionType)) return null;

  const envOverride = process.env[`SELF_HEAL_CMD_${actionType.toUpperCase()}`];
  if (envOverride) return envOverride;

  const GENERIC_DEFAULTS = {
    alert_only: 'true', // no-op - alerting itself is the "action", nothing to execute
  };
  return GENERIC_DEFAULTS[actionType] || null;
}

/**
 * Whether a real (non no-op) fixed command is configured for this
 * action_type - used by the approvals UI/API to decide whether to offer a
 * human-triggered "Execute Remotely" button on an already-approved action.
 * Deliberately reuses the exact same fixed-command whitelist as automatic
 * self-healing (never the LLM-suggested `action.commands` text), just
 * triggered by an explicit human click instead of happening automatically.
 */
function remoteCommandAvailable(actionType) {
  const command = commandFor(actionType);
  return !!command && command !== 'true';
}

async function execOverSsh(sshConfig, command, targetName) {
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: sshConfig.host,
      port: sshConfig.port,
      username: sshConfig.username,
      ...(sshConfig.privateKeyPath ? { privateKeyPath: sshConfig.privateKeyPath, passphrase: sshConfig.passphrase } : { password: sshConfig.password }),
      readyTimeout: 15000,
    });

    const result = await Promise.race([
      ssh.execCommand(command),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Command timed out after 20s')), 20000)),
    ]);

    return {
      success: result.code === 0,
      command,
      target: targetName,
      stdout: (result.stdout || '').slice(0, 4000),
      stderr: (result.stderr || '').slice(0, 4000),
      code: result.code,
    };
  } catch (err) {
    logger.error(`Self-healing SSH execution failed (target=${targetName}): ${err.message}`);
    return { success: false, command, target: targetName, stdout: '', stderr: err.message, code: null };
  } finally {
    ssh.dispose();
  }
}

/**
 * Attempts to auto-execute the fixed command configured for this action_type
 * on the given target VM. Returns `null` if auto-execution doesn't apply
 * (disabled, unconfigured, or blocked action_type) so the caller can fall
 * back to the normal human-approval flow. Never throws - execution failures
 * are returned as a result object, not raised, so a flaky remote host never
 * breaks log upload or approval.
 */
async function tryAutoHeal(actionType, targetName) {
  if (!selfHealingEnabled) return null;
  if (NEVER_AUTO_EXECUTE.has(actionType)) return null;

  const command = commandFor(actionType);
  if (!command) return null;

  const { name, config } = resolveTarget(targetName);

  if (!isConfigured(name)) {
    logger.warn(`SELF_HEALING_ENABLED=true but SSH target '${name}' is not fully configured - skipping auto-execution`);
    return null;
  }

  if (command === 'true') {
    return { success: true, command, target: name, stdout: '(no-op: alert only)', stderr: '', code: 0 };
  }

  return execOverSsh(config, command, name);
}

/**
 * Runs an exact, human-typed command on the given target VM. This is the
 * "manual override" addon: for actions that don't have a fixed
 * operator-configured command (or where the operator wants a one-off
 * remediation), an authenticated user entitled to approve/execute this
 * action can type the precise command themselves. The caller (routes/
 * approvals.js) is responsible for role/approval-state gating and audit
 * logging before calling this - this function only handles the SSH leg.
 */
async function runManualCommand(command, targetName) {
  if (!selfHealingEnabled) {
    return { success: false, command, target: targetName, stdout: '', stderr: 'Self-healing is disabled (SELF_HEALING_ENABLED=false)', code: null };
  }
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return { success: false, command: trimmed, target: targetName, stdout: '', stderr: 'No command provided', code: null };
  }

  const { name, config } = resolveTarget(targetName);
  if (!isConfigured(name)) {
    return { success: false, command: trimmed, target: name, stdout: '', stderr: `SSH target '${name}' is not fully configured`, code: null };
  }

  return execOverSsh(config, trimmed, name);
}

module.exports = {
  tryAutoHeal,
  runManualCommand,
  runOnTarget,
  selfHealingEnabled,
  isConfigured,
  remoteCommandAvailable,
  listConfiguredTargets,
  DEFAULT_TARGET,
};
