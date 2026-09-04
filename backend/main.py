"""DocuMind API — upload a PDF, ask questions, get answers grounded in it."""

from __future__ import annotations

import json
import logging
import os
from typing import AsyncIterator, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from langchain_core.documents import Document
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel, Field

import rag

load_dotenv()

log = logging.getLogger("documind")

CHAT_MODEL = "gemini-2.5-flash"

SYSTEM_PROMPT = """You are DocuMind. You answer questions using only the \
numbered excerpts from a document that are given to you.

Rules:
- Answer only from the excerpts. Never use outside knowledge, never guess.
- If the excerpts don't contain the answer, say so in one sentence and stop.
- Cite the excerpt you used inline as [1], [2] — immediately after the claim it
  supports, not collected at the end.
- Be direct. No preamble, no "based on the provided context", no restating the
  question. Prose by default; a list only when the answer is genuinely a list.
- Quote the document verbatim when the exact wording matters.
"""

app = FastAPI(title="DocuMind API", version="1.0.0")
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Nothing configured means local development: accept any localhost port. Vite
    # moves to 5174 when 5173 is taken, and a CORS mismatch is indistinguishable
    # from a dead backend in the UI. In production ALLOWED_ORIGINS is set and this
    # regex is never consulted.
    allow_origin_regex=None if ALLOWED_ORIGINS else r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

_llm: ChatGoogleGenerativeAI | None = None


def llm() -> ChatGoogleGenerativeAI:
    global _llm
    if _llm is None:
        _llm = ChatGoogleGenerativeAI(model=CHAT_MODEL, temperature=0.2)
    return _llm


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskRequest(BaseModel):
    doc_id: str
    question: str = Field(min_length=1, max_length=2000)
    history: list[Turn] = Field(default_factory=list, max_length=10)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "documents": len(rag.catalogue())}


@app.get("/api/documents")
def list_documents() -> list[dict]:
    return rag.catalogue()


@app.post("/api/documents", status_code=201)
async def upload_document(file: UploadFile = File(...)) -> dict:
    try:
        return rag.ingest(file.filename or "document.pdf", await file.read())
    except rag.IngestError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("indexing failed")
        raise HTTPException(status_code=502, detail=_upstream(exc)) from exc


@app.delete("/api/documents/{doc_id}", status_code=204, response_class=Response)
def delete_document(doc_id: str) -> Response:
    if not rag.delete(doc_id):
        raise HTTPException(status_code=404, detail="No such document.")
    return Response(status_code=204)


def _upstream(exc: Exception) -> str:
    """Turn a provider exception into one line a user can act on."""
    text = str(exc)
    if "not found" in text.lower() or "NOT_FOUND" in text:
        return (
            "The configured Google model is unavailable for this API key — it has "
            "most likely been retired. Update the model name in the backend."
        )
    if "API key" in text or "PERMISSION_DENIED" in text or "UNAUTHENTICATED" in text:
        return "Google rejected the API key. Check the GOOGLE_API_KEY environment variable."
    if "RESOURCE_EXHAUSTED" in text or "429" in text:
        return "Google's rate limit was hit. Wait a moment and try again."
    return "The embedding service failed. See the backend log for details."


def _prompt(question: str, history: list[Turn], excerpts: list[Document]) -> str:
    context = "\n\n".join(
        f"[{i}] (page {d.metadata['page']})\n{d.page_content.strip()}"
        for i, d in enumerate(excerpts, start=1)
    )
    parts = [SYSTEM_PROMPT, f"EXCERPTS\n{context}"]
    if history:
        prior = "\n".join(f"{t.role}: {t.content}" for t in history[-6:])
        parts.append(f"EARLIER IN THIS CONVERSATION\n{prior}")
    parts.append(f"QUESTION\n{question}")
    return "\n\n---\n\n".join(parts)


@app.post("/api/ask")
async def ask(req: AskRequest) -> StreamingResponse:
    if not rag.get_document(req.doc_id):
        raise HTTPException(status_code=404, detail="No such document.")

    # ponytail: the raw question is embedded as-is. Add a history-aware rewrite
    # step if follow-ups like "what about the second one?" start missing.
    try:
        excerpts = rag.retrieve(req.doc_id, req.question)
    except Exception as exc:
        log.exception("retrieval failed")
        raise HTTPException(status_code=502, detail=_upstream(exc)) from exc

    async def events() -> AsyncIterator[str]:
        def send(payload: dict) -> str:
            return f"data: {json.dumps(payload)}\n\n"

        yield send(
            {
                "type": "sources",
                "sources": [
                    {
                        "n": i,
                        "page": d.metadata["page"],
                        "text": d.page_content.strip(),
                    }
                    for i, d in enumerate(excerpts, start=1)
                ],
            }
        )
        if not excerpts:
            yield send({"type": "token", "text": "This document has no indexed text to search."})
            yield send({"type": "done"})
            return
        try:
            # `.text` flattens both shapes: older models stream plain strings,
            # newer ones stream lists of content blocks.
            async for chunk in llm().astream(_prompt(req.question, req.history, excerpts)):
                if chunk.text:
                    yield send({"type": "token", "text": chunk.text})
        except Exception as exc:
            yield send({"type": "error", "message": f"The model failed to respond: {exc}"})
        yield send({"type": "done"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
