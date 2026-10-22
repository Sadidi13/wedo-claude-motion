"use client";
/** Text button with the editor's variants and an optional loading spinner. */
import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type Variant = "default" | "primary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  default: "border border-border bg-panel-2 text-foreground hover:bg-panel-3",
  primary: "bg-accent text-[#0b0d14] font-semibold hover:brightness-110",
  ghost: "text-muted hover:bg-panel-3 hover:text-foreground",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  type = "button",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        "ms-focus inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-6 px-2 text-[11.5px]" : "h-7 px-2.5 text-[12px]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}
