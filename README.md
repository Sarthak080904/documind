# DocuMind

Upload a PDF, ask questions about it, get answers that cite the page they came
from. A working RAG system — retrieval is scoped to one document, and the model
is given nothing but the passages that were retrieved.

```
PDF ─▶ PyPDFLoader ─▶ RecursiveCharacterTextSplitter ─▶ gemini-embedding-001 ─▶ ChromaDB
                                                                                 │
question ──────────────────────────────── similarity search (filtered by doc) ◀──┘
                                                        │
                                          top-k passages ─▶ Gemini 2.5 Flash ─▶ streamed answer + citations
```

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 19 + Vite + Tailwind v4 | No CSS build config; theme is one set of custom properties |
| API | FastAPI | Async streaming falls out of `StreamingResponse` |
| Orchestration | LangChain | Loading, splitting, embedding, vector-store interface |
| Vectors | ChromaDB (persistent, local) | No signup, no service to run |
| Model | Gemini 2.5 Flash + `gemini-embedding-001` | Free tier |

## Run it

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env                             # then paste your GOOGLE_API_KEY
uvicorn main:app --reload
```

```bash
cd frontend
npm install
npm run dev                                      # http://localhost:5173
```

The frontend talks to `http://localhost:8000` unless `VITE_API_URL` says otherwise.

## Self-check

```bash
cd backend && python test_rag.py
```

Runs offline — embeddings are stubbed with a bag-of-words vector, so chunking,
page metadata, per-document filtering and citation numbering are all exercised
for real against a generated PDF.

## When something Google-side breaks

```bash
cd backend && python check_api.py
```

Prints which models your key can actually use, tries the two this app is
configured with, and names the cause when one fails - retired model, rejected
key, or exhausted free-tier quota. Run it first whenever an upload or a question
errors; it separates "my code is wrong" from "Google changed something" in one
command.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/health` | liveness + document count |
| `GET` | `/api/documents` | catalogue |
| `POST` | `/api/documents` | multipart PDF upload, returns the catalogue entry |
| `DELETE` | `/api/documents/{id}` | drops the chunks and the entry |
| `POST` | `/api/ask` | SSE stream: one `sources` event, then `token` events, then `done` |

## Design notes

**Retrieval is scoped, not global.** Every chunk carries a `doc_id`, and the
similarity search filters on it. Asking about one contract never pulls passages
from another — `test_retrieval_is_scoped_to_one_document` covers exactly that.

**Citations are load-bearing.** The prompt requires `[n]` markers inline, the
excerpts are numbered from one, and each marker in the UI is a button that opens
and highlights the passage it refers to. If the retrieved passages don't answer
the question, the model is told to say so rather than fill the gap.

**Answers stream.** The API yields the source list first, so the citation targets
exist before the text that references them arrives.

**Retrieval has a fallback.** Chroma's HNSW index occasionally never returns a
vector it stored — rare, permanent for that record, and reproducible across
chromadb 1.3–1.5 on small indexes. Left alone it makes a short document answer
every question with "that isn't in the document" while its text sits in the
store. So when vector search comes back empty for a document that has chunks,
`retrieve` falls back to fetching that document's passages by metadata. For a
document small enough to hit this, top-k and "the whole document" are the same
thing. `test_retrieval_falls_back_when_vector_search_returns_nothing` pins it.

## Deploying

**Backend → Render.** `render.yaml` is a blueprint; set `GOOGLE_API_KEY` and
`ALLOWED_ORIGINS` (your Vercel URL) in the dashboard. The free plan has no
persistent disk, so the index resets on redeploy — attach a disk at `/var/data`
to keep it.

**Frontend → Vercel.** Root directory `frontend`, framework preset Vite, and set
`VITE_API_URL` to the Render URL.

## When Google retires a model

Both model names are single constants — `EMBEDDING_MODEL` in `backend/rag.py`
and `CHAT_MODEL` in `backend/main.py`. A 404 from the API means that name is
gone; the app reports it as "the configured Google model is unavailable" rather
than a 500. After changing the embedding model, **delete `backend/data`** —
vectors written by two different embedders aren't comparable, and a stale index
would return nonsense instead of an error.

## Known limits

- **No auth.** Every visitor sees every uploaded document. Fine for a demo, not
  for anything real.
- **Follow-ups aren't rewritten.** "What about the second one?" is embedded as
  written rather than resolved against the conversation first, so retrieval for
  pronoun-heavy follow-ups is weaker than for standalone questions.
- **Scanned PDFs are rejected**, not OCR'd — the upload fails with a clear
  message rather than indexing an empty document.
- **The catalogue is a JSON file** rewritten on every change. Single-process
  only; concurrent uploads on multiple workers would race.
- **The retrieval fallback is unranked.** It returns the first `k` passages of
  the document rather than the most relevant ones. It only fires when vector
  search returns nothing at all, which in practice means a very short document.
