/**
 * DOM-free HTML extraction (must run in node tests and on the server).
 *
 * A tiny sequential scanner pulls out the raw-text elements (`<script>`,
 * `<style>`) and HTML comments in document order; the remaining markup is
 * then searched with regexes for `<link>`, `<meta>`, `<title>`, the `<body>`
 * and `data-canvas-*` hints. No attempt is made to build a tree: the importer
 * only needs the script bodies, the stylesheets and "is there static markup".
 */

export interface ScriptBlock {
  /** lower-cased attribute names → decoded values ("" for bare attributes) */
  attrs: Record<string, string>;
  body: string;
}

export interface HtmlExtraction {
  scripts: ScriptBlock[];
  /** bodies of inline <style> blocks, in order */
  styles: string[];
  links: Record<string, string>[];
  metas: Record<string, string>[];
  title?: string;
  /** body markup with scripts, styles, comments, links, metas and noscript removed */
  body: string;
  /** `data-canvas-width` / `data-canvas-height` found anywhere in the markup */
  canvas: { width?: number; height?: number };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const ATTRIBUTE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** Parse the attribute part of an opening tag. Names are lower-cased, values entity-decoded. */
export function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const [, name, dq, sq, bare] = match;
    if (name === "/") continue;
    attrs[name.toLowerCase()] = decodeEntities(dq ?? sq ?? bare ?? "");
  }
  return attrs;
}

/** Index just after the `>` that closes the tag opening at `start`, honouring quoted attribute values; -1 if unterminated. */
function findTagEnd(html: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i + 1;
    }
  }
  return -1;
}

interface RawBlocks {
  scripts: ScriptBlock[];
  styles: string[];
  /** the document with comments, scripts and styles removed */
  rest: string;
}

/** One pass over the document collecting comments, <script> and <style> elements in order. */
function scanRawBlocks(html: string): RawBlocks {
  const scripts: ScriptBlock[] = [];
  const styles: string[] = [];
  let rest = "";
  let last = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      const stop = end === -1 ? html.length : end + 3;
      rest += html.slice(last, lt);
      last = stop;
      i = stop;
      continue;
    }
    const open = /^<(script|style)(?=[\s/>])/i.exec(html.slice(lt, lt + 8));
    if (!open) {
      i = lt + 1;
      continue;
    }
    const tag = open[1].toLowerCase();
    const openEnd = findTagEnd(html, lt);
    if (openEnd === -1) break;
    const close = new RegExp(`</${tag}\\s*>`, "ig");
    close.lastIndex = openEnd;
    const closeMatch = close.exec(html);
    const bodyEnd = closeMatch ? closeMatch.index : html.length;
    const stop = closeMatch ? closeMatch.index + closeMatch[0].length : html.length;
    const attrs = parseAttributes(html.slice(lt + 1 + tag.length, openEnd - 1));
    const body = html.slice(openEnd, bodyEnd);
    if (tag === "script") scripts.push({ attrs, body });
    else styles.push(body);
    rest += html.slice(last, lt);
    last = stop;
    i = stop;
  }
  rest += html.slice(last);
  return { scripts, styles, rest };
}

function collectTags(markup: string, tag: string): Record<string, string>[] {
  return [...markup.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "gi"))].map((m) => parseAttributes(m[1]));
}

function readCanvasHints(markup: string): { width?: number; height?: number } {
  const hints: { width?: number; height?: number } = {};
  for (const m of markup.matchAll(/\bdata-canvas-(width|height)\s*=\s*["']?\s*(\d+(?:\.\d+)?)/gi)) {
    const value = Number(m[2]);
    if (value > 0) hints[m[1].toLowerCase() as "width" | "height"] ??= value;
  }
  return hints;
}

function extractBody(markup: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)(?:<\/body\s*>|$)/i.exec(markup);
  let inner = body ? body[1] : markup.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, "");
  inner = inner
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(link|meta|base)\b[^>]*>/gi, "")
    .replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, "");
  return inner.trim();
}

export function extractHtml(html: string): HtmlExtraction {
  const { scripts, styles, rest } = scanRawBlocks(html);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(rest)?.[1];
  return {
    scripts,
    styles,
    links: collectTags(rest, "link"),
    metas: collectTags(rest, "meta"),
    title: title ? decodeEntities(title).replace(/\s+/g, " ").trim() || undefined : undefined,
    body: extractBody(rest),
    canvas: readCanvasHints(rest),
  };
}

/**
 * True when the body holds real content, not just empty mount points such as
 * `<div id="root"></div>` (which React apps leave behind).
 */
export function hasStaticMarkup(body: string): boolean {
  let markup = body;
  for (let pass = 0; pass < 8; pass++) {
    const next = markup.replace(/<([a-z][\w-]*)\b[^>]*>\s*<\/\1\s*>/gi, "").replace(/<(br|hr|wbr)\b[^>]*\/?>/gi, "");
    if (next === markup) break;
    markup = next;
  }
  return /\S/.test(markup);
}
