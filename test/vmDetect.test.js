'use strict';
// GPU fallback on virtual machines (Sentry ARMGDDN-COMPANION-2Q, Nov 25 2026): once a VM needed the no-GPU step, it keeps it for good.
const test = require('node:test');
const assert = require('node:assert');
const vm = require('../main/vmDetect');

test('virtual machine makers and models are recognised; real PCs are not', () => {
  for (const [m, p] of [['Parallels Software International Inc.', 'Parallels Virtual Platform'], ['Parallels International GmbH.', 'Parallels ARM Virtual Machine'],
    ['VMware, Inc.', 'VMware7,1'], ['innotek GmbH', 'VirtualBox'], ['QEMU', 'Standard PC (Q35 + ICH9, 2009)'], ['Xen', 'HVM domU'],
    ['Microsoft Corporation', 'Virtual Machine'], ['Red Hat', 'KVM'], ['Amazon EC2', 't3.large']]) assert.ok(vm.isVirtualMachine(m, p), m);
  for (const [m, p] of [['ASUS', 'ROG STRIX Z790-E'], ['Micro-Star International Co., Ltd.', 'MS-7D25'], ['Microsoft Corporation', 'Surface Laptop 5'],
    ['Dell Inc.', 'XPS 15 9530'], ['', ''], [null, undefined]]) assert.ok(!vm.isVirtualMachine(m, p), String(m));
});

test('Windows: the BIOS registry key is read', async () => {
  const out = '\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DESCRIPTION\\System\\BIOS\r\n    SystemManufacturer    REG_SZ    Parallels International GmbH.\r\n    SystemProductName    REG_SZ    Parallels ARM Virtual Machine\r\n';
  const r = await vm.detect('win32', { execFile: (c, a, o, cb) => cb(null, out) });
  assert.deepEqual(r, { vm: true, maker: 'Parallels International GmbH.', model: 'Parallels ARM Virtual Machine' });
  assert.equal(await vm.detect('win32', { execFile: (c, a, o, cb) => cb(new Error('no reg')) }), null, 'an error means unknown');
});

test('Linux: DMI files; macOS and unreadable files mean unknown', async () => {
  const files = { '/sys/class/dmi/id/sys_vendor': 'QEMU\n', '/sys/class/dmi/id/product_name': 'Standard PC\n' };
  assert.equal((await vm.detect('linux', { readFile: (f) => files[f] })).vm, true);
  assert.equal(await vm.detect('linux', { readFile: () => { throw new Error('x'); } }), null);
  assert.equal(await vm.detect('darwin'), null);
});

test('main.js never lets the no-GPU marker expire on a VM, and arming writes the VM note', () => {
  const src = require('./mainSource')();
  assert.ok(src.includes("fs.existsSync(GPU_HARD_MARKER + '.vm')"));
  assert.ok(src.includes('fresh = gpuHardVm || Date.now()'));
  const aw = require('fs').readFileSync(require('path').join(__dirname, '..', 'main', 'appWindows.js'), 'utf8');
  assert.ok(aw.includes("require('./vmDetect').detect()") && aw.includes("ctx.GPU_HARD_MARKER + '.vm'"));
});
