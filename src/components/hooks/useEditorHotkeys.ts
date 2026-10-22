"use client";
/**
 * Global keyboard shortcuts (CONTRACTS §4): Space play/pause, ←/→ frame step,
 * Shift+←/→ one second, Delete removes the selected layer, Ctrl/Cmd+Z undo,
 * Ctrl/Cmd+Shift+Z (or Ctrl+Y) redo, Ctrl/Cmd+D duplicate, H toggle hidden,
 * Escape clears the selection. Ignored while typing in a form control.
 */
import { useEffect } from "react";
import { useEditorStore } from "@/store/editorStore";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useEditorHotkeys(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const store = useEditorStore.getState();
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key;
      const onButton = event.target instanceof HTMLButtonElement;

      if (mod && (key === "z" || key === "Z")) {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (mod && (key === "y" || key === "Y")) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (mod && (key === "d" || key === "D")) {
        event.preventDefault();
        if (store.selectedId) store.duplicateLayer(store.selectedId);
        return;
      }
      if (mod) return;

      switch (key) {
        case " ":
          if (onButton) return; // let the focused button handle Space itself
          event.preventDefault();
          store.togglePlay();
          return;
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) store.stepSeconds(-1);
          else store.stepFrames(-1);
          return;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) store.stepSeconds(1);
          else store.stepFrames(1);
          return;
        case "Home":
          event.preventDefault();
          store.pause();
          store.seek(0);
          return;
        case "End":
          event.preventDefault();
          store.pause();
          store.seek(Number.MAX_SAFE_INTEGER);
          return;
        case "Delete":
        case "Backspace":
          if (store.selectedId) {
            event.preventDefault();
            store.deleteLayer(store.selectedId);
          }
          return;
        case "h":
        case "H": {
          const node = store.selectedId ? store.scene?.byId[store.selectedId] : undefined;
          if (node) {
            event.preventDefault();
            store.setHidden(node.id, !node.hidden);
          }
          return;
        }
        case "Escape":
          store.select(null);
          return;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
