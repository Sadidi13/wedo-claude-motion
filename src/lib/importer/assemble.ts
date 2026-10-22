/**
 * Turns extracted scene code into a loadable `scene.jsx` (CONTRACTS §7):
 *
 *   - merges imports when concatenated <script> blocks repeat them or use CDN
 *     URLs (a clean file keeps its import lines untouched);
 *   - when there is no <Stage>: wraps the element passed to
 *     `ReactDOM.createRoot(…).render(…)`, else wraps the root component
 *     (`export default` / Scene / App / …) in `<Stage {...meta}>`, else wraps
 *     static HTML markup, else emits an empty Stage;
 *   - appends `export default` for a Stage-rendering component that has none;
 *   - adds the runtime / React imports the code relies on as globals.
 *
 * All changes to the author's code are offset splices; nothing is regenerated.
 */
import type { StageMeta } from "@/lib/types";
import { analyseModule, type DeclarationInfo, type ModuleAnalysis } from "./ast";
import {
  RUNTIME_SPECIFIER,
  bindsLocal,
  ensureDefaultImport,
  ensureNamedImport,
  mergeImports,
  renderImports,
  type MergedImport,
} from "./imports";
import { describeMeta, stageMetaProps } from "./meta";

export interface AssembleInput {
  /** concatenated scene code (may be empty) */
  code: string;
  /** side-effect imports prepended to the file, e.g. ["./styles.css"] */
  cssImports: readonly string[];
  /** meta used for a generated <Stage> */
  fallbackMeta: StageMeta;
  /** body markup to wrap when the page has no React code at all */
  staticHtml?: string;
}

export interface AssembleResult {
  source: string;
  warnings: string[];
  /** a <Stage> was generated around the original content */
  wrapped: boolean;
  /** `staticHtml` became the scene content */
  staticHtmlUsed: boolean;
}

/** Name of the component we append when the original code has no Stage-rendering root. */
const ROOT_COMPONENT = "MotionStudioRoot";
const PREFERRED_ROOTS = ["Scene", "App", "Animation", "Main", "Root"];
const RUNTIME_EXPORTS = [
  "Stage", "Sprite", "useTime", "useTimeline", "useSprite", "useStage",
  "Easing", "interpolate", "animate", "clamp", "lerp",
];

interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Apply non-overlapping edits computed against the same original string. */
function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const edit of ordered) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

/** Extend a statement's end over its line terminator so removing it leaves no blank line. */
function throughLineEnd(source: string, end: number): number {
  let e = end;
  while (source[e] === " " || source[e] === "\t") e++;
  if (source[e] === "\r") e++;
  if (source[e] === "\n") return e + 1;
  return end;
}

function stageWrapper(props: string, inner: string): string {
  return [
    `export default function ${ROOT_COMPONENT}() {`,
    "  return (",
    `    <Stage ${props}>`,
    ...(inner ? inner.split("\n").map((line) => `      ${line}`) : []),
    "    </Stage>",
    "  );",
    "}",
  ].join("\n");
}

/** The component most likely to be the scene root: preferred names, then the one containing the Stage, then the last. */
function pickRoot(a: ModuleAnalysis): DeclarationInfo | undefined {
  const preferred = PREFERRED_ROOTS.map((name) => a.components.find((c) => c.name === name)).find(Boolean);
  if (preferred) return preferred;
  if (a.stageStart !== null) {
    const stage = a.stageStart;
    const container = a.components.find((c) => c.start <= stage && stage < c.end);
    if (container) return container;
  }
  return a.components[a.components.length - 1];
}

/**
 * Make the default-exported thing available under a plain name so it can be
 * rendered inside a generated Stage. Returns the name, pushing the edits that
 * remove / rewrite the `export default` statement.
 */
function detachDefaultExport(source: string, def: NonNullable<ModuleAnalysis["defaultExport"]>, edits: Edit[]): string {
  const innerName = `${ROOT_COMPONENT}Inner`;
  if (def.name && def.isDeclaration) {
    edits.push({ start: def.start, end: def.declarationStart, text: "" });
    return def.name;
  }
  if (def.name) {
    edits.push({ start: def.start, end: throughLineEnd(source, def.end), text: "" });
    return def.name;
  }
  edits.push({ start: def.start, end: def.declarationStart, text: `const ${innerName} = ` });
  return innerName;
}

function usesIdentifier(code: string, name: string): boolean {
  return new RegExp(`(^|[^\\w$.])${name}\\b`).test(code);
}

