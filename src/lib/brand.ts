/**
 * Product naming in one place: the editor's title, the top bar and exported files read it from
 * here, so a rename is a one-line change. (The CLI, the MCP connector and the docs carry the name
 * as plain text; scripts/lib/bridge-client.mjs has the user-facing next-step note.)
 */
export const PRODUCT_NAME = "WeDo Claude Motion";

export const PRODUCT_TAGLINE =
  "Layer-based editor for Claude Motion animations: edit layers by hand or ask Claude to rewrite one.";

/** Independent project: shown wherever the name could suggest an official Anthropic product. */
export const DISCLAIMER = "Independent project, not affiliated with or endorsed by Anthropic. Claude is a trademark of Anthropic, PBC.";
