/**
 * Self-healing execution engine.
 *
 * IMPORTANT SECURITY DESIGN:
 * - The AI (Gemini) NEVER supplies the command that actually gets executed.
 *   `action.commands` (LLM free text) is shown to humans as a suggestion only
 *   and is never passed to a shell here. Auto-execution only ever runs a
 *   fixed, operator-configured command per `action_type`, configured via
 *   environment variables (SELF_HEAL_CMD_<ACTION_TYPE>). This avoids using
 *   untrusted/LLM-generated text as a shell command (OWASP injection risk),
 *   even though log content indirectly influences which anomaly/action_type
 *   gets picked.
 * - `rotate_credentials` can NEVER be auto-executed, regardless of config -
 *   credential rotation is security-critical and always requires a human to
 *   review and run it manually via the existing approval workflow.
 * - This whole engine is OFF by default (`SELF_HEALING_ENABLED` must be set
 *   to `true`) and only activates for an action_type if the operator has
 *   configured a command for it - unconfigured types silently fall back to
 *   the existing human-approval workflow, they are never blocked or errored.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env'), override: true });

const { NodeSSH } = require('node-ssh');
const logger = require('./logger');

const NEVER_AUTO_EXECUTE = new Set(['rotate_credentials']);

const selfHealingEnabled = String(process.env.SELF_HEALING_ENABLED || 'false').toLowerCase() === 'true';

const sshConfig = {
  host: process.env.SELF_HEAL_SSH_HOST || '',
  port: parseInt(process.env.SELF_HEAL_SSH_PORT, 10) || 22,
  username: process.env.SELF_HEAL_SSH_USER || '',
  privateKeyPath: process.env.SELF_HEAL_SSH_PRIVATE_KEY_PATH || '',
  password: process.env.SELF_HEAL_SSH_PASSWORD || '',
  passphrase: process.env.SELF_HEAL_SSH_PASSPHRASE || undefined,
};

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

function isConfigured() {
  return selfHealingEnabled && !!sshConfig.host && !!sshConfig.username && (!!sshConfig.privateKeyPath || !!sshConfig.password);
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

/**
 * Attempts to auto-execute the fixed command configured for this action_type.
 * Returns `null` if auto-execution doesn't apply (disabled, unconfigured,
 * or blocked action_type) so the caller can fall back to the normal
 * human-approval flow. Never throws - execution failures are returned as a
 * result object, not raised, so a flaky remote host never breaks log upload.
 */
async function tryAutoHeal(actionType) {
  if (!selfHealingEnabled) return null;
  if (NEVER_AUTO_EXECUTE.has(actionType)) return null;

  const command = commandFor(actionType);
  if (!command) return null;

  if (!isConfigured()) {
    logger.warn('SELF_HEALING_ENABLED=true but SSH target is not fully configured - skipping auto-execution');
    return null;
  }

  if (command === 'true') {
    return { success: true, command, stdout: '(no-op: alert only)', stderr: '', code: 0 };
  }

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
      stdout: (result.stdout || '').slice(0, 4000),
      stderr: (result.stderr || '').slice(0, 4000),
      code: result.code,
    };
  } catch (err) {
    logger.error(`Self-healing SSH execution failed: ${err.message}`);
    return { success: false, command, stdout: '', stderr: err.message, code: null };
  } finally {
    ssh.dispose();
  }
}

module.exports = { tryAutoHeal, selfHealingEnabled, isConfigured, remoteCommandAvailable };
