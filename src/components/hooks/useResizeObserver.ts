"use client";
/**
 * Content-box size of a ref'd element, updated through ResizeObserver (which
 * delivers an initial notification on observe, so no synchronous measure is
 * needed). `{0, 0}` until the element mounts.
 */
import { useEffect, useState, type RefObject } from "react";

export interface Size {
  width: number;
  height: number;
}

export function useResizeObserver(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
