import uuid
import logging
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

from agents.log_analyzer import analyze_logs
from agents.healing_agent import generate_healing_plan, record_successful_healing
from vector_store import upsert_log

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("AI Service starting up...")
    yield
    logger.info("AI Service shutting down...")


app = FastAPI(
    title="Self-Healing Log Analyser - AI Service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Request / Response Models ───────────────────────────────────────────────

class LogBatch(BaseModel):
    batch_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    logs: list[str]
    source: str = "unknown"
    environment: str = "production"
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class HealingRequest(BaseModel):
    anomaly: dict
    action: dict
    environment: str = "production"
    approved_by: str
    approval_level: str


class HealingFeedback(BaseModel):
    anomaly: dict
    action: dict
    plan: dict
    success: bool


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ai-service", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/analyze")
async def analyze(batch: LogBatch, background_tasks: BackgroundTasks):
    """
    Analyze a batch of logs.
    Stores each log in vector DB asynchronously, then runs LLM analysis.
    """
    if not batch.logs:
        raise HTTPException(status_code=400, detail="No logs provided")

    # Store logs in vector DB in background
    background_tasks.add_task(_ingest_logs, batch)

    try:
        result = analyze_logs(batch.logs, batch.batch_id)
        result["batch_id"] = batch.batch_id
        result["analyzed_at"] = datetime.now(timezone.utc).isoformat()
        result["source"] = batch.source
        result["environment"] = batch.environment
        return result
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@app.post("/healing/plan")
async def create_healing_plan(request: HealingRequest):
    """
    Generate an execution plan for an approved healing action.
    Called after an action has been approved at the required level.
    """
    try:
        plan = generate_healing_plan(request.anomaly, request.action, request.environment)
        plan["healing_id"] = str(uuid.uuid4())
        plan["approved_by"] = request.approved_by
        plan["approval_level"] = request.approval_level
        plan["generated_at"] = datetime.now(timezone.utc).isoformat()
        return plan
    except Exception as e:
        logger.error(f"Plan generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Plan generation failed: {str(e)}")


@app.post("/healing/feedback")
async def healing_feedback(feedback: HealingFeedback):
    """
    Record the outcome of a healing action for continuous learning.
    """
    try:
        if feedback.success:
            pattern_id = record_successful_healing(
                feedback.anomaly, feedback.action, feedback.plan
            )
            return {"recorded": True, "pattern_id": pattern_id}
        return {"recorded": False, "reason": "Only successful healings are recorded as patterns"}
    except Exception as e:
        logger.error(f"Feedback recording failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest")
async def ingest_logs(batch: LogBatch):
    """Direct log ingestion endpoint for batch storage in vector DB."""
    await _ingest_logs(batch)
    return {"ingested": len(batch.logs), "batch_id": batch.batch_id}


# ─── Background helpers ───────────────────────────────────────────────────────

async def _ingest_logs(batch: LogBatch):
    for i, log_line in enumerate(batch.logs):
        log_id = f"{batch.batch_id}_{i}"
        metadata = {
            "source": batch.source,
            "environment": batch.environment,
            "timestamp": batch.timestamp,
            "batch_id": batch.batch_id,
            "line_index": i,
        }
        try:
            upsert_log(log_id, log_line, metadata)
        except Exception as e:
            logger.warning(f"Failed to ingest log {log_id}: {e}")
