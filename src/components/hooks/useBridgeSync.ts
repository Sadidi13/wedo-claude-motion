"use client";
/**
 * Editor side of the Claude Desktop bridge (docs/CLAUDE-DESKTOP.md). Mounted
 * once by the editor; it
 *
 *   - shares the open project with the server (PUT /api/bridge/project,
 *     debounced) so Claude can read what the designer sees,
 *   - polls /api/bridge/status for the Ask Claude tab,
 *   - polls /api/bridge/events and applies scenes / edits Claude pushed from
 *     the desktop chat (new scene → new project; edit → undo-able change),
 *   - polls the one queued Ask Claude request and applies its answer.
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
    loaded.setNotice({ kind: "info", message: `Claude Desktop created “${event.project.name}”` });
    return;
  }
  if (store.project?.id !== event.projectId) {
    store.setNotice({ kind: "warning", message: "Claude Desktop edited a project that is not open here, so the edit was skipped" });
    return;
  }
  const scope = event.response.scope;
  const layerId = event.layerId ?? null;
  const key = chatKeyFor(scope, layerId);
  if (event.prompt.trim()) store.appendChat(key, { role: "user", content: event.prompt.trim() });
  const applied = applyAiResult(event.response, { scope, layerId, key, prompt: event.prompt });
  useEditorStore.getState().setNotice(
    applied
      ? { kind: "info", message: `Claude Desktop: ${shorten(event.response.summary)}` }
      : { kind: "error", message: "Claude Desktop sent an edit that could not be applied (see Ask Claude)" },
  );
}

export function useBridgeSync(): void {
  useEffect(() => {
    let disposed = false;

    // 1. Share the open project (debounced; only when the project object changed).
    let syncTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSynced: unknown = null;
    const syncNow = () => {
      syncTimer = null;
      const { project } = useEditorStore.getState();
      if (!project || project === lastSynced) return;
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
    scheduleSync();
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.project !== previous.project) scheduleSync();
    });

    // 2. Status.
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

    // 3. Events pushed from the desktop chat.
    let cursor: string | null = null;
    let eventsBusy = false;
    const pollEvents = async () => {
      if (eventsBusy) return;
      eventsBusy = true;
      try {
        const url = cursor === null ? "/api/bridge/events" : `/api/bridge/events?after=${encodeURIComponent(cursor)}`;
        const { status, body } = await getJson<{ events: BridgeEvent[]; cursor: string }>(url);
        if (disposed || status !== 200 || !body) return;
        const first = cursor === null;
        cursor = body.cursor;
        if (first) return;
        for (const event of body.events) {
          try {
            applyEvent(event);
          } catch (error) {
            useEditorStore.getState().setNotice({ kind: "error", message: `Could not apply a Claude Desktop change: ${errorMessage(error)}` });
          }
        }
      } catch {
        // server restarting: try again on the next tick
      } finally {
        eventsBusy = false;
      }
    };
    void pollEvents();
    const eventsTimer = setInterval(() => void pollEvents(), EVENTS_EVERY_MS);

    // 3b. Opened by Claude with ?event=<id> (no editor tab was open): apply that scene / edit once.
    const opened = new URLSearchParams(window.location.search).get("event");
    if (opened && EVENT_ID.test(opened) && !appliedFromUrl.has(opened)) {
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

    // 4. The queued Ask Claude request.
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
      unsubscribe();
      if (syncTimer) clearTimeout(syncTimer);
      clearInterval(statusTimer);
      clearInterval(eventsTimer);
      clearInterval(requestTimer);
    };
  }, []);
}
