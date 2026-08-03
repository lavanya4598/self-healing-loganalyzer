import json
import re
from llm_client import chat
from vector_store import upsert_healing_pattern
import uuid

HEAL_SYSTEM = """You are an expert infrastructure automation engineer.
Given an approved healing action, generate safe, idempotent shell commands or API calls 
to resolve the issue. Always include rollback steps.
Respond with valid JSON only.
"""

HEAL_TEMPLATE = """Generate execution plan for the following approved healing action.

=== ANOMALY ===
{anomaly}

=== ACTION ===
{action}

=== ENVIRONMENT ===
{environment}

Respond with JSON:
{{
  "execution_steps": [
    {{
      "step": 1,
      "description": "What this step does",
      "command": "actual command or API call",
      "timeout_seconds": 30,
      "expected_output": "what success looks like",
      "on_failure": "what to do if this fails"
    }}
  ],
  "rollback_steps": [
    {{
      "step": 1,
      "description": "Rollback description",
      "command": "rollback command"
    }}
  ],
  "health_check": {{
    "command": "command to verify success",
    "expected_result": "expected output",
    "retry_count": 3,
    "retry_interval_seconds": 10
  }},
  "estimated_duration_seconds": 60,
  "dry_run_safe": true
}}
"""


def generate_healing_plan(anomaly: dict, action: dict, environment: str = "production") -> dict:
    """Generate a detailed execution plan for an approved healing action."""
    prompt = HEAL_TEMPLATE.format(
        anomaly=json.dumps(anomaly, indent=2),
        action=json.dumps(action, indent=2),
        environment=environment,
    )
    raw = chat(HEAL_SYSTEM, prompt)
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)

    plan = json.loads(raw)
    return plan


def record_successful_healing(anomaly: dict, action: dict, plan: dict):
    """Store a successful healing pattern in vector DB for future reference."""
    pattern_id = str(uuid.uuid4())
    description = (
        f"Anomaly: {anomaly.get('title', '')}. "
        f"Root cause: {anomaly.get('root_cause', '')}. "
        f"Action: {action.get('title', '')}. "
        f"Result: successful healing."
    )
    metadata = {
        "anomaly_title": anomaly.get("title", ""),
        "action_type": action.get("action_type", ""),
        "severity": anomaly.get("severity", ""),
        "approval_level": action.get("approval_level", ""),
    }
    upsert_healing_pattern(pattern_id, description, metadata)
    return pattern_id
