# WeDo Claude Motion

**Make animations with Claude, then edit them layer by layer.**

Ask Claude for a video. Claude first shows you a few styles and a storyboard; once you approve them, the
video opens in your browser as a project where every element is its own layer. Change it by hand, or
tell Claude what to change. Then export it, with sound, as MP4, WebM, MOV, GIF or PNG frames.

- Free and open source (MIT).
- Runs on your computer. Nothing is uploaded.
- Works with your Claude subscription. You do not need an API key.

[راهنمای فارسی](README.fa.md)

> Independent project, not affiliated with or endorsed by Anthropic. Claude is a trademark of
> Anthropic, PBC.

## Install

You need Windows, macOS or Linux, the [Claude app](https://claude.ai/download), and Chrome or Edge
for exporting video.

### Easiest: let Claude Code install it

Open the Claude app, click the **Code** tab (any folder), and send:

```text
Install WeDo Claude Motion on this computer and open it.
Follow "Steps for Claude" in https://github.com/Sadidi13/wedo-claude-motion/blob/main/INSTALL.md
```

Approve the commands Claude asks to run. When it is done, the editor opens in your browser.

### Windows: one line

Open **PowerShell** from the Start menu, then paste this and press Enter:

```powershell
irm https://raw.githubusercontent.com/Sadidi13/wedo-claude-motion/main/scripts/install-windows.ps1 | iex
```

It installs what is missing, adds a **WeDo Claude Motion** shortcut to your desktop and offers to
connect the Claude app. Run it again to update.

### Claude Code in a terminal: the plugin

```bash
claude plugin marketplace add Sadidi13/wedo-claude-motion
claude plugin install wedo-claude-motion@wedo-claude-motion
```

Then ask Claude Code for a video in any folder. If the app is not installed yet, Claude offers to
install it first. (Other coding agents: `npx skills add Sadidi13/wedo-claude-motion --skill wedo-claude-motion`.)

### By hand, or on Mac and Linux

See [INSTALL.md](INSTALL.md#3-by-hand). It is five commands.

## Start it

- **Windows:** double-click **WeDo Claude Motion** on the desktop.
- **Mac and Linux:** run `pnpm bridge start` in the `wedo-claude-motion` folder.

The editor opens at http://localhost:3000 with a sample project.

## Use it with Claude

**Make a video.** Ask Claude, for example *"make a 6-second teaser for my café"*. It works in:

- the **Code** tab, opened in the `wedo-claude-motion` folder (no setup), and
- the regular **Claude chat** and the Code tab in any folder, once the Claude app is connected. The
  Windows installer offers this. Later you can double-click `scripts\connect-claude-chat.cmd` instead.

Every new video is made in three steps, in the editor's **Storyboard** window:

1. **Style:** Claude shows 3 style frames (the same moment of your video in different looks). Pick one,
   or ask for others. You can add a note, and attach a reference image or video whose look Claude
   should match.
2. **Storyboard:** Claude lays out the shots in that style (timing, what moves, on-screen text,
   sound). Approve it or ask for changes.
3. **Video:** Claude builds it, checks it, and it opens as layers. To skip the storyboard, say so.

You can also start a new video from the editor: **Ask Claude → New scene**.

**Change it.** Do one of these:

- **Tell Claude** in the same conversation, for example *"make the title bigger"*.
- **Use the editor.** Select a layer, open the **Ask Claude** tab and write the change. Then either
  - write **"check Claude Motion"** to Claude (in Persian: «کلاد موشن رو چک کن»), or
  - leave the **autopilot** running. It answers every request by itself. Start it with the
    **WeDo Claude Motion - Autopilot** shortcut. It needs
    [Claude Code](INSTALL.md#connect-claude) on the computer.

- **Comment on the frame.** Click **Comment** (or press C), click the spot that should change, and write
  what you want. Claude gets the time, the spot and the layer.

Every change is one step in the editor, and Undo takes it back.

## In the editor

- **Layers and timeline:** every element is a layer; drag clips to retime them.
- **Move, scale, rotate:** drag the selected layer on the canvas; corners scale, the top knob rotates.
- **Keyframes:** in Properties → Transform, ◇ animates X, Y, scale, rotation or opacity from the playhead.
- **Sound:** **Sound** adds an audio file or one of 21 built-in effects and music beds (whoosh, pop,
  impact, riser, ding, beat…) as layers you can move and trim. Exports include the mix.
- **Check:** renders the video on your computer and lists cut-off, overlapping or hard-to-read text,
  text that is on screen too briefly, and empty or frozen stretches. **Ask Claude to fix** sends the list.
- **History:** every change Claude makes is saved as a version you can restore.

## Does it cost anything?

- **The app is free.**
- **Claude's work uses your Claude plan,** like any message you send Claude. There is no extra
  charge and no API key.
- **Waiting is free.** An open editor, a Claude conversation waiting for requests, or the autopilot
  use nothing until you send a request.
- **Each request uses some of your plan's usage,** whether it is a new video or a change.
  - A new video takes three short steps (styles, storyboard, video) instead of one, so it uses a bit
    more, and you get what you approved.
  - Rendering, previews, the quality check and exports run on your computer and use no Claude usage.
  - The autopilot uses Claude's default model. `pnpm autopilot --model sonnet` uses less.
  - A long conversation uses more for each request than the autopilot, which starts fresh every time.

## Export and save

- **Export:** render a video (MP4, WebM with transparency, MOV ProRes 4444, GIF or PNG frames).
- **Save:** download the project as a `.zip`.
- **Import:** open a saved project, or code from Claude Design or Claude Motion (MP4 files cannot be
  turned back into layers).

Keyboard shortcuts:

| Key | Action |
|---|---|
| Space | play or pause |
| ← / → | step one frame |
| Shift+← / → | step 1 s |
| Delete | remove the layer |
| Ctrl+Z / Ctrl+Shift+Z | undo / redo |
| Ctrl+D | duplicate |
| H | hide or show |
| C | comment on the frame |

## Safety

- The app only answers on your own computer (127.0.0.1). Other devices and websites cannot reach it.
- Claude's answers are checked before the editor applies them.
- **Only import projects from people you trust.** A project is code that runs in the editor, like
  opening an HTML file.

See [SECURITY.md](SECURITY.md) for details and how to report a problem.

## More

- [INSTALL.md](INSTALL.md): every install option, troubleshooting, uninstalling.
- [docs/USER-GUIDE.fa.md](docs/USER-GUIDE.fa.md): full Persian user guide.
- [docs/DEVELOPERS.md](docs/DEVELOPERS.md): how it works, settings, scripts, roadmap.
- [docs/CLAUDE-DESKTOP.md](docs/CLAUDE-DESKTOP.md): how Claude and the editor talk.
- [docs/STORYBOARD.md](docs/STORYBOARD.md), [docs/AUDIO.md](docs/AUDIO.md), [docs/TRANSFORM.md](docs/TRANSFORM.md),
  [docs/QUALITY.md](docs/QUALITY.md), [docs/VERSIONS.md](docs/VERSIONS.md): how each feature works.
- [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE). Export uses the ffmpeg build that `ffmpeg-static` downloads at install
time (GPL). It is not part of this repository. Scenes can use [GSAP](https://gsap.com), installed as
a dependency under GreenSock / Webflow's own "Standard No Charge" license
(gsap.com/community/standard-license), not MIT; three.js is MIT.
