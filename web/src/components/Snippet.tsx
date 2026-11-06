"use client";

import { useState } from "react";

/** A titled block of text to copy: button code, a link, or a prompt. `long` keeps tall text scrollable. */
export function Snippet({
  title,
  note,
  code,
  disabled,
  primary,
  long,
  placeholder,
}: {
  title: string;
  note?: string;
  code: string;
  disabled?: boolean;
  primary?: boolean;
  long?: boolean;
  placeholder?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {note && <div className="text-xs text-muted">{note}</div>}
        </div>
        <button type="button" className={`btn ${primary ? "btn-accent" : "btn-ghost"} !py-1 !px-3 text-sm ml-auto shrink-0`} onClick={copy} disabled={disabled || !code}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={`p-4 text-xs font-mono whitespace-pre-wrap ${long ? "break-words max-h-56 overflow-y-auto" : "break-all"}`}>{code || placeholder}</pre>
    </div>
  );
}
