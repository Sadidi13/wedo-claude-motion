# Sound

Sound is a layer like any other: an `<Audio>` element in the Stage, next to the Sprites. It shows on
the timeline as a clip you can move and trim, plays in the preview in sync with the playhead, and is
mixed into the export.

```jsx
import { Audio, Sprite, Stage } from "./animations.jsx";

<Stage width={1080} height={1920} duration={8} fps={30}>
  <Audio sound="music-corporate" start={0} end={8} volume={0.4} fadeIn={0.4} fadeOut={1.5} data-layer-name="Music" />
  <Audio sound="whoosh-fast" start={0.42} data-layer-name="Whoosh" />
  <Audio src="assets/voice.mp3" start={2} from={0.5} data-layer-name="Voice" />
  <Sprite start={2.2} end={8}>…</Sprite>
</Stage>
```

| Prop | Meaning |
|---|---|
| `src` | an audio file of the project (`assets/…`; the loader turns it into a `data:` URL) or of the media library (`media/<id>.mp3`) |
| `sound` | a real recorded sound or music bed from the sound bank instead of a file (below) |
| `sfx` | an older synthesized sound (below); kept so older scenes still play |
| `start`, `end` | stage seconds, literals like a Sprite's. Without `end` the clip plays to its own length; a looping clip plays to the end of the stage |
| `from` | offset into the file, seconds |
| `volume` | 0 to 1 |
| `fadeIn`, `fadeOut` | seconds |
| `loop` | repeat the source until `end` |

## The sound bank (real recordings)

