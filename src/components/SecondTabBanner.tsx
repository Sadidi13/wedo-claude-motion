"use client";
/**
 * Shown in every editor tab except the one Claude works with (see useBridgeSync): that other tab
 * shares its project with Claude and receives Claude's scenes and edits. "Use this tab" moves the
 * connection here.
 */
import { MonitorSmartphone } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useBridgeStore } from "@/store/bridgeStore";
import { Button } from "./ui/Button";

export function SecondTabBanner() {
  const { isLeader, takeOver } = useBridgeStore(useShallow((s) => ({ isLeader: s.isLeader, takeOver: s.takeOver })));
  if (isLeader !== false) return null;
  return (
    <div
      role="status"
      className="fixed left-1/2 top-12 z-40 flex max-w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-md border border-accent-2/40 bg-panel-2 px-3 py-2 text-[12px] text-foreground shadow-lg"
    >
      <MonitorSmartphone size={16} className="shrink-0 text-accent-2" />
      <span className="min-w-0 flex-1">
        Claude is connected to another WeDo Claude Motion tab. Scenes and edits from Claude appear there, and this
        tab&apos;s project is not shared with Claude.
      </span>
      <Button size="sm" variant="primary" disabled={!takeOver} onClick={() => takeOver?.()}>
        Use this tab
      </Button>
    </div>
  );
}
