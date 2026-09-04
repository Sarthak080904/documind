import { useEffect, useRef, useState } from "react";
import { plural } from "../lib";
import { ChevronIcon } from "./icons";

// Answers come back as light markdown. Rather than pull in a renderer we handle
// the three things the model actually emits — emphasis, code spans, and the
// [n] citations, which have to become interactive rather than stay as text.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g;
const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

function Inline({ text, onCite }) {
  return text
    .split(INLINE)
    .filter(Boolean)
    .map((part, i) => {
      if (/^\*\*.+\*\*$/.test(part))
        return (
          <strong key={i} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        );
      if (/^`.+`$/.test(part))
        return (
          <code key={i} className="rounded bg-raised px-1 py-0.5 font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        );
      if (/^\[\d+\]$/.test(part)) {
        const n = Number(part.slice(1, -1));
        return (
          <button
            key={i}
            onClick={() => onCite(n)}
            title={`Show excerpt ${n}`}
            className="mx-px rounded-[3px] bg-signal-soft px-[3px] align-super font-mono text-[9.5px] font-medium text-signal tabular-nums transition hover:brightness-95"
          >
            {n}
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
}

function Prose({ text, onCite }) {
  // Group consecutive lines into runs so a lead-in sentence followed by bullets
  // ("Three commitments carry hard dates:" + list) renders as prose then a list,
  // which is how the model actually writes.
  const out = [];

  for (const block of text.trim().split(/\n{2,}/)) {
    let run = [];
    let kind = null;
    const flush = () => {
      if (!run.length) return;
      const key = out.length;
      const items = run.map((l) => l.replace(BULLET, "").replace(NUMBERED, ""));

      if (kind === "bullet") {
        out.push(
          <ul key={key} className="my-3 space-y-2">
            {items.map((item, i) => (
              <li key={i} className="relative pl-5">
                <span className="absolute left-0 top-[0.72em] size-1 rounded-full bg-signal" />
                <Inline text={item} onCite={onCite} />
              </li>
            ))}
          </ul>,
        );
      } else if (kind === "number") {
        out.push(
          <ol
            key={key}
            className="my-3 list-decimal space-y-2 pl-6 marker:font-mono marker:text-[12px] marker:text-signal marker:tabular-nums"
          >
            {items.map((item, i) => (
              <li key={i} className="pl-1">
                <Inline text={item} onCite={onCite} />
              </li>
            ))}
          </ol>,
        );
      } else {
        out.push(
          <p key={key} className="my-3 first:mt-0 last:mb-0">
            <Inline text={run.join(" ")} onCite={onCite} />
          </p>,
        );
      }
      run = [];
    };

    for (const line of block.split("\n")) {
      if (!line.trim()) continue;
      const lineKind = BULLET.test(line) ? "bullet" : NUMBERED.test(line) ? "number" : "text";
      if (kind !== null && lineKind !== kind) flush();
      kind = lineKind;
      run.push(line);
    }
    flush();
  }

  return out;
}

function Sources({ sources, highlight, expanded, onToggle }) {
  const refs = useRef({});

  useEffect(() => {
    if (expanded && highlight) {
      refs.current[highlight]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [expanded, highlight]);

  return (
    <div className="mt-5 border-t border-line pt-3">
      <button
        onClick={onToggle}
        className="label flex items-center gap-1.5 transition hover:text-muted"
      >
        <ChevronIcon
          width={12}
          height={12}
          className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
        {plural(sources.length, "retrieved excerpt")}
      </button>

      {expanded && (
        <ol className="mt-3 space-y-2">
          {sources.map((s) => (
            <li
              key={s.n}
              ref={(el) => (refs.current[s.n] = el)}
              className={`rounded-md border px-3 py-2.5 transition-colors ${
                highlight === s.n ? "border-signal bg-signal-soft" : "border-line bg-surface"
              }`}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[10px] font-medium text-signal tabular-nums">
                  [{s.n}]
                </span>
                <span className="label">page {s.page}</span>
              </div>
              <p className="mt-1.5 line-clamp-6 text-[12.5px] leading-relaxed text-muted">
                {s.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function Message({ message, streaming }) {
  const [expanded, setExpanded] = useState(false);
  const [highlight, setHighlight] = useState(null);

  if (message.role === "user") {
    return (
      <article className="animate-[--animate-rise] border-l-2 border-signal pl-4">
        <p className="label mb-2">You asked</p>
        <h2 className="font-display text-[23px] leading-[1.35] tracking-[-0.01em]">
          {message.content}
        </h2>
      </article>
    );
  }

  const cite = (n) => {
    setExpanded(true);
    setHighlight(n);
  };

  return (
    <article className="animate-[--animate-rise]">
      {message.error ? (
        <p className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-[14px] text-danger">
          {message.error}
        </p>
      ) : (
        <div className="text-[15.5px] leading-[1.75] text-ink/90">
          {message.content ? (
            <Prose text={message.content} onCite={cite} />
          ) : (
            <p className="label animate-[--animate-blink]">Reading the document…</p>
          )}
          {streaming && message.content && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-[--animate-blink] bg-signal" />
          )}
        </div>
      )}

      {!streaming && message.sources?.length > 0 && (
        <Sources
          sources={message.sources}
          highlight={highlight}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </article>
  );
}
