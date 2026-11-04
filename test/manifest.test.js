const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const manifest = require('../manifest.json');

test('the manifest declares no content scripts, because Chrome freezes them at the last extension reload', () => {
  assert.equal(manifest.content_scripts, undefined);
});

test('the manifest points the side panel at a page that exists', () => {
  assert.equal(existsSync(path.join(__dirname, '..', manifest.side_panel.default_path)), true);
});
