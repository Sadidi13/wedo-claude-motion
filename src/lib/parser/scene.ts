/**
 * parseScene: source → ParsedScene (stage meta + layer tree + warnings).
 *
 * Naming: `data-layer-name` > the element's own static text (first 24 chars)
 * > a Sprite with a single child layer borrows that child's text > `<Tag>`.
 * Kind: Sprite → sprite; Audio → audio; img/Image/video → image; SVG tags → shape;
 * Three3D / canvas → canvas; capitalised tag → component; has child layers → group; text / expression
 * children only → text; empty box-like tag (div/span/section/hr) → shape;
 * anything else → element.
 * Range: a Sprite's literal start/end (absent start = 0, absent end =
 * Infinity) intersected with the parent range; an Audio's likewise, except that
 * a built-in sound without `end` lasts its own length; other elements inherit
 * the parent range; the root range is [0, meta.duration].
 */
import type * as t from "@babel/types";
import { sfxDuration } from "@/lib/audio/sfx";
import { parseMotion } from "@/lib/motion/keyframes";
import type { LayerKind, LayerNode, ParsedScene, StageMeta } from "@/lib/types";
import { ATTR, attrIsTrue, attrNumber, attrString, findAttr, tagBaseName } from "./attrs";
import { lineOf, span } from "./babel";
import { tagSlug } from "./ids";
import { type StageContext, type WalkedElement, elementId, isAudioTag, isTimedTag, loadStage } from "./stage";

const NAME_MAX = 24;
const PREVIEW_MAX = 60;

/** Runtime defaults of <Stage> (see CONTRACTS §1 runtime table). */
const STAGE_DEFAULTS: StageMeta = { width: 1280, height: 720, duration: 10, fps: 30 };

const IMAGE_TAGS = new Set(["img", "Image", "video"]);
const SHAPE_TAGS = new Set([
  "svg", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "g", "defs", "use",
  "mask", "clipPath", "linearGradient", "radialGradient", "stop", "pattern", "symbol", "text",
  "tspan", "filter", "feGaussianBlur", "feOffset", "feMerge", "feMergeNode", "feColorMatrix",
  "feBlend", "feDropShadow",
]);
/** Drawn surfaces: a three.js scene (runtime <Three3D>) or a plain <canvas>. One layer each. */
const CANVAS_TAGS = new Set(["Three3D", "canvas"]);
/** Empty elements of these tags are decorative boxes (backgrounds, dividers). */
const EMPTY_SHAPE_TAGS = new Set(["div", "span", "section", "hr"]);

export function parseScene(source: string): ParsedScene {
  return buildScene(loadStage(source));
}

/** Build the scene from an already-parsed Stage (lets edit ops reuse their parse). */
export function buildScene(ctx: StageContext): ParsedScene {
  const warnings: string[] = [];
  const meta = readStageMeta(ctx.stagePath.node, warnings);
  const rootRange = { start: 0, end: meta.duration };

  const byId: Record<string, LayerNode> = {};
  const layers: LayerNode[] = [];
  const nodeOf = new Map<WalkedElement, LayerNode>();
  const content = new Map<LayerNode, OwnContent>();

  for (const el of ctx.elements) {
    const parent = el.parent ? (nodeOf.get(el.parent) ?? null) : null;
    const node = buildNode(el, parent, parent?.range ?? rootRange, byId, warnings);
    nodeOf.set(el, node);
    content.set(node, collectOwnContent(el.node));
    byId[node.id] = node;
    if (parent) parent.children.push(node);
    else layers.push(node);
  }

  for (const layer of layers) finalize(layer, content);

  const stageSpan = span(ctx.stagePath.node);
  return {
    meta,
    layers,
    byId,
    stageLoc: { start: stageSpan.start, end: stageSpan.end, line: lineOf(ctx.stagePath.node) },
    warnings,
  };
}

/** Read the literal Stage props, falling back to runtime defaults (with a warning for non-literals). */
function readStageMeta(stage: t.JSXElement, warnings: string[]): StageMeta {
  const numeric = (key: keyof Omit<StageMeta, "background">): number => {
    const attr = findAttr(stage, key);
    if (!attr) return STAGE_DEFAULTS[key];
    const value = attrNumber(attr);
    if (value === undefined || !Number.isFinite(value)) {
      warnings.push(`Stage prop "${key}" is not a numeric literal; using default ${STAGE_DEFAULTS[key]}`);
      return STAGE_DEFAULTS[key];
    }
    return value;
  };
  const meta: StageMeta = {
    width: numeric("width"),
    height: numeric("height"),
    duration: numeric("duration"),
    fps: numeric("fps"),
  };
  const bgAttr = findAttr(stage, "background");
  if (bgAttr) {
    const background = attrString(bgAttr);
    if (background === undefined) {
      warnings.push('Stage prop "background" is not a string literal; it cannot be edited from the inspector');
    } else {
      meta.background = background;
    }
  }
  return meta;
}

