import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, parseListing } from '../scripts/submit-checklist.ts';

const listing = (description: string, storage: string) => `# Chrome Web Store listing

## Store listing tab

**Title** comes from the manifest: Example

**Category:** Productivity

**Screenshots:** \`store/screenshot-1.png\`, \`store/screenshot-2.png\`

**Description:**

\`\`\`text
${description}
\`\`\`

## Privacy tab

| Permission | Justification |
| --- | --- |
| \`storage\` | ${storage} |

## Test instructions tab

\`\`\`text
Open the panel.
\`\`\`
`;

test('the listing parser reads each dashboard field with its tab, and marks the fields to paste', () => {
  assert.deepEqual(parseListing(listing('Line one.\n\n- Item.', 'Saves the rules.')), [
    { tab: 'Store listing', name: 'Category', value: 'Productivity', paste: false },
    { tab: 'Store listing', name: 'Screenshots', value: '`store/screenshot-1.png`, `store/screenshot-2.png`', paste: false },
    { tab: 'Store listing', name: 'Description', value: 'Line one.\n\n- Item.', paste: true },
    { tab: 'Privacy', name: 'Justification: storage', value: 'Saves the rules.', paste: true },
    { tab: 'Test instructions', name: 'Test instructions', value: 'Open the panel.', paste: true },
  ]);
});

test('the checklist holds only the fields with new text, and the image fields with a changed file', () => {
  const before = listing('Old text.', 'Saves the rules.');
  const after = listing('New text.', 'Saves the rules.');
  assert.deepEqual(
    changedFields(before, after, ['store/screenshot-2.png']).map(({ name }) => name),
    ['Screenshots', 'Description'],
  );
  assert.deepEqual(changedFields(before, before, []), []);
});

test('the checklist marks a field that the last release did not have', () => {
  const before = listing('Text.', 'Saves the rules.').replace(/\| `storage` .*\n/, '');
  const [field] = changedFields(before, listing('Text.', 'Saves the rules.'), []);
  assert.deepEqual(field, { tab: 'Privacy', name: 'Justification: storage', value: 'Saves the rules.', paste: true, isNew: true });
});
