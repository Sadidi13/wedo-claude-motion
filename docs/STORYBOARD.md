# Storyboard first

Every new video goes through three steps the designer sees and decides in the editor, before Claude
writes the whole scene. Claude does not spend a long build on a look nobody asked for, and the
designer gets the video they approved.

```
styles-pending ──► choose-style ──► storyboard-pending ──► storyboard ──► build-pending ──► built
 (Claude: style      (designer        (Claude: shots         (designer       (Claude: the
  frames)             picks one)        in that style)         approves)       whole scene)
```

1. **Style frames.** Claude proposes 3 (at most 6) clearly different directions. Each is a complete
   entry file at the video's canvas size that shows one key moment (`time`), usually the hero frame.
2. **Choose.** The designer picks one in the storyboard view and may add a note, or asks for other
   styles (**Try other styles**, which means new directions, not variations).
3. **Storyboard.** Claude writes the shots in the chosen style: `title`, `start`, `end`, `action`
   (what moves), on-screen `text`, `audio` cues, and sketches (`code` + `time`) for the key shots,
   built from the chosen style frame.
4. **Approve** or **Ask for changes**. Approval queues the build: Claude writes the whole scene and
   calls `new --board <id>` (CLI) or `create_scene` with `board_id` (chat). The board is then `built`
   and the new project opens.

Before the build the designer can go back: choose another style, ask for other styles, or revise the
storyboard again.

## Where it runs

| Who starts it | How |
|---|---|
| Claude in a chat or Code session | writes the style frames and calls `board-styles` / `propose_styles`; that creates the board and opens the storyboard view |
| The designer in the editor | the **New video** wizard (below), or **Ask Claude → New scene**, starts an empty board (`POST /api/bridge/boards/start`) and queues the style step for whoever listens |

Each decision taken in the editor queues a bridge request with a `board` field
(`{ boardId, action, note? }`), so the Code tab, the chat connector and the autopilot all receive it
like an Ask Claude request, with a brief (`src/lib/server/bridge/boardBrief.ts`) that says which
command or tool delivers the step. When the designer decides in the chat instead ("the second one"),
Claude records the decision with the bridge token (`board-choose`, `record_decision`) and nothing is
queued.

`new` without `--board` is refused. `--skip-storyboard` (`skip_storyboard` in the chat tool) is for
when the user explicitly asked for no storyboard.

## The New video wizard

The top bar's **New video** button (and `?new=1`, which `motion-bridge launch` opens) starts every
video in four steps (`src/components/wizard/NewVideoWizard.tsx`, state in `src/store/wizardStore.ts`):

1. **Kind**: motion graphics only, or footage of a person (a conversation with Claude comes next);
   what the video is about, the format (9:16, 16:9, 1:1, 4:5), its length and language.
2. **Content**: footage, a voice-over or music, images and a logo, fonts, each uploaded to the media
   library as it is added ([VIDEO.md](VIDEO.md)), with its use (footage, voice-over, music, logo, …)
   and an optional note; footage and voice-overs are transcribed by Whisper and can be corrected
   there. With footage, its length becomes the video's. A script box takes the exact on-screen words.
3. **Style**: up to three directions from the style library (search, grouped), references to match
   (also uploaded to the library, so any size), or neither and Claude proposes.
4. **Start**: a summary, and the autopilot switch when nobody listens.

The board keeps the setup (`videoKind`, `language`, `script`, `materials`, `styleHints`). The brief of
every step, the build included, lists the materials with their `media/…` references, lengths, sizes
and font names and how scene code uses each, the transcript (segments; word timings for the build),
the script, and for the style step the picked directions ("one style frame from each").

## Validation

Style frames and sketches are checked like new scenes (`finalizeOutput`, scope "new"): imports, no
time or random APIs, a parseable `<Stage>`. They must use the board's canvas size. A bad frame is
rejected with the error text (HTTP 422) and the board stays where it was, so Claude fixes it and
sends it again. A step that does not fit the board's state answers 409.

## Choosing directions

`styles` (CLI), `get_style_library` (chat) or `GET /api/bridge/contract?part=styles` give the style
library (`src/lib/ai/styleLibrary.ts`): 117 directions in ten groups (commercial and product,
hand-drawn, paper and craft, art and design movements, retro digital, retro UI and neon, light and
imaging, data and information, generative and type, cosmic and psychedelic), each with a concrete
recipe that renders in Motion Studio. It is a menu, not a limit: the contract's section 9 asks Claude to pick directions that
fit the product, audience, format and brand, to make them clearly different from each other, and to
go beyond the list when another look fits better.

## References

The designer can attach up to 4 reference images or videos (40 MB each) to a board in the
storyboard view, and Claude can make previews of files the user gives it in the chat
(`reference <file>`). `src/lib/server/bridge/references.ts` stores them in
`<bridge state>/refs/<boardId>/` and makes a JPEG preview with ffmpeg:

- an image is scaled down to 1280 px wide;
- a video becomes a contact sheet of 12 frames (4 × 3), or 16 (4 × 4) for clips over 20 seconds,
  spread evenly over its length.

The next style step's brief tells Claude to match the reference's look (palette, type, texture,
pacing, transitions) and how to see the previews: their file paths for the Code tab (Read tool),
`get_board_references` for the chat (MCP image content), and image input for the autopilot.

### Seen in full

References from the New video wizard (an upload of any size, or a link: an Instagram reel or a
YouTube video, downloaded at up to 1080p with yt-dlp, `src/lib/server/media/download.ts`) go into
the media library and are measured on this computer with ffmpeg before the board starts
(`src/lib/server/media/analysis.ts`, about half a minute for a 40-second reel, no Claude usage):

- **contact sheets** of the whole video: up to 8 frames a second, at most 12 sheets, tiles shaped
  like the video (6 × 3 for a vertical reel);
- **transition strips**: every frame from 0.25 s before to 0.35 s after up to 6 cuts spread over
  the video, so a flash, a glitch or a type-on reads frame by frame;
- **numbers**: every cut (scene score above 0.3), each shot's main colours and brightness, and the
  loudness (EBU R128 integrated, true peak).

The style step's brief lists the numbers and the images in the order Claude receives them (at most
20 images; the same rule in `referenceImageList` and in the tools' `boardReferenceFiles`), and asks
Claude to write a **style spec** with the style frames (`styleSpec`: formula, hex palette, type,
motion, transitions frame by frame, sound) and to make style frame A match it exactly. The board
keeps the spec; the storyboard view shows it under **Style spec read from the reference**, where
the designer can correct it (`PUT /api/bridge/boards/<id>/spec`), and the storyboard and build
briefs carry the corrected text.

## Files

| File | What |
|---|---|
| `src/lib/server/bridge/boards.ts` | board state machine, schemas, storage (`boards/<id>.json`) |
| `src/lib/server/bridge/boardBrief.ts` | the brief of each step, worded for the CLI, the chat or the autopilot |
| `src/lib/server/bridge/references.ts` | reference uploads and previews |
| `src/lib/ai/storyboard.ts` | contract section 9 (how to write style frames and storyboards) |
| `src/lib/ai/styleLibrary.ts` | the style library |
| `src/components/board/BoardView.tsx` | the storyboard view in the editor |
| `src/store/boardStore.ts` | the editor's board state |

Routes are listed in [CLAUDE-DESKTOP.md](CLAUDE-DESKTOP.md#routes).