/** First pass: everything that does not depend on the element's children. */
function buildNode(
  el: WalkedElement,
  parent: LayerNode | null,
  parentRange: { start: number; end: number },
  byId: Record<string, LayerNode>,
  warnings: string[],
): LayerNode {
  const { node, tag } = el;
  const s = span(node);
  const line = lineOf(node);

  let id = elementId(el);
  if (!id) {
    id = `${tagSlug(tag)}@${s.start}`;
    warnings.push(`<${tag}> at line ${line} has no data-layer-id; run ensureLayerIds before editing it`);
  } else if (byId[id]) {
    warnings.push(`Duplicate data-layer-id "${id}" at line ${line}; run ensureLayerIds to regenerate it`);
    id = `${id}@${s.start}`;
  }

  const timed = isTimedTag(tag);
  let start: number | undefined;
  let end: number | undefined;
  if (timed) {
    const label = tagBaseName(tag);
    const startAttr = findAttr(node, "start");
    const endAttr = findAttr(node, "end");
    start = startAttr ? attrNumber(startAttr) : 0;
    end = endAttr ? attrNumber(endAttr) : Infinity;
    if (!endAttr && isAudioTag(tag) && start !== undefined) {
      // A built-in sound without `end` plays its own length.
      const length = sfxDuration(attrString(findAttr(node, "sfx")) ?? "");
      if (length !== undefined && !attrIsTrue(findAttr(node, "loop"))) end = start + length;
    }
    if (startAttr && start === undefined) {
      warnings.push(`${label} "${id}" (line ${line}) has a dynamic "start"; its timing is read-only`);
    }
    if (endAttr && end === undefined) {
      warnings.push(`${label} "${id}" (line ${line}) has a dynamic "end"; its timing is read-only`);
    }
  }
  if (el.repeated) {
    warnings.push(
      `Layer "${id}" (<${tag}> line ${line}) is repeated: it is rendered inside a .map() callback, so edits apply to every copy`,
    );
  }

  const ownStart = start ?? parentRange.start;
  const ownEnd = end ?? parentRange.end;
  const range = {
    start: Math.max(parentRange.start, ownStart),
    end: Math.min(parentRange.end, ownEnd),
  };
  if (range.end < range.start) range.end = range.start;

  const layer: LayerNode = {
    id,
    name: "",
    kind: "element",
    tag,
    range,
    hidden: attrIsTrue(findAttr(node, ATTR.hidden)),
    locked: attrIsTrue(findAttr(node, ATTR.locked)),
    parentId: parent?.id ?? null,
    depth: parent ? parent.depth + 1 : 0,
    children: [],
    loc: { start: s.start, end: s.end, line },
  };
  if (timed) {
    layer.start = start;
    layer.end = end;
  }
  if (isAudioTag(tag)) {
    const number = (name: string) => {
      const attr = findAttr(node, name);
      return attr ? attrNumber(attr) : undefined;
    };
    layer.audio = {
      src: attrString(findAttr(node, "src")),
      sfx: attrString(findAttr(node, "sfx")),
      from: number("from"),
      volume: number("volume"),
      fadeIn: number("fadeIn"),
      fadeOut: number("fadeOut"),
      loop: attrIsTrue(findAttr(node, "loop")),
    };
  }
  const explicitName = attrString(findAttr(node, ATTR.name));
  if (explicitName) layer.name = explicitName;
  const motion = parseMotion(attrString(findAttr(node, ATTR.motion)));
  if (motion) layer.motion = motion;
  return layer;
}

/** Second pass (post-order): kind, textPreview and derived names need the children. */
function finalize(layer: LayerNode, content: Map<LayerNode, OwnContent>): void {
  for (const child of layer.children) finalize(child, content);

  const own = content.get(layer) ?? { text: "", hasExpressions: false };
  const preview = own.text || layer.children.map((c) => c.textPreview ?? "").filter(Boolean).join(" ");
  if (preview) layer.textPreview = preview.slice(0, PREVIEW_MAX);

  layer.kind = classify(layer, own);

  if (!layer.name) {
    if (own.text) {
      layer.name = own.text.slice(0, NAME_MAX).trim();
    } else if (layer.kind === "sprite" && layer.children.length === 1 && layer.children[0].textPreview) {
      layer.name = layer.children[0].textPreview.slice(0, NAME_MAX).trim();
    } else {
      layer.name = `<${layer.tag}>`;
    }
  }
}

function classify(layer: LayerNode, own: OwnContent): LayerKind {
  const base = tagBaseName(layer.tag);
  if (base === "Sprite") return "sprite";
  if (base === "Audio") return "audio";
  if (IMAGE_TAGS.has(base)) return "image";
  if (SHAPE_TAGS.has(base)) return "shape";
  if (CANVAS_TAGS.has(base)) return "canvas";
  if (layer.tag.includes(".") || /^[A-Z]/.test(base)) return "component";
  if (layer.children.length > 0) return "group";
  if (own.text || own.hasExpressions) return "text";
  if (EMPTY_SHAPE_TAGS.has(base)) return "shape";
  return "element";
}

interface OwnContent {
  /** static text directly inside the element */
  text: string;
  /** the element has non-empty, non-element expression children such as `{label}` */
  hasExpressions: boolean;
}

/**
 * Static text directly inside an element: JSXText plus literal expression
 * containers, descending through fragments but NOT into nested elements
 * (those are layers of their own).
 */
function collectOwnContent(node: t.JSXElement): OwnContent {
  const parts: string[] = [];
  let hasExpressions = false;
  const visit = (children: t.JSXElement["children"]): void => {
    for (const child of children) {
      switch (child.type) {
        case "JSXText": {
          const text = child.value.replace(/\s+/g, " ").trim();
          if (text) parts.push(text);
          break;
        }
        case "JSXFragment":
          visit(child.children);
          break;
        case "JSXExpressionContainer": {
          const expr = child.expression;
          if (expr.type === "StringLiteral") parts.push(expr.value);
          else if (expr.type === "NumericLiteral") parts.push(String(expr.value));
          else if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) {
            parts.push(expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join(""));
          } else if (expr.type === "JSXFragment") visit(expr.children);
          else if (expr.type !== "JSXEmptyExpression" && expr.type !== "JSXElement") hasExpressions = true;
          break;
        }
        default:
          break;
      }
    }
  };
  visit(node.children);
  return { text: parts.join(" ").replace(/\s+/g, " ").trim(), hasExpressions };
}
