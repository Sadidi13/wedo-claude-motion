"use client";
/**
 * 16px lucide icon button used across the panels. `title` is mandatory (it
 * doubles as the accessible name); `active` renders the pressed state.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  active?: boolean;
  danger?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
}

export function IconButton({ title, active, danger, size = "md", className, children, type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cx(
        "ms-focus inline-flex shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        size === "sm" ? "h-5 w-5" : "h-7 w-7",
        active ? "bg-accent/20 text-accent" : "text-muted hover:bg-panel-3 hover:text-foreground",
        danger && "hover:text-danger",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
