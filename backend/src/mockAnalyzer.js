const { v4: uuidv4 } = require('uuid');

/**
 * Mock, rule-based log analyzer used as a fallback when the Python AI
 * service (LLM + vector DB) is unreachable. Lets the full stack run and
 * be demoed without Python/pip installed.
 *
 * Mirrors the response shape of ai-service's /analyze endpoint.
 */

const RULES = [
  {
    match: /connection timeout|econnrefused|connection refused/i,
    title: 'Database Connection Failure',
    severity: 'high',
    root_cause: 'The database or a downstream dependency is unreachable, causing connection timeouts and refused connections.',
    affected_components: ['database', 'app-server'],
    action_type: 'restart_service',
    action_title: 'Restart affected service and verify DB connectivity',
    commands: ['systemctl restart app-service', 'pg_isready -h db-primary -p 5432'],
    risk_level: 'medium',
  },
  {
    match: /payment.*(down|fail|rollback)|transaction rollback/i,
    title: 'Payment Processing Failure',
    severity: 'critical',
    root_cause: 'Payment transactions are failing, likely due to an upstream dependency outage (database or payment gateway).',
    affected_components: ['payment-service'],
    action_type: 'rollback_deployment',
    action_title: 'Roll back latest payment-service deployment',
    commands: ['kubectl rollout undo deployment/payment-service'],
    risk_level: 'high',
  },
  {
    match: /disk.*(full|95%|9[0-9]% full)|partition.*full/i,
    title: 'Disk Space Critical',
    severity: 'medium',
    root_cause: 'A disk partition is nearly full, risking write failures and service instability.',
    affected_components: ['storage', 'logging'],
    action_type: 'disk_cleanup',
    action_title: 'Clean up old logs and temp files',
    commands: ['find /var/log -mtime +7 -delete', 'df -h'],
    risk_level: 'low',
  },
  {
    match: /redis|cache.*evict|memory usage \d+%/i,
    title: 'Cache Memory Pressure',
    severity: 'low',
    root_cause: 'Cache memory usage is high, triggering evictions that may increase latency.',
    affected_components: ['cache-service'],
    action_type: 'clear_cache',
    action_title: 'Clear stale cache entries',
    commands: ['redis-cli --scan --pattern "stale:*" | xargs redis-cli del'],
    risk_level: 'low',
  },
  {
    match: /jwt|credential|secret rotation failed|permission denied/i,
    title: 'Credential / Secret Rotation Issue',
    severity: 'high',
    root_cause: 'Automated credential rotation failed, likely due to insufficient permissions.',
    affected_components: ['auth-service'],
    action_type: 'rotate_credentials',
    action_title: 'Manually rotate and redeploy credentials',
    commands: ['vault write auth/rotate role=app-service'],
    risk_level: 'high',
  },
  {
    match: /degraded|scale|high load|cpu.*9[0-9]%/i,
    title: 'Service Degradation Under Load',
    severity: 'medium',
    root_cause: 'One or more service instances are degraded, likely due to high load or resource contention.',
    affected_components: ['app-server'],
    action_type: 'scale_up',
    action_title: 'Scale up service replicas',
    commands: ['kubectl scale deployment/app-server --replicas=6'],
    risk_level: 'medium',
  },
];

const ACTION_LEVELS = {
  restart_service: 'L2',
  clear_cache: 'L1',
  scale_up: 'L3',
  rotate_credentials: 'L3',
  disk_cleanup: 'L2',
  config_update: 'L2',
  rollback_deployment: 'L3',
  alert_only: 'L1',
  auto_fix_code: 'L1',
  network_reset: 'L3',
};

