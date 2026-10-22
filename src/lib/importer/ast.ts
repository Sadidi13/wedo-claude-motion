/**
 * Lightweight static analysis of a scene module with @babel/parser: the
 * import declarations (with offsets, so they can be stripped and merged),
 * top-level bindings and capitalised component declarations, the default
 * export, a `ReactDOM.createRoot(...).render(<App/>)`-style render call and
 * whether a `<Stage>` element exists. Everything is reported as source
 * offsets so the assembler can splice the original text instead of
 * regenerating it (CONTRACTS §2 spirit: preserve the author's formatting).
 *
 * Deliberately dependency-light: a generic walker over VISITOR_KEYS instead of
 * @babel/traverse, so it behaves the same in vitest and in the browser bundle.
 */
import { parse } from "@babel/parser";
import { VISITOR_KEYS } from "@babel/types";
import type * as t from "@babel/types";

export interface ImportSpecifierInfo {
  imported: string;
  local: string;
}

export interface ImportInfo {
  source: string;
  defaultName?: string;
  namespace?: string;
  named: ImportSpecifierInfo[];
  /** `import type …` / `import { type X }`-only declarations have no runtime effect */
  typeOnly: boolean;
  start: number;
  end: number;
}

export interface DeclarationInfo {
  name: string;
  start: number;
  end: number;
}

export interface DefaultExportInfo {
  start: number;
  end: number;
  /** offset where the exported declaration / expression begins (after `export default `) */
  declarationStart: number;
  /** identifier of the exported thing when it has one (`export default function App` / `export default App`) */
  name?: string;
  /** `export default function/class …` (a declaration) vs `export default <expr>;` */
  isDeclaration: boolean;
}

export interface RenderCallInfo {
  /** span of the element passed to `.render(...)` */
  argStart: number;
  argEnd: number;
}

export interface ModuleAnalysis {
  imports: ImportInfo[];
  /** every top-level binding: function / class / variable names and import locals */
  declared: Set<string>;
  /** top-level capitalised functions, classes and `const X = () => …` components, in source order */
  components: DeclarationInfo[];
  defaultExport: DefaultExportInfo | null;
  renderCall: RenderCallInfo | null;
  /** offset of the first `<Stage …>` element, if any */
  stageStart: number | null;
  /** the module contains JSX (so it needs `React` in scope under the classic runtime) */
  hasJsx: boolean;
}

export type AnalysisResult = { ok: true; analysis: ModuleAnalysis } | { ok: false; error: string };

const PLUGINS = ["jsx", "typescript"] as const;

function isNode(value: unknown): value is t.Node {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Depth-first walk; returning `false` from `visit` skips the node's children. */
function walk(node: t.Node, visit: (node: t.Node) => boolean | void): void {
  if (visit(node) === false) return;
  const record = node as unknown as Record<string, unknown>;
  for (const key of VISITOR_KEYS[node.type] ?? []) {
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) walk(item, visit);
    } else if (isNode(child)) {
      walk(child, visit);
    }
  }
}

function offsets(node: t.Node): { start: number; end: number } {
  return { start: node.start ?? 0, end: node.end ?? 0 };
}

function isCapitalised(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function moduleExportName(node: t.Identifier | t.StringLiteral): string {
  return node.type === "Identifier" ? node.name : node.value;
}

function readImport(node: t.ImportDeclaration): ImportInfo {
  const info: ImportInfo = {
    source: node.source.value,
    named: [],
    typeOnly: node.importKind === "type" || node.importKind === "typeof",
    ...offsets(node),
  };
  for (const spec of node.specifiers) {
    switch (spec.type) {
      case "ImportDefaultSpecifier":
        info.defaultName = spec.local.name;
        break;
      case "ImportNamespaceSpecifier":
        info.namespace = spec.local.name;
        break;
      case "ImportSpecifier":
        if (spec.importKind === "type" || spec.importKind === "typeof") break;
        info.named.push({ imported: moduleExportName(spec.imported), local: spec.local.name });
        break;
    }
  }
  if (!info.typeOnly && !info.defaultName && !info.namespace && info.named.length === 0 && node.specifiers.length > 0) {
    // only type specifiers were listed: nothing survives at runtime
    info.typeOnly = true;
  }
  return info;
}

/** Names bound by a declaration (patterns included) plus the component-like ones among them. */
function collectDeclaration(
  node: t.Declaration,
  declared: Set<string>,
  components: DeclarationInfo[],
  span: { start: number; end: number },
): void {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    if (!node.id) return;
    declared.add(node.id.name);
    if (isCapitalised(node.id.name)) components.push({ name: node.id.name, ...span });
    return;
  }
  if (node.type !== "VariableDeclaration") return;
  for (const declarator of node.declarations) {
    const names: string[] = [];
    walk(declarator.id, (n) => {
      if (n.type === "Identifier") names.push(n.name);
    });
    for (const name of names) declared.add(name);
    const id = declarator.id;
    const init = declarator.init;
    if (id.type !== "Identifier" || !isCapitalised(id.name) || !init) continue;
    if (
      init.type === "ArrowFunctionExpression" ||
      init.type === "FunctionExpression" ||
      init.type === "CallExpression" ||
      init.type === "ClassExpression"
    ) {
      components.push({ name: id.name, ...span });
    }
  }
}

