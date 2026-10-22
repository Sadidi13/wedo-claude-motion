"use client";
/**
 * Centered modal dialog: dimmed backdrop, Escape / backdrop click to close,
 * focus moves into the panel on open. Rendered inline (the editor owns the
 * whole viewport, so no portal is needed).
 */
import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";
import { IconButton } from "./IconButton";

interface ModalProps {
  title: string;
  onClose: () => void;
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, onClose, width = 520, footer, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{ width, maxWidth: "100%" }}
        className={cx("ms-focus flex max-h-[90vh] flex-col rounded-lg border border-border-strong bg-panel-2 shadow-2xl outline-none")}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <IconButton title="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="ms-scroll min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">{footer}</div>}
      </div>
    </div>
  );
}