export function assembleScene(input: AssembleInput): AssembleResult {
  const warnings: string[] = [];
  const code = input.code.trim();
  const cssLines = input.cssImports.map((path) => `import ${JSON.stringify(path)};`);

  const result = analyseModule(code);
  if (!result.ok) {
    warnings.push(`The scene code could not be parsed (${result.error}); it was imported unchanged`);
    return { source: [...cssLines, code].filter(Boolean).join("\n") + "\n", warnings, wrapped: false, staticHtmlUsed: false };
  }
  const a = result.analysis;
  const merge = mergeImports(a.imports);
  for (const source of merge.unsupported) {
    warnings.push(
      `Import "${source}" cannot be loaded inside Motion Studio (only react, react-dom, lucide-react, the runtime and project files are available)`,
    );
  }
  const edits: Edit[] = merge.changed
    ? a.imports.map((imp) => ({ start: imp.start, end: throughLineEnd(code, imp.end), text: "" }))
    : [];

  const props = stageMetaProps(input.fallbackMeta);
  const appended: string[] = [];
  let wrapped = false;
  let staticHtmlUsed = false;

  if (a.stageStart !== null) {
    if (!a.defaultExport && !a.renderCall) {
      const root = pickRoot(a);
      if (root) appended.push(`export default ${root.name};`);
      else {
        warnings.push(
          "The scene renders a <Stage> but has no default export and no ReactDOM render call; add `export default` to the scene component",
        );
      }
    }
  } else if (a.renderCall) {
    edits.push({ start: a.renderCall.argStart, end: a.renderCall.argStart, text: `<Stage ${props}>` });
    edits.push({ start: a.renderCall.argEnd, end: a.renderCall.argEnd, text: "</Stage>" });
    wrapped = true;
    warnings.push(`No <Stage> found; the rendered root was wrapped in a Stage (${describeMeta(input.fallbackMeta)})`);
  } else {
    const rootName = a.defaultExport ? detachDefaultExport(code, a.defaultExport, edits) : pickRoot(a)?.name;
    if (rootName) {
      appended.push(stageWrapper(props, `<${rootName} />`));
      wrapped = true;
      warnings.push(`No <Stage> found; <${rootName}> was wrapped in a Stage (${describeMeta(input.fallbackMeta)})`);
    } else if (input.staticHtml) {
      appended.push(`const STATIC_MARKUP = ${JSON.stringify(input.staticHtml)};`);
      appended.push(
        stageWrapper(
          props,
          [
            `<Sprite start={0} end={${input.fallbackMeta.duration}} data-layer-name="HTML markup">`,
            `  <div style={{ position: "absolute", inset: 0 }} dangerouslySetInnerHTML={{ __html: STATIC_MARKUP }} />`,
            "</Sprite>",
          ].join("\n"),
        ),
      );
      wrapped = true;
      staticHtmlUsed = true;
      warnings.push(
        `The page has no React code; its static HTML was placed in one Stage layer (${describeMeta(input.fallbackMeta)}) as raw markup`,
      );
    } else {
      appended.push(stageWrapper(props, ""));
      wrapped = true;
      warnings.push(`No scene content was found; an empty Stage (${describeMeta(input.fallbackMeta)}) was created`);
    }
  }

  const body = [applyEdits(code, edits).trim(), ...appended].filter(Boolean).join("\n\n");
  // When the original import lines are kept, additions go in a separate block above them.
  const additions: MergedImport[] = merge.changed ? merge.imports : [];
  repairImports({ body, jsx: a.hasJsx || appended.length > 0 }, a, merge.imports, additions, warnings);

  const header = [...cssLines, renderImports(additions)].filter(Boolean).join("\n");
  return { source: [header, body].filter(Boolean).join("\n\n") + "\n", warnings, wrapped, staticHtmlUsed };
}

/**
 * Add the React / ReactDOM / runtime imports that the code uses as globals
 * (Babel-standalone pages, generated wrappers). JSX needs `React` in scope
 * under the classic runtime, so any JSX counts as a use of `React`.
 */
function repairImports(
  code: { body: string; jsx: boolean },
  a: ModuleAnalysis,
  bound: readonly MergedImport[],
  target: MergedImport[],
  warnings: string[],
): void {
  const { body } = code;
  const declared = (name: string) => a.declared.has(name) || bindsLocal(bound, name);
  if (!declared("React") && (code.jsx || usesIdentifier(body, "React"))) ensureDefaultImport(target, bound, "react", "React");
  if (!declared("ReactDOM") && usesIdentifier(body, "ReactDOM")) {
    ensureDefaultImport(target, bound, "react-dom/client", "ReactDOM");
  }
  const runtimeNames = RUNTIME_EXPORTS.filter((name) => !declared(name) && usesIdentifier(body, name));
  if (runtimeNames.length) ensureNamedImport(target, bound, RUNTIME_SPECIFIER, runtimeNames);

  const ownRuntime = ["Stage", "Sprite"].filter((name) => a.declared.has(name) && !bindsLocal(bound, name));
  if (ownRuntime.length) {
    warnings.push(
      `The scene defines its own ${ownRuntime.join(" / ")} component instead of importing the runtime; Motion Studio's timeline and export hooks may not work until it imports from "./animations.jsx"`,
    );
  }
}
