/**
 * Parsing a JSX fragment supplied by the UI or by Claude (replacement /
 * insertion). The text must contain exactly one JSX element; a surrounding
 * `<>...</>` with one element, parentheses and a trailing semicolon are
 * tolerated and stripped. Offsets of the returned elements are relative to
 * `text`, so id edits can be spliced straight into it.
 */
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { parseFile, span, traverse } from "./babel";
import { ParseError } from "./errors";
import { type WalkedElement, collectElements } from "./stage";

export interface LayerFragment {
  /** canonical text: exactly the root element, nothing around it */
  text: string;
  root: NodePath<t.JSXElement>;
  /** root first, then every nested layer element in source order */
  elements: WalkedElement[];
}

const ONE_ELEMENT = "Layer code must be exactly one JSX element";

function isBlankText(child: t.JSXElement["children"][number]): boolean {
  return child.type === "JSXText" && child.value.trim() === "";
}

/** The single JSX element in the program, unwrapping a one-element fragment; null otherwise. */
function singleRootElement(ast: t.File): t.JSXElement | null {
  if (ast.program.body.length !== 1) return null;
  const statement = ast.program.body[0];
  if (statement.type !== "ExpressionStatement") return null;
  const expr = statement.expression;
  if (expr.type === "JSXElement") return expr;
  if (expr.type === "JSXFragment") {
    const kids = expr.children.filter((c) => !isBlankText(c));
    if (kids.length === 1 && kids[0].type === "JSXElement") return kids[0];
  }
  return null;
}

export function parseLayerFragment(jsx: string): LayerFragment {
  const text = jsx.trim();
  if (!text) throw new ParseError(ONE_ELEMENT);
  const ast = parseFile(text);
  const rootNode = singleRootElement(ast);
  if (!rootNode) throw new ParseError(ONE_ELEMENT, { line: 1, column: 0 });

  const s = span(rootNode);
  // Parentheses, a fragment wrapper or a trailing ";" put the root somewhere
  // inside `text`; re-parse the exact slice so offsets are text-relative.
  if (s.start !== 0 || s.end !== text.length) return parseLayerFragment(text.slice(s.start, s.end));

  let root: NodePath<t.JSXElement> | undefined;
  traverse(ast, {
    JSXElement(path) {
      if (path.node === rootNode) {
        root = path;
        path.stop();
      }
    },
  });
  if (!root) throw new ParseError(ONE_ELEMENT);
  return { text, root, elements: collectElements(root, true) };
}
