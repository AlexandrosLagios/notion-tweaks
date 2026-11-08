import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spacesOf } from '../src/notion-api.ts';

const space = (name: string) => ({ spaceId: 'x', value: { value: { name }, role: 'editor' } });
const spacesByUser = {
  u1: { space: { s1: space('Work'), s2: space('Personal') } },
  u2: { space: { s3: space('Other account') } },
};

test('spacesOf lists the workspaces of the user with their names', () => {
  assert.deepEqual(spacesOf(spacesByUser, 'u1'), [
    { id: 's1', name: 'Work' },
    { id: 's2', name: 'Personal' },
  ]);
});

test('spacesOf falls back to the first user when the user is unknown', () => {
  assert.deepEqual(spacesOf(spacesByUser, 'any-user'), [
    { id: 's1', name: 'Work' },
    { id: 's2', name: 'Personal' },
  ]);
});
