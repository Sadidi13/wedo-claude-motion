"use client";
/**
 * Right-click menu anchored at a viewport position. Closes on outside
 * pointer-down, Escape, or after an item runs. Clamped so it stays on screen.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "./cx";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** draw a separator above this item */
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MENU_WIDTH = 200;
const ITEM_HEIGHT = 26;

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Only rendered after a pointer event, so `window` exists here.
  const height = items.length * ITEM_HEIGHT + 8;
  const left = Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 4));
  const top = Math.max(4, Math.min(y, window.innerHeight - height - 4));

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left, top, width: MENU_WIDTH, maxHeight: window.innerHeight - 8 }}
      className="ms-scroll fixed z-50 overflow-y-auto rounded-md border border-border-strong bg-panel-2 py-1 text-[12px] shadow-xl"
    >
      {items.map((item, index) => (
        <div key={item.label} className={cx(item.separator && index > 0 && "mt-1 border-t border-border pt-1")}>
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cx(
              "flex h-[26px] w-full items-center gap-2 px-2.5 text-left hover:bg-panel-3 disabled:cursor-not-allowed disabled:opacity-40",
              item.danger ? "text-danger" : "text-foreground",
            )}
          >
            <span className="flex w-4 items-center justify-center text-muted">{item.icon}</span>
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
