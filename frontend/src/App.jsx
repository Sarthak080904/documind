import { useCallback, useEffect, useRef, useState } from "react";
import Composer from "./components/Composer";
import Conversation from "./components/Conversation";
import Library from "./components/Library";
import { MenuIcon } from "./components/icons";
import { ask, deleteDocument, listDocuments, uploadDocument } from "./lib";

const nextId = () => Math.random().toString(36).slice(2);

function useTheme() {
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem("documind-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"),
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("documind-theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [chats, setChats] = useState({}); // one thread per document
  const [status, setStatus] = useState("connecting");
  const [uploading, setUploading] = useState(null);
  const [notice, setNotice] = useState(null);
  const [streamingId, setStreamingId] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const abort = useRef(null);

  const doc = docs.find((d) => d.id === activeId) ?? null;
  const messages = chats[activeId] ?? [];

  useEffect(() => {
    listDocuments()
      .then((list) => {
        setDocs(list);
        setActiveId((id) => id ?? list[0]?.id ?? null);
        setStatus("ready");
      })
      .catch(() => setStatus("offline"));
  }, []);

  // Auto-dismiss the toast, but let a new one reset the clock.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const patchLast = (docId, patch) =>
    setChats((prev) => {
      const thread = prev[docId] ?? [];
      const last = thread[thread.length - 1];
      if (!last) return prev;
      return { ...prev, [docId]: [...thread.slice(0, -1), { ...last, ...patch(last) }] };
    });

  const handleUpload = async (file) => {
    setUploading(file.name);
    try {
      const entry = await uploadDocument(file);
      setDocs((prev) => [entry, ...prev]);
      setActiveId(entry.id);
      setDrawer(false);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteDocument(id);
    } catch (err) {
      setNotice(err.message);
      return;
    }
    setDocs((prev) => {
      const rest = prev.filter((d) => d.id !== id);
      setActiveId((current) => (current === id ? (rest[0]?.id ?? null) : current));
      return rest;
    });
    setChats(({ [id]: _removed, ...rest }) => rest);
  };

  const handleAsk = useCallback(
    async (question) => {
      if (!activeId || streamingId) return;
      const docId = activeId;
      const answerId = nextId();
      const history = (chats[docId] ?? [])
        .filter((m) => m.content && !m.error)
        .map(({ role, content }) => ({ role, content }));

      setChats((prev) => ({
        ...prev,
        [docId]: [
          ...(prev[docId] ?? []),
          { id: nextId(), role: "user", content: question },
          { id: answerId, role: "assistant", content: "", sources: [] },
        ],
      }));
      setStreamingId(answerId);
      abort.current = new AbortController();

      try {
        await ask({
          docId,
          question,
          history,
          signal: abort.current.signal,
          onEvent: (event) => {
            if (event.type === "sources") patchLast(docId, () => ({ sources: event.sources }));
            else if (event.type === "token")
              patchLast(docId, (m) => ({ content: m.content + event.text }));
            else if (event.type === "error") patchLast(docId, () => ({ error: event.message }));
          },
        });
      } catch (err) {
        if (err.name !== "AbortError") patchLast(docId, () => ({ error: err.message }));
      } finally {
        setStreamingId(null);
        abort.current = null;
      }
    },
    [activeId, chats, streamingId],
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <Library
        docs={docs}
        activeId={activeId}
        onSelect={(id) => {
          setActiveId(id);
          setDrawer(false);
        }}
        onUpload={handleUpload}
        onDelete={handleDelete}
        uploading={uploading}
        status={status}
        theme={theme}
        onToggleTheme={toggleTheme}
        open={drawer}
        onClose={() => setDrawer(false)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5 sm:px-10">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open library"
            className="-ml-1 rounded p-1.5 text-muted hover:text-ink lg:hidden"
          >
            <MenuIcon />
          </button>
          {doc ? (
            <>
              <span className="min-w-0 truncate text-[13px] font-medium">{doc.filename}</span>
              <span className="label hidden shrink-0 tabular-nums sm:inline">
                {doc.pages} pages · {doc.chunks} passages
              </span>
            </>
          ) : (
            <span className="label">No document selected</span>
          )}
        </header>

        <Conversation
          doc={doc}
          messages={messages}
          streamingId={streamingId}
          onAsk={handleAsk}
        />

        <Composer
          disabled={!doc || status === "offline"}
          streaming={Boolean(streamingId)}
          placeholder={
            status === "offline"
              ? "Backend unreachable — start the API and reload"
              : doc
                ? "Ask about this document"
                : "Upload a document to begin"
          }
          onSubmit={handleAsk}
          onStop={() => abort.current?.abort()}
        />
      </main>

      {notice && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-[--animate-rise] rounded-lg border border-line bg-surface px-4 py-2.5 text-[13px] shadow-lg shadow-ink/5"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
