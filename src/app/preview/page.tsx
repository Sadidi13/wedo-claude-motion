"use client";
/**
 * /preview — the iframe page that hosts the Motion Studio runtime
 * (CONTRACTS.md §3). All behaviour lives in PreviewHost; this file only adds
 * the Suspense boundary that `useSearchParams` requires and an inline script
 * that buffers postMessages arriving before hydration (see messaging.ts).
 */

import { Suspense } from "react";
import { PRE_HYDRATION_QUEUE_SCRIPT } from "./messaging";
import PreviewHost from "./PreviewHost";

export default function PreviewPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PRE_HYDRATION_QUEUE_SCRIPT }} />
      <Suspense fallback={null}>
        <PreviewHost />
      </Suspense>
    </>
  );
}
