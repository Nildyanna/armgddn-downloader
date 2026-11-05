'use strict';
// Pieces of the in-app updater that can be tested without Electron: the PowerShell runner that installs the update after the
// app exits, the marker that says "an install is running", and the progress numbers for the download window.

const INSTALL_MARKER_MAX_AGE_MS = 5 * 60 * 1000;

function escapePsPath(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

// The runner shows a small always-on-top "Updating..." window while the silent installer works (it takes 20-80 seconds and the
// app itself is closed by then, so without it the member sees nothing and starts the app again, which starts a second installer).
function buildRunner({ pid, filePath, appExe, wrapperLogPath, resultPath, silentArg, shouldRelaunch, shortcut }) {
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
    '# Wait for parent process to exit',
    'while (Get-Process -Id $pid_to_wait -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }',
    'Add-Content -Path $logPath -Value ("[{0}] parent exited" -f (Get-Date -Format o))',
    '',
    '# Run installer',
    'Set-Content -Path $resultPath -Value (\'{"state":"installing"}\')',
    '$proc = Start-Process -FilePath $installer -ArgumentList $silentArg -PassThru',
    '',
    '# Show a small window until the installer is done; fall back to plain waiting if it cannot be shown.',
    'try {',
    '  Add-Type -AssemblyName System.Windows.Forms',
    '  $form = New-Object System.Windows.Forms.Form',
    '  $form.Text = \'ARMGDDN Companion\'',
    '  $form.TopMost = $true',
    '  $form.StartPosition = \'CenterScreen\'',
    '  $form.FormBorderStyle = \'FixedDialog\'',
    '  $form.ControlBox = $false',
    '  $form.ClientSize = New-Object System.Drawing.Size(380, 84)',
    '  $label = New-Object System.Windows.Forms.Label',
    '  $label.Text = \'Installing the update. ARMGDDN Companion reopens by itself in about a minute.\'',
    '  $label.SetBounds(14, 12, 352, 32)',
    '  $bar = New-Object System.Windows.Forms.ProgressBar',
    '  $bar.Style = \'Marquee\'',
    '  $bar.SetBounds(14, 52, 352, 18)',
    '  $form.Controls.Add($label)',
    '  $form.Controls.Add($bar)',
    '  $started = Get-Date',
    '  $timer = New-Object System.Windows.Forms.Timer',
    '  $timer.Interval = 500',
    '  $timer.Add_Tick({ if ($proc.HasExited -or ((Get-Date) - $started).TotalMinutes -gt 10) { $timer.Stop(); $form.Close() } })',
    '  $form.Add_Shown({ $timer.Start() })',
    '  [void]$form.ShowDialog()',
    '} catch {',
    '  Add-Content -Path $logPath -Value ("[{0}] progress window not shown: $($_.Exception.Message)" -f (Get-Date -Format o))',
    '}',
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

module.exports = { buildRunner, installIsRunning, progressPayload, INSTALL_MARKER_MAX_AGE_MS };
