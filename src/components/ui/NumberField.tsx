"use client";
/**
 * Number input that commits on blur / Enter (not on every keystroke, so a
 * half-typed "1." never reaches the parser). Escape restores the value.
 */
import { useId, useState, type KeyboardEvent } from "react";
import { cx } from "./cx";

interface NumberFieldProps {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** text shown after the input (e.g. "px", "f 45") */
  suffix?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  id?: string;
  decimals?: number;
}

function format(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(decimals)));
}

export function NumberField({ value, onCommit, min, max, step, suffix, disabled, title, className, id, decimals = 3 }: NumberFieldProps) {
  const autoId = useId();
  const [draft, setDraft] = useState(() => format(value, decimals));
  const [seen, setSeen] = useState(value);
  // "adjust state when a prop changes" (React docs pattern): resync the draft when the outside value moves.
  if (seen !== value) {
    setSeen(value);
    setDraft(format(value, decimals));
  }

  const commit = () => {
    const parsed = Number(draft.trim());
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(format(value, decimals));
      return;
    }
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setDraft(format(next, decimals));
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(format(value, decimals));
      event.currentTarget.blur();
    }
  };

  return (
    <span className={cx("inline-flex items-center gap-1", className)}>
      <input
        id={id ?? autoId}
        type="number"
        inputMode="decimal"
        className="ms-input w-full select-text font-mono tabular-nums"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        title={title}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix && <span className="shrink-0 text-[11px] text-muted tabular-nums">{suffix}</span>}
    </span>
  );
}
