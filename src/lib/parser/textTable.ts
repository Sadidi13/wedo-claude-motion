/**
 * Editable words and fonts (CONTRACTS §2; the contract asks scenes to keep them in two tables at
 * the top of the entry file):
 *
 *   const TEXT = { title: "مدل بی‌نظیر سورا ۲", points: ["…", "…"], cta: { label: "Follow" } };
 *   const FONTS = { display: '"Peyda", sans-serif', body: '"Vazirmatn", system-ui, sans-serif' };
 *
 * `readSceneTables` finds every string in them (nested objects and arrays give dotted keys:
 * `points.1`, `cta.label`), and `setTableValue` replaces one string literal in place with
 * `JSON.stringify(value)`, so any text, quotes and newlines included, stays a valid literal.
 *
 * Scenes without a TEXT table still get their plain JSX text (`<h1>Hello</h1>`, `{"Hello"}`) as
 * entries keyed by position (`readJsxTexts` / `setJsxText`).
 *
 * Pure and isomorphic, like the rest of the parser.
 */
import type * as t from "@babel/types";
import { parseFile, span, traverse } from "./babel";
import { applyEdits } from "./text";

export type TableName = "TEXT" | "FONTS";

export interface TableEntry {
  /** dotted path inside the table: "title", "points.1", "cta.label" */
  key: string;
  value: string;
  /** the literal's source range, quotes included */
  start: number;
  end: number;
}

export interface SceneTables {
  TEXT: TableEntry[] | null;
  FONTS: TableEntry[] | null;
}

const MAX_DEPTH = 4;

function keyName(key: t.ObjectProperty["key"]): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "StringLiteral") return key.value;
  if (key.type === "NumericLiteral") return String(key.value);
  return null;
}

/** A string literal, or a template literal without expressions. */
function literalValue(node: t.Node): string | null {
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
  return null;
}

function unwrap(node: t.Node): t.Node {
  // `{ … } as const`, `{ … } satisfies Record<…>`
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return unwrap(node.expression);
  return node;
}

function collect(node: t.Node, prefix: string, depth: number, out: TableEntry[]): void {
  const value = literalValue(node);
  if (value !== null) {
    const { start, end } = span(node);
    out.push({ key: prefix, value, start, end });
    return;
  }
  if (depth >= MAX_DEPTH) return;
  const inner = unwrap(node);
  if (inner.type === "ObjectExpression") {
    for (const property of inner.properties) {
      if (property.type !== "ObjectProperty" || property.computed) continue;
      const name = keyName(property.key);
      if (name !== null) collect(property.value, prefix ? `${prefix}.${name}` : name, depth + 1, out);
    }
  } else if (inner.type === "ArrayExpression") {
    inner.elements.forEach((element, index) => {
      if (element && element.type !== "SpreadElement") collect(element, prefix ? `${prefix}.${index}` : String(index), depth + 1, out);
    });
  }
}

function tablesOf(ast: t.File): SceneTables {
  const tables: SceneTables = { TEXT: null, FONTS: null };
  for (const statement of ast.program.body) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier" || !declarator.init) continue;
      const name = declarator.id.name;
      if (name !== "TEXT" && name !== "FONTS") continue;
      const init = unwrap(declarator.init);
      if (init.type !== "ObjectExpression") continue;
      const entries: TableEntry[] = [];
      collect(init, "", 0, entries);
      tables[name] = entries;
    }
  }
  return tables;
}

/** The TEXT and FONTS tables of an entry file (null for a table it does not have). Throws ParseError. */
export function readSceneTables(source: string): SceneTables {
  return tablesOf(parseFile(source));
}

/** TEXT's values by dotted key, for showing `{TEXT.title}` as its words (layer names, previews). */
export function textLookup(ast: t.File): Map<string, string> {
  return new Map((tablesOf(ast).TEXT ?? []).map((entry) => [entry.key, entry.value]));
}

/** "title" for `TEXT.title`, "points.1" for `TEXT.points[1]`; null for anything else. */
export function textMemberKey(node: t.Node): string | null {
  const parts: string[] = [];
  let current: t.Node = node;
  while (current.type === "MemberExpression" || current.type === "OptionalMemberExpression") {
    const property: t.Node = current.property;
    if (!current.computed && property.type === "Identifier") parts.unshift(property.name);
    else if (current.computed && property.type === "NumericLiteral") parts.unshift(String(property.value));
    else if (current.computed && property.type === "StringLiteral") parts.unshift(property.value);
    else return null;
    current = current.object;
  }
  return current.type === "Identifier" && current.name === "TEXT" && parts.length ? parts.join(".") : null;
}

