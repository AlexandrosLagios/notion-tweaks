import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import manifest from '../manifest.json' with { type: 'json' };

test('the manifest runs the comment box scripts on Notion only, with the props reader in the main world first', () => {
  assert.deepEqual(
    manifest.content_scripts.map(({ matches, js, world }) => ({ matches, js, world })),
    [
      { matches: ['https://app.notion.com/*'], js: ['src/content-main.js'], world: 'MAIN' },
      { matches: ['https://app.notion.com/*'], js: ['src/content.js'], world: undefined },
    ],
  );
  manifest.content_scripts.forEach(({ js: [script] }) =>
    assert.equal(existsSync(path.join(import.meta.dirname, '..', script.replace(/\.js$/, '.ts'))), true, script),
  );
});

test('the manifest points the side panel at a page that exists', () => {
  assert.equal(existsSync(path.join(import.meta.dirname, '..', manifest.side_panel.default_path)), true);
});

test('the manifest asks for no cookies permission, because the Chrome Web Store reviews that permission as sensitive', () => {
  assert.equal(manifest.permissions.includes('cookies'), false);
});

test('the manifest points at icons that exist', () => {
  const icons = Object.values(manifest.icons);
  assert.equal(icons.length, 4);
  icons.forEach((icon) => assert.equal(existsSync(path.join(import.meta.dirname, '..', icon)), true, icon));
});

test('the manifest name does not start with the Notion trademark', () => {
  assert.equal(manifest.name.startsWith('Notion'), false);
});

test('the manifest asks only for permissions without an install warning, so an update keeps the extension turned on', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'scripting', 'sidePanel', 'storage']);
});

test('the manifest exposes to Notion only the modules that the comment box script loads', () => {
  assert.deepEqual(manifest.web_accessible_resources, [
    { resources: ['src/picker.js', 'src/schedule.js'], matches: ['https://app.notion.com/*'] },
  ]);
});
