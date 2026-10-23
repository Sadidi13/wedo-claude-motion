"use client";
/**
 * Editor side of the Claude Desktop bridge (docs/CLAUDE-DESKTOP.md). Mounted
 * once by the editor; it
 *
 *   - elects one editor tab per browser as the one Claude works with (Web Locks:
 *     the tab holding the lock leads; the next one takes over when it closes, or
 *     when the user clicks "Use this tab"),
 *   - in the leading tab only: shares the open project with the server
 *     (PUT /api/bridge/project, debounced) and polls /api/bridge/events to apply
 *     scenes / edits Claude pushed (that poll is also the editor's heartbeat),
 *   - in every tab: polls /api/bridge/status for the Ask Claude tab, and the one
 *     Ask Claude request this tab queued, applying its answer.
 *
 * Without the Web Locks API (very old browsers) every tab leads, as before.
 */
import { useEffect } from "react";
import type { AiEditResponse, BridgeEvent, BridgeRequestView, BridgeStatus } from "@/lib/types";
import { applyAiResult } from "@/store/aiApply";
import { useBridgeStore } from "@/store/bridgeStore";
import { chatKeyFor, errorMessage, useEditorStore } from "@/store/editorStore";

const SYNC_DEBOUNCE_MS = 800;
const STATUS_EVERY_MS = 2_500;
const EVENTS_EVERY_MS = 1_500;
const REQUEST_EVERY_MS = 1_000;
const EVENT_ID = /^[0-9a-z]{15}$/;
const LEADER_LOCK = "wedo-claude-motion:editor-leader";
/** Events applied from the URL; module-level so React's double-run of effects in development cannot apply one twice. */
const appliedFromUrl = new Set<string>();

async function getJson<T>(url: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as T | null;
  return { status: response.status, body };
}

