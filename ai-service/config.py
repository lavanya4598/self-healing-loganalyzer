import os
from dotenv import load_dotenv

load_dotenv()

# LLM Configuration
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "openai")  # openai | google
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
GOOGLE_MODEL = os.getenv("GOOGLE_MODEL", "gemini-1.5-pro")

# ChromaDB Configuration
# CHROMA_MODE: "embedded" (default, local file-based, no server/Docker needed)
#              "http" (connect to a separately running Chroma server)
CHROMA_MODE = os.getenv("CHROMA_MODE", "embedded")
CHROMA_PATH = os.getenv("CHROMA_PATH", os.path.join(os.path.dirname(__file__), "chroma_data"))
CHROMA_HOST = os.getenv("CHROMA_HOST", "localhost")
CHROMA_PORT = int(os.getenv("CHROMA_PORT", "8000"))
CHROMA_COLLECTION_LOGS = "log_embeddings"
CHROMA_COLLECTION_PATTERNS = "healing_patterns"

# Embedding model
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# Approval Levels
APPROVAL_LEVELS = {
    "L1": {"label": "Auto-Approve", "severity": ["low"], "requires_human": False},
    "L2": {"label": "Team Lead", "severity": ["medium"], "requires_human": True},
    "L3": {"label": "Manager", "severity": ["high", "critical"], "requires_human": True},
}

# Self-healing action categories
ACTION_CATEGORIES = {
    "restart_service": "L2",
    "clear_cache": "L1",
    "scale_up": "L3",
    "rotate_credentials": "L3",
    "disk_cleanup": "L2",
    "config_update": "L2",
    "rollback_deployment": "L3",
    "alert_only": "L1",
    "auto_fix_code": "L1",
    "network_reset": "L3",
}
