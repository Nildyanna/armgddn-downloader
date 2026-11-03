'use strict';
// "Check my setup": the things that cause most install and launch support questions, looked at before a download.
// evaluateSetup() is pure (facts in, findings out) so it can be tested; collectFacts() gathers the facts from the
// machine and never throws (anything it cannot read becomes null and is reported as "could not check").

const fs = require('fs');
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

// "D:", "D:\\" or "D:/": the top of a drive, which Windows treats as protected
function isDriveRoot(p) {
  return /^[a-z]:[\\/]*$/i.test(String(p || '').trim());
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

// Mount table lines: Linux /proc/mounts ("dev /mnt/x ntfs3 rw,... 0 0") or macOS `mount` ("/dev/disk4s1 on /Volumes/X (exfat, local, ...)").
function parseMounts(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = line.match(/^\S+ (\S+) (\S+) (\S+)/);                         // linux
    if (m && !/ on /.test(line)) { out.push({ mount: m[1].replace(/\\040/g, ' '), fs: m[2].toLowerCase(), opts: m[3].split(',') }); continue; }
    m = line.match(/ on (.+?) \(([^)]*)\)/);                              // macOS
    if (m) { const parts = m[2].split(',').map(x => x.trim().toLowerCase()); out.push({ mount: m[1], fs: parts[0], opts: parts.slice(1) }); }
  }
  return out;
}

function mountFor(p, mounts) {
  const target = String(p || '');
  let best = null;
  for (const m of mounts || []) {
    const mp = m.mount.replace(/\/+$/, '') || '/';
    if (target === mp || target.startsWith(mp === '/' ? '/' : mp + '/')) {
      if (!best || mp.length >= best.mount.length) best = { ...m, mount: mp };
    }
  }
  return best;
}