/** Replace the string at `key` in `table`. Throws when the table or the key does not exist. */
export function setTableValue(source: string, table: TableName, key: string, value: string): string {
  const entry = readSceneTables(source)[table]?.find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`${table}.${key} is not in the scene`);
  return applyEdits(source, [{ start: entry.start, end: entry.end, text: JSON.stringify(value) }]);
}

/** Several changes to one or both tables at once (unknown keys are skipped and returned). */
export function setTableValues(source: string, changes: { table: TableName; key: string; value: string }[]): { source: string; missing: string[] } {
  const tables = readSceneTables(source);
  const edits = [];
  const missing: string[] = [];
  for (const change of changes) {
    const entry = tables[change.table]?.find((candidate) => candidate.key === change.key);
    if (entry) edits.push({ start: entry.start, end: entry.end, text: JSON.stringify(change.value) });
    else missing.push(`${change.table}.${change.key}`);
  }
  return { source: edits.length ? applyEdits(source, edits) : source, missing };
}

/** The entry with `import "<specifier>";` after its last import, unless it already imports it. */
export function ensureSideEffectImport(source: string, specifier: string): string {
  const ast = parseFile(source);
  const imports = ast.program.body.filter((statement): statement is t.ImportDeclaration => statement.type === "ImportDeclaration");
  if (imports.some((statement) => statement.source.value === specifier)) return source;
  const line = `import ${JSON.stringify(specifier)};`;
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  if (imports.length === 0) return `${line}${eol}${source}`;
  const end = span(imports[imports.length - 1]).end;
  return applyEdits(source, [{ start: end, end, text: `${eol}${line}` }]);
}

// ---------------------------------------------------------------------------
// Plain JSX text (scenes without a TEXT table)
// ---------------------------------------------------------------------------

export interface JsxTextEntry {
  /** "t<n>": n-th text in source order (stable while the file does not change around it) */
  key: string;
  value: string;
  /** the data-layer-id of the element holding the text, when it has one */
  layerId: string | null;
  start: number;
  end: number;
  /** JSXText (written between tags) or a string literal in braces */
  form: "text" | "literal";
}

function layerIdOf(element: t.JSXElement): string | null {
  for (const attribute of element.openingElement.attributes) {
    if (attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && attribute.name.name === "data-layer-id") {
      return attribute.value?.type === "StringLiteral" ? attribute.value.value : null;
    }
  }
  return null;
}

/** Every piece of literal JSX text in the file, trimmed, in source order. */
export function readJsxTexts(source: string): JsxTextEntry[] {
  const ast = parseFile(source);
  const out: JsxTextEntry[] = [];
  traverse(ast, {
    JSXText(path) {
      // Offsets come from the text as written (entities such as &amp; are longer than what they mean).
      const raw = (path.node.extra?.raw as string | undefined) ?? path.node.value;
      const value = path.node.value.replace(/\s+/g, " ").trim();
      if (!value) return;
      const { start } = span(path.node);
      const lead = raw.length - raw.trimStart().length;
      const trail = raw.length - raw.trimEnd().length;
      const parent = path.parentPath?.node;
      out.push({
        key: `t${out.length + 1}`,
        value,
        layerId: parent?.type === "JSXElement" ? layerIdOf(parent) : null,
        start: start + lead,
        end: start + raw.length - trail,
        form: "text",
      });
    },
    JSXExpressionContainer(path) {
      const expression = path.node.expression;
      if (expression.type !== "StringLiteral" || !expression.value.trim()) return;
      if (path.parentPath?.node.type === "JSXAttribute") return;
      const parent = path.parentPath?.node;
      const { start, end } = span(expression);
      out.push({ key: `t${out.length + 1}`, value: expression.value, layerId: parent?.type === "JSXElement" ? layerIdOf(parent) : null, start, end, form: "literal" });
    },
  });
  return out;
}

/** Replace one piece of JSX text; text with JSX-special characters becomes `{"…"}`. */
export function setJsxText(source: string, key: string, value: string): string {
  const entry = readJsxTexts(source).find((candidate) => candidate.key === key);
  if (!entry) throw new Error(`Text ${key} is not in the scene`);
  const plain = entry.form === "text" && !/[{}<>\n]/.test(value) && value.trim() === value && value !== "";
  const text = entry.form === "literal" ? JSON.stringify(value) : plain ? value : `{${JSON.stringify(value)}}`;
  return applyEdits(source, [{ start: entry.start, end: entry.end, text }]);
}
