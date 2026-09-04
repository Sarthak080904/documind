import { useEffect, useRef } from "react";
import Message from "./Message";

const SUGGESTIONS = [
  "Summarise this in five bullet points",
  "What are the key findings?",
  "List every date and deadline mentioned",
  "What questions does this document leave open?",
];

function Blank({ title, children }) {
  return (
    <div className="flex min-h-full flex-col justify-center py-16">
      <h2 className="max-w-[18ch] font-display text-[34px] leading-[1.15] tracking-[-0.015em] sm:text-[42px]">
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function Conversation({ doc, messages, streamingId, onAsk }) {
  const scroller = useRef(null);
  const pinned = useRef(true);

  // Follow the stream, but stop fighting the user the moment they scroll away.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scroller.current;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  return (
    <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full w-full max-w-[46rem] px-6 sm:px-10">
        {!doc ? (
          <Blank title="Start with a document.">
            <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-muted">
              Upload a PDF and DocuMind splits it into passages, embeds them, and stores
              them in a vector index. Ask a question and it retrieves only the passages
              that matter — the answer is written from those, and cites the page each
              claim came from.
            </p>
            <ol className="mt-8 space-y-3 border-t border-line pt-6">
              {[
                ["01", "Chunk", "Recursive splitting into overlapping passages"],
                ["02", "Embed", "gemini-embedding-001 vectors persisted in ChromaDB"],
                ["03", "Retrieve", "Top-k nearest passages for your question"],
                ["04", "Answer", "Gemini 2.5 Flash writes from those passages only"],
              ].map(([n, step, detail]) => (
                <li key={n} className="flex gap-4">
                  <span className="label pt-1 tabular-nums">{n}</span>
                  <span className="text-[14px]">
                    <span className="font-medium">{step}</span>
                    <span className="text-muted"> — {detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Blank>
        ) : messages.length === 0 ? (
          <Blank title="Ask anything about this document.">
            <p className="mt-5 text-[14px] text-muted">
              <span className="text-ink">{doc.filename}</span> — {doc.pages} pages indexed as{" "}
              {doc.chunks} passages.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onAsk(s)}
                  className="rounded-full border border-line bg-surface px-3.5 py-2 text-left text-[13px] text-muted transition hover:border-faint hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </Blank>
        ) : (
          <div className="space-y-10 py-10">
            {messages.map((m) => (
              <Message key={m.id} message={m} streaming={m.id === streamingId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
