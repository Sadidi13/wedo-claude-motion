# Install WeDo Claude Motion

Pick one way. Each one ends with the editor open in your browser.

| Way | For | You do |
|---|---|---|
| [1. Ask Claude Code](#1-ask-claude-code-to-install-it) | anyone with Claude Code (the **Code** tab in the Claude app) | paste one message, approve |
| [2. One line in PowerShell](#2-windows-one-line-in-powershell) | Windows | paste one line |
| [3. By hand](#3-by-hand) | Mac, Linux, or when 1 and 2 do not work | five commands |

Nothing here needs a password, an API key or a new account.

## 1. Ask Claude Code to install it

1. Open the Claude app and click the **Code** tab (or run `claude` in a terminal). Any folder is fine.
2. Paste this message and send it:

   ```text
   Install WeDo Claude Motion on this computer and open it.
   Follow "Steps for Claude" in https://github.com/Sadidi13/wedo-claude-motion/blob/main/INSTALL.md
   ```

3. Claude asks before it runs each command: approve them. If Windows asks whether Node.js may be
   installed, click **Yes**.

At the end the editor opens in your browser, and Claude tells you how to start it next time.

## 2. Windows: one line in PowerShell

1. Open the Start menu, type **PowerShell** and press Enter.
2. Paste this line and press Enter:

   ```powershell
   irm https://raw.githubusercontent.com/Sadidi13/wedo-claude-motion/main/scripts/install-windows.ps1 | iex
   ```

3. Wait a few minutes. If Windows asks whether Node.js may be installed, click **Yes**.
4. When it asks **Connect it now?**, press Enter. It asks you to quit Claude (right-click the Claude
   icon next to the clock, then **Quit**) and opens it again by itself.

The editor opens in your browser, and two shortcuts appear on your desktop: **WeDo Claude Motion**
and **WeDo Claude Motion - Autopilot**.

Run the same line again later to update. Your projects and settings are kept.

What the installer changes: it installs Node.js LTS (with winget) and pnpm when they are missing,
puts the app in `C:\Users\<you>\wedo-claude-motion`, adds the two shortcuts and, only if you say
yes, adds the WeDo Claude Motion connector to the Claude app. You can read it first:
[`scripts/install-windows.ps1`](scripts/install-windows.ps1).

## 3. By hand

You need [Node.js](https://nodejs.org) 22 or newer, [Git](https://git-scm.com), and Chrome or Edge
(for exporting video).

```bash
npm install -g pnpm
git clone https://github.com/Sadidi13/wedo-claude-motion.git
cd wedo-claude-motion
pnpm install
pnpm bridge start
```

`pnpm bridge start` starts the app in the background and opens it in your browser. On Windows you can
double-click `scripts\start.cmd` instead.

## After installing

### Start it

- **Windows:** double-click **WeDo Claude Motion** on the desktop. The app runs in a small minimised
  window called "WeDo Claude Motion server"; close that window to stop it.
- **Mac and Linux:** run `pnpm bridge start` in the `wedo-claude-motion` folder. To keep it in a
  terminal instead, run `pnpm dev`, open http://localhost:3000, and press Ctrl+C to stop.

### Connect Claude

| Where you talk to Claude | Setup |
|---|---|
| Claude Code, opened in the `wedo-claude-motion` folder | none |
| The Claude chat, and Claude Code in any folder | connect the Claude app once (below) |
| Nobody: answer the editor's Ask Claude tab by itself | the autopilot (below) |

**Connect the Claude app** (the Windows installer offers this; skip it if you said yes there):

- Windows: double-click `scripts\connect-claude-chat.cmd` in the `wedo-claude-motion` folder. It asks
  you to quit Claude for a moment, then opens it again.
- Mac: quit Claude, run `pnpm bridge install-chat` in the folder, open Claude.

**Autopilot** (optional). It needs Claude Code installed on the computer: in PowerShell run
`irm https://claude.ai/install.ps1 | iex` (Mac and Linux: `curl -fsSL https://claude.ai/install.sh | bash`).
Then double-click **WeDo Claude Motion - Autopilot** on the desktop (Mac and Linux: `pnpm autopilot`).
The first time, it opens the browser so you can sign in with your Claude account.

## If something goes wrong

- **"node" or "pnpm" is not recognized** right after installing: close PowerShell, open a new one and
  run the line again.
- **The browser did not open:** go to http://localhost:3000. If port 3000 was busy, the app uses the
  next free one (3001, 3002, ...); the server window shows which.
- **Export fails:** install Google Chrome or Microsoft Edge.
- **Claude says WeDo Claude Motion is not running:** start it (see above), or ask Claude to start it.
- **Remove it:** delete the `wedo-claude-motion` folder and the two desktop shortcuts. If you connected
  the Claude app, open Claude, go to Settings, Developer, Edit Config, and remove the
  `motion-studio` entry.

---

## Steps for Claude

*This section is for Claude Code, which follows it when someone asks it to install WeDo Claude
Motion. People can skip it.*

Talk to the user in their language and keep it short. Nothing here needs a password, API key or
account: never ask for one. Ask the user before installing Node.js or pnpm.

### Windows

1. Run this. It takes a few minutes, so allow a 10-minute timeout. It works from PowerShell and from Bash:

   ```text
   powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Sadidi13/wedo-claude-motion/main/scripts/install-windows.ps1 | iex"
   ```

   You can read the script first at that URL. It does the following:
   - installs Node.js LTS with winget and pnpm with npm, when missing (tell the user that Windows may
     ask them to allow Node.js);
   - downloads the app to `%USERPROFILE%\wedo-claude-motion`, with git, or as a zip without git;
   - runs `pnpm install`;
   - adds two desktop shortcuts;
   - starts the app in a minimised window and opens the editor.

   It skips the "connect the Claude app" question when it runs without a keyboard, as it does here.
2. Check: in `%USERPROFILE%\wedo-claude-motion`, `node scripts/motion-bridge.mjs status` prints
   `server: http://localhost:<port> (up)`.
3. If step 1 failed, read the red message. Then do the macOS / Linux steps 2 to 4 with
   `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`
   for Node.js, and start with `cmd /c scripts\start.cmd` instead of step 5.

### macOS and Linux

1. `node -v` must be 22 or newer. If it is not, ask the user, then install Node.js 22+ (macOS:
   `brew install node`; Linux: the distribution's package or https://nodejs.org).
2. If `pnpm -v` fails, run `npm install -g pnpm`. If npm has no permission, run `corepack enable pnpm`.
3. `git clone --depth 1 https://github.com/Sadidi13/wedo-claude-motion.git ~/wedo-claude-motion`
   (if the folder already exists: `git -C ~/wedo-claude-motion pull --ff-only`).
4. `cd ~/wedo-claude-motion && pnpm install`
5. `node scripts/motion-bridge.mjs start`: it starts the server in the background, waits until it
   answers and opens the editor. The first start can take a minute.
6. Check with `node scripts/motion-bridge.mjs status`.

### Then tell the user

- Where it is installed, and the address that `status` printed.
- How to start it next time: the **WeDo Claude Motion** desktop shortcut on Windows, or
  `pnpm bridge start` in the folder on macOS and Linux.
- How to make videos with Claude:
  - Claude Code opened in that folder works now, with no setup.
  - For the Claude chat, and Claude Code in other folders, they connect the Claude app once. On
    Windows they double-click `scripts\connect-claude-chat.cmd` in that folder. On macOS they quit
    Claude, run `pnpm bridge install-chat` and open Claude again.
  - Do not run these yourself when you run inside the Claude app: they need the app closed, which
    ends this conversation.
- The optional autopilot, which answers the editor's Ask Claude tab by itself: see "Autopilot"
  above.
