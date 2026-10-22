"use client";
/** Polls GET /api/ai/status once on mount: is ANTHROPIC_API_KEY configured, which model. */
import { useEffect, useState } from "react";

export type AiStatus =
  | { state: "loading" }
  | { state: "ready"; model: string }
  | { state: "unconfigured"; model: string }
  | { state: "error"; message: string };

function isStatusBody(value: unknown): value is { configured: boolean; model: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { configured?: unknown }).configured === "boolean" &&
    typeof (value as { model?: unknown }).model === "string"
  );
}

export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ai/status", { cache: "no-store" })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok || !isStatusBody(body)) throw new Error(`HTTP ${response.status}`);
        if (!cancelled) setStatus(body.configured ? { state: "ready", model: body.model } : { state: "unconfigured", model: body.model });
      })
      .catch((error: unknown) => {
        if (!cancelled) setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}
