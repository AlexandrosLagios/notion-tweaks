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

test('the manifest asks for no cookies permission, because the Chrome Web Store reviews that permission as sensitive', () => {
  assert.equal(manifest.permissions.includes('cookies'), false);
});

test('the manifest points at icons that exist', () => {
  const icons = Object.values(manifest.icons);
  assert.equal(icons.length, 4);
  icons.forEach((icon) => assert.equal(existsSync(path.join(__dirname, '..', icon)), true, icon));
});

test('the manifest name does not start with the Notion trademark', () => {
  assert.equal(manifest.name.startsWith('Notion'), false);
});
