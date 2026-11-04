const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRules, resolveDatabaseId, groupNotifications, markArchived, withUnreadIds } = require('../src/grouping.js');
const log = require('./fixtures/notification-log.json');

const B1 = 'b1000000-0000-4000-8000-000000000001';
const B2 = 'b2000000-0000-4000-8000-000000000002';
const B4 = 'b4000000-0000-4000-8000-000000000004';
const B7 = 'b7000000-0000-4000-8000-000000000007';

const TASKS_ONE = '11111111111141118111111111111111';
const TASKS_TWO = '22222222222242228222222222222222';
const ROADMAP = '44444444444444448444444444444444';

const RULES_TEXT = [
  `https://app.notion.com/p/acme/Tasks-${TASKS_ONE}?v=99999999999949998999999999999999 = Engineering`,
  '22222222-2222-4222-8222-222222222222 = Engineering',
  '',
  `https://app.notion.com/p/acme/Roadmap-${ROADMAP} = Planning`,
].join('\n');

const notification = (id) => log.recordMap.notification[id].value.value;
const groupsFor = (rulesText) => groupNotifications(log, parseRules(rulesText).rules);
const itemIds = (group) => group.items.map((item) => item.id.slice(0, 2));

test('parseRules takes the database id from the URL path, not the view id in the query', () => {
  assert.equal(parseRules(RULES_TEXT).rules[0].databaseId, TASKS_ONE);
});

test('parseRules accepts a dashed id and keeps the line order', () => {
  assert.deepEqual(parseRules(RULES_TEXT).rules, [
    { databaseId: TASKS_ONE, group: 'Engineering' },
    { databaseId: TASKS_TWO, group: 'Engineering' },
    { databaseId: ROADMAP, group: 'Planning' },
  ]);
});

test('parseRules ignores blank lines', () => {
  assert.deepEqual(parseRules(RULES_TEXT).errors, []);
});

test('parseRules keeps the first rule when a database repeats', () => {
  assert.deepEqual(parseRules(`${ROADMAP} = First\n${ROADMAP} = Second`).rules, [
    { databaseId: ROADMAP, group: 'First' },
  ]);
});

test('parseRules reports a line without "="', () => {
  assert.deepEqual(parseRules(`${ROADMAP} Planning`).errors, [{ line: 1, reason: 'missing "="' }]);
});

test('parseRules reports a line without a database id', () => {
  assert.deepEqual(parseRules(`${ROADMAP} = Planning\nRoadmap = Planning`).errors, [
    { line: 2, reason: 'no database id' },
  ]);
});

test('parseRules reports a line without a group name', () => {
  assert.deepEqual(parseRules(`${ROADMAP} = `).errors, [{ line: 1, reason: 'no group name' }]);
});

test('resolveDatabaseId finds the database of a page in a database', () => {
  assert.deepEqual(resolveDatabaseId(log.recordMap, notification('b1000000-0000-4000-8000-000000000001')), {
    databaseId: TASKS_ONE,
    collectionId: '111111111111411181111111111111c1',
    databaseName: 'Tasks',
  });
});

test('resolveDatabaseId walks up from a sub-page to its database', () => {
  const database = resolveDatabaseId(log.recordMap, notification('b4000000-0000-4000-8000-000000000004'));
  assert.equal(database.databaseId, ROADMAP);
});

test('resolveDatabaseId returns null for a page outside a database', () => {
  assert.equal(resolveDatabaseId(log.recordMap, notification('b5000000-0000-4000-8000-000000000005')), null);
});

test('resolveDatabaseId returns null when the page record is missing', () => {
  assert.equal(resolveDatabaseId(log.recordMap, notification('b6000000-0000-4000-8000-000000000006')), null);
});

test('resolveDatabaseId returns null when the parent chain loops', () => {
  assert.equal(resolveDatabaseId(log.recordMap, notification('b8000000-0000-4000-8000-000000000008')), null);
});

test('groupNotifications puts the rule groups first, the other databases next, and Other last', () => {
  assert.deepEqual(groupsFor(RULES_TEXT).map((group) => group.name), ['Engineering', 'Planning', 'Tasks', 'Other']);
});

test('groupNotifications merges databases that share a group name', () => {
  assert.deepEqual(itemIds(groupsFor(RULES_TEXT)[0]), ['b7', 'b2']);
});

test('groupNotifications groups a database without a rule under the database name', () => {
  assert.deepEqual(itemIds(groupsFor(RULES_TEXT)[2]), ['b3']);
});

test('groupNotifications without rules merges databases that share a name', () => {
  assert.deepEqual(itemIds(groupsFor('')[0]), ['b7', 'b3', 'b2']);
});

test('groupNotifications orders the database groups by their newest notification', () => {
  assert.deepEqual(groupsFor('').map((group) => group.name), ['Tasks', 'Roadmap', 'Other']);
});

test('groupNotifications keeps only pages outside a database in Other', () => {
  assert.deepEqual(itemIds(groupsFor(RULES_TEXT)[3]), ['b8', 'b6', 'b5']);
});

test('groupNotifications sorts each group from newest to oldest', () => {
  assert.deepEqual(itemIds(groupsFor('')[0]), ['b7', 'b3', 'b2']);
});

test('groupNotifications counts the unread notifications of each group', () => {
  assert.deepEqual(groupsFor(RULES_TEXT).map((group) => group.unread), [1, 1, 0, 1]);
});