24 sound effects and 5 music beds (`src/lib/audio/realSounds.ts`), all **CC0 1.0** (public domain)
from [freesound.org](https://freesound.org): free to use in any video, commercial or not, without
credit. Each was chosen by listening with earshot: an effect is a real recording or a professionally
produced one (or a designed sound of a kind that is synthetic by nature: risers, glitches, drops), a
bed is professionally mixed music with full bandwidth. Nothing is stored in the repository.

The server downloads a sound's Freesound preview (HQ OGG) the first time it is played or exported,
trims it, levels it and caches a 48 kHz stereo WAV with the media library (`<media>/sounds/`, or
`MOTION_STUDIO_SOUNDS_DIR`; `src/lib/server/audio.ts`). Effects are levelled to a -3 dBFS peak, so
`volume` means the same for each; beds to -16 LUFS (true peak at most -1.5 dBTP, DC and rumble under
20 Hz removed). The preview fetches them from `GET /api/audio/sound/<name>` (`list` for the bank). A
bed is a few megabytes and Freesound's CDN can be slow, so its first download can take a minute or
two; after that it is instant and works offline.

Every effect has a measured **hit time** (`peak`): where the whoosh lands, the boom hits, the riser
tops out, in seconds from its start. A clip that should land on a moment starts that long before it.
Every bed has a measured tempo and **first beat**: beats fall at `firstBeat + n × 60 / BPM` from its
start, so cuts can land on them. `loops` beds repeat without a seam; the others play once.

| Name | Length / hit | Freesound | Title, author |
|---|---|---|---|
| `whoosh-fast` | 2.13 s / 1.78 s | [486234](https://freesound.org/s/486234/) | Whoosh For Whip Zoom, BennettFilmTeacher |
| `whoosh-soft` | 2.18 s / 0.36 s | [558827](https://freesound.org/s/558827/) | Deep Whoosh #5, Kinoton |
| `whoosh-cinematic` | 4 s / 1.51 s | [848212](https://freesound.org/s/848212/) | Whoosh, Futuristic, Pass-By, Cinematic 03, JW_Audio |
| `swish-fast` | 0.77 s / 0.21 s | [614170](https://freesound.org/s/614170/) | Swishes_4_strong_fast, videofueralle |
| `swish-quick` | 0.28 s / 0.05 s | [683101](https://freesound.org/s/683101/) | quick woosh, florianreichelt |
| `swoosh-short` | 0.28 s / 0.05 s | [585257](https://freesound.org/s/585257/) | swoosh-1, lesaucisson |
| `pop` | 0.17 s / 0.01 s | [245646](https://freesound.org/s/245646/) | Cartoon Pop (Distorted), unfa |
| `click` | 0.41 s / 0.02 s | [488534](https://freesound.org/s/488534/) | UI click, Ranner |
| `click-soft` | 0.12 s / 0.01 s | [467951](https://freesound.org/s/467951/) | UI Button Click, benzix2 |
| `typing` | 2.5 s / 0.1 s | [685984](https://freesound.org/s/685984/) | Keyboard typing sounds: modded Omnikey 101, zrrion |
| `typing-long` | 8 s / 0.14 s | [442689](https://freesound.org/s/442689/) | Keyboard Typing, bwarpus99 |
| `impact-cinematic` | 6.2 s / 1.41 s | [719831](https://freesound.org/s/719831/) | impact_01, vekoN |
| `boom-deep` | 4.9 s / 0.01 s | [754421](https://freesound.org/s/754421/) | Deep Cinematic Impact 2, zazz.sound.design |
| `punch` | 0.47 s / 0.08 s | [439747](https://freesound.org/s/439747/) | Punch Hit 1, joe_anderson22 |
| `thud` | 0.57 s / 0.05 s | [388038](https://freesound.org/s/388038/) | Lettuce Hit, saturdaysoundguy |
| `riser` | 2.48 s / 2.2 s | [685256](https://freesound.org/s/685256/) | Riser sound effect short, syntheffects |
| `ding` | 0.79 s / 0.18 s | [571513](https://freesound.org/s/571513/) | Soft-Notifications - Bell - Ding-Dong, LegitCheese |
| `camera-shutter` | 0.51 s / 0.06 s | [520684](https://freesound.org/s/520684/) | Contarex camera shutter, Tonik1105 |
| `glitch` | 0.35 s / 0.07 s | [424375](https://freesound.org/s/424375/) | glitched sound 1, Elnosos |
| `sparkle` | 0.9 s / 0 s | [511485](https://freesound.org/s/511485/) | cartoon_wink_magic_sparkle, MLaudio |
| `magic-transition` | 2.25 s / 0.9 s | [856641](https://freesound.org/s/856641/) | Cartoon Magic Transition, qubodup |
| `bass-drop` | 3.2 s / 1.6 s | [727610](https://freesound.org/s/727610/) | Color Bass 1, staticpony1 |
| `success` | 0.9 s / 0.29 s | [541985](https://freesound.org/s/541985/) | GASP_Chimes_Success_4, Rob_Marion |
| `tick` | 0.2 s / 0.05 s | [534094](https://freesound.org/s/534094/) | clock-tick-01, pbimal |
| `music-corporate` | 60 s, 120 BPM, loops | [713517](https://freesound.org/s/713517/) | Perspire (Loop), JapanYoshiTheGamer |
| `music-playful` | 37.65 s, 101.3 BPM | [561190](https://freesound.org/s/561190/) | Tropicorp Advertisement, code_box |
| `music-hiphop` | 22.15 s, 65 BPM, loops | [806474](https://freesound.org/s/806474/) | Down-fi Hop w Bass 65bpm, CVLTIV8R |
| `music-synthwave` | 31.22 s, 123 BPM, loops | [841299](https://freesound.org/s/841299/) | Upbeat Game Loop - Aurora Ride, Venus17 |
| `music-dreamy` | 60.22 s, 107.7 BPM | [814843](https://freesound.org/s/814843/) | Wonders [cinematic background music] (40.17-100.39 s), Seth_Makes_Sounds |

The contract (section 5) lists every sound with its hit time and every bed with its beat, and tells
Claude to use these for every effect and to put cuts on the beats.

## Older synthesized sounds

21 sounds synthesized by ffmpeg from formulas (`src/lib/audio/sfx.ts`), used by scenes made before the
sound bank. They still play and export (rendered to WAV on first use, cached in
`os.tmpdir()/motion-studio/…` or `MOTION_STUDIO_SFX_DIR`, served from `GET /api/audio/sfx/<name>`),
but new scenes use the bank. The editor still offers their three looping beds (`beat-90`, `beat-120`,
`pad`) in the Sound menu.

## In the editor

- **Sound** in the layers panel adds an audio file from the computer, a sound from the **Sound
  library…** (▶ previews it; **Add** puts an effect so its hit lands on the playhead, and a bed from
  the playhead to the end of the stage, at 40% with a 1 s fade-out), or one of the older looping beds.
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
