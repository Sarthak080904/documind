import { useRef, useState } from "react";
import { formatBytes } from "../lib";
import {
  CloseIcon,
  FileIcon,
  MoonIcon,
  SunIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <rect width="32" height="32" rx="7" className="fill-ink" />
        <path
          d="M10 9h8l4 4v10a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z"
          fill="none"
          className="stroke-paper"
          strokeWidth="1.8"
        />
        <path
          d="M12.5 17.5h7M12.5 20.5h4.5"
          className="stroke-signal"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <div className="leading-none">
        <h1 className="font-display text-[21px] tracking-tight">DocuMind</h1>
        <p className="label mt-1.5">Grounded document Q&amp;A</p>
      </div>
    </div>
  );
}

function Dropzone({ onFile, uploading }) {
  const [over, setOver] = useState(false);
  const input = useRef(null);

  if (uploading) {
    return (
      <div className="rounded-lg border border-line bg-surface px-3 py-3">
        <p className="truncate text-[13px] text-muted">Indexing {uploading}</p>
        <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-raised">
          <div className="h-full w-1/3 animate-[--animate-sweep] rounded-full bg-signal" />
        </div>
        <p className="label mt-2">Splitting · embedding · storing</p>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`rounded-lg border border-dashed transition-colors ${
        over ? "border-signal bg-signal-soft" : "border-line bg-surface hover:border-faint"
      }`}
    >
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="flex w-full flex-col items-center gap-2 px-3 py-5 text-center"
      >
        <UploadIcon className="text-faint" width={18} height={18} />
        <span className="text-[13px] font-medium">Add a PDF</span>
        <span className="text-[11px] text-faint">Drop it here, or browse · 20 MB max</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function DocumentRow({ doc, active, onSelect, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="rounded-md border border-line bg-raised px-3 py-2.5">
        <p className="truncate text-[13px]">Remove {doc.filename}?</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => onDelete(doc.id)}
            className="rounded border border-danger/40 px-2 py-1 text-[12px] text-danger hover:bg-danger/10"
          >
            Remove
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="rounded px-2 py-1 text-[12px] text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        onClick={() => onSelect(doc.id)}
        className={`w-full rounded-md py-2.5 pl-4 pr-9 text-left transition-colors ${
          active ? "bg-raised" : "hover:bg-raised/60"
        }`}
      >
        {active && (
          <span className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full bg-signal" />
        )}
        <div className="flex items-start gap-2.5">
          <FileIcon
            className={`mt-px shrink-0 ${active ? "text-signal" : "text-faint"}`}
            width={15}
            height={15}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-5">{doc.filename}</p>
            <p className="label mt-1 tabular-nums">
              {doc.pages}p · {doc.chunks} chunks · {formatBytes(doc.bytes)}
            </p>
          </div>
        </div>
      </button>
      <button
        onClick={() => setConfirming(true)}
        aria-label={`Remove ${doc.filename}`}
        className="absolute right-1.5 top-2.5 rounded p-1.5 text-faint opacity-0 transition hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </div>
  );
}

export default function Library({
  docs,
  activeId,
  onSelect,
  onUpload,
  onDelete,
  uploading,
  status,
  theme,
  onToggleTheme,
  open,
  onClose,
}) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-30 bg-ink/25 backdrop-blur-[2px] lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[280px] flex-col border-r border-line bg-paper transition-transform duration-300 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between px-5 pb-5 pt-5">
          <Wordmark />
          <button
            onClick={onClose}
            aria-label="Close library"
            className="-mr-1 rounded p-1 text-faint hover:text-ink lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-4">
          <Dropzone onFile={onUpload} uploading={uploading} />
        </div>

        <div className="flex items-baseline justify-between px-5 pb-2 pt-6">
          <span className="label">Library</span>
          <span className="label tabular-nums">{docs.length}</span>
        </div>

        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
          {docs.length === 0 ? (
            <p className="px-2 py-3 text-[12.5px] leading-relaxed text-faint">
              Nothing indexed yet. Uploaded documents stay available across sessions.
            </p>
          ) : (
            docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                active={doc.id === activeId}
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="label flex items-center gap-2">
            <span
              className={`size-1.5 rounded-full ${
                status === "ready"
                  ? "bg-signal"
                  : status === "offline"
                    ? "bg-danger"
                    : "bg-faint animate-[--animate-blink]"
              }`}
            />
            {status === "ready" ? "API connected" : status === "offline" ? "API offline" : "Connecting"}
          </span>
          <button
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            className="rounded p-1.5 text-faint transition hover:text-ink"
          >
            {theme === "dark" ? <SunIcon width={15} height={15} /> : <MoonIcon width={15} height={15} />}
          </button>
        </div>
      </aside>
    </>
  );
}
