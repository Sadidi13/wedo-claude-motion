/**
 * Shared structural edits for layer operations: removing an element from its
 * position, inserting element text into a container at an index, swapping two
 * elements, and inferring the file's indentation unit. All of them produce
 * TextEdits / strings against the original source; nothing is regenerated.
 */
import type { NodePath } from "@babel/traverse";
import type * as t from "@babel/types";
import { type Span, span } from "./babel";
import {
  type StageContext,
  type WalkedElement,
  directElementChildren,
  elementId,
  hasFunctionChildren,
} from "./stage";
import {
  type TextEdit,
  endsLine,
  eolOf,
  indentAt,
  lineEndOf,
  lineStartOf,
  reindent,
  startsLine,
} from "./text";

const DEFAULT_INDENT_UNIT = "  ";

/**
 * One indentation level, inferred from the Stage and its first direct child
 * (so tabs / 4-space files keep their style); defaults to two spaces.
 */
export function detectIndentUnit(ctx: StageContext): string {
  const { source } = ctx;
  const stageIndent = indentAt(source, span(ctx.stagePath.node).start);
  const first = directElementChildren(ctx.stagePath.node)[0];
  if (first && startsLine(source, span(first).start)) {
    const childIndent = indentAt(source, span(first).start);
    if (childIndent.length > stageIndent.length && childIndent.startsWith(stageIndent)) {
      return childIndent.slice(stageIndent.length);
    }
  }
  return DEFAULT_INDENT_UNIT;
}

/**
 * Edit that takes an element out of the tree. A plain JSX child is removed
 * together with its whole line(s) when it owns them; an element that is an
 * expression (arrow body, `cond && <x/>`, array item, .map callback) is
 * replaced by `null` so the surrounding code stays valid.
 */
export function removalEdit(source: string, el: WalkedElement): TextEdit {
  const s = span(el.node);
  if (!el.directChild) return { start: s.start, end: s.end, text: "null" };
  if (startsLine(source, s.start) && endsLine(source, s.end)) {
    const lineEnd = lineEndOf(source, s.end);
    return {
      start: lineStartOf(source, s.start),
      end: lineEnd < source.length ? lineEnd + 1 : lineEnd,
      text: "",
    };
  }
  return { start: s.start, end: s.end, text: "" };
}

/**
 * For each layer child of `parent` (the layer tree the UI shows), the start
 * offset of the direct child of `target` that contains it: the element itself
 * when it is a plain JSX child, otherwise its enclosing `{...}` container.
 */
function childAnchors(ctx: StageContext, parent: WalkedElement | null, target: t.JSXElement): number[] {
  return ctx.elements
    .filter((e) => e.parent === parent)
    .map((child) => {
      let path: NodePath = child.path;
      while (path.parentPath && path.parentPath.node !== target) path = path.parentPath;
      return span(path.node).start;
    });
}

/**
 * Edit that inserts `text` (one JSX element) as a child of `parent` (null =
 * the Stage) at `index` among its layer children (undefined ⇒ append before
 * the closing tag). A sibling that lives inside an expression is anchored on
 * its enclosing `{...}` container. Self-closing targets are opened up. Throws
 * when the target renders function-children, because a JSX sibling there
 * would be a syntax error.
 */
export function insertionEdit(ctx: StageContext, parent: WalkedElement | null, text: string, index?: number): TextEdit {
  const { source } = ctx;
  const target = parent ? parent.node : ctx.stagePath.node;
  if (hasFunctionChildren(target)) {
    throw new Error(
      `Layer "${containerLabel(parent)}" renders function-children ({(api) => ...}); JSX children cannot be inserted next to a render function`,
    );
  }
  const eol = eolOf(source);
  const open = target.openingElement;
  const targetIndent = indentAt(source, span(target).start);
  const anchors = childAnchors(ctx, parent, target);
  const childIndent =
    anchors.length && startsLine(source, anchors[0])
      ? indentAt(source, anchors[0])
      : targetIndent + detectIndentUnit(ctx);
  const snippet = reindent(text, childIndent, eol);

  if (open.selfClosing) {
    const openSpan = span(open);
    let cut = source.lastIndexOf("/", openSpan.end);
    while (cut > openSpan.start && /[ \t\r\n]/.test(source[cut - 1])) cut--;
    const nameSpan = span(open.name);
    const tagText = source.slice(nameSpan.start, nameSpan.end);
    return {
      start: cut,
      end: openSpan.end,
      text: `>${eol}${childIndent}${snippet}${eol}${targetIndent}</${tagText}>`,
    };
  }

  const at = index === undefined ? anchors.length : Math.max(0, Math.min(index, anchors.length));
  const anchor = at < anchors.length ? anchors[at] : span(target.closingElement as t.JSXClosingElement).start;
  if (startsLine(source, anchor)) {
    const lineStart = lineStartOf(source, anchor);
    return { start: lineStart, end: lineStart, text: `${childIndent}${snippet}${eol}` };
  }
  return { start: anchor, end: anchor, text: snippet };
}

/** Swap the text of two non-overlapping spans, keeping everything between them. */
export function swapSpans(source: string, a: Span, b: Span): string {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return (
    source.slice(0, first.start) +
    source.slice(second.start, second.end) +
    source.slice(first.end, second.start) +
    source.slice(first.start, first.end) +
    source.slice(second.end)
  );
}

/** Label used in error messages for a container: its id, or "<Stage>". */
function containerLabel(el: WalkedElement | null): string {
  return el ? (elementId(el) ?? el.tag) : "<Stage>";
}
