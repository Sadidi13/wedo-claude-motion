/**
 * Public entry of the Motion Studio runtime. Re-exports `./motion` (Stage,
 * Sprite, hooks, easing), `./three` (<Three3D>) and `useGsapTimeline` from
 * `./gsap` so the loader (`@/runtime`) and project code (`./animations.jsx`
 * alias) see one module instance with the contract's exports (CONTRACTS.md §1).
 */
export * from "./motion";
export * from "./three";
export { useGsapTimeline, type GsapTimelineBuild } from "./gsap";
