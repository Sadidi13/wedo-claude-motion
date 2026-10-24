# Sound

Sound is a layer like any other: an `<Audio>` element in the Stage, next to the Sprites. It shows on
the timeline as a clip you can move and trim, plays in the preview in sync with the playhead, and is
mixed into the export.

```jsx
import { Audio, Sprite, Stage } from "./animations.jsx";

<Stage width={1080} height={1920} duration={8} fps={30}>
  <Audio sfx="pad" start={0} end={8} loop volume={0.5} fadeIn={1} fadeOut={1.5} data-layer-name="Music bed" />
  <Audio sfx="whoosh" start={1.2} data-layer-name="Whoosh" />
  <Audio src="assets/voice.mp3" start={2} from={0.5} data-layer-name="Voice" />
  <Sprite start={1.2} end={8}>…</Sprite>
</Stage>
```

| Prop | Meaning |
|---|---|
| `src` | an audio file of the project (`assets/…`; the loader turns it into a `data:` URL) |
| `sfx` | a built-in sound instead of a file (below) |
| `start`, `end` | stage seconds, literals like a Sprite's. Without `end` the clip plays to its own length; a looping clip plays to the end of the stage |
| `from` | offset into the file, seconds |
| `volume` | 0 to 1 |
| `fadeIn`, `fadeOut` | seconds |
| `loop` | repeat the source until `end` |

## Built-in sounds

21 sounds, synthesized by ffmpeg from formulas (`src/lib/audio/sfx.ts`): original, deterministic, and
no audio files in the repository. The server renders each to WAV on first use and caches it
(`os.tmpdir()/motion-studio/…`, or `MOTION_STUDIO_SFX_DIR`); the preview fetches them from
`GET /api/audio/sfx/<name>`.

- **Effects:** `whoosh`, `swoosh`, `pop`, `click`, `tick`, `typing`, `ding`, `chime`, `success`,
  `notification`, `sparkle`, `impact`, `bass-hit`, `riser`, `drop`, `glitch`, `heartbeat`, `shutter`
- **Beds** (meant to `loop`): `beat-90`, `beat-120`, `pad`

The contract (section 5) lists them with what each is for, so Claude can place cues on the moments a
storyboard names.

## In the editor

- **Sound** in the layers panel adds an audio file from the computer, or a built-in sound at the
  playhead.
- The transport's speaker button mutes the preview. Muting does not change the export.
- The Properties tab edits volume, fades, offset and loop like any layer attribute.

## Preview

`src/runtime/audio.tsx` renders a hidden marker element (so the clip is a layer) and an `HTMLAudioElement`.
The editor tells the preview when it plays, pauses or mutes (`{ type: "playback" }` message,
`setAudioPlayback`); each clip seeks itself to the playhead, so scrubbing, looping and jumping stay in
sync. A standalone page plays with the Stage's own clock.

## Export

In render mode nothing plays. Every clip the page renders is recorded, and
`window.__getAudioClips()` hands the list to the exporter (`src/lib/server/export/renderer.ts`).
`src/lib/server/export/audio.ts` then:

1. merges the samples of each clip (`mergeClips`) and writes its source to `<job>/audio/`;
2. builds one ffmpeg graph (`buildAudioMixArgs`, pure): `atrim` for `from` and length, `afade` in and
   out, `adelay` to the clip's start relative to the export range, `amix`, then `alimiter`, and
   `apad` / `-t` to cover exactly the export range;
3. mixes it into `<job>/audio.wav` (48 kHz stereo).

The encoder adds it in the same pass: AAC in MP4, Opus in WebM, PCM in MOV; the PNG-sequence zip
gets `audio.wav`; GIF stays silent. The export dialog shows **Include sound** (on by default) when the
scene has audio layers. A clip whose source cannot be read is skipped with a warning in the server
log, rather than failing the export.
