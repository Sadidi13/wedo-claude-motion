# WeDo Claude Motion installer for Windows. Paste this one line into PowerShell:
#
#   irm https://raw.githubusercontent.com/Sadidi13/wedo-claude-motion/main/scripts/install-windows.ps1 | iex
#
# It installs Node.js (with winget) and pnpm when they are missing, downloads the app to
# %USERPROFILE%\wedo-claude-motion, installs its packages, adds desktop shortcuts and starts it.
# Run the same line again to update; your settings (.env.local) and projects are kept.
#
# Options (environment variables, mainly for testing): WEDO_INSTALL_DIR, WEDO_NO_SHORTCUTS=1, WEDO_NO_START=1.

$ErrorActionPreference = "Stop"
$Repo = "Sadidi13/wedo-claude-motion"
$Branch = "main"
$InstallDir = if ($env:WEDO_INSTALL_DIR) { $env:WEDO_INSTALL_DIR } else { Join-Path $HOME "wedo-claude-motion" }

function Step([string]$number, [string]$text) { Write-Host ""; Write-Host "[$number/5] $text" -ForegroundColor Cyan }
function Info([string]$text) { Write-Host "      $text" }
function Fail([string]$text) { Write-Host ""; Write-Host "  $text" -ForegroundColor Red; throw "WeDo Claude Motion was not installed." }
function Has([string]$command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if ($env:APPDATA -and ($env:Path -notlike "*$env:APPDATA\npm*")) { $env:Path += ";$env:APPDATA\npm" }
}
function Node-Major {
  if (-not (Has "node")) { return 0 }
  $version = (& node -v) -replace "^v", ""
  return [int]($version.Split(".")[0])
}

Write-Host ""
Write-Host "  WeDo Claude Motion - installer" -ForegroundColor White
Write-Host "  Installs into $InstallDir"

# 1. Node.js 22 or newer
Step 1 "Node.js"
if ((Node-Major) -ge 22) {
  Info "Node.js $(& node -v) is installed."
} else {
  if (-not (Has "winget")) { Fail "Install Node.js 22 or newer from https://nodejs.org, then run this installer again." }
  Info "Installing Node.js LTS with winget (Windows may ask for permission)..."
  & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements
  Refresh-Path
  if ((Node-Major) -lt 22) { Fail "Node.js was installed but is not available yet. Close this window, open a new PowerShell and run the installer again." }
  Info "Node.js $(& node -v) installed."
}

# 2. pnpm
Step 2 "pnpm"
if (Has "pnpm") {
  Info "pnpm is installed."
} else {
  Info "Installing pnpm..."
  & npm install -g pnpm
  if ($LASTEXITCODE -ne 0) { Fail "Could not install pnpm (npm install -g pnpm)." }
  Refresh-Path
  if (-not (Has "pnpm")) { Fail "pnpm was installed but is not available yet. Open a new PowerShell and run the installer again." }
}

# 3. The app
Step 3 "Downloading WeDo Claude Motion"
$isGitCheckout = Test-Path (Join-Path $InstallDir ".git")
if ((Has "git") -and $isGitCheckout) {
  & git -C $InstallDir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Fail "Could not update $InstallDir with git pull. Move your own changes away and try again." }
} elseif ((Has "git") -and -not (Test-Path $InstallDir)) {
  & git clone --depth 1 --branch $Branch "https://github.com/$Repo.git" $InstallDir
  if ($LASTEXITCODE -ne 0) { Fail "Could not download the app with git." }
} else {
  # No git (or an earlier zip install): download the zip and copy it over, keeping local files.
  $zip = Join-Path ([IO.Path]::GetTempPath()) "wedo-claude-motion.zip"
  $unpacked = Join-Path ([IO.Path]::GetTempPath()) "wedo-claude-motion-unpacked"
  Invoke-WebRequest -UseBasicParsing "https://github.com/$Repo/archive/refs/heads/$Branch.zip" -OutFile $zip
  if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
  Expand-Archive $zip -DestinationPath $unpacked -Force
  $source = Get-ChildItem $unpacked -Directory | Select-Object -First 1
  New-Item -ItemType Directory -Force $InstallDir | Out-Null
  Copy-Item (Join-Path $source.FullName "*") $InstallDir -Recurse -Force
  Remove-Item $zip, $unpacked -Recurse -Force
}
Info "Downloaded to $InstallDir"

# 4. Packages
Step 4 "Installing the app's packages (about a minute)"
Push-Location $InstallDir
try {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed; the messages above show why." }
} finally {
  Pop-Location
}

# 5. Shortcuts and start
Step 5 "Shortcuts"
if ($env:WEDO_NO_SHORTCUTS -ne "1") {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shell = New-Object -ComObject WScript.Shell
  $shortcuts = @(
    @{ Name = "WeDo Claude Motion"; Target = "scripts\start.cmd"; Description = "Start WeDo Claude Motion and open it in the browser" },
    @{ Name = "WeDo Claude Motion - Autopilot"; Target = "scripts\start-autopilot.cmd"; Description = "Answer the Ask Claude tab automatically with Claude Code" }
  )
  foreach ($item in $shortcuts) {
    $link = $shell.CreateShortcut((Join-Path $desktop ($item.Name + ".lnk")))
    $link.TargetPath = Join-Path $InstallDir $item.Target
    $link.WorkingDirectory = $InstallDir
    $link.IconLocation = Join-Path $InstallDir "src\app\favicon.ico"
    $link.Description = $item.Description
    $link.Save()
    Info "Desktop shortcut: $($item.Name)"
  }
} else {
  Info "Skipped (WEDO_NO_SHORTCUTS=1)."
}

Write-Host ""
Write-Host "  WeDo Claude Motion is installed." -ForegroundColor Green
Write-Host "  Start it any time with the 'WeDo Claude Motion' shortcut on your desktop."
Write-Host "  To work with Claude, see 'Use it with Claude' in https://github.com/$Repo"
if (-not (Has "claude")) {
  Write-Host "  The autopilot needs Claude Code:  npm install -g @anthropic-ai/claude-code"
}

if ($env:WEDO_NO_START -ne "1") {
  Write-Host ""
  Write-Host "  Starting it now..."
  & (Join-Path $InstallDir "scripts\start.cmd")
}
