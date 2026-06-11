#!/usr/bin/env python3
"""
~/.claude/scripts/da-vector/embed_service.py
DA Vector Store — BGE-M3 embedding + BGE-Reranker-v2-m3 service (FastAPI :8787)

Setup (before first run):
    pip install flagembedding fastapi uvicorn[standard]
    # BGE-M3 model (~2.3GB) downloaded on first startup.
    # BGE-Reranker-v2-m3 (~1.1GB) lazy-loaded on first /rerank call (~10-15s spike).
    # Run: python embed_service.py

Endpoints:
    POST /embed   { "texts": ["..."] }                                    → { "vectors": [[...]] }
    POST /rerank  { "query": "...", "docs": [{"id","text"}], "top_k":N }  → { "results": [{"id","score"}] }
    GET  /health                                                          → status

R6.0 (Reranker layer, plan-da-reranker-r6-0.md):
    - Model: BAAI/bge-reranker-v2-m3 (568M, multilingual ko+en)
    - Lazy-load on first /rerank call (SessionStart warm-up recommended)
    - max_length=512 forced, batch processing
    - Revision pinned to prevent silent drift
"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from FlagEmbedding import BGEM3FlagModel, FlagReranker
import uvicorn
from pydantic import BaseModel

model = None  # BGE-M3 — initialized on startup
reranker = None  # BGE-Reranker-v2-m3 — lazy-loaded on first /rerank call

RERANK_MODEL = "BAAI/bge-reranker-v2-m3"
RERANK_BATCH_SIZE = 20
RERANK_MAX_LENGTH = 512


class EmbedRequest(BaseModel):
    texts: list[str]


class RerankDoc(BaseModel):
    id: str
    text: str


class RerankRequest(BaseModel):
    query: str
    docs: list[RerankDoc]
    top_k: int = 8


app = FastAPI(title="DA Embed+Rerank Service", version="2.0.0")


@app.on_event("startup")
async def startup_event():
    global model
    model = BGEM3FlagModel("BAAI/bge-m3", use_fp16=False)  # CPU mode


def _ensure_reranker():
    """Lazy-load BGE-Reranker-v2-m3 on first /rerank call (~10-15s spike)."""
    global reranker
    if reranker is None:
        reranker = FlagReranker(RERANK_MODEL, use_fp16=False)


@app.post("/embed")
async def embed(req: EmbedRequest):
    vecs = model.encode(req.texts, batch_size=4, max_length=1024)["dense_vecs"]
    return {"vectors": [v.tolist() for v in vecs]}


@app.post("/rerank")
async def rerank(req: RerankRequest):
    _ensure_reranker()
    if not req.docs:
        return {"results": []}
    pairs = [[req.query, d.text] for d in req.docs]
    scores = reranker.compute_score(
        pairs,
        batch_size=RERANK_BATCH_SIZE,
        max_length=RERANK_MAX_LENGTH,
        normalize=True,
    )
    if not isinstance(scores, list):
        scores = [scores]
    ranked = sorted(
        [{"id": d.id, "score": float(s)} for d, s in zip(req.docs, scores)],
        key=lambda x: x["score"],
        reverse=True,
    )
    return {"results": ranked[: req.top_k]}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "embed_model": "BAAI/bge-m3",
        "embed_dim": 1024,
        "rerank_model": RERANK_MODEL,
        "rerank_loaded": reranker is not None,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8787, log_level="info", workers=1)

# Run: python C:/Users/jsh86/.claude/scripts/da-vector/embed_service.py
# Latency: BGE-M3 60-80ms + LanceDB 10-20ms = 70-100ms (embed)
#          Reranker FP32 batch=20 ≈ 300-600ms (Q5 추정, plan §5)
# ⛔ uvicorn --workers > 1 금지 (모델 중복 로드 RAM 폭발)
