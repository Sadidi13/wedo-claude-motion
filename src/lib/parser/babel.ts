/**
 * Thin wrapper around Babel 8 for the parser module.
 *
 * - resolves the `traverse` function in a way that works both under vitest
 *   (pure ESM) and inside the Next.js browser / server bundles
 * - parses whole files with a fixed plugin set (jsx + typescript, ESM) and
 *   converts Babel SyntaxErrors into ParseError
 * - `span()` / `lineOf()` read the source offsets Babel attaches to every node;
 *   every edit in this module is a string splice on those offsets
 *
 * This file must stay isomorphic: no node built-ins.
 */
import { parse } from "@babel/parser";
import * as traverseModule from "@babel/traverse";
import type * as t from "@babel/types";
import { toParseError } from "./errors";

type TraverseFn = typeof traverseModule.default;

/**
 * Babel 8 ships ESM only and its `default` export IS the traverse function
 * (verified with `Object.keys(await import("@babel/traverse"))` →
 * `Hub, NodePath, Scope, default, visitors`, `typeof default === "function"`).
 * Some CJS-interop paths (older bundler settings) wrap the namespace once
 * more and expose the function as `default.default`; accept both shapes so the
 * module behaves identically in vitest and in the Next.js bundle.
 */
function resolveTraverse(): TraverseFn {
  const mod = traverseModule as unknown as {
    default?: TraverseFn | { default?: TraverseFn };
  };
  const candidate = mod.default;
  if (typeof candidate === "function") return candidate;
  if (candidate && typeof candidate.default === "function") return candidate.default;
  throw new Error("@babel/traverse: could not resolve the traverse function");
}

export const traverse: TraverseFn = resolveTraverse();

/** Parser plugins: project files are JSX/TSX written as ES modules. */
const PARSER_PLUGINS = ["jsx", "typescript"] as const;

/** Parse a whole source file; throws ParseError (with line/column) on syntax errors. */
export function parseFile(source: string): t.File {
  try {
    return parse(source, { sourceType: "module", plugins: [...PARSER_PLUGINS] });
  } catch (err) {
    throw toParseError(err);
  }
}

export interface Span {
  /** 0-based inclusive start offset */
  start: number;
  /** 0-based exclusive end offset */
  end: number;
}

/** Source offsets of a node. Babel always fills them in; the guard keeps the types honest. */
export function span(node: t.Node): Span {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    throw new Error(`Babel node ${node.type} has no source offsets`);
  }
  return { start: node.start, end: node.end };
}

/** 1-based line of the node's first character. */
export function lineOf(node: t.Node): number {
  return node.loc?.start.line ?? 1;
}
