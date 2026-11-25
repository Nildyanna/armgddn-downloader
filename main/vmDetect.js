'use strict';
// Is this PC a virtual machine? Used by the GPU fallback (Sentry ARMGDDN-COMPANION-2Q, Nov 25 2026): a virtual machine whose GPU process
// failed even with software drawing keeps the no-GPU mode for good, instead of retrying the graphics every month and crashing each time.
// A VM with a real graphics card passed through never reaches that step, because its GPU process does not fail.
// Read from the firmware's maker and model: Windows registry (BIOS key), Linux /sys/class/dmi/id. Never throws; unknown means "not a VM".
const fs = require('fs');
const { execFile } = require('child_process');

const VM_MAKERS = /parallels|vmware|innotek|virtualbox|qemu|xen|bochs|\bkvm\b|red hat|proxmox|bhyve|amazon ec2|google compute/i;

function isVirtualMachine(manufacturer, product) {
  const m = String(manufacturer || ''), p = String(product || '');
  if (VM_MAKERS.test(m) || VM_MAKERS.test(p)) return true;
  if (/microsoft corporation/i.test(m) && /virtual machine/i.test(p)) return true;   // Hyper-V
  return false;
}

function regValue(out, name) {
  const line = String(out || '').split(/\r?\n/).find((l) => l.trim().startsWith(name));
  return line ? line.replace(new RegExp('^\\s*' + name + '\\s+REG_\\w+\\s+'), '').trim() : '';
}

function detect(platform = process.platform, deps = {}) {
  const run = deps.execFile || execFile, read = deps.readFile || ((f) => fs.readFileSync(f, 'utf8'));
  return new Promise((resolve) => {
    try {
      if (platform === 'win32') {
        run('reg', ['query', 'HKLM\\HARDWARE\\DESCRIPTION\\System\\BIOS'], { timeout: 5000, windowsHide: true }, (err, out) => {
          if (err) return resolve(null);
          const m = regValue(out, 'SystemManufacturer'), p = regValue(out, 'SystemProductName');
          resolve({ vm: isVirtualMachine(m, p), maker: m, model: p });
        });
        return;
      }
      if (platform === 'linux') {
        let m = '', p = '';
        try { m = read('/sys/class/dmi/id/sys_vendor').trim(); } catch (e) { }
        try { p = read('/sys/class/dmi/id/product_name').trim(); } catch (e) { }
        resolve(m || p ? { vm: isVirtualMachine(m, p), maker: m, model: p } : null);
        return;
      }
      resolve(null);
    } catch (e) { resolve(null); }
  });
}

module.exports = { isVirtualMachine, regValue, detect };
