"use client";
/** Labelled checkbox row. */
import { useId } from "react";
import { cx } from "./cx";

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function Checkbox({ label, checked, onChange, disabled, title, className }: CheckboxProps) {
  const id = useId();
  return (
    <label htmlFor={id} title={title} className={cx("inline-flex cursor-pointer items-center gap-2 text-[12px]", disabled && "cursor-not-allowed opacity-50", className)}>
      <input
        id={id}
        type="checkbox"
        className="ms-check ms-focus h-3.5 w-3.5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
