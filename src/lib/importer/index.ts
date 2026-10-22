/**
 * Importer module (CONTRACTS §7) — public entry.
 *
 * Turns what designers have (a Claude Design project archive, a standalone
 * HTML export, a raw scene.jsx) into a Project whose entry file renders a
 * <Stage> with layer ids, and writes it back out as a zip. The `…Detailed`
 * variants also return the non-fatal warnings collected during the import
 * (dropped scripts, generated Stage wrappers, unparseable code).
 */
export { createBlankProject } from "./blank";
export { exportProjectZip } from "./exportZip";
export { importFromHtml, importFromHtmlDetailed } from "./html";
export { importFromJsx, importFromJsxDetailed } from "./jsx";
export type { ImportResult } from "./project";
export { importFromZip, importFromZipDetailed } from "./zip";