// Where on Linux or macOS a download folder is a bad idea.
function posixProblem(p, facts) {
  const dl = String(p || '');
  const home = String(facts.homeDir || '').replace(/\/+$/, '');
  if (dl === '/' || dl === home) return 'the top of your home or system folder';
  if (/^\/(usr|etc|bin|sbin|lib|lib64|opt|boot|proc|sys|dev|var\/lib)(\/|$)/.test(dl) || /^\/(System|Library|private)(\/|$)/.test(dl)) return 'a system folder';
  if (/^\/(tmp|var\/tmp)(\/|$)/.test(dl)) return 'a temporary folder that is cleared on restart';
  if (facts.platform === 'darwin') {
    if (home && dl.startsWith(home + '/Library/Mobile Documents')) return 'iCloud Drive';
    if (home && /^\/(desktop|documents)(\/|$)/i.test(dl.slice(home.length))) return 'a folder macOS syncs to iCloud and protects (Desktop or Documents)';
    if (/^\/Applications(\/|$)/.test(dl)) return 'the Applications folder';
  }
  if (/\/(snap|\.var\/app)\//.test(dl)) return 'a sandboxed app folder';
  return '';
}

/** @returns {{id:string,status:'ok'|'warn'|'info',title:string,detail:string}[]} */
function evaluateSetup(facts) {
  const out = [];
  const add = (id, status, title, detail) => out.push({ id, status, title, detail });
  const win = facts.platform === 'win32';
  const posix = facts.platform === 'linux' || facts.platform === 'darwin';
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
  const place = posix ? posixProblem(dl, facts) : protectedPlace(dl, facts);
  const example = '~/Games';
  if (posix) {
    if (place) {
      add('download-path', 'warn', 'Download folder is in a poor place',
        `Your download folder is inside ${place}. Setup and installers often fail there. Use a plain folder such as ${example} and choose it in Settings.`);
    } else {
      add('download-path', 'ok', 'Download folder looks fine', dl ? `${dl} is not in a protected or temporary place.` : '');
    }
    const mnt = mountFor(dl, facts.mounts);
    if (!mnt) {
      add('download-fs', 'info', 'Download drive format', 'Could not read what format the download drive uses.');
    } else if (mnt.opts && mnt.opts.includes('ro')) {
      add('download-fs', 'warn', `Download drive is read-only (${mnt.fs})`, `${mnt.mount} is mounted read-only, so nothing can be saved there. Pick a drive you can write to.`);
    } else if (/^(vfat|msdos|fat|fat32)$/.test(mnt.fs)) {
      add('download-fs', 'warn', `Download drive is FAT (${mnt.fs})`, 'FAT cannot hold a file bigger than 4 GB, and most games have files larger than that. Use a drive formatted as ext4, btrfs, xfs, APFS or exFAT.');
    } else if (facts.platform === 'darwin' && /^(ntfs|ntfs-3g|fuseblk)$/.test(mnt.fs)) {
      add('download-fs', 'warn', `Download drive is NTFS (${mnt.fs})`, 'macOS can read NTFS but cannot write to it, so saves can fail partway. Use an APFS or exFAT drive.');
    } else if (facts.platform === 'linux' && /^(ntfs|ntfs3|ntfs-3g|fuseblk|exfat)$/.test(mnt.fs)) {
      add('download-fs', 'info', `Download drive is Windows-formatted (${mnt.fs})`, 'Downloads work, but there are no Linux file permissions, so Wine and Proton games often cannot run from it. Extract and install on an ext4 or btrfs drive.');
    } else {
      add('download-fs', 'ok', `Download drive format: ${mnt.fs}`, '');
    }
  } else if (isDriveRoot(dl)) {
    add('download-path', 'warn', 'Download folder is the root of a drive',
      `Your download folder is the root of ${dlDrive}\\. Windows protects the root of a drive, and setup and antivirus often fail there. ` +
      'Make a short plain folder such as D:\\Games and choose it in Settings.');
  } else if (place) {
    add('download-path', 'warn', 'Download folder is in a protected place',
      `Your download folder is inside ${place}. Setup and antivirus often fail there. Use a short plain folder such as D:\\Games.`);
  } else if (!posix && dl.length > LONG_PATH) {
    add('download-path', 'warn', 'Download folder path is long',
      `The path is ${dl.length} characters. Long paths break setup. Use a short one such as D:\\Games.`);
  } else if (!posix) {
    add('download-path', 'ok', 'Download folder looks fine', dl ? `${dl} is short and not in a protected place.` : '');
  }

  if (facts.platform === 'linux') {
    if (facts.maxMapCount != null && facts.maxMapCount < 1048576) {
      add('map-count', 'warn', `vm.max_map_count is ${facts.maxMapCount}`,
        'Many Windows games crash on launch under Wine or Proton when this is below 1048576. Run: sudo sysctl -w vm.max_map_count=1048576 (and put vm.max_map_count=1048576 in /etc/sysctl.d/ to keep it after a restart).');
    }
    if (facts.wine === false) {
      add('wine', 'info', 'Wine not found', 'The games are Windows programs, so you need Wine or Proton (through Steam, Lutris, Heroic or Bottles). Ignore this if you already use one of those.');
    } else if (facts.wine === true) {
      add('wine', 'ok', 'Wine found', '');
    }
  }
  if (facts.platform === 'darwin') {
    if (facts.appMisplaced) {
      add('app-location', 'warn', 'Companion is not in Applications',
        'It is running from a disk image or a temporary location, where macOS limits what it can do and updates fail. Drag it to the Applications folder, eject the disk image and open it from there.');
    }
    if (facts.arch === 'arm64' && facts.rosetta === false) {
      add('rosetta', 'warn', 'Rosetta is not installed', 'Most Windows-on-Mac tools still need it on Apple Silicon. Run in Terminal: softwareupdate --install-rosetta --agree-to-license');
    }
    if (facts.winLayer === false) {
      add('wine', 'info', 'No Windows layer found', 'The games are Windows programs. On a Mac you need CrossOver, Whisky, Sikarugir or Wine to run them. Ignore this if you already have one.');
    } else if (facts.winLayer === true) {
      add('wine', 'ok', 'Windows layer found', '');
    }
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
  facts.arch = process.arch;
  if (process.platform === 'linux') {
    try { facts.mounts = parseMounts(fs.readFileSync('/proc/mounts', 'utf8')); } catch (e) { facts.mounts = null; }
    try { facts.maxMapCount = parseInt(fs.readFileSync('/proc/sys/vm/max_map_count', 'utf8'), 10) || null; } catch (e) { facts.maxMapCount = null; }
    const dirs = (process.env.PATH || '').split(':').concat(['/usr/bin', '/usr/local/bin', '/opt/wine-staging/bin']);
    facts.wine = dirs.some(d => { try { return fs.existsSync(path.join(d, 'wine')) || fs.existsSync(path.join(d, 'wine64')); } catch (e) { return false; } });
    return facts;
  }
  if (process.platform === 'darwin') {
    const out = await run('/sbin/mount', []);
    facts.mounts = out == null ? null : parseMounts(out);
    const exe = String(process.execPath || '');
    facts.appMisplaced = /^\/Volumes\//.test(exe) || /AppTranslocation/.test(exe) || /^\/private\/var\/folders\//.test(exe);
    if (process.arch === 'arm64') facts.rosetta = fs.existsSync('/Library/Apple/usr/libexec/oah/libRosettaRuntime');
    const apps = ['CrossOver', 'Whisky', 'Sikarugir', 'Sikarugir Creator', 'PlayOnMac', 'Heroic', 'Bottles'].map(a => `/Applications/${a}.app`)
      .concat(['/opt/homebrew/bin/wine', '/usr/local/bin/wine', '/opt/homebrew/bin/wine64']);
    facts.winLayer = apps.some(a => { try { return fs.existsSync(a); } catch (e) { return false; } });
    return facts;
  }
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

module.exports = { evaluateSetup, collectFacts, parseMounts, mountFor };
