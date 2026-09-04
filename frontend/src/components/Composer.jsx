import { useState } from "react";
import { ArrowUpIcon, StopIcon } from "./icons";

export default function Composer({ disabled, streaming, placeholder, onSubmit, onStop }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const question = value.trim();
    if (!question || disabled || streaming) return;
    setValue("");
    onSubmit(question);
  };

  return (
    <div className="shrink-0 border-t border-line bg-paper">
      <div className="mx-auto w-full max-w-[46rem] px-6 py-4 sm:px-10">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 transition focus-within:border-faint">
          {/* field-sizing grows the box with the question — no resize observer needed. */}
          <textarea
            rows={1}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            className="field-sizing-content max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
          />
          {streaming ? (
            <button
              onClick={onStop}
              aria-label="Stop generating"
              className="shrink-0 rounded-lg border border-line p-2 text-muted transition hover:text-ink"
            >
              <StopIcon width={15} height={15} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || !value.trim()}
              aria-label="Ask"
              className="shrink-0 rounded-lg bg-ink p-2 text-paper transition disabled:opacity-25"
            >
              <ArrowUpIcon width={15} height={15} />
            </button>
          )}
        </div>
        <p className="label mt-2.5 text-center">
          Grounded in the selected document · Enter to send
        </p>
      </div>
    </div>
  );
}