function shorten(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function applyEvent(event: BridgeEvent): void {
  const store = useEditorStore.getState();
  if (event.type === "project") {
    store.loadProject(event.project);
    const loaded = useEditorStore.getState();
    loaded.appendChat("scene", { role: "assistant", content: event.summary, status: "applied" });
    loaded.setNotice({ kind: "info", message: `Claude created “${event.project.name}”` });
    return;
  }
  if (store.project?.id !== event.projectId) {
    store.setNotice({ kind: "warning", message: "Claude edited a project that is not open here, so the edit was skipped" });
    return;
  }
  const scope = event.response.scope;
  const layerId = event.layerId ?? null;
  const key = chatKeyFor(scope, layerId);
  if (event.prompt.trim()) store.appendChat(key, { role: "user", content: event.prompt.trim() });
  const applied = applyAiResult(event.response, { scope, layerId, key, prompt: event.prompt });
  useEditorStore.getState().setNotice(
    applied
      ? { kind: "info", message: `Claude: ${shorten(event.response.summary)}` }
      : { kind: "error", message: "Claude sent an edit that could not be applied (see Ask Claude)" },
  );
}

export function useBridgeSync(): void {
  useEffect(() => {
    let disposed = false;
    const leading = () => useBridgeStore.getState().isLeader === true;

    // 1. Share the open project (leader only; debounced; only when the project object changed).
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSynced: unknown = null;
    const syncNow = () => {
      syncTimer = null;
      const { project } = useEditorStore.getState();
      if (!leading() || !project || project === lastSynced) return;
      lastSynced = project;
      void fetch("/api/bridge/project", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(project),
      }).catch(() => {
        lastSynced = null; // retry on the next change
      });
    };
    const scheduleSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(syncNow, SYNC_DEBOUNCE_MS);
    };
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.project !== previous.project) scheduleSync();
    });

    // 2. Status (every tab: the Ask Claude tab shows it).
    const pollStatus = async () => {
      try {
        const { status, body } = await getJson<BridgeStatus>("/api/bridge/status");
        if (!disposed) useBridgeStore.getState().setStatus(status === 200 ? body : null, status !== 200);
      } catch {
        if (!disposed) useBridgeStore.getState().setStatus(null, true);
      }
    };
    void pollStatus();
    const statusTimer = setInterval(() => void pollStatus(), STATUS_EVERY_MS);

    // 3. Events pushed by Claude (leader only).
    let cursor: string | null = null;
    let eventsBusy = false;
    const pollEvents = async () => {
      if (eventsBusy || !leading()) return;
      eventsBusy = true;
      try {
        const url = cursor === null ? "/api/bridge/events" : `/api/bridge/events?after=${encodeURIComponent(cursor)}`;
        const { status, body } = await getJson<{ events: BridgeEvent[]; cursor: string }>(url);
        if (disposed || !leading() || status !== 200 || !body) return;
        const first = cursor === null;
        cursor = body.cursor;
        if (first) return;
        for (const event of body.events) {
          try {
            applyEvent(event);
          } catch (error) {
            useEditorStore.getState().setNotice({ kind: "error", message: `Could not apply a change from Claude: ${errorMessage(error)}` });
          }
        }
      } catch {
        // server restarting: try again on the next tick
      } finally {
        eventsBusy = false;
      }
    };
    const eventsTimer = setInterval(() => void pollEvents(), EVENTS_EVERY_MS);

    // 0. Leadership. A tab that becomes leader shares its project at once and starts reading events
    //    from "now" (events before that were applied by the previous leader).
    const onLeadershipChange = (isLeader: boolean) => {
      useBridgeStore.getState().setLeader(isLeader);
      if (!isLeader) return;
      lastSynced = null;
      cursor = null;
      scheduleSync();
      void pollEvents();
    };
    let releaseLock: (() => void) | null = null;
    let waiting: AbortController | null = null;
    let activeRequest = 0;
    const requestLeadership = (steal: boolean) => {
      const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
      if (!locks) {
        onLeadershipChange(true);
        return;
      }
      const id = ++activeRequest;
      waiting?.abort();
      waiting = steal ? null : new AbortController();
      const options: LockOptions = steal ? { steal: true } : { signal: waiting!.signal };
      void locks
        .request(LEADER_LOCK, options, () => {
          if (disposed || id !== activeRequest) return Promise.resolve();
          waiting = null;
          onLeadershipChange(true);
          return new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
        })
        .catch(() => undefined) // aborted (unmount / take-over) or stolen by another tab
        .finally(() => {
          if (disposed || id !== activeRequest) return;
          releaseLock = null;
          onLeadershipChange(false);
          requestLeadership(false); // wait for our turn: the leading tab closes or hands over
        });
      if (!steal) {
        // A queued request does not say it is waiting: when another tab holds the lock, this tab follows.
        void locks
          .query()
          .then(({ held }) => {
            if (disposed || id !== activeRequest || useBridgeStore.getState().isLeader === true) return;
            if (held?.some((lock) => lock.name === LEADER_LOCK)) onLeadershipChange(false);
          })
          .catch(() => undefined);
      }
    };
    useBridgeStore.getState().setTakeOver(() => requestLeadership(true));

    // 3b. Opened by Claude with ?event=<id> (no editor tab was open): this tab leads and applies it once.
    const opened = new URLSearchParams(window.location.search).get("event");
    const openedByClaude = opened !== null && EVENT_ID.test(opened) && !appliedFromUrl.has(opened);
    requestLeadership(openedByClaude);
    if (openedByClaude) {
      void getJson<BridgeEvent>(`/api/bridge/events/${opened}`)
        .then(({ status, body }) => {
          if (disposed || appliedFromUrl.has(opened)) return;
          appliedFromUrl.add(opened);
          const url = new URL(window.location.href);
          url.searchParams.delete("event");
          window.history.replaceState(null, "", url.toString());
          if (status === 200 && body) applyEvent(body);
          else useEditorStore.getState().setNotice({ kind: "warning", message: "The scene Claude made is no longer available" });
        })
        .catch(() => undefined);
    }

    // 4. The Ask Claude request this tab queued (every tab: answers go to the tab that asked).
    let requestBusy = false;
    const pollRequest = async () => {
      const pending = useBridgeStore.getState().pending;
      if (!pending || requestBusy) return;
      requestBusy = true;
      try {
        const { status, body } = await getJson<BridgeRequestView>(`/api/bridge/requests/${encodeURIComponent(pending.id)}`);
        if (disposed || useBridgeStore.getState().pending?.id !== pending.id) return;
        const ctx = { scope: pending.scope, layerId: pending.layerId, key: pending.key, prompt: pending.prompt };
        const finish = (result: AiEditResponse | { ok: false; code: string; error: string }) => {
          useBridgeStore.getState().setPending(null);
          applyAiResult(result, ctx);
        };
        if (status === 404) {
          finish({ ok: false, code: "bridge_lost", error: "The request disappeared from the server" });
        } else if (status === 200 && body) {
          if (body.state === "done" && body.result) finish(body.result);
          else if (body.state === "error") finish({ ok: false, code: "declined", error: body.error ?? "Claude declined the request" });
          else if (body.state === "cancelled") useBridgeStore.getState().setPending(null);
        }
      } catch {
        // keep waiting
      } finally {
        requestBusy = false;
      }
    };
    const requestTimer = setInterval(() => void pollRequest(), REQUEST_EVERY_MS);

    return () => {
      disposed = true;
      waiting?.abort();
      releaseLock?.();
      useBridgeStore.getState().setTakeOver(null);
      unsubscribe();
      if (syncTimer) clearTimeout(syncTimer);
      clearInterval(statusTimer);
      clearInterval(eventsTimer);
      clearInterval(requestTimer);
    };
  }, []);
}
