/**
 * The GSAP entry points a scene may import (CONTRACTS.md §1 "GSAP"). One list
 * shared by the loader, the AI validator, the importer and the runtime, so
 * they cannot drift. Dependency-free: safe on the server and in tests.
 *
 * Only plugins whose output is a pure function of the seeked time are listed.
 * Left out on purpose: ScrambleTextPlugin, EasePack (RoughEase) and
 * CustomWiggle (random by design), Flip (reads live layout between states),
 * ScrollTrigger / ScrollSmoother / Draggable / Observer / InertiaPlugin
 * (scroll and pointer input), GSDevTools (its own playback UI).
 */

export const GSAP_PLUGINS = [
  "SplitText",
  "DrawSVGPlugin",
  "MorphSVGPlugin",
  "MotionPathPlugin",
  "CustomEase",
  "TextPlugin",
] as const;

export type GsapPlugin = (typeof GSAP_PLUGINS)[number];
export type GsapModule = "gsap" | `gsap/${GsapPlugin}`;

export const GSAP_MODULES: readonly GsapModule[] = ["gsap", ...GSAP_PLUGINS.map((name) => `gsap/${name}` as const)];

/** `gsap`, `gsap/SplitText` or `gsap/SplitText.js` → the module it names; anything else → undefined. */
export function gsapModuleFor(specifier: string): GsapModule | undefined {
  const name = specifier.startsWith("gsap/") ? specifier.replace(/\.js$/, "") : specifier;
  return (GSAP_MODULES as readonly string[]).includes(name) ? (name as GsapModule) : undefined;
}
