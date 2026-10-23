/**
 * Client state of the Claude Desktop bridge: the last polled status and the
 * one request the editor is waiting on. Kept outside the Ask Claude tab so a
 * request survives switching inspector tabs; `useBridgeSync` (mounted once by
 * the editor) does the polling and applies the answer.
 */
import { create } from "zustand";
import type { AiScope, BridgeStatus } from "@/lib/types";

export interface PendingBridgeRequest {
  id: string;
  scope: AiScope;
  layerId: string | null;
  key: string;
  prompt: string;
  /** epoch ms when the request was queued */
  sentAt: number;
}

/** A listener seen this recently is only between requests (Claude is answering, then re-arms). */
export const RECENT_LISTENER_MS = 90_000;

interface BridgeState {
  /**
   * Whether this tab is the one Claude works with. Only one editor tab per browser shares its project
   * and applies Claude's scenes and edits; null until the election settled.
   */
  isLeader: boolean | null;
  setLeader(isLeader: boolean): void;
  /** Make this tab the one Claude works with (set by useBridgeSync while it is mounted). */
  takeOver: (() => void) | null;
  setTakeOver(takeOver: (() => void) | null): void;
  status: BridgeStatus | null;
  /** the listener polled within RECENT_LISTENER_MS (computed when the status arrives) */
  recentlyActive: boolean;
  /** true when /api/bridge/status could not be reached on the last poll */
  unreachable: boolean;
  pending: PendingBridgeRequest | null;
  setStatus(status: BridgeStatus | null, unreachable?: boolean): void;
  setPending(pending: PendingBridgeRequest | null): void;
}

export const useBridgeStore = create<BridgeState>()((set) => ({
  isLeader: null,
  setLeader: (isLeader) => set({ isLeader }),
  takeOver: null,
  setTakeOver: (takeOver) => set({ takeOver }),
  status: null,
  recentlyActive: false,
  unreachable: false,
  pending: null,
  setStatus: (status, unreachable = false) =>
    set({
      status,
      unreachable,
      recentlyActive: status?.lastSeen != null && Date.now() - status.lastSeen < RECENT_LISTENER_MS,
    }),
  setPending: (pending) => set({ pending }),
}));

/** Claude Desktop counts as connected while a session listens or works on a request. */
export function isDesktopConnected(status: BridgeStatus | null): boolean {
  return status?.listener === "listening" || status?.listener === "busy";
}
