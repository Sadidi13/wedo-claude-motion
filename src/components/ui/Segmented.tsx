"use client";
/** Segmented control (tabs / scope switch): one highlighted option out of a few. */
import type { ReactNode } from "react";
import { cx } from "./cx";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  /** stretch options to fill the row */
  block?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, size = "md", className, block }: SegmentedProps<T>) {
  return (
    <div role="tablist" className={cx("inline-flex rounded border border-border bg-panel p-0.5", block && "flex w-full", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            title={option.title}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              "ms-focus rounded-[3px] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]",
              block && "flex-1",
              selected ? "bg-panel-3 text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
