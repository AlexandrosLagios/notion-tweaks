const { test } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../manifest.json');

test('the manifest declares no content scripts, because Chrome freezes them at the last extension reload', () => {
  assert.equal(manifest.content_scripts, undefined);
});
