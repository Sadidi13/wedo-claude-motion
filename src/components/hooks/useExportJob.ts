"use client";
/**
 * Drives one export job: POST /api/export → poll GET /api/export/<jobId>
 * every 700ms until `done` / `error`. Exposes the latest status for the
 * Export dialog's progress bar and download link.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportJobStatus, ExportRequest } from "@/lib/types";

export const EXPORT_POLL_MS = 700;

export interface ExportJob {
  status: ExportJobStatus | null;
  /** request-level failure (network, 4xx) — job errors are in `status.error` */
  error: string | null;
  starting: boolean;
  start: (request: ExportRequest) => Promise<void>;
  reset: () => void;
}

function isJobStatus(value: unknown): value is ExportJobStatus {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.jobId === "string" && typeof v.state === "string" && typeof v.progress === "number";
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: unknown })?.error;
    if (typeof message === "string") return message;
  } catch {
    // not JSON
  }
  return `HTTP ${response.status}`;
}

export function useExportJob(): ExportJob {
  const [status, setStatus] = useState<ExportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    activeRef.current = jobId;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const response = await fetch(`/api/export/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const body: unknown = await response.json();
        if (!isJobStatus(body)) throw new Error("Unexpected status response");
        if (activeRef.current !== jobId) return;
        setStatus(body);
        if (body.state === "done" || body.state === "error") return;
      } catch (err) {
        if (activeRef.current !== jobId) return;
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      timer = setTimeout(poll, EXPORT_POLL_MS);
    };
    void poll();
    return () => {
      if (timer) clearTimeout(timer);
      if (activeRef.current === jobId) activeRef.current = null;
    };
  }, [jobId]);

  const start = useCallback(async (request: ExportRequest) => {
    setStarting(true);
    setError(null);
    setStatus(null);
    setJobId(null);
    try {
      const response = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body: unknown = await response.json();
      const id = (body as { jobId?: unknown })?.jobId;
      if (typeof id !== "string") throw new Error("Export did not return a job id");
      setJobId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, []);

  const reset = useCallback(() => {
    activeRef.current = null;
    setJobId(null);
    setStatus(null);
    setError(null);
  }, []);

  return { status, error, starting, start, reset };
}
