# Quality check

**Check** in the top bar (and `qa` / `check_quality` for Claude) renders the video on this computer
and lists what a designer would notice before publishing. It costs no Claude usage: the render and the
measuring are local, and Claude only reads the resulting list.

## What it finds

| Kind | Severity | When |
|---|---|---|
| `text-cut` | error | a visible text runs outside the frame |
| `safe-margin` | warning | a text sits within 3.5% of the frame's edge |
| `text-clipped` | warning | a text does not fit its box and is clipped |
| `overlap` | warning | texts of different layers overlap |
| `contrast` | error below 2:1, warning below 3:1 | text against the background behind it |
| `small-text` | warning | the largest size of a text stays under 2% of the frame's short side |
| `rtl` | warning | Persian or Arabic text laid out left to right |
| `too-brief` | warning | a text of 3+ words is readable for less than max(0.8 s, 0.25 s per word) |
| `empty` | warning | nothing visible for a second or more (not counting the first and last half second) |
| `frozen` | warning | the frame hardly changes for 3 seconds or more |

A problem is reported only when it lasts (at least 0.4 s, and 1.5 sample steps), so a title flying in
from outside the frame is fine. Each issue names the layer and its time range.

## How it works

`src/lib/server/qa/index.ts` opens the scene in headless Chromium exactly like an export (same
preview page, sandbox and network rules) and samples about two frames per second (6 to 60 samples) at
half size. For each sample it reads every text's box from DOM ranges (font size, opacity, clipping,
direction), takes a screenshot, and a second one with the text hidden to measure each text's contrast
against what is really behind it. `src/lib/server/qa/analyze.ts` (pure, tested) turns the samples into
issues and a text report.

One check runs at a time (HTTP 429 otherwise). A short video takes a few seconds; a long one about a
minute.

## In the editor

`src/components/QualityDialog.tsx` shows the list. Clicking an issue moves the playhead to it and
selects its layer. **Ask Claude to fix** queues one whole-scene request with the list, through the
same queue as the Ask Claude tab.

## For Claude

After `new` or `edit`, `node scripts/motion-bridge.mjs qa` checks what Claude just sent: the scene of
the pushed event, or the project after the editor shared the edited version
(`POST /api/bridge/qa`, token). The chat connector has `check_quality`. The skill and the autopilot
run it after building a video and fix real problems before handing it over.

## Review after a build

With `{ "review": true }` the check also saves contact sheets of the rendered frames in the bridge
folder (`reviews/<event>-1.jpg`, …): 12 frames spread evenly over the video, six to a sheet, each
labelled with its time, at the size Claude reads an image without shrinking it (`reviewLayout`).

After it builds a video, the autopilot runs this check and one more Claude run (effort xhigh) that
looks at the sheets next to the designer's reference images (when the storyboard has them), with the
style spec and the check's findings, the way a senior motion designer reviews a cut: likeness to the
reference, finish, motion (easing with weight, overshoot, motion blur, nothing frozen) and sound
(each effect's hit on its moment). It fixes at most five things, or answers `{"ok": true}` when the
video already meets the bar. The fix arrives in the editor as an edit named "Review after the build",
so the designer can undo it.
