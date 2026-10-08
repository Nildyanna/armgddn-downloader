'use strict';
// "Check my setup": the things that cause most install and launch support questions, looked at before a download.
// evaluateSetup() is pure (facts in, findings out) so it can be tested; collectFacts() gathers the facts from the
// machine and never throws (anything it cannot read becomes null and is reported as "could not check").

const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const GB = 1024 ** 3;
const TEMP_WARN_BYTES = 30 * GB;       // setup's temp files are as big as the game, so this is a floor, not a promise
const DOWNLOAD_WARN_BYTES = 50 * GB;
const LONG_PATH = 60;

function fmt(bytes) {
  if (bytes == null || bytes < 0) return 'unknown';
  return bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`;
}

function driveOf(p) {
  const text = String(p || '');
  const m = text.match(/^([A-Za-z]:)(?:[\\/]|$)/);
  if (m) return m[1].toUpperCase();                                   // C:\... (also when tested on another OS)
  const root = path.parse(path.resolve(text)).root || '';
  return root.replace(/[\\/]+$/, '');
}

function protectedPlace(p, facts) {
  const low = String(p || '').toLowerCase().replace(/\//g, '\\');
  const home = String(facts.homeDir || '').toLowerCase().replace(/\//g, '\\');
  if (/\\program files( \(x86\))?(\\|$)/.test(low) || /\\windows(\\|$)/.test(low)) return 'a protected Windows folder';
  if (/\\onedrive/.test(low)) return 'OneDrive';
  if (home && low.startsWith(home + '\\')) {
    const rest = low.slice(home.length + 1).split('\\')[0];
    if (['desktop', 'documents', 'downloads'].includes(rest) || rest === '') return 'your user profile folder';
  }
  return '';
}

/** @returns {{id:string,status:'ok'|'warn'|'info',title:string,detail:string}[]} */
function evaluateSetup(facts) {
  const out = [];
  const add = (id, status, title, detail) => out.push({ id, status, title, detail });
  const win = facts.platform === 'win32';
  const dl = facts.downloadPath || '';
  const dlDrive = driveOf(dl) || 'the download drive';

  // Download folder: free space
  if (facts.freeDownload == null || facts.freeDownload < 0) {
    add('download-space', 'info', 'Download drive space', `Could not read the free space on ${dlDrive}.`);
  } else if (facts.freeDownload < DOWNLOAD_WARN_BYTES) {
    add('download-space', 'warn', `Only ${fmt(facts.freeDownload)} free on ${dlDrive}`,
      'Many games are bigger than that. Free up space or choose a roomier download folder in Settings.');
  } else {
    add('download-space', 'ok', `${fmt(facts.freeDownload)} free on ${dlDrive}`, 'Plenty of room for the download.');
  }

  // Download folder: where it lives
  const place = protectedPlace(dl, facts);
  if (place) {
    add('download-path', 'warn', 'Download folder is in a protected place',
      `Your download folder is inside ${place}. Setup and antivirus often fail there. Use a short plain folder such as D:\\Games.`);
  } else if (dl.length > LONG_PATH) {
    add('download-path', 'warn', 'Download folder path is long',
      `The path is ${dl.length} characters. Long paths break setup. Use a short one such as D:\\Games.`);
  } else {
    add('download-path', 'ok', 'Download folder looks fine', dl ? `${dl} is short and not in a protected place.` : '');
  }

  if (win) {
    // Windows temp drive
    const tempDrive = driveOf(facts.tempDir);
    if (facts.freeTemp == null || facts.freeTemp < 0) {
      add('temp-space', 'info', 'Temp drive space', 'Could not read the free space on your Windows temp drive.');
    } else if (facts.freeTemp < TEMP_WARN_BYTES) {
      add('temp-space', 'warn', `Only ${fmt(facts.freeTemp)} free on ${tempDrive} (your temp drive)`,
        `Setup unpacks temporary files into your Windows temp folder on ${tempDrive}, wherever you save or install the game, ` +
        'and they are about as big as the game. Free up space there or move your temp folder to another drive (see the Wiki).');
    } else {
      add('temp-space', 'ok', `${fmt(facts.freeTemp)} free on ${tempDrive} (your temp drive)`, 'Room for setup\'s temporary files.');
    }

    // Antivirus
    const others = (facts.avProducts || []).filter(n => !/defender/i.test(n));
    if (facts.avProducts == null) {
      add('antivirus', 'info', 'Antivirus', 'Could not check which antivirus is installed. Add your download and install folders to its exclusions.');
    } else if (others.length) {
      add('antivirus', 'warn', `Other antivirus found: ${others.join(', ')}`,
        'Add your download and install folders to its exclusions (exclude them, do not turn it off). If games still vanish, ' +
        'ask in the chat which antivirus works best.');
    } else if (facts.defenderExclusions == null) {
      add('antivirus', 'info', 'Windows Defender exclusions',
        `Could not read Defender's exclusions. Make sure ${dl || 'your download folder'} is excluded.`);
    } else {
      const covered = facts.defenderExclusions.some(e => {
        const x = String(e).toLowerCase().replace(/[\\/]+$/, '');
        return x && String(dl).toLowerCase().startsWith(x);
      });
      add('antivirus', covered ? 'ok' : 'warn',
        covered ? 'Download folder is excluded from Defender' : 'Download folder is not excluded from Defender',
        covered ? '' : `Add ${dl || 'your download folder'} to Windows Security > Virus & threat protection > Exclusions so it does not delete game files.`);
    }

    // Redistributables
    const missing = [];
    if (facts.vcRuntime === false) missing.push('Visual C++ runtime');
    if (facts.d3dx === false) missing.push('DirectX 9 files');
    if (facts.vcRuntime == null && facts.d3dx == null) {
      add('redists', 'info', 'Redistributables', 'Could not check. If a game crashes on launch or shows a missing DLL, type /redists in the ARMGDDN chat.');
    } else if (missing.length) {
      add('redists', 'warn', `Missing: ${missing.join(' and ')}`,
        'Games need these to launch. Type /redists (exactly that) in the ARMGDDN Telegram chat to use our all-in-one redist installer.');
    } else {
      add('redists', 'ok', 'Redistributables look installed', 'If a game still crashes on launch, type /redists in the ARMGDDN chat.');
    }
  }
  return out;
}

