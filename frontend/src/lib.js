const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");

/**
 * fetch() rejects with a bare "Failed to fetch" for both a dead server and a
 * CORS rejection — the browser deliberately refuses to say which. Name both,
 * since the fix is completely different.
 */
async function call(path, init) {
  try {
    return await fetch(`${BASE}${path}`, init);
  } catch (cause) {
    if (cause.name === "AbortError") throw cause; // the user pressed stop
    throw new Error(
      `Could not reach the API at ${BASE} — either it is not running, or it is ` +
        `refusing requests from ${location.origin} (check ALLOWED_ORIGINS in backend/.env).`,
      { cause },
    );
  }
}

async function unwrap(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export const listDocuments = () => call("/api/documents").then(unwrap);

export const deleteDocument = (id) =>
  call(`/api/documents/${id}`, { method: "DELETE" }).then(unwrap);

export function uploadDocument(file) {
  const form = new FormData();
  form.append("file", file);
  return call("/api/documents", { method: "POST", body: form }).then(unwrap);
}

/**
 * Ask a question and consume the server-sent event stream.
 * `onEvent` receives {type: "sources"|"token"|"error"|"done", ...} as it arrives.
 */
export async function ask({ docId, question, history, signal, onEvent }) {
  const res = await call("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ doc_id: docId, question, history }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${res.status})`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // SSE frames are separated by a blank line; keep the trailing partial.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const payload = frame.replace(/^data: ?/, "");
      if (payload) onEvent(JSON.parse(payload));
    }
  }
}

export const formatBytes = (n) =>
  n < 1_000_000 ? `${Math.round(n / 1000)} KB` : `${(n / 1_000_000).toFixed(1)} MB`;

export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
