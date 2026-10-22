/**
 * Stage-meta detection for imports that have no parseable <Stage> yet
 * (CONTRACTS §7): `<Stage width={…}>` literals → `window.__videoMeta = {…}`
 * → `<meta name="hz:canvas-width">` / `data-canvas-width` hints → defaults
 * (1920×1080, 10 s, 30 fps). The result is only a fallback: once the entry
 * file parses, `parseScene` is the source of truth.
 */
import type { StageMeta } from "@/lib/types";

export const DEFAULT_IMPORT_META: StageMeta = { width: 1920, height: 1080, duration: 10, fps: 30 };

export type MetaHints = Partial<StageMeta>;

const NUMERIC_KEYS = ["width", "height", "duration", "fps"] as const;

function positive(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Literal props of the first `<Stage …>` opening tag (`width={1280}`, `background="#000"`). */
export function readStageTagMeta(code: string): MetaHints {
  const open = /<Stage\b([^>]*)>/.exec(code);
  if (!open) return {};
  const attrs = open[1];
  const hints: MetaHints = {};
  for (const key of NUMERIC_KEYS) {
    const m = new RegExp(`\\b${key}\\s*=\\s*\\{\\s*(\\d+(?:\\.\\d+)?)\\s*\\}`).exec(attrs);
    const value = m ? positive(m[1]) : undefined;
    if (value !== undefined) hints[key] = value;
  }
  const bg = /\bbackground\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)')\s*\})/.exec(attrs);
  const background = bg?.[1] ?? bg?.[2] ?? bg?.[3] ?? bg?.[4];
  if (background) hints.background = background;
  return hints;
}

/** `window.__videoMeta = { width: 1920, height: 1080, duration: 12, fps: 30 }`. */
export function readVideoMeta(code: string): MetaHints {
  const m = /__videoMeta\s*=\s*\{([^}]*)\}/.exec(code);
  if (!m) return {};
  const hints: MetaHints = {};
  for (const key of NUMERIC_KEYS) {
    const prop = new RegExp(`\\b${key}\\s*:\\s*(\\d+(?:\\.\\d+)?)`).exec(m[1]);
    const value = prop ? positive(prop[1]) : undefined;
    if (value !== undefined) hints[key] = value;
  }
  return hints;
}

/** `<meta name="hz:canvas-width" content="1920">` and `data-canvas-width="1920"`. */
export function readHtmlMetaHints(
  metas: readonly Record<string, string>[],
  canvas: { width?: number; height?: number },
): MetaHints {
  const hints: MetaHints = {};
  for (const meta of metas) {
    const name = (meta.name ?? meta.property ?? "").toLowerCase();
    const value = positive(meta.content);
    if (value === undefined) continue;
    if (name === "hz:canvas-width" || name === "canvas-width") hints.width ??= value;
    if (name === "hz:canvas-height" || name === "canvas-height") hints.height ??= value;
  }
  hints.width ??= canvas.width;
  hints.height ??= canvas.height;
  if (hints.width === undefined) delete hints.width;
  if (hints.height === undefined) delete hints.height;
  return hints;
}

/** First defined value per key across the hints (highest priority first), then defaults. */
export function resolveMeta(...hints: MetaHints[]): StageMeta {
  const meta: StageMeta = { ...DEFAULT_IMPORT_META };
  for (const key of NUMERIC_KEYS) {
    const found = hints.map((h) => positive(h[key])).find((v) => v !== undefined);
    if (found !== undefined) meta[key] = found;
  }
  const background = hints.map((h) => h.background).find((b) => typeof b === "string" && b.length > 0);
  if (background) meta.background = background;
  return meta;
}

function formatNumber(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** JSX props for a generated `<Stage …>` tag. */
export function stageMetaProps(meta: StageMeta): string {
  const props = NUMERIC_KEYS.map((key) => `${key}={${formatNumber(meta[key])}}`);
  if (meta.background) props.push(`background="${meta.background.replace(/"/g, "&quot;")}"`);
  return props.join(" ");
}

/** "1920×1080, 10s, 30 fps" for warnings. */
export function describeMeta(meta: StageMeta): string {
  return `${formatNumber(meta.width)}×${formatNumber(meta.height)}, ${formatNumber(meta.duration)}s, ${formatNumber(meta.fps)} fps`;
}