function run(cmd, args, timeout = 8000) {
  return new Promise(resolve => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout || '')));
    } catch (e) { resolve(null); }
  });
}

async function collectFacts({ downloadPath, getFreeDiskSpace }) {
  const facts = { platform: process.platform, downloadPath, homeDir: os.homedir(), tempDir: os.tmpdir() };
  try { facts.freeDownload = getFreeDiskSpace(downloadPath); } catch (e) { facts.freeDownload = null; }
  try { facts.freeTemp = getFreeDiskSpace(facts.tempDir); } catch (e) { facts.freeTemp = null; }
  if (process.platform !== 'win32') return facts;

  const ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const [av, excl, vc, d3d] = await Promise.all([
    ps("Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { $_.displayName }"),
    ps("(Get-MpPreference).ExclusionPath | ForEach-Object { $_ }"),
    run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64', '/v', 'Installed']),
    ps("Test-Path (Join-Path $env:WINDIR 'System32\\d3dx9_43.dll')"),
  ]);
  facts.avProducts = av == null ? null : av.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (excl == null || /must be an administrator|N\/A/i.test(excl)) facts.defenderExclusions = null;
  else facts.defenderExclusions = excl.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  facts.vcRuntime = vc == null ? null : /0x1\b/.test(vc);
  facts.d3dx = d3d == null ? null : /true/i.test(d3d);
  return facts;
}

module.exports = { evaluateSetup, collectFacts };
