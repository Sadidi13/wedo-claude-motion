"use client";
/**
 * loadProject — evaluates a Project in the browser and mounts its root element
 * (CONTRACTS.md §3). Flow:
 *
 *   1. build the module table, evaluate the entry file through the mini
 *      module system (react / react-dom shim / lucide-react / three / runtime builtins);
 *   2. pick the root element: the entry's default export component, or the
 *      node captured from `ReactDOM.createRoot(...).render(...)`;
 *   3. render it into `mount` with the real `createRoot`, inside an error
 *      boundary; wait for the commit, then one animation frame;
 *   4. if no `[data-stage]` appeared (plain HTML project) re-render wrapped in
 *      <Stage {...project.meta}> and emit a warning.
 *
 * Errors during the initial render reject the promise (the caller keeps its
 * previous frame); errors after that are reported through `opts.onError`.
 */

import React, { Component, useLayoutEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as lucide from "lucide-react";
import * as THREE from "three";
import type { Project, StageMeta } from "@/lib/types";
import * as runtime from "@/runtime";
import { motionWindow } from "@/runtime/globals";
import { LoadError } from "./errors";
import { createModuleSystem } from "./modules";
import { normalisePath } from "./paths";
import { buildFileTable } from "./resolve";
import { asEsModule, createReactDomShim } from "./shims";

export interface LoadErrorInfo {
  message: string;
  stack?: string;
}

export interface LoadOptions {
  /** start with the stage background removed (alpha export) */
  transparent?: boolean;
  /** runtime errors thrown after the initial render (React error boundary) */
  onError?: (error: LoadErrorInfo) => void;
  /** non-fatal notices, e.g. "no <Stage> found, wrapped in one" */
  onWarning?: (message: string) => void;
}

export interface LoadResult {
  meta: StageMeta;
  unmount: () => void;
}

// ---------------------------------------------------------------------------
// React helpers
// ---------------------------------------------------------------------------

/** Resolves its promise once the subtree has been committed to the DOM. */
function Committed({ onCommit, children }: { onCommit: () => void; children: ReactNode }) {
  useLayoutEffect(() => {
    onCommit();
  }, [onCommit]);
  return children;
}

interface BoundaryProps {
  onError: (error: unknown) => void;
  children: ReactNode;
}

/** Outer boundary for errors thrown outside the Stage (e.g. in the scene component body). */
class LoaderBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function toErrorInfo(error: unknown): LoadErrorInfo {
  if (error instanceof Error) return { message: error.message, stack: error.stack };
  return { message: String(error) };
}

function isComponentLike(value: unknown): value is React.ComponentType {
  if (typeof value === "function") return true;
  // memo / forwardRef / lazy wrappers are objects tagged with $$typeof
  return typeof value === "object" && value !== null && "$$typeof" in value && !React.isValidElement(value);
}

function pickRootElement(entryExports: unknown, captured: ReactNode | undefined, entry: string): ReactNode {
  const def = (entryExports as { default?: unknown } | null)?.default;
  if (isComponentLike(def)) return React.createElement(def);
  if (React.isValidElement(def)) return def;
  if (captured !== undefined) return captured;
  throw new LoadError(
    `Entry file '${entry}' has no default export component and never called ReactDOM.render / createRoot(...).render`,
    entry,
  );
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** A scene that suspends forever (e.g. React.lazy without data) would otherwise hang the editor. */
const COMMIT_TIMEOUT_MS = 10_000;

function withCommitTimeout(commit: Promise<void>, entry: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(new LoadError(`'${entry}' did not finish its first render within ${COMMIT_TIMEOUT_MS / 1000}s`, entry)),
      COMMIT_TIMEOUT_MS,
    );
  });
  return Promise.race([commit, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// CSS injection (one <style data-file="…"> per project css file)
// ---------------------------------------------------------------------------

function createCssInjector() {
  const touched = new Set<string>();
  const inject = (path: string, css: string) => {
    touched.add(path);
    const existing = document.querySelector<HTMLStyleElement>(`style[data-file="${CSS.escape(path)}"]`);
    if (existing) {
      if (existing.textContent !== css) existing.textContent = css;
      return;
    }
    const style = document.createElement("style");
    style.dataset.file = path;
    style.textContent = css;
    document.head.appendChild(style);
  };
  /** remove styles of files that the (successfully) loaded project no longer has */
  const removeStale = () => {
    document.querySelectorAll<HTMLStyleElement>("style[data-file]").forEach((style) => {
      if (!touched.has(style.dataset.file ?? "")) style.remove();
    });
  };
  return { inject, removeStale };
}

// ---------------------------------------------------------------------------
// loadProject
// ---------------------------------------------------------------------------

export async function loadProject(project: Project, mount: HTMLElement, opts: LoadOptions = {}): Promise<LoadResult> {
  const files = buildFileTable(project.files);
  const entry = normalisePath(project.entry);
  const css = createCssInjector();

  let captured: ReactNode | undefined;
  const system = createModuleSystem({
    files,
    react: React,
    injectCss: css.inject,
    builtins: {
      react: asEsModule(React),
      "react-dom": createReactDomShim((node) => {
        captured = node;
      }),
      "lucide-react": asEsModule(lucide),
      three: asEsModule(THREE),
      runtime: asEsModule(runtime),
    },
  });

  const element = pickRootElement(system.load(entry), captured, entry);

  // Held in an object (not `let`s) because the closures below assign them after control-flow narrowing.
  const phase: { initialError: LoadErrorInfo | null; live: boolean } = { initialError: null, live: false };
  const report = (error: unknown) => {
    const info = toErrorInfo(error);
    if (phase.live) opts.onError?.(info);
    else phase.initialError ??= info;
  };
  // The Stage dispatches `motion:error` on its element (bubbles to window) or,
  // when the stage element is not mounted yet (first-render failure), on window
  // itself. Listening on window catches both; events from other mounts are ignored.
  const onMotionError = (event: Event) => {
    if (event.target instanceof Node && !mount.contains(event.target)) return;
    report((event as CustomEvent<{ error: unknown }>).detail?.error);
  };
  window.addEventListener("motion:error", onMotionError);

  const root = createRoot(mount);
  let renderCount = 0;
  const renderTree = (tree: ReactNode) =>
    withCommitTimeout(
      new Promise<void>((resolve) => {
        root.render(
          <Committed key={renderCount++} onCommit={resolve}>
            <LoaderBoundary onError={report}>{tree}</LoaderBoundary>
          </Committed>,
        );
      }),
      entry,
    );
  const unmount = () => {
    window.removeEventListener("motion:error", onMotionError);
    root.unmount();
  };

  try {
    await renderTree(element);
    if (!phase.initialError && !mount.querySelector("[data-stage]")) {
      opts.onWarning?.(`'${entry}' renders no <Stage>; wrapped it in a Stage using the project's meta`);
      await renderTree(<runtime.Stage {...project.meta}>{element}</runtime.Stage>);
    }
    if (phase.initialError) {
      throw new LoadError(phase.initialError.message, entry);
    }
    const w = motionWindow();
    if (opts.transparent) w?.__setTransparent?.(true);
    await nextFrame();
    phase.live = true;
    css.removeStale();
    return { meta: { ...project.meta, ...w?.__videoMeta }, unmount };
  } catch (error) {
    unmount();
    throw error;
  }
}
