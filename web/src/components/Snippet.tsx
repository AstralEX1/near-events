"use client";

import { SlCopy } from "./SlUi";

/** A titled block of text to copy: button code, a link, or a prompt. `long` keeps tall text scrollable. */
export function Snippet({
  title,
  code,
  disabled,
  primary,
  long,
  placeholder,
}: {
  title: string;
  code: string;
  disabled?: boolean;
  primary?: boolean;
  long?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <div className="min-w-0 text-sm font-medium">{title}</div>
        {!disabled && code && <SlCopy text={code} className="ml-auto" />}
      </div>
      <pre className={`p-4 text-xs font-mono whitespace-pre-wrap ${long ? "break-words max-h-56 overflow-y-auto" : "break-all"}`}>{code || placeholder}</pre>
    </div>
  );
}