function analyzeLogsMock(logs, reason) {
  const fallbackNote = reason ? `AI provider unavailable (${reason})` : 'no LLM configured';
  const anomalies = [];
  const healing_actions = [];
  const matchedRuleTitles = new Set();

  for (const rule of RULES) {
    const matchingLines = logs.filter(line => rule.match.test(line));
    if (matchingLines.length === 0 || matchedRuleTitles.has(rule.title)) continue;
    matchedRuleTitles.add(rule.title);

    const anomalyId = uuidv4();
    anomalies.push({
      id: anomalyId,
      title: rule.title,
      description: `Detected ${matchingLines.length} matching log line(s) indicating: ${rule.title.toLowerCase()}.`,
      severity: rule.severity,
      affected_components: rule.affected_components,
      root_cause: rule.root_cause,
      log_references: matchingLines.slice(0, 5),
      confidence: 0.7,
    });

    const approvalLevel = ACTION_LEVELS[rule.action_type] || 'L2';
    healing_actions.push({
      anomaly_id: anomalyId,
      action_type: rule.action_type,
      title: rule.action_title,
      description: `Automated remediation suggestion for "${rule.title}" (mock analyzer — ${fallbackNote}).`,
      commands: rule.commands,
      estimated_impact: 'Should restore normal operation if root cause matches the detected pattern.',
      risk_level: rule.risk_level,
      approval_level: approvalLevel,
      approval_reason: `Enforced to ${approvalLevel} based on action type '${rule.action_type}'`,
    });
  }

  // Catch-all: any error/warning lines not already covered by a matched rule
  // above should still be surfaced, not silently dropped. Without this, a
  // critical rule match (e.g. DB failure) would swallow an unrelated medium/
  // low severity issue elsewhere in the same log batch.
  const alreadyMatchedLines = new Set(anomalies.flatMap(a => a.log_references));
  const unclassifiedLines = logs.filter(
    l => /error|critical|warn/i.test(l) && !alreadyMatchedLines.has(l),
  );
  if (unclassifiedLines.length > 0) {
    const anomalyId = uuidv4();
    anomalies.push({
      id: anomalyId,
      title: 'Unclassified Error Pattern',
      description: `Found ${unclassifiedLines.length} error/warning line(s) that did not match a known pattern.`,
      severity: 'medium',
      affected_components: ['unknown'],
      root_cause: `Could not be automatically classified by the mock analyzer (${fallbackNote}). Try again shortly, or connect a real LLM provider for deeper analysis.`,
      log_references: unclassifiedLines.slice(0, 5),
      confidence: 0.4,
    });
    healing_actions.push({
      anomaly_id: anomalyId,
      action_type: 'alert_only',
      title: 'Notify on-call engineer',
      description: 'Unclassified issue detected — route to human for investigation.',
      commands: [],
      estimated_impact: 'No automated remediation available.',
      risk_level: 'low',
      approval_level: 'L1',
      approval_reason: "Enforced to L1 based on action type 'alert_only'",
    });
  }

  const healthScore = Math.max(0, 100 - anomalies.length * 15 - anomalies.filter(a => a.severity === 'critical').length * 20);

  return {
    anomalies,
    healing_actions,
    summary: anomalies.length
      ? `Mock analyzer detected ${anomalies.length} anomaly pattern(s) across ${logs.length} log line(s). ${fallbackNote.charAt(0).toUpperCase() + fallbackNote.slice(1)} - re-run once the AI service is available for deeper, contextual analysis.`
      : `No known anomaly patterns detected across ${logs.length} log line(s).`,
    health_score: healthScore,
    mock: true,
  };
}

function generateHealingPlanMock(anomaly, action) {
  const steps = (action.commands || []).map((command, i) => ({
    step: i + 1,
    description: `Execute: ${command}`,
    command,
    timeout_seconds: 30,
    expected_output: 'Command completes with exit code 0',
    on_failure: 'Escalate to on-call engineer and halt remaining steps',
  }));

  if (steps.length === 0) {
    steps.push({
      step: 1,
      description: 'No automated command available — manual investigation required',
      command: 'echo "Manual investigation required"',
      timeout_seconds: 5,
      expected_output: 'N/A',
      on_failure: 'Escalate to on-call engineer',
    });
  }

  return {
    execution_steps: steps,
    rollback_steps: [
      { step: 1, description: 'Revert any changes made by the executed commands', command: '# rollback depends on action taken' },
    ],
    health_check: {
      command: 'curl -f http://localhost/health',
      expected_result: 'HTTP 200',
      retry_count: 3,
      retry_interval_seconds: 10,
    },
    estimated_duration_seconds: 60,
    dry_run_safe: false,
    mock: true,
  };
}

module.exports = { analyzeLogsMock, generateHealingPlanMock };
