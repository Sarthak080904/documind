"""Self-check for the retrieval pipeline: `python test_rag.py`.

Runs offline. Embeddings are stubbed with a deterministic bag-of-words vector so
the chunking, metadata, filtering and citation numbering are all exercised for
real — only the two Google API calls are stood in for.
"""

import hashlib
import os
import random
import tempfile

os.environ.setdefault("GOOGLE_API_KEY", "not-used-offline")
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="documind-test-")

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

import rag
from main import Turn, _prompt

DIMS = 256


class BagOfWords(Embeddings):
    """Word-overlap similarity — enough for 'does retrieval find the right page'.

    Each word gets a dense pseudo-random vector and a text is their normalised
    sum, so shared vocabulary means high cosine similarity — the same shape as a
    real embedder, unlike a sparse one-bucket-per-word hash.
    """

    def _vector(self, text: str) -> list[float]:
        vec = [0.0] * DIMS
        for word in text.lower().split():
            rng = random.Random(hashlib.md5(word.encode()).hexdigest())
            for i in range(DIMS):
                vec[i] += rng.gauss(0.0, 1.0)
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]

    def embed_documents(self, texts):
        return [self._vector(t) for t in texts]

    def embed_query(self, text):
        return self._vector(text)


def make_pdf(lines: list[str]) -> bytes:
    """A minimal but valid PDF — one line of extractable text per page."""
    objs, kids = [], []
    for i, line in enumerate(lines):
        page_no, content_no = 4 + i * 2, 5 + i * 2
        kids.append(f"{page_no} 0 R")
        stream = f"BT /F1 12 Tf 72 720 Td ({line}) Tj ET".encode("latin-1")
        objs.append((page_no, (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 3 0 R >> >> /Contents {content_no} 0 R >>"
        ).encode()))
        objs.append((content_no,
                     b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream)))

    all_objs = sorted([
        (1, b"<< /Type /Catalog /Pages 2 0 R >>"),
        (2, f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(lines)} >>".encode()),
        (3, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    ] + objs)

    out, offsets = bytearray(b"%PDF-1.4\n"), {}
    for num, body in all_objs:
        offsets[num] = len(out)
        out += b"%d 0 obj\n" % num + body + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(all_objs) + 1)
    for num, _ in all_objs:
        out += b"%010d 00000 n \n" % offsets[num]
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(all_objs) + 1, xref_at)
    return bytes(out)


# Prime the module-level store so ingest() never reaches for a real embedder.
rag._store = Chroma(
    collection_name="documents",
    embedding_function=BagOfWords(),
    persist_directory=os.path.join(os.environ["DATA_DIR"], "chroma"),
)


def test_upload_guards():
    before = len(rag.catalogue())
    for filename, content, expected in [
        ("notes.txt", b"hello", "Only PDF"),
        ("empty.pdf", b"", "empty"),
        ("huge.pdf", b"x" * (rag.MAX_UPLOAD_BYTES + 1), "limit is"),
        ("junk.pdf", b"not a pdf at all", "could not be read"),
    ]:
        try:
            rag.ingest(filename, content)
        except rag.IngestError as exc:
            assert expected in str(exc), f"{filename}: got {exc!r}"
        else:
            raise AssertionError(f"{filename} should have been rejected")

    assert len(rag.catalogue()) == before, "a rejected upload must not reach the catalogue"


def ingest_report():
    return rag.ingest("report.pdf", make_pdf([
        "The quarterly revenue was 42 million euros.",
        "The compliance deadline is 14 March 2027.",
    ]))


def test_ingest_indexes_every_page():
    entry = ingest_report()

    assert entry["pages"] == 2
    assert entry["chunks"] == 2
    assert rag.get_document(entry["id"]) == entry
    assert rag.catalogue()[0]["id"] == entry["id"], "newest document should sort first"


def test_retrieval_finds_the_right_page():
    entry = ingest_report()
    top = rag.retrieve(entry["id"], "how much revenue?", k=1)[0]

    assert "42 million" in top.page_content
    # PyPDF counts pages from zero; citations shown to the user must not.
    assert top.metadata["page"] == 1
    assert top.metadata["doc_id"] == entry["id"]


def test_retrieval_is_scoped_to_one_document():
    a = rag.ingest("a.pdf", make_pdf(["Alpha discusses budget forecasting."]))
    b = rag.ingest("b.pdf", make_pdf(["Beta discusses budget forecasting too."]))

    hits = rag.retrieve(a["id"], "budget forecasting", k=5)
    assert hits, "expected a hit in document A"
    assert {h.metadata["doc_id"] for h in hits} == {a["id"]}, "leaked chunks from another document"

    assert rag.delete(b["id"]) is True
    assert rag.get_document(b["id"]) is None
    assert rag.retrieve(b["id"], "budget forecasting") == []


def test_retrieval_falls_back_when_vector_search_returns_nothing():
    """Chroma occasionally never returns a vector it stored. Retrieval must fall
    back to the document's own passages instead of reporting an empty document —
    and the fallback must stay scoped to that document."""
    entry = rag.ingest("fallback.pdf", make_pdf(["Only passage about tariff schedules."]))
    rag.ingest("other.pdf", make_pdf(["An unrelated passage about tariff schedules."]))

    store = rag.store()
    store.similarity_search = lambda *args, **kwargs: []   # simulate the lost record
    try:
        hits = rag.retrieve(entry["id"], "tariff schedules", k=5)
    finally:
        del store.similarity_search

    assert hits, "fallback should surface the document's own passages"
    assert "Only passage" in hits[0].page_content
    assert {h.metadata["doc_id"] for h in hits} == {entry["id"]}


def test_prompt_numbers_excerpts_from_one():
    excerpts = [
        Document(page_content="Revenue grew 12%.", metadata={"page": 4}),
        Document(page_content="  Costs fell.  ", metadata={"page": 9}),
    ]
    prompt = _prompt("How did revenue do?", [Turn(role="user", content="hi")], excerpts)

    assert "[1] (page 4)" in prompt and "[2] (page 9)" in prompt
    assert "[0]" not in prompt
    assert "\nCosts fell.\n" in prompt, "excerpt text should be stripped"
    assert prompt.index("[1]") < prompt.index("[2]") < prompt.index("How did revenue do?")
    assert "user: hi" in prompt


def test_prompt_omits_empty_history():
    prompt = _prompt("q", [], [Document(page_content="x", metadata={"page": 1})])
    assert "EARLIER IN THIS CONVERSATION" not in prompt


if __name__ == "__main__":
    for name, fn in list(vars().items()):  # definition order
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("\nall checks passed")
