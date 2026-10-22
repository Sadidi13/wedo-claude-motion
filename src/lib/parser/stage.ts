/**
 * Locating the <Stage> and walking its subtree.
 *
 * `collectElements` defines what counts as a layer: every JSXElement that is a
 * descendant of the Stage *through JSX children* — including elements inside
 * function-children (`{({progress}) => <div/>}`), conditionals, logical
 * expressions, arrays and `.map()` callbacks. JSX written inside an attribute
 * (`icon={<Zap/>}`) is a prop value, not a layer, and is skipped together with
 * its subtree. Elements are returned in source order with their nearest
 * ancestor layer, which is exactly the tree the editor shows.
 */
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { ATTR, attrString, elementTag, findAttr, tagBaseName } from "./attrs";
import { lineOf, parseFile, span, traverse } from "./babel";
import { ParseError } from "./errors";

const STAGE_TAG = "Stage";
const SPRITE_TAG = "Sprite";

export function isStageTag(tag: string): boolean {
  return tagBaseName(tag) === STAGE_TAG;
}

export function isSpriteTag(tag: string): boolean {
  return tagBaseName(tag) === SPRITE_TAG;
}

export interface WalkedElement {
  path: NodePath<t.JSXElement>;
  node: t.JSXElement;
  /** tag as written ("Sprite", "div", "Motion.Card") */
  tag: string;
  /** nearest ancestor layer element; null for direct descendants of the walk root */
  parent: WalkedElement | null;
  /** rendered inside a `.map()` / `.flatMap()` callback (directly or through an ancestor layer) */
  repeated: boolean;
  /** written as a plain JSX child (AST parent is a JSXElement / JSXFragment) */
  directChild: boolean;
}

export interface StageContext {
  source: string;
  ast: t.File;
  stagePath: NodePath<t.JSXElement>;
  /** all layer elements inside the Stage, in source order (the Stage itself excluded) */
  elements: WalkedElement[];
}

/** Array-iteration callees whose JSX result is repeated at runtime. */
const REPEATING_CALLEES = new Set(["map", "flatMap"]);

interface Placement {
  inAttribute: boolean;
  repeated: boolean;
}

/**
 * Walk up from an element to its nearest JSXElement ancestor and classify the
 * path in between: does it pass through an attribute, or through a callback
 * argument of `.map()`?
 */
function classifyPlacement(path: NodePath<t.JSXElement>): Placement {
  const placement: Placement = { inAttribute: false, repeated: false };
  let child: NodePath = path;
  let current: NodePath | null = path.parentPath;
  while (current && !current.isJSXElement()) {
    if (current.isJSXAttribute()) {
      placement.inAttribute = true;
      return placement;
    }
    if (current.isCallExpression() && child.listKey === "arguments") {
      const callee = current.node.callee;
      if (
        (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") &&
        callee.property.type === "Identifier" &&
        REPEATING_CALLEES.has(callee.property.name)
      ) {
        placement.repeated = true;
      }
    }
    child = current;
    current = current.parentPath;
  }
  return placement;
}

function isJsxContainer(node: t.Node): boolean {
  return node.type === "JSXElement" || node.type === "JSXFragment";
}

/**
 * Collect the layer elements below `root` (optionally including `root`
 * itself) in source order.
 */
export function collectElements(root: NodePath<t.JSXElement>, includeRoot: boolean): WalkedElement[] {
  const out: WalkedElement[] = [];
  const stack: WalkedElement[] = [];
  if (includeRoot) {
    const entry: WalkedElement = {
      path: root,
      node: root.node,
      tag: elementTag(root.node),
      parent: null,
      repeated: false,
      directChild: isJsxContainer(root.parent),
    };
    out.push(entry);
    stack.push(entry);
  }
  root.traverse({
    JSXElement: {
      enter(path) {
        const placement = classifyPlacement(path);
        if (placement.inAttribute) {
          path.skip();
          return;
        }
        const parent = stack[stack.length - 1] ?? null;
        const entry: WalkedElement = {
          path,
          node: path.node,
          tag: elementTag(path.node),
          parent,
          // everything below a repeated element is repeated as well
          repeated: placement.repeated || (parent?.repeated ?? false),
          directChild: isJsxContainer(path.parent),
        };
        out.push(entry);
        stack.push(entry);
      },
      exit(path) {
        if (stack.length && stack[stack.length - 1].node === path.node) stack.pop();
      },
    },
  });
  return out;
}

/** The one <Stage> element of the file; ParseError when there are none or several. */
export function findStagePath(ast: t.File): NodePath<t.JSXElement> {
  const found: NodePath<t.JSXElement>[] = [];
  traverse(ast, {
    JSXElement(path) {
      if (isStageTag(elementTag(path.node))) found.push(path);
    },
  });
  if (found.length === 0) {
    throw new ParseError("No <Stage> element found in the entry file");
  }
  if (found.length > 1) {
    const second = found[1].node;
    throw new ParseError(`Expected exactly one <Stage> element, found ${found.length}`, {
      line: lineOf(second),
      column: second.loc?.start.column,
    });
  }
  return found[0];
}

/** Every literal `data-layer-id` value in the whole file (not only inside the Stage). */
export function collectAllIds(ast: t.File): Set<string> {
  const ids = new Set<string>();
  traverse(ast, {
    JSXAttribute(path) {
      const { name } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== ATTR.id) return;
      const value = attrString(path.node);
      if (value) ids.add(value);
    },
  });
  return ids;
}

/** Parse the file, find its Stage and walk the Stage subtree. */
export function loadStage(source: string): StageContext {
  const ast = parseFile(source);
  const stagePath = findStagePath(ast);
  return { source, ast, stagePath, elements: collectElements(stagePath, false) };
}

/** The element's `data-layer-id`, when it is a string literal. */
export function elementId(el: WalkedElement): string | undefined {
  const id = attrString(findAttr(el.node, ATTR.id));
  return id ? id : undefined;
}

/** The layer element with the given id; throws when it does not exist. */
export function findElement(ctx: StageContext, id: string): WalkedElement {
  const el = ctx.elements.find((e) => elementId(e) === id);
  if (!el) throw new Error(`Layer "${id}" not found`);
  return el;
}

/** True when `inner` is `outer` or lies inside it. */
export function isWithin(inner: WalkedElement, outer: WalkedElement): boolean {
  const a = span(inner.node);
  const b = span(outer.node);
  return a.start >= b.start && a.end <= b.end;
}

/** Direct JSX-element children of a node (plain `<Child/>` children only). */
export function directElementChildren(node: t.JSXElement): t.JSXElement[] {
  return node.children.filter((c): c is t.JSXElement => c.type === "JSXElement");
}

/** True when the element renders its children through a function (`{(api) => ...}`). */
export function hasFunctionChildren(node: t.JSXElement): boolean {
  return node.children.some(
    (c) =>
      c.type === "JSXExpressionContainer" &&
      (c.expression.type === "ArrowFunctionExpression" || c.expression.type === "FunctionExpression"),
  );
}
