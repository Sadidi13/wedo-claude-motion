"use client";
/** Label + control row used by the inspector forms and dialogs. */
import type { ReactNode } from "react";
import { cx } from "./cx";

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}

export function Field({ label, hint, htmlFor, className, children }: FieldProps) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}
