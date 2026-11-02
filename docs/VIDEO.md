# Video layers and the media library

Footage (a talking head, B-roll, a screen recording) is too large to live inside a project: project
assets are data: URLs kept in the browser's localStorage. Videos therefore go into a **media
library** on the local server, and scenes refer to them by id:

```jsx
import { Stage, Sprite, Video } from "./animations.jsx";

<Stage width={1080} height={1920} duration={46.35} fps={30}>
  <Sprite start={0} end={46.35} data-layer-name="Footage">
    <Video src="media/k3f9x2abcd12.mp4" />
  </Sprite>
  {/* titles, captions, graphics above it */}
</Stage>
```

## Importing

- **Editor:** the Video button in the layers panel uploads the file (any size, streamed to disk)
  and adds it as the bottom layer at the playhead. When the clip runs past the end of the stage,
  the stage is lengthened to fit.
- **Claude Code:** `node scripts/motion-bridge.mjs media <file>` uploads it, waits until it is
  ready and prints the `media/<id>.<ext>` reference, its length, size and whether it has sound.
  `media` alone lists the library.

The server stores each file under `<repo>/.motion-media/<id>/` (override:
`MOTION_STUDIO_MEDIA_DIR`; git-ignored) and prepares it in the background with ffmpeg:

| file | used by |
|---|---|
| `source.<ext>` | the original; exports mix its sound from here |
| `preview.mp4` | the editor's playback (H.264, long side 1920, a keyframe every second) |
| `frames/f_000000.jpg …` | exports: one JPEG per frame at the source frame rate (rounded), long side `MOTION_STUDIO_MEDIA_FRAME_SIDE` or 2560 |
| `meta.json` | `MediaMeta` (`src/lib/media.ts`): state, length, size, sound, frame count |

Measured on this project's own machine with a 46-second 4K camera file (333 MB): about 4 minutes
from upload to ready, 180 MB of frames and a 9 MB preview copy. Exports draw about one frame per
second under `pnpm dev` (each frame decodes a 1440×2560 JPEG), so a 46-second reel takes roughly
25 minutes; the frames are exact either way.

## `<Video>` props

| prop | meaning |
|---|---|
| `src` | `media/<id>.<ext>` |
| `from` | seconds into the file at the Sprite's start (default 0) |
| `volume` | 0..1 for its sound (default 1); `volume={0}` or `muted` leaves it out of the mix |
| `fit` | `cover` (default), `contain` or `fill` inside its box |
| `style` | the box (it fills its parent by default); punch-ins go here or on a wrapper |

## How it plays and exports

- **Editor preview:** a `<video>` element plays `preview.mp4`, following the playhead like
  `<Audio>` does (re-seeking when it drifts, exact seek when paused or scrubbing). Until the file
  is ready the layer shows "Preparing the video…".
- **Export:** the renderer first waits until every video the project refers to is ready
  (`ensureMediaReady`). In the headless page each frame draws the JPEG for its time
  (`frameAt`) and holds the frame (`src/runtime/pending.ts`) until it is decoded, so footage is
  frame-exact. The page may load `/api/media/<id>` and its frames only for ids the project's code
  mentions (`isAllowedRenderRequest`). The sound is reported with the `<Audio>` clips and mixed
  from `source.<ext>` by ffmpeg.

## Routes

| route | |
|---|---|
| `POST /api/media/upload` | raw body (`application/octet-stream`), header `X-File-Name`; answers 201 with the meta and `ref`. Not behind `src/proxy.ts` (it would buffer the body and cut it at 10 MB): the route runs `checkMediaUpload` itself (local host, same origin, up to 8 GB) |
| `GET /api/media` | the library |
| `GET /api/media/<id>` | one file's meta |
| `GET /api/media/<id>/preview` | the preview copy, with Range support |
| `GET /api/media/<id>/frames/<n>` | export frame `n` (JPEG, cached forever) |

The library is local to the machine: a project that refers to `media/<id>` only plays where that
file was imported. Moving a project to another computer means importing its footage there again.
