/**
 * JSX attribute helpers: reading literal attribute values from Babel nodes and
 * producing minimal TextEdits that set / replace / remove attributes without
 * touching anything else in the opening tag.
 */
import type * as t from "@babel/types";
import { span } from "./babel";
import type { TextEdit } from "./text";

/** The data-* attributes the editor writes into the source. */
export const ATTR = {
  id: "data-layer-id",
  name: "data-layer-name",
  hidden: "data-hidden",
  locked: "data-locked",
} as const;

type JSXName = t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName;

/** Tag name exactly as written: "Sprite", "Motion.Sprite", "svg:path". */
export function jsxNameToString(name: JSXName): string {
  switch (name.type) {
    case "JSXIdentifier":
      return name.name;
    case "JSXMemberExpression":
      return `${jsxNameToString(name.object)}.${name.property.name}`;
    case "JSXNamespacedName":
      return `${name.namespace.name}:${name.name.name}`;
  }
}

/** Tag name of an element as written in the source. */
export function elementTag(node: t.JSXElement): string {
  return jsxNameToString(node.openingElement.name);
}

/** Last segment of a tag ("Motion.Sprite" → "Sprite"). */
export function tagBaseName(tag: string): string {
  return tag.split(/[.:]/).pop() ?? tag;
}

/** The attribute named `name` (plain identifier names only), if present. */
export function findAttr(node: t.JSXElement, name: string): t.JSXAttribute | undefined {
  for (const attr of node.openingElement.attributes) {
    if (attr.type === "JSXAttribute" && attr.name.type === "JSXIdentifier" && attr.name.name === name) {
      return attr;
    }
  }
  return undefined;
}

/** String value of a literal attribute: `a="x"`, `a={"x"}`, `a={`x`}`. */
export function attrString(attr: t.JSXAttribute | undefined): string | undefined {
  const value = attr?.value;
  if (!value) return undefined;
  if (value.type === "StringLiteral") return value.value;
  if (value.type === "JSXExpressionContainer") {
    const expr = value.expression;
    if (expr.type === "StringLiteral") return expr.value;
    if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) {
      return expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join("");
    }
  }
  return undefined;
}

/** Numeric value of a literal attribute: `a={1.5}`, `a={-2}`, `a={Infinity}`; undefined otherwise. */
export function attrNumber(attr: t.JSXAttribute | undefined): number | undefined {
  const value = attr?.value;
  if (!value || value.type !== "JSXExpressionContainer") return undefined;
  const expr = value.expression;
  if (expr.type === "NumericLiteral") return expr.value;
  if (expr.type === "Identifier" && expr.name === "Infinity") return Infinity;
  if (expr.type === "UnaryExpression" && expr.operator === "-") {
    const arg = expr.argument;
    if (arg.type === "NumericLiteral") return -arg.value;
    if (arg.type === "Identifier" && arg.name === "Infinity") return -Infinity;
  }
  return undefined;
}

/** True for `a`, `a="true"` and `a={true}`. */
export function attrIsTrue(attr: t.JSXAttribute | undefined): boolean {
  if (!attr) return false;
  if (!attr.value) return true;
  const str = attrString(attr);
  if (str !== undefined) return str === "true";
  return (
    attr.value.type === "JSXExpressionContainer" &&
    attr.value.expression.type === "BooleanLiteral" &&
    attr.value.expression.value
  );
}

/** Offset right after the tag name (and TS type arguments) — where new attributes are inserted. */
export function afterTagName(node: t.JSXElement): number {
  const open = node.openingElement;
  return span(open.typeArguments ?? open.name).end;
}

/**
 * Edit that sets the attribute's value to `raw` (already formatted JSX source,
 * e.g. `"Title"` or `{1.5}`). Replaces the value of an existing attribute,
 * completes a bare attribute, or inserts ` name=raw` at `insertAt` (default:
 * right after the tag name).
 */
export function setAttrEdit(node: t.JSXElement, name: string, raw: string, insertAt?: number): TextEdit {
  const attr = findAttr(node, name);
  if (attr) {
    if (attr.value) {
      const s = span(attr.value);
      return { start: s.start, end: s.end, text: raw };
    }
    const end = span(attr).end;
    return { start: end, end, text: `=${raw}` };
  }
  const at = insertAt ?? afterTagName(node);
  return { start: at, end: at, text: ` ${name}=${raw}` };
}

/** Edit that removes an attribute together with the whitespace preceding it; null when absent. */
export function removeAttrEdit(source: string, node: t.JSXElement, name: string): TextEdit | null {
  const attr = findAttr(node, name);
  if (!attr) return null;
  const s = span(attr);
  let start = s.start;
  while (start > 0 && /\s/.test(source[start - 1])) start--;
  return { start, end: s.end, text: "" };
}

/**
 * Where editor-owned data-* attributes go: right after `data-layer-id` when it
 * exists (keeps them grouped), else right after the tag name.
 */
export function afterLayerId(node: t.JSXElement): number {
  const idAttr = findAttr(node, ATTR.id);
  return idAttr ? span(idAttr).end : afterTagName(node);
}
