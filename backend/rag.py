"""Ingestion and retrieval.

One persisted Chroma collection holds every document; chunks carry a `doc_id`
so retrieval can be scoped to the document the user is asking about. A small
JSON file next to it keeps the human-facing catalogue (filename, page count,
upload time) that Chroma has no good place for.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_core.documents import Document
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

DATA_DIR = Path(os.getenv("DATA_DIR", "./data"))
CATALOGUE = DATA_DIR / "documents.json"

# Google retires embedding models: a 404 from the embed call means this name is
# gone. Swap it, then delete DATA_DIR — vectors from two models can't be compared.
EMBEDDING_MODEL = "models/gemini-embedding-001"

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200
MAX_UPLOAD_BYTES = 20 * 1024 * 1024

_store: Chroma | None = None


class IngestError(ValueError):
    """Upload rejected — message is safe to show the user."""


def store() -> Chroma:
    """Lazily open the vector store so import doesn't require an API key."""
    global _store
    if _store is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        _store = Chroma(
            collection_name="documents",
            embedding_function=GoogleGenerativeAIEmbeddings(
                model=EMBEDDING_MODEL
            ),
            persist_directory=str(DATA_DIR / "chroma"),
        )
    return _store


def catalogue() -> list[dict]:
    if not CATALOGUE.exists():
        return []
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


# ponytail: whole-file rewrite, single process. Move the catalogue into Chroma's
# own collection metadata or a real table if this ever runs on >1 worker.
def _save_catalogue(docs: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CATALOGUE.write_text(json.dumps(docs, indent=2), encoding="utf-8")


def get_document(doc_id: str) -> dict | None:
    return next((d for d in catalogue() if d["id"] == doc_id), None)


def ingest(filename: str, content: bytes) -> dict:
    """PDF bytes -> chunks -> embeddings -> Chroma. Returns the catalogue entry."""
    if not filename.lower().endswith(".pdf"):
        raise IngestError("Only PDF files are supported.")
    if not content:
        raise IngestError("That file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise IngestError(
            f"That file is {len(content) / 1e6:.1f} MB — the limit is "
            f"{MAX_UPLOAD_BYTES // 1_000_000} MB."
        )

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    try:
        pages = PyPDFLoader(tmp_path).load()
    except Exception as exc:  # pypdf raises a zoo of exception types
        raise IngestError("That PDF could not be read — it may be corrupt.") from exc
    finally:
        os.unlink(tmp_path)

    chunks = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        add_start_index=True,
    ).split_documents(pages)
    chunks = [c for c in chunks if c.page_content.strip()]

    if not chunks:
        raise IngestError(
            "No selectable text found. Scanned PDFs need OCR before they can be indexed."
        )

    doc_id = uuid.uuid4().hex[:12]
    for chunk in chunks:
        chunk.metadata = {
            "doc_id": doc_id,
            "filename": filename,
            # PyPDFLoader pages are 0-indexed; humans are not.
            "page": int(chunk.metadata.get("page", 0)) + 1,
        }

    store().add_documents(chunks)

    entry = {
        "id": doc_id,
        "filename": filename,
        "pages": len(pages),
        "chunks": len(chunks),
        "bytes": len(content),
        "uploaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    _save_catalogue([entry, *catalogue()])
    return entry


def delete(doc_id: str) -> bool:
    if not get_document(doc_id):
        return False
    store().delete(where={"doc_id": doc_id})
    _save_catalogue([d for d in catalogue() if d["id"] != doc_id])
    return True


def retrieve(doc_id: str, question: str, k: int = 5) -> list[Document]:
    hits = store().similarity_search(question, k=k, filter={"doc_id": doc_id})
    if hits:
        return hits

    # Chroma's HNSW index occasionally never returns a vector it stored — rare,
    # permanent for that record, and reproducible on small indexes across
    # chromadb 1.3-1.5. Without this fallback a short document can answer every
    # question with "not in the document" while its text sits in the store.
    # ponytail: plain metadata fetch, no ranking. Short docs only, which is
    # exactly when top-k and "the whole document" are the same thing.
    raw = store().get(
        where={"doc_id": doc_id}, limit=k, include=["documents", "metadatas"]
    )
    return [
        Document(page_content=text, metadata=meta)
        for text, meta in zip(raw["documents"], raw["metadatas"])
    ]
