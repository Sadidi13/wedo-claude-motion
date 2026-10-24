/**
 * JSX templates for the "+ Text / + Image / + Shape / + Sound" buttons and the
 * small source helpers around them (clip placement at the playhead, asset
 * paths, making sure `Sprite` / `Audio` are imported). Pure string builders —
 * the parser's `insertLayer` assigns the `data-layer-id`s.
 */

export interface ClipTiming {
  start: number;
  end: number;
}

/** A `length`-second clip starting at the playhead, pulled back so it fits inside the stage. */
export function clipAtPlayhead(time: number, duration: number, fps: number, length = 2): ClipTiming {
  const snap = (t: number) => (fps > 0 ? Math.round(t * fps) / fps : t);
  const frame = fps > 0 ? 1 / fps : 0.01;
  const clipLength = Math.min(length, Math.max(frame, duration));
  const latestStart = Math.max(0, duration - clipLength);
  const start = snap(Math.min(Math.max(0, time), latestStart));
  return { start, end: snap(Math.min(duration, start + clipLength)) };
}

function spriteOpen(timing: ClipTiming, name: string): string {
  return `<Sprite start={${timing.start}} end={${timing.end}} data-layer-name="${name}">`;
}

/** Centred headline that fades in over the first quarter of its clip. */
export function textLayerTemplate(timing: ClipTiming, stage: { width: number; height: number }): string {
  const fontSize = Math.max(24, Math.round(Math.min(stage.width, stage.height) * 0.08));
  return `${spriteOpen(timing, "Text")}
  {({ progress }) => (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: \`translate(-50%, -50%) translateY(\${(1 - Math.min(1, progress * 4)) * 24}px)\`,
        opacity: Math.min(1, progress * 4),
        color: "#ffffff",
        fontSize: ${fontSize},
        fontWeight: 700,
        fontFamily: "system-ui, sans-serif",
        letterSpacing: -0.5,
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      New text
    </div>
  )}
</Sprite>`;
}

export type ShapeKind = "rect" | "circle";

/** A centred 200×200 box (rounded or circular) in the accent colour, scaling in. */
export function shapeLayerTemplate(timing: ClipTiming, kind: ShapeKind, stage: { width: number; height: number }): string {
  const size = Math.max(40, Math.round(Math.min(stage.width, stage.height) * 0.28));
  const name = kind === "circle" ? "Circle" : "Rectangle";
  const radius = kind === "circle" ? '"50%"' : "16";
  return `${spriteOpen(timing, name)}
  {({ progress }) => (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        width: ${size},
        height: ${size},
        transform: \`translate(-50%, -50%) scale(\${Math.min(1, progress * 3)})\`,
        background: "#7c9cff",
        borderRadius: ${radius},
      }}
    />
  )}
</Sprite>`;
}

/** An image asset fitted inside 80% of the stage, centred. */
export function imageLayerTemplate(timing: ClipTiming, assetPath: string, name: string): string {
  return `${spriteOpen(timing, escapeAttr(name))}
  <img
    src="${assetPath}"
    alt="${escapeAttr(name)}"
    style={{
      position: "absolute",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      maxWidth: "80%",
      maxHeight: "80%",
      objectFit: "contain",
    }}
  />
</Sprite>`;
}

export interface AudioTemplateOptions {
  /** project asset path, or a built-in sound in `sfx` */
  src?: string;
  sfx?: string;
  start: number;
  /** omitted: the clip plays its own length */
  end?: number;
  name: string;
  volume?: number;
  loop?: boolean;
}

/** One <Audio> clip layer (a direct child of the Stage). */
export function audioLayerTemplate(options: AudioTemplateOptions): string {
  const attrs = [
    options.src ? `src="${escapeAttr(options.src)}"` : `sfx="${escapeAttr(options.sfx ?? "")}"`,
    `start={${options.start}}`,
    options.end !== undefined ? `end={${options.end}}` : "",
    options.volume !== undefined && options.volume !== 1 ? `volume={${options.volume}}` : "",
    options.loop ? "loop" : "",
    `data-layer-name="${escapeAttr(options.name)}"`,
  ].filter(Boolean);
  return `<Audio ${attrs.join(" ")} />`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** "assets/<safe file name>", suffixed with -2, -3… while `taken` already has it. */
export function assetPathFor(fileName: string, taken: Iterable<string>): string {
  const existing = new Set(taken);
  const dot = fileName.lastIndexOf(".");
  const rawBase = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = rawBase.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "image";
  const withExt = (stem: string) => (ext ? `assets/${stem}.${ext}` : `assets/${stem}`);
  let candidate = withExt(base);
  for (let i = 2; existing.has(candidate); i++) candidate = withExt(`${base}-${i}`);
  return candidate;
}

const RUNTIME_IMPORT = /import\s*\{([^}]*)\}\s*from\s*(["'])(\.\/animations(?:\.jsx|\.js|\.tsx|\.ts)?|@motion\/runtime|motion-runtime)\2\s*;?/;

/**
 * Make sure the entry file imports `name` (`Sprite`, `Audio`) from the runtime
 * (templates and wrapInSprite emit them). Extends the existing runtime
 * import's named list, or adds one after the last import when there is none.
 */
export function ensureRuntimeImport(source: string, name: string): string {
  const match = RUNTIME_IMPORT.exec(source);
  if (match) {
    const names = match[1].split(",").map((n) => n.trim()).filter(Boolean);
    if (names.some((n) => n === name || n.startsWith(`${name} as`))) return source;
    const spacer = match[1].trim() ? " " : "";
    const replacement = match[0].replace(match[1], `${spacer}${[...names, name].join(", ")} `);
    return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
  }
  if (new RegExp(`\\b${name}\\b`).test(source.split(/<Stage\b/)[0])) return source; // declared or imported some other way
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const line = `import { ${name} } from "./animations.jsx";${eol}`;
  const imports = [...source.matchAll(/^import\b[^\n]*\n?/gm)];
  if (imports.length === 0) return line + source;
  const last = imports[imports.length - 1];
  const at = (last.index ?? 0) + last[0].length;
  return source.slice(0, at) + line + source.slice(at);
}

/** `ensureRuntimeImport(source, "Sprite")`. */
export function ensureSpriteImport(source: string): string {
  return ensureRuntimeImport(source, "Sprite");
}
