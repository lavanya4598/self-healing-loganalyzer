import json
import re
from llm_client import chat
from vector_store import query_similar_logs, query_healing_patterns
from config import ACTION_CATEGORIES

ANALYZE_SYSTEM = """You are an expert SRE (Site Reliability Engineer) and log analysis AI.
Your job is to:
1. Identify anomalies, errors, and patterns in application logs
2. Determine the root cause and severity
3. Recommend specific self-healing actions
4. Assign the correct approval level (L1/L2/L3)

Severity levels:
- low: informational issues, minor warnings, no user impact
- medium: degraded performance, partial failures, limited user impact  
- high: service outages, data corruption risk, significant user impact
- critical: complete system failure, data loss risk, all users affected

Always respond with valid JSON only, no extra text.
"""

ANALYZE_TEMPLATE = """Analyze the following log batch and similar historical context.

=== CURRENT LOGS ===
{logs}

=== SIMILAR HISTORICAL LOGS ===
{similar_logs}

=== PAST HEALING PATTERNS ===
{healing_patterns}

Respond with JSON matching this schema exactly:
{{
  "anomalies": [
    {{
      "id": "unique_id",
      "title": "Short title",
      "description": "Detailed description of the anomaly",
      "severity": "low|medium|high|critical",
      "affected_components": ["service1", "service2"],
      "root_cause": "Probable root cause",
      "log_references": ["log line or snippet"],
      "confidence": 0.0-1.0
    }}
  ],
  "healing_actions": [
    {{
      "anomaly_id": "links to anomaly id above",
      "action_type": "restart_service|clear_cache|scale_up|rotate_credentials|disk_cleanup|config_update|rollback_deployment|alert_only|auto_fix_code|network_reset",
      "title": "Action title",
      "description": "What this action will do",
      "commands": ["command1", "command2"],
      "estimated_impact": "Expected outcome",
      "risk_level": "low|medium|high",
      "approval_level": "L1|L2|L3",
      "approval_reason": "Why this approval level is needed"
    }}
  ],
  "summary": "Overall health summary of the analyzed logs",
  "health_score": 0-100
}}
"""


def analyze_logs(logs: list[str], batch_id: str) -> dict:
    """
    Run LLM-powered analysis on a batch of log lines.
    Returns structured anomalies and healing actions.
    """
    logs_text = "\n".join(logs[:200])  # cap to avoid token overflow

    # Retrieve context from vector DB
    combined_text = " ".join(logs[:20])
    similar = query_similar_logs(combined_text, n_results=5)
    patterns = query_healing_patterns(combined_text, n_results=3)

    similar_text = "\n".join([f"- {s['log']}" for s in similar]) or "None"
    patterns_text = "\n".join([f"- {p['pattern']}" for p in patterns]) or "None"

    prompt = ANALYZE_TEMPLATE.format(
        logs=logs_text,
        similar_logs=similar_text,
        healing_patterns=patterns_text,
    )

    raw = chat(ANALYZE_SYSTEM, prompt)

    # Extract JSON even if LLM wraps in markdown
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)

    result = json.loads(raw)

    # Enforce correct approval level from action_type config
    for action in result.get("healing_actions", []):
        action_type = action.get("action_type", "alert_only")
        enforced_level = ACTION_CATEGORIES.get(action_type, "L2")
        if action.get("approval_level", "L2") != enforced_level:
            action["approval_level"] = enforced_level
            action["approval_reason"] = (
                f"Enforced to {enforced_level} based on action type '{action_type}'"
            )

    return result
