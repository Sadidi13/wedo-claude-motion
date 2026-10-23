"use client";
/**
 * GSAP, driven by Motion Studio's time (CONTRACTS.md §1 "GSAP"). The runtime
 * (`./animations.jsx`) exports `useGsapTimeline`; scenes import `gsap` and
 * the plugins in GSAP_PLUGINS (src/lib/gsapModules.ts) from the loader, which
 * hands out the very modules imported here.
 *
 * GSAP normally plays animations on its own requestAnimationFrame ticker. In
 * a scene nothing may move with the wall clock, so:
 *   - importing this module pauses GSAP's global timeline: a tween made
 *     outside useGsapTimeline (`gsap.to(…)` at module level or in an effect)
 *     never advances, in the editor or in export;
 *   - the GSAP_PLUGINS are registered once, so scenes may use them without
 *     calling `gsap.registerPlugin` (calling it again is harmless);
 *   - useGsapTimeline(build, deps) builds ONE paused timeline inside a
 *     gsap.context scoped to the element its returned ref is attached to,
 *     after web fonts are ready (SplitText measures text), and on every render
 *     seeks it to the enclosing Sprite's local time (the stage time outside a
 *     Sprite) in a layout effect. seek() renders synchronously (GSAP flushes
 *     lazy first renders on seek), backwards as well as forwards, and under
 *     `window.__seek` (flushSync) the styles are written before it returns;
 *   - on unmount, or when `deps` change, the context is reverted: inline
 *     styles and SplitText markup return to what React rendered.
 */

import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";
import * as gsapModule from "gsap";
import * as CustomEaseModule from "gsap/CustomEase";
import * as DrawSVGPluginModule from "gsap/DrawSVGPlugin";
import * as MorphSVGPluginModule from "gsap/MorphSVGPlugin";
import * as MotionPathPluginModule from "gsap/MotionPathPlugin";
import * as SplitTextModule from "gsap/SplitText";
import * as TextPluginModule from "gsap/TextPlugin";
import type { GsapModule } from "@/lib/gsapModules";
import { useFontsReady } from "./fonts";
import { useSprite } from "./motion";

const { gsap } = gsapModule;

/** The module objects scene code receives for each GSAP specifier (same instances as here). */
export const GSAP_NAMESPACES: Record<GsapModule, object> = {
  gsap: gsapModule,
  "gsap/SplitText": SplitTextModule,
  "gsap/DrawSVGPlugin": DrawSVGPluginModule,
  "gsap/MorphSVGPlugin": MorphSVGPluginModule,
  "gsap/MotionPathPlugin": MotionPathPluginModule,
  "gsap/CustomEase": CustomEaseModule,
  "gsap/TextPlugin": TextPluginModule,
};

gsap.registerPlugin(
  SplitTextModule.SplitText,
  DrawSVGPluginModule.DrawSVGPlugin,
  MorphSVGPluginModule.MorphSVGPlugin,
  MotionPathPluginModule.MotionPathPlugin,
  CustomEaseModule.CustomEase,
  TextPluginModule.TextPlugin,
);
// Motion Studio owns time: GSAP's own clock must never move anything.
gsap.globalTimeline.pause();

/** Fills the paused timeline; `scope` is the element the hook's ref is attached to. */
export type GsapTimelineBuild<T extends Element> = (timeline: gsap.core.Timeline, scope: T) => void;

/**
 * Build a paused GSAP timeline once (again when `deps` change) and keep it
 * seeked to the Sprite's local time. Attach the returned ref to the element
 * that contains the animated nodes; selector text in `build` (".word") is
 * scoped to it.
 */
export function useGsapTimeline<T extends Element = HTMLDivElement>(
  build: GsapTimelineBuild<T>,
  deps: DependencyList = [],
): RefObject<T | null> {
  const scopeRef = useRef<T | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const { localTime } = useSprite();
  const fontsReady = useFontsReady();

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (!fontsReady || !scope) return;
    const built: { timeline?: gsap.core.Timeline } = {};
    const context = gsap.context(() => {
      built.timeline = gsap.timeline({ paused: true });
      build(built.timeline, scope);
    }, scope);
    timelineRef.current = built.timeline ?? null;
    return () => {
      timelineRef.current = null;
      context.revert();
    };
    // `build` is a new function on every render; the timeline is rebuilt only when `deps` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, ...deps]);

  // Every render (each time change): the picture is a function of the time.
  useLayoutEffect(() => {
    timelineRef.current?.seek(localTime);
  });

  return scopeRef;
}