test('groupNotifications matches a rule on the collection id', () => {
  const groups = groupsFor('33333333-3333-4333-8333-3333333333c3 = Docs');
  assert.deepEqual(itemIds(groups[0]), ['b3']);
});

test('groupNotifications leaves out a group without notifications', () => {
  const groups = groupsFor(`55555555555555558555555555555555 = Empty\n${ROADMAP} = Planning`);
  assert.deepEqual(groups.map((group) => group.name), ['Planning', 'Tasks', 'Other']);
});

test('groupNotifications describes each row for the panel', () => {
  assert.deepEqual(groupsFor(RULES_TEXT)[0].items[0], {
    id: B7,
    ids: [B7, B1],
    unreadIds: [B1],
    path: '/p/a1000000000040008000000000000001?d=d1a00000000040008000000000000001',
    title: 'Fix login',
    verbs: ['updated', 'mentioned you'],
    actors: ['Status Sync', 'Maria Doe'],
    preview: 'Please check',
    endTime: 7000,
  });
});

test('groupNotifications shows the newest comment and names the mentions in it', () => {
  assert.equal(groupsFor(RULES_TEXT)[1].items[0].preview, 'Looks good @Maria Doe see Plan sprint');
});

test('groupNotifications reads a comment from the comment table and skips a deleted comment', () => {
  const sprint = groupsFor(RULES_TEXT)[0].items.find((item) => item.id === B2);
  assert.equal(sprint.preview, 'From the comment table');
});

test('groupNotifications has no preview for a row without a comment', () => {
  assert.equal(groupsFor(RULES_TEXT)[2].items[0].preview, null);
});

test('groupNotifications links to the discussion of the newest child notification', () => {
  assert.equal(groupsFor(RULES_TEXT)[1].items[0].path, '/p/a4000000000040008000000000000004?d=d4b00000000040008000000000000042');
});

test('groupNotifications links to the discussion of the activity', () => {
  const sprint = groupsFor(RULES_TEXT)[0].items.find((item) => item.id === B2);
  assert.equal(sprint.path, '/p/a2000000000040008000000000000002?d=d2a00000000040008000000000000002');
});

test('groupNotifications links to the page when the row has no discussion', () => {
  assert.equal(groupsFor(RULES_TEXT)[2].items[0].path, '/p/a3000000000040008000000000000003');
});

test('groupNotifications names each person once across the children of a grouped notification', () => {
  assert.deepEqual(groupsFor(RULES_TEXT)[1].items[0].actors, ['Nikos Roe', 'Maria Doe']);
});

test('groupNotifications leaves the actors empty when the notification has no activity', () => {
  const sprint = groupsFor(RULES_TEXT)[0].items.find((item) => item.id.startsWith('b2'));
  assert.deepEqual(sprint.actors, []);
});

test('groupNotifications lists every notification of a group as active', () => {
  assert.deepEqual(groupsFor(RULES_TEXT)[1].activeIds, [B4]);
});

test('markArchived keeps the row in place, flags it, and recounts the group', () => {
  const [group] = markArchived(groupsFor(RULES_TEXT), new Set([B7, B1]));
  assert.deepEqual(itemIds(group), ['b7', 'b2']);
  assert.deepEqual(group.items.map((item) => item.archived), [true, false]);
  assert.equal(group.unread, 0);
  assert.deepEqual(group.activeIds, [B2]);
  assert.equal(group.activeCount, 1);
});

test('markArchived restores a row when its ids leave the set', () => {
  const [group] = markArchived(markArchived(groupsFor(RULES_TEXT), new Set([B7, B1])), new Set());
  assert.deepEqual([group.items[0].archived, group.unread, group.activeIds], [false, 1, [B7, B1, B2]]);
});

test('markArchived keeps a group whose rows are all archived', () => {
  const groups = markArchived(groupsFor(RULES_TEXT), new Set([B4]));
  assert.deepEqual(groups.map((group) => group.name), ['Engineering', 'Planning', 'Tasks', 'Other']);
  assert.deepEqual(groups[1].activeIds, []);
});

test('withUnreadIds clears the unread notifications of one row and recounts only its group', () => {
  const groups = withUnreadIds(groupsFor(RULES_TEXT), B7, []);
  assert.deepEqual(groups[0].items[0].unreadIds, []);
  assert.deepEqual(groups.map((group) => group.unread), [0, 1, 0, 1]);
});

test('withUnreadIds restores the unread notifications of a row', () => {
  const groups = withUnreadIds(withUnreadIds(groupsFor(RULES_TEXT), B7, []), B7, [B1]);
  assert.deepEqual(groups.map((group) => group.unread), [1, 1, 0, 1]);
});

test('groupNotifications gives each notification without a page its own row in Other', () => {
  const entry = (id) => ({ value: { value: { id, read: true, end_time: '1', type: 'space-update' } } });
  const [other] = groupNotifications(
    { notificationIds: ['x1', 'x2'], recordMap: { notification: { x1: entry('x1'), x2: entry('x2') } } },
    [],
  );
  assert.equal(other.name, 'Other');
  assert.deepEqual(other.items.map((item) => [item.id, item.path]), [['x1', '/'], ['x2', '/']]);
});

test('groupNotifications joins the rich-text parts of a title', () => {
  assert.equal(groupsFor(RULES_TEXT)[1].items[0].title, 'Q1 notes');
});

test('groupNotifications shows Untitled when the page record is missing', () => {
  const missing = groupsFor(RULES_TEXT)[3].items.find((item) => item.id.startsWith('b6'));
  assert.equal(missing.title, 'Untitled');
});
