"""
重排服务（FastAPI）。

定位：RAG 的「召回 → 重排」中的第二段。后端 TS 侧先做粗召回（向量或关键词），
把候选丢到这里重排，取前几条再喂给模型。

设计原则和后端其它下游依赖一致：**这个服务挂了，主流程必须还能跑。**
所以后端调用失败时是「跳过重排、沿用原召回顺序」，而不是报错。

启动：
    python -m uvicorn app.main:app --port 3200        （在 services/rerank 目录下）
或：
    pwsh -File services/rerank/run.ps1
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .reranker import Document, rerank

VERSION = "1.0.0"
MODEL_NAME = os.getenv("RERANK_MODEL", "bm25-uni+bigram+rrf")
# 设了才校验，方便本机直连调试
API_KEY = os.getenv("RERANK_API_KEY", "").strip()

app = FastAPI(
    title="AI优选零食 · 重排服务",
    description="BM25 词法重排（可选 RRF 融合向量召回分）。零重依赖，不下载模型。",
    version=VERSION,
)


class DocumentIn(BaseModel):
    id: str
    text: str
    # 召回阶段的分数。传了就做 RRF 融合，不传就纯词法重排。
    originalScore: float | None = Field(default=None, alias="originalScore")

    model_config = {"populate_by_name": True}


class RerankIn(BaseModel):
    query: str
    documents: list[DocumentIn]
    topK: int | None = Field(default=None, alias="topK")

    model_config = {"populate_by_name": True}


class ScoredOut(BaseModel):
    id: str
    score: float
    lexicalScore: float
    originalScore: float | None = None


class RerankOut(BaseModel):
    results: list[ScoredOut]
    model: str
    tookMs: int


@app.get("/health")
def health() -> dict[str, Any]:
    """健康检查。后端会定期探它，失败就自动停止调用重排。"""
    return {"status": "ok", "model": MODEL_NAME, "version": VERSION}


@app.post("/rerank", response_model=RerankOut)
def do_rerank(body: RerankIn, x_api_key: str | None = Header(default=None)) -> RerankOut:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

    if not body.query.strip():
        # 空查询没有排序依据，原样返回比瞎排更诚实
        return RerankOut(
            results=[
                ScoredOut(id=d.id, score=1.0, lexicalScore=0.0, originalScore=d.originalScore)
                for d in body.documents
            ],
            model=MODEL_NAME,
            tookMs=0,
        )

    started = time.perf_counter()
    scored = rerank(
        body.query,
        [Document(id=d.id, text=d.text, original_score=d.originalScore) for d in body.documents],
        top_k=body.topK,
    )
    took_ms = int((time.perf_counter() - started) * 1000)

    return RerankOut(
        results=[
            ScoredOut(
                id=s.id,
                score=s.score,
                lexicalScore=s.lexical_score,
                originalScore=s.original_score,
            )
            for s in scored
        ],
        model=MODEL_NAME,
        tookMs=took_ms,
    )
