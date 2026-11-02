# Video layers and the media library

Footage (a talking head, B-roll, a screen recording) is too large to live inside a project: project
assets are data: URLs kept in the browser's localStorage. Videos therefore go into a **media
library** on the local server, and scenes refer to them by id. The library also holds the other
files a video is made with: sound (a voice-over, music), images (a logo, product photos) and fonts.

```jsx
import { Stage, Sprite, Video } from "./animations.jsx";

<Stage width={1080} height={1920} duration={46.35} fps={30}>
  <Sprite start={0} end={46.35} data-layer-name="Footage">
    <Video src="media/k3f9x2abcd12.mp4" />
  </Sprite>
  {/* titles, captions, graphics above it */}
</Stage>
```

| kind | extensions | in scene code |
|---|---|---|
| video | mp4 mov m4v webm mkv avi | `<Video src="media/<id>.mp4" />` inside a Sprite |
| sound | mp3 wav m4a aac ogg oga opus flac | `<Audio src="media/<id>.mp3" start={0} />` (played from `/api/media/<id>/file`, mixed into exports from the original) |
| image | png jpg jpeg webp gif avif svg | `<img src="media/<id>.png" />` |
| font | ttf otf woff woff2 | CSS `@font-face { font-family: "Brand"; src: url("media/<id>.ttf"); }` |

The loader points image and font references at `/api/media/<id>/file` (`rewriteMediaReferences`
in `src/lib/loader/assets.ts`); video and sound references stay as written for `<Video>` and
`<Audio>`. A font's family, weight and style are read from its own `name` and `OS/2` tables
(`src/lib/server/media/fontInfo.ts`; TrueType, OpenType, WOFF and WOFF2), so it is used under the
name it declares.

## Importing

- **New video wizard** (the top bar's New video button): every file added there goes into the
  library at once, and the storyboard hands them to Claude as the video's materials
  ([STORYBOARD.md](STORYBOARD.md#the-new-video-wizard)).
- **Editor:** the Video button in the layers panel uploads the file (any size, streamed to disk)
  and adds it as the bottom layer at the playhead. When the clip runs past the end of the stage,
  the stage is lengthened to fit.
- **Claude Code:** `node scripts/motion-bridge.mjs media <file>` uploads it, waits until it is
  ready and prints the `media/<id>.<ext>` reference, what it is (length, size, sound, font family)
  and how to use it. `media` alone lists the library.

The server stores each file under `<repo>/.motion-media/<id>/` (override:
`MOTION_STUDIO_MEDIA_DIR`; git-ignored). A sound only needs its length, an image its size and a
font its name: they are ready in a moment. A video is prepared in the background with ffmpeg, one
video at a time:

| file | used by |
|---|---|
| `source.<ext>` | the original; exports mix its sound from here |
| `preview.mp4` | the editor's playback (H.264, long side 1920, a keyframe every second) |
| `frames/f_000000.jpg …` | exports: one JPEG per frame at the source frame rate (rounded), long side `MOTION_STUDIO_MEDIA_FRAME_SIDE` or 2560 |
| `meta.json` | `MediaMeta` (`src/lib/media.ts`): kind, state, length, size, sound, frame count, font name |
| `transcript.json` | what is said, when it was transcribed (below) |

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
  frame-exact. The page may load `/api/media/<id>`, its frames and its file only for ids the
  project's code mentions (`isAllowedRenderRequest`). The sound is reported with the `<Audio>`
  clips and mixed from `source.<ext>` by ffmpeg. Every frame also waits for the images it shows and
  the fonts its text uses (`whenSettled` in `src/runtime/pending.ts`), so a logo or a font from the
  library is on the first frame it appears in.

## What is said: transcripts

A video or sound with speech can be transcribed on this computer with Whisper, so captions and cuts
follow what is said without any Claude usage (`src/lib/server/media/transcribe.ts`). ffmpeg extracts
16 kHz mono speech and `scripts/transcribe.py` runs faster-whisper with word timings
(`MOTION_STUDIO_WHISPER_MODEL`, default `large-v3`, which writes Persian well; about four times the
clip's length on a laptop CPU, one transcript at a time). The Python comes from
`MOTION_STUDIO_WHISPER_PYTHON`, else the environment the `/watch` skill installs WhisperX into
(`~/.cache/watch/whisperx-venv`); without one the wizard asks for the script instead.

The wizard starts it for footage and voice-overs and shows each segment for correction (a misheard
brand name is fixed once). The storyboard brief gives Claude the segments at every step and the
word timings for the build.

## Routes

| route | |
|---|---|
| `POST /api/media/upload` | raw body (`application/octet-stream`), header `X-File-Name`; answers 201 with the meta and `ref`. Not behind `src/proxy.ts` (it would buffer the body and cut it at 10 MB): the route runs `checkMediaUpload` itself (local host, same origin, up to 8 GB) |
| `GET /api/media` | the library |
| `GET /api/media/<id>` | one file's meta |
| `GET /api/media/<id>/preview` | the preview copy, with Range support |
| `GET /api/media/<id>/frames/<n>` | export frame `n` (JPEG, cached forever) |
| `GET /api/media/<id>/file` | the file as imported, with Range support (sound, images, fonts); `Content-Security-Policy: sandbox`, so an SVG opened directly runs nothing |
| `GET/POST/PUT /api/media/<id>/transcript` | the transcript's status and text; start Whisper (`{ language? }`); save corrections (`{ texts }`) |

The library is local to the machine: a project that refers to `media/<id>` only plays where that
file was imported. Moving a project to another computer means importing its footage there again.
