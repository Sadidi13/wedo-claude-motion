# Move, scale, rotate and keyframes

The designer can move, scale, rotate and fade any layer by hand, statically or animated with
keyframes, without touching its code. Claude's code and the designer's motion live side by side: the
motion is stored in the scene as one `data-motion` attribute on the layer's element and applied on
top of whatever the scene's own code does.

```jsx
<h1 data-layer-id="title" data-motion='{"x":40,"y":-20,"scale":1.2}'>…</h1>
<div data-layer-id="card" data-motion='{"x":[[0,-120,"easeOutCubic"],[0.6,0]],"opacity":[[0,0],[0.4,1]]}'>…</div>
```

## The format

`src/lib/motion/keyframes.ts` (pure, tested):

- Properties: `x`, `y` (px), `scale` (1 = as is), `rotate` (degrees), `opacity` (0 to 1, multiplied
  with the element's own).
- A value is a number (static) or a list of keyframes `[time, value, ease?]`.
- Keyframe times are seconds from the start of the layer's Sprite (the layer itself when it is a
  Sprite, else its nearest Sprite ancestor). Moving the clip on the timeline moves its keyframes with
  it.
- A keyframe's easing (any name of the runtime's `Easing`) shapes the segment that starts at it.
- `ox`, `oy` place the transform origin in px from the element's top-left. The editor sets them for
  Sprite layers, whose own box is the whole stage, so they pivot around their visible content.

## Runtime

After every Stage commit, `applyLayerMotion` (`src/runtime/layerMotion.ts`) finds the elements with
`data-motion`, evaluates them at the Sprite-local time (the Sprite wrapper carries
`data-sprite-start`) and sets the CSS individual transform properties (`translate`, `rotate`,
`scale`) and opacity. These compose with the element's own `transform`, so it works on any element,
custom components included, and stays a pure function of time: export renders it frame-exactly.

## In the editor

- **On the canvas** (`src/components/TransformBox.tsx`): drag the selected layer's box to move it, a
  corner to scale, the knob above it to rotate. Shift keeps a move on one axis and snaps rotation to
  15°. While dragging, the preview shows the change live through a motion override message; on
  release it is written into the scene, one undo step.
- **Properties → Transform** (`src/components/TransformSection.tsx`): X, Y, scale, rotation and
  opacity at the playhead. ◇ starts animating a property with a keyframe at the playhead; ◆ (a key is
  here) removes it. Editing a value, or dragging on the canvas, sets the keyframe at the playhead when
  the property is animated, and the static value otherwise. The easing menu applies to the
  segments that start at the playhead. Reset removes the layer's motion.
- **Timeline:** keyframes show as diamonds on the layer's clip; clicking one moves the playhead there.

Claude keeps `data-motion` attributes as they are when it edits the scene (contract section 1), so the
designer's adjustments survive Claude's changes.

## Comments on the frame

**Comment** in the canvas toolbar (or C) turns on comment mode: a click on the stage drops a pin and
opens a box for what should change there (`src/components/CommentLayer.tsx`). Sending queues an Ask
Claude request for the layer under the pin (`layerAtPoint` picks the smallest visible layer there; a
lone child of a Sprite counts as the Sprite), with the time and the point in stage pixels added to the
instruction. The pin stays while Claude works on it. Escape leaves comment mode.
