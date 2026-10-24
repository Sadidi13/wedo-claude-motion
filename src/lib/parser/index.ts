/**
 * Parser module (CONTRACTS §2) — public entry.
 *
 * Pure, isomorphic `string → string` functions that expose a Claude-Motion
 * scene file (one <Stage> with <Sprite> children) as a layer tree and apply
 * layer edits as minimal source splices. Everything else in this directory
 * is internal.
 */
export { ParseError } from "./errors";
export { parseScene } from "./scene";
export { ensureLayerIds } from "./ensureIds";
export {
  type LayerMove,
  deleteLayer,
  duplicateLayer,
  getLayerSource,
  insertLayer,
  listLayerIds,
  moveLayer,
  replaceLayerSource,
} from "./layerOps";
export { setLayerAttribute, setLayerHidden, setLayerLocked, setLayerMotion, setLayerName, setLayerTiming, wrapInSprite } from "./layerProps";
export { setStageMeta } from "./stageMeta";
