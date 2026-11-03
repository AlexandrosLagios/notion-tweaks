const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRules, resolveDatabaseId, groupNotifications } = require('../src/grouping.js');
const log = require('./fixtures/notification-log.json');

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

test('groupNotifications orders the groups by the rules and puts Other last', () => {
  assert.deepEqual(groupsFor(RULES_TEXT).map((group) => group.name), ['Engineering', 'Planning', 'Other']);
});

test('groupNotifications merges databases that share a group name', () => {
  assert.deepEqual(itemIds(groupsFor(RULES_TEXT)[0]), ['b7', 'b2', 'b1']);
});

test('groupNotifications sends a database without a rule to Other, even when its name matches a rule database', () => {
  assert.ok(itemIds(groupsFor(RULES_TEXT)[2]).includes('b3'));
});

test('groupNotifications sorts each group from newest to oldest', () => {
  assert.deepEqual(itemIds(groupsFor(RULES_TEXT)[2]), ['b8', 'b6', 'b5', 'b3']);
});

test('groupNotifications counts the unread notifications of each group', () => {
  assert.deepEqual(groupsFor(RULES_TEXT).map((group) => group.unread), [1, 1, 1]);
});

test('groupNotifications matches a rule on the collection id', () => {
  const groups = groupsFor('33333333-3333-4333-8333-3333333333c3 = Docs');
  assert.deepEqual(itemIds(groups[0]), ['b3']);
});

test('groupNotifications leaves out a group without notifications', () => {
  const groups = groupsFor(`55555555555555558555555555555555 = Empty\n${ROADMAP} = Planning`);
  assert.deepEqual(groups.map((group) => group.name), ['Planning', 'Other']);
});

test('groupNotifications describes each item for the panel', () => {
  assert.deepEqual(groupsFor(RULES_TEXT)[0].items[0], {
    id: 'b7000000-0000-4000-8000-000000000007',
    pageId: 'a1000000000040008000000000000001',
    title: 'Fix login',
    type: 'Update',
    unread: false,
    endTime: 7000,
  });
});

test('groupNotifications joins the rich-text parts of a title', () => {
  assert.equal(groupsFor(RULES_TEXT)[1].items[0].title, 'Q1 notes');
});

test('groupNotifications shows Untitled when the page record is missing', () => {
  const missing = groupsFor(RULES_TEXT)[2].items.find((item) => item.id.startsWith('b6'));
  assert.equal(missing.title, 'Untitled');
});