function readDefaultExport(node: t.ExportDefaultDeclaration): DefaultExportInfo {
  const decl = node.declaration;
  const isDeclaration = decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration";
  let name: string | undefined;
  if (isDeclaration) name = (decl as t.FunctionDeclaration | t.ClassDeclaration).id?.name;
  else if (decl.type === "Identifier") name = decl.name;
  return { ...offsets(node), declarationStart: decl.start ?? node.start ?? 0, name, isDeclaration };
}

function calleeName(callee: t.CallExpression["callee"]): string {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") return callee.property.name;
  return "";
}

/**
 * `ReactDOM.render(<App/>, el)`, `createRoot(el).render(<App/>)`,
 * `hydrateRoot(el).render(…)`, `root.render(<App/>)` or any `.render(<jsx/>)`.
 */
function asRenderCall(node: t.CallExpression): RenderCallInfo | null {
  const { callee } = node;
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier" || callee.property.name !== "render") {
    return null;
  }
  const arg = node.arguments[0];
  if (!arg || arg.type === "SpreadElement" || arg.type === "ArgumentPlaceholder") return null;
  const target = callee.object;
  const viaReactDom = target.type === "Identifier" && target.name === "ReactDOM";
  const viaRoot =
    target.type === "CallExpression" && ["createRoot", "hydrateRoot"].includes(calleeName(target.callee));
  const viaRootVar = target.type === "Identifier" && /root$/i.test(target.name);
  const jsxArg = arg.type === "JSXElement" || arg.type === "JSXFragment";
  if (!viaReactDom && !viaRoot && !viaRootVar && !jsxArg) return null;
  return { argStart: arg.start ?? 0, argEnd: arg.end ?? 0 };
}

function isStageElement(node: t.JSXElement): boolean {
  const name = node.openingElement.name;
  if (name.type === "JSXIdentifier") return name.name === "Stage";
  if (name.type === "JSXMemberExpression") return name.property.name === "Stage";
  return false;
}

/** Parse `source` as an ES module (jsx + typescript) and describe its shape. */
export function analyseModule(source: string): AnalysisResult {
  let ast: t.File;
  try {
    // errorRecovery: concatenated <script> blocks legitimately re-declare `React` / `Stage`;
    // those duplicate bindings are what the import merge fixes, so they must not abort the analysis.
    ast = parse(source, { sourceType: "module", plugins: [...PLUGINS], errorRecovery: true });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const analysis: ModuleAnalysis = {
    imports: [],
    declared: new Set(),
    components: [],
    defaultExport: null,
    renderCall: null,
    stageStart: null,
    hasJsx: false,
  };

  for (const statement of ast.program.body) {
    const span = offsets(statement);
    switch (statement.type) {
      case "ImportDeclaration": {
        const info = readImport(statement);
        analysis.imports.push(info);
        for (const name of [info.defaultName, info.namespace, ...info.named.map((n) => n.local)]) {
          if (name) analysis.declared.add(name);
        }
        break;
      }
      case "ExportDefaultDeclaration":
        analysis.defaultExport = readDefaultExport(statement);
        if (statement.declaration.type === "FunctionDeclaration" || statement.declaration.type === "ClassDeclaration") {
          collectDeclaration(statement.declaration, analysis.declared, analysis.components, span);
        }
        break;
      case "ExportNamedDeclaration":
        if (statement.declaration) {
          collectDeclaration(statement.declaration, analysis.declared, analysis.components, span);
        }
        break;
      case "FunctionDeclaration":
      case "ClassDeclaration":
      case "VariableDeclaration":
        collectDeclaration(statement, analysis.declared, analysis.components, span);
        break;
      default:
        break;
    }
  }

  walk(ast.program, (node) => {
    if (node.type === "JSXElement" || node.type === "JSXFragment") analysis.hasJsx = true;
    if (node.type === "JSXElement" && analysis.stageStart === null && isStageElement(node)) {
      analysis.stageStart = node.start ?? 0;
    }
    if (node.type === "CallExpression" && !analysis.renderCall) {
      analysis.renderCall = asRenderCall(node);
    }
  });

  return { ok: true, analysis };
}
