const test = require('node:test'); const assert = require('node:assert');
test('vendored Preact + htm load and build a virtual tree without a build step', async () => {
  const ui = await import('../native/vendor/ui.mjs');
  const v = ui.html`<div class="card"><h2>${'Title'}</h2><${ui.Fragment}><span>a</span></${ui.Fragment}></div>`;
  assert.equal(v.type, 'div'); assert.equal(v.props.class, 'card');
  assert.equal(v.props.children[0].type, 'h2');
  assert.equal(typeof ui.useState, 'function'); assert.equal(typeof ui.render, 'function');
});
