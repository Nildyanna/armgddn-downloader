'use strict';
// Pieces of the in-app updater that can be tested without Electron: the PowerShell runner that installs the update after the
// app exits, the marker that says "an install is running", and the progress numbers for the download window.

const INSTALL_MARKER_MAX_AGE_MS = 5 * 60 * 1000;

function escapePsPath(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

// The runner shows a small always-on-top "Updating..." window while the silent installer works (it takes 20-80 seconds and the
// app itself is closed by then, so without it the member sees nothing and starts the app again, which starts a second installer).
// A colour from the page ('#abc', '#aabbcc', 'rgb(1, 2, 3)', 'rgba(...)') as '#rrggbb', or the fallback. Only this form reaches PowerShell.
function hexColor(v, fallback) {
  const s = String(v || '').trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return '#' + m[1].toLowerCase();
  m = s.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
  m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  return fallback;
}

// The install screen for the ARMGDDN App (Nov 24 2026, George: "make it all inside the app instead of separate popups"). Windows can't replace the
// app's files while it runs, so the app closes for the install; this screen takes its place: same spot and size as the app window, the app's colours,
// logo, version and a moving bar, until the new version opens. screen = {x, y, w, h (physical pixels), bg, fg, dim, accent, track, logo, version}.
function screenSpec(screen) {
  if (!screen || typeof screen !== 'object') return null;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const w = int(screen.w, 480, 20000, 1100), h = int(screen.h, 320, 20000, 700);
  return {
    x: int(screen.x, -40000, 40000, 100), y: int(screen.y, -40000, 40000, 100), w, h,
    scale: Math.max(1, Math.min(4, Number(screen.scale) || 1)),
    bg: hexColor(screen.bg, '#0d0a12'), fg: hexColor(screen.fg, '#f3eff8'), dim: hexColor(screen.dim, '#9d93ab'),
    accent: hexColor(screen.accent, '#b6ff3b'), track: hexColor(screen.track, '#2b2236'),
    logo: typeof screen.logo === 'string' && /^[A-Za-z]:\\[^\r\n]*\.png$/.test(screen.logo) ? screen.logo : '',
    version: /^\d+\.\d+\.\d+$/.test(String(screen.version || '')) ? String(screen.version) : '',
  };
}

function appStyledWindow(name, sp) {
  const px = (n) => Math.round(n * sp.scale);
  const color = (hex) => `[System.Drawing.ColorTranslator]::FromHtml('${hex}')`;
  const title = sp.version ? `Updating ${name} to v${sp.version}` : `Updating ${name}`;
  return [
    '  # Crisp text on scaled screens: this process draws at real pixels, like the app window it replaces',
    "  try { Add-Type -Namespace ArmgddnUpd -Name Dpi -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();'; [void][ArmgddnUpd.Dpi]::SetProcessDPIAware() } catch { }",
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  Add-Type -AssemblyName System.Drawing',
    '  $form = New-Object System.Windows.Forms.Form',
    `  $form.Text = '${name}'`,
    "  $form.FormBorderStyle = 'None'",
    "  $form.StartPosition = 'Manual'",
    `  $form.Bounds = New-Object System.Drawing.Rectangle(${sp.x}, ${sp.y}, ${sp.w}, ${sp.h})`,
    `  $form.BackColor = ${color(sp.bg)}`,
    '  $form.TopMost = $true',
    '  $form.ShowInTaskbar = $true',
    `  $cx = [int](${sp.w} / 2); $cy = [int](${sp.h} / 2)`,
    `  $logoPath = '${sp.logo.replace(/'/g, "''")}'`,
    '  if ($logoPath -and (Test-Path $logoPath)) {',
    '    $pic = New-Object System.Windows.Forms.PictureBox',
    "    $pic.SizeMode = 'Zoom'",
    '    $pic.Image = [System.Drawing.Image]::FromFile($logoPath)',
    `    $pic.SetBounds($cx - ${px(48)}, $cy - ${px(150)}, ${px(96)}, ${px(96)})`,
    '    $form.Controls.Add($pic)',
    '  }',
    '  $title = New-Object System.Windows.Forms.Label',
    `  $title.Text = '${title.replace(/'/g, "''")}'`,
    "  $title.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)",
    `  $title.ForeColor = ${color(sp.fg)}`,
    "  $title.TextAlign = 'MiddleCenter'",
    `  $title.SetBounds(0, $cy - ${px(40)}, ${sp.w}, ${px(46)})`,
    '  $form.Controls.Add($title)',
    '  $sub = New-Object System.Windows.Forms.Label',
    `  $sub.Text = 'Installing. ${name} opens again by itself in about a minute, right here.'`,
    "  $sub.Font = New-Object System.Drawing.Font('Segoe UI', 11)",
    `  $sub.ForeColor = ${color(sp.dim)}`,
    "  $sub.TextAlign = 'MiddleCenter'",
    `  $sub.SetBounds(0, $cy + ${px(12)}, ${sp.w}, ${px(28)})`,
    '  $form.Controls.Add($sub)',
    '  $track = New-Object System.Windows.Forms.Panel',
    `  $track.BackColor = ${color(sp.track)}`,
    `  $trackW = ${px(360)}`,
    `  $track.SetBounds($cx - [int]($trackW / 2), $cy + ${px(64)}, $trackW, ${px(6)})`,
    '  $fill = New-Object System.Windows.Forms.Panel',
    `  $fill.BackColor = ${color(sp.accent)}`,
    `  $fill.SetBounds(0, 0, ${px(110)}, ${px(6)})`,
    '  $track.Controls.Add($fill)',
    '  $form.Controls.Add($track)',
    '  $started = Get-Date',
    '  $timer = New-Object System.Windows.Forms.Timer',
    '  $timer.Interval = 30',
    `  $timer.Add_Tick({ $fill.Left = $fill.Left + ${px(5)}; if ($fill.Left -gt $trackW) { $fill.Left = -$fill.Width }`,
    '    if (-not $script:proc) { if (-not (Get-Process -Id $pid_to_wait -ErrorAction SilentlyContinue)) { Start-InstallerOnce } }',
    '    elseif ($script:proc.HasExited) { $timer.Stop(); $form.Close() }',
    '    if (((Get-Date) - $started).TotalMinutes -gt 10) { $timer.Stop(); $form.Close() } })',
    '  $form.Add_Shown({ $timer.Start(); $form.Activate() })',
    '  [void]$form.ShowDialog()',
  ];
}

function classicWindow(name) {
  return [
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  [System.Windows.Forms.Application]::EnableVisualStyles()',
    '  $form = New-Object System.Windows.Forms.Form',
    `  $form.Text = '${name}'`,
    '  $form.TopMost = $true',
    '  $form.StartPosition = \'CenterScreen\'',
    '  $form.FormBorderStyle = \'FixedDialog\'',
    '  $form.ControlBox = $false',
    '  $form.ClientSize = New-Object System.Drawing.Size(380, 84)',
    '  $label = New-Object System.Windows.Forms.Label',
    `  $label.Text = 'Installing the update. ${name} reopens by itself in about a minute.'`,
    '  $label.SetBounds(14, 12, 352, 32)',
    '  $bar = New-Object System.Windows.Forms.ProgressBar',
    '  $bar.Style = \'Marquee\'',
    '  $bar.MarqueeAnimationSpeed = 30',
    '  $bar.SetBounds(14, 52, 352, 18)',
    '  $form.Controls.Add($label)',
    '  $form.Controls.Add($bar)',
    '  $started = Get-Date',
    '  $timer = New-Object System.Windows.Forms.Timer',
    '  $timer.Interval = 500',
    '  $timer.Add_Tick({ if ($script:proc.HasExited -or ((Get-Date) - $started).TotalMinutes -gt 10) { $timer.Stop(); $form.Close() } })',
    '  $form.Add_Shown({ $timer.Start() })',
    '  [void]$form.ShowDialog()',
  ];
}

function buildRunner({ pid, filePath, appExe, wrapperLogPath, resultPath, silentArg, shouldRelaunch, shortcut, appName, screen }) {
  // Members on the new built-in window know the app as "ARMGDDN App"; everyone else sees "ARMGDDN Companion".
  const name = String(appName || 'ARMGDDN Companion').replace(/[^A-Za-z0-9 ]/g, '');
  const sp = screenSpec(screen);
  return [
    '# ARMGDDN Companion update runner — auto-generated, do not edit',
    `$pid_to_wait = ${pid}`,
    `$installer = ${escapePsPath(filePath)}`,
    `$appExe = ${escapePsPath(appExe)}`,
    `$logPath = ${escapePsPath(wrapperLogPath)}`,
    `$resultPath = ${escapePsPath(resultPath)}`,
    `$silentArg = '${silentArg}'`,
    `$shouldRelaunch = $${shouldRelaunch ? 'true' : 'false'}`,
    `$shortcut = ${escapePsPath(shortcut || '')}`,
    '',
    'Add-Content -Path $logPath -Value ("[{0}] runner start pid=$pid_to_wait" -f (Get-Date -Format o))',
    '',
    '# Wait for the app to exit, then run the installer (once). The app-styled screen opens first and calls this from its timer, so it is up',
    '# before the app window goes away; the small box and the no-window fallback call it right here.',
    '$script:proc = $null',
    'function Start-InstallerOnce {',
    '  if ($script:proc) { return }',
    '  while (Get-Process -Id $pid_to_wait -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }',
    '  Add-Content -Path $logPath -Value ("[{0}] parent exited" -f (Get-Date -Format o))',
    '  Set-Content -Path $resultPath -Value (\'{"state":"installing"}\')',
    '  $script:proc = Start-Process -FilePath $installer -ArgumentList $silentArg -PassThru',
    '}',
    ...(sp ? [] : ['Start-InstallerOnce']),
    '',
    '# Show a window until the installer is done (the app-styled screen for the ARMGDDN App, the small box otherwise); fall back to plain waiting.',
    'try {',
    ...(sp ? appStyledWindow(name, sp) : classicWindow(name)),
    '} catch {',
    '  Add-Content -Path $logPath -Value ("[{0}] progress window not shown: $($_.Exception.Message)" -f (Get-Date -Format o))',
    '}',
    'Start-InstallerOnce',
    '$proc = $script:proc',
    'if (-not $proc.HasExited) { [void]$proc.WaitForExit() }',
    '$rc = $proc.ExitCode',
    'Add-Content -Path $logPath -Value ("[{0}] installer finished rc=$rc" -f (Get-Date -Format o))',
    '',
    '# RC=0: success. RC=2: NSIS UAC elevation — treat as success.',
    'if ($rc -eq 0 -or $rc -eq 2) {',
    '  Set-Content -Path $resultPath -Value (\'{"state":"success","exitCode":0}\')',
    '  if ($shouldRelaunch) {',
    '    if ($shortcut -and (Test-Path $shortcut)) { Start-Process -FilePath $shortcut }',
    '    else { Start-Process -FilePath $appExe -ArgumentList \'--updated\' }',
    '  }',
    '} else {',
    '  Set-Content -Path $resultPath -Value (\'{"state":"failed","exitCode":\' + $rc + \'}\')',
    '  Add-Content -Path $logPath -Value ("[{0}] installer failed rc=$rc, skipping relaunch" -f (Get-Date -Format o))',
    '}',
    'Add-Content -Path $logPath -Value ("[{0}] runner done" -f (Get-Date -Format o))',
    'Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue',
  ].join('\r\n');
}

// True while an installer started by an earlier run of the app is still working (marker written within the last few minutes).
function installIsRunning(resultText, markerMtimeMs, now = Date.now()) {
  let state = '';
  try { state = String(JSON.parse(resultText).state || '').toLowerCase(); } catch (e) { return false; }
  if (state !== 'installing') return false;
  return Number.isFinite(markerMtimeMs) && now - markerMtimeMs >= 0 && now - markerMtimeMs < INSTALL_MARKER_MAX_AGE_MS;
}

// What the download window gets for each chunk. GitHub's download servers sometimes send no Content-Length; then the
// size from the release listing is used, and with neither the window shows megabytes instead of a bar stuck at 0%.
function progressPayload(received, headerTotal, listedTotal, elapsedSec) {
  const total = Number.isFinite(headerTotal) && headerTotal > 0 ? headerTotal : (Number.isFinite(listedTotal) && listedTotal > 0 ? listedTotal : 0);
  const speed = elapsedSec > 0 ? received / elapsedSec : 0;
  const speedStr = speed > 1024 * 1024 ? (speed / (1024 * 1024)).toFixed(1) + ' MB/s' : (speed / 1024).toFixed(1) + ' KB/s';
  const out = { transferred: received, total, speed: speedStr, status: 'Downloading update...' };
  if (total > 0) out.percent = Math.min(100, (received / total) * 100);
  else out.status = `Downloading update... ${(received / (1024 * 1024)).toFixed(1)} MB`;
  return out;
}

module.exports = { buildRunner, installIsRunning, progressPayload, hexColor, screenSpec, INSTALL_MARKER_MAX_AGE_MS };
