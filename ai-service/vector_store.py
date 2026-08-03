import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from config import CHROMA_MODE, CHROMA_PATH, CHROMA_HOST, CHROMA_PORT, CHROMA_COLLECTION_LOGS, CHROMA_COLLECTION_PATTERNS, EMBEDDING_MODEL
import uuid

_client = None
_embedder = None


def get_chroma_client():
    """Returns a Chroma client. Defaults to an embedded, local, file-based
    PersistentClient so no separate DB server (or Docker) is required.
    Set CHROMA_MODE=http to instead connect to a running Chroma server.
    """
    global _client
    if _client is None:
        if CHROMA_MODE == "http":
            _client = chromadb.HttpClient(
                host=CHROMA_HOST,
                port=CHROMA_PORT,
                settings=Settings(anonymized_telemetry=False),
            )
        else:
            _client = chromadb.PersistentClient(
                path=CHROMA_PATH,
                settings=Settings(anonymized_telemetry=False),
            )
    return _client


def get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer(EMBEDDING_MODEL)
    return _embedder


def get_collection(name: str):
    client = get_chroma_client()
    return client.get_or_create_collection(
        name=name,
        metadata={"hnsw:space": "cosine"},
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    embedder = get_embedder()
    return embedder.encode(texts, show_progress_bar=False).tolist()


def upsert_log(log_id: str, log_text: str, metadata: dict):
    """Store a log entry in the vector DB."""
    collection = get_collection(CHROMA_COLLECTION_LOGS)
    embedding = embed_texts([log_text])[0]
    collection.upsert(
        ids=[log_id],
        embeddings=[embedding],
        documents=[log_text],
        metadatas=[metadata],
    )


def query_similar_logs(query_text: str, n_results: int = 10) -> list[dict]:
    """Find similar log entries."""
    collection = get_collection(CHROMA_COLLECTION_LOGS)
    embedding = embed_texts([query_text])[0]
    results = collection.query(
        query_embeddings=[embedding],
        n_results=n_results,
        include=["documents", "metadatas", "distances"],
    )
    items = []
    for i, doc in enumerate(results["documents"][0]):
        items.append({
            "id": results["ids"][0][i],
            "log": doc,
            "metadata": results["metadatas"][0][i],
            "distance": results["distances"][0][i],
        })
    return items


def upsert_healing_pattern(pattern_id: str, description: str, metadata: dict):
    """Store a proven healing pattern."""
    collection = get_collection(CHROMA_COLLECTION_PATTERNS)
    embedding = embed_texts([description])[0]
    collection.upsert(
        ids=[pattern_id],
        embeddings=[embedding],
        documents=[description],
        metadatas=[metadata],
    )


def query_healing_patterns(problem_description: str, n_results: int = 5) -> list[dict]:
    """Find relevant past healing patterns."""
    collection = get_collection(CHROMA_COLLECTION_PATTERNS)
    embedding = embed_texts([problem_description])[0]
    try:
        results = collection.query(
            query_embeddings=[embedding],
            n_results=n_results,
            include=["documents", "metadatas", "distances"],
        )
        items = []
        for i, doc in enumerate(results["documents"][0]):
            items.append({
                "id": results["ids"][0][i],
                "pattern": doc,
                "metadata": results["metadatas"][0][i],
                "distance": results["distances"][0][i],
            })
        return items
    except Exception:
        return []
