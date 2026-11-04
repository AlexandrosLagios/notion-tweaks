const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ACTION_NEEDED_GROUP,
  parseRules,
  resolveDatabaseId,
  groupNotifications,
  moveRow,
  moveTargets,
  markArchived,
  withUnreadIds,
} = require('../src/grouping.js');
const log = require('./fixtures/notification-log.json');

const B1 = 'b1000000-0000-4000-8000-000000000001';
const B2 = 'b2000000-0000-4000-8000-000000000002';
const B4 = 'b4000000-0000-4000-8000-000000000004';
const B7 = 'b7000000-0000-4000-8000-000000000007';
const FIX_LOGIN_PAGE = 'a1000000-0000-4000-8000-000000000001';
const Q1_NOTES_PAGE = 'a4000000-0000-4000-8000-000000000004';
const TEAM_WIKI_PAGE = 'a6000000-0000-4000-8000-000000000006';

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
const groupsFor = (rulesText, movedRows = {}) => groupNotifications(log, parseRules(rulesText).rules, movedRows);
const groupNames = (groups) => groups.map((group) => group.name);
const fixLoginRow = () => groupsFor(RULES_TEXT)[0].items[0];
const planningRow = () => groupsFor(RULES_TEXT)[1].items[0];
const flagged = (row) => ({ [row.pageKey]: row });
const movedTo = (row, group) => ({ [row.pageKey]: { ...row, movedTo: group } });
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
    pageKey: 'a1000000-0000-4000-8000-000000000001',
    homeGroup: 'Engineering',
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

test('markArchived keeps the row in place, flags it, and recounts the group', () => {
  const [group] = markArchived(groupsFor(RULES_TEXT), new Set([B7, B1]));
  assert.deepEqual(itemIds(group), ['b7', 'b2']);
  assert.deepEqual(group.items.map((item) => item.archived), [true, false]);
  assert.equal(group.unread, 0);
  assert.equal(group.activeCount, 1);
});

test('markArchived restores a row when its ids leave the set', () => {
  const [group] = markArchived(markArchived(groupsFor(RULES_TEXT), new Set([B7, B1])), new Set());
  assert.deepEqual([group.items[0].archived, group.unread, group.activeCount], [false, 1, 2]);
});

test('markArchived keeps a group whose rows are all archived', () => {
  const groups = markArchived(groupsFor(RULES_TEXT), new Set([B4]));
  assert.deepEqual(groups.map((group) => group.name), ['Engineering', 'Planning', 'Tasks', 'Other']);
  assert.equal(groups[1].activeCount, 0);
});

test('groupNotifications puts a flagged page in Action needed, before every other group', () => {
  const groups = groupsFor(RULES_TEXT, flagged(fixLoginRow()));
  assert.deepEqual(groupNames(groups), [ACTION_NEEDED_GROUP, 'Engineering', 'Planning', 'Tasks', 'Other']);
  assert.deepEqual(itemIds(groups[0]), ['b7']);
  assert.deepEqual(itemIds(groups[1]), ['b2']);
});

test('groupNotifications keeps a flagged row that the response does not hold', () => {
  const stored = fixLoginRow();
  const [section] = groupNotifications({ notificationIds: [], recordMap: {} }, [], flagged(stored));
  assert.equal(section.name, ACTION_NEEDED_GROUP);
  assert.deepEqual(section.items, [{ ...stored, movedTo: ACTION_NEEDED_GROUP }]);
});

test('groupNotifications updates a flagged row and keeps the notifications that the response does not hold', () => {
  const older = 'older-notification';
  const stored = { ...fixLoginRow(), title: 'Old title', ids: [older], unreadIds: [older] };
  const [row] = groupsFor(RULES_TEXT, flagged(stored))[0].items;
  assert.equal(row.title, 'Fix login');
  assert.deepEqual(row.ids, [B7, B1, older]);
  assert.deepEqual(row.unreadIds, [B1, older]);
});

test('groupNotifications records Action needed on a flagged row saved without a group', () => {
  const [row] = groupsFor(RULES_TEXT, flagged(fixLoginRow()))[0].items;
  assert.equal(row.movedTo, ACTION_NEEDED_GROUP);
});

test('groupNotifications keeps the usual group of a flagged row', () => {
  const [row] = groupsFor(RULES_TEXT, flagged(fixLoginRow()))[0].items;
  assert.equal(row.homeGroup, 'Engineering');
});

test('moveRow moves a row to Action needed and recounts both groups', () => {
  const groups = moveRow(groupsFor(RULES_TEXT), FIX_LOGIN_PAGE, ACTION_NEEDED_GROUP, parseRules(RULES_TEXT).rules);
  assert.deepEqual(groupNames(groups), [ACTION_NEEDED_GROUP, 'Engineering', 'Planning', 'Tasks', 'Other']);
  assert.deepEqual([groups[0].unread, groups[1].unread], [1, 0]);
});

test('moveRow drops a group that becomes empty', () => {
  const groups = moveRow(groupsFor(RULES_TEXT), Q1_NOTES_PAGE, ACTION_NEEDED_GROUP, parseRules(RULES_TEXT).rules);
  assert.deepEqual(groupNames(groups), [ACTION_NEEDED_GROUP, 'Engineering', 'Tasks', 'Other']);
});

test('moveRow returns a row to its usual group in rule order and date order', () => {
  const rules = parseRules(RULES_TEXT).rules;
  const original = groupsFor(RULES_TEXT);
  const moved = moveRow(original, FIX_LOGIN_PAGE, ACTION_NEEDED_GROUP, rules);
  const returned = moveRow(moved, FIX_LOGIN_PAGE, 'Engineering', rules);
  assert.deepEqual(groupNames(returned), groupNames(original));
  assert.deepEqual(itemIds(returned[0]), ['b7', 'b2']);
});

test('moveRow to the current group keeps one copy of the row', () => {
  const groups = moveRow(groupsFor(RULES_TEXT), FIX_LOGIN_PAGE, 'Engineering', parseRules(RULES_TEXT).rules);
  assert.deepEqual(itemIds(groups[0]), ['b7', 'b2']);
});

test('groupNotifications puts a moved page in its custom group, after Action needed and before the rule groups', () => {
  const groups = groupsFor(RULES_TEXT, { ...flagged(fixLoginRow()), ...movedTo(planningRow(), 'Waiting') });
  assert.deepEqual(groupNames(groups), [ACTION_NEEDED_GROUP, 'Waiting', 'Engineering', 'Tasks', 'Other']);
  assert.deepEqual(itemIds(groups[1]), ['b4']);
});

test('groupNotifications sorts the custom groups by name', () => {
  const groups = groupsFor(RULES_TEXT, { ...movedTo(fixLoginRow(), 'Zeta'), ...movedTo(planningRow(), 'Alpha') });
  assert.deepEqual(groupNames(groups), ['Alpha', 'Zeta', 'Engineering', 'Tasks', 'Other']);
});

test('groupNotifications keeps a moved row that the response does not hold', () => {
  const [section] = groupNotifications({ notificationIds: [], recordMap: {} }, [], movedTo(fixLoginRow(), 'Waiting'));
  assert.equal(section.name, 'Waiting');
});

test('groupNotifications keeps a moved row in its custom group when Notion returns the row with a new comment', () => {
  const stored = { ...fixLoginRow(), title: 'Old title', movedTo: 'Waiting' };
  const [group] = groupsFor(RULES_TEXT, { [stored.pageKey]: stored });
  assert.equal(group.name, 'Waiting');
  assert.equal(group.items[0].title, 'Fix login');
  assert.equal(group.items[0].movedTo, 'Waiting');
});

test('moveRow moves a row to a new custom group and records the group on the row', () => {
  const groups = moveRow(groupsFor(RULES_TEXT), FIX_LOGIN_PAGE, 'Waiting', parseRules(RULES_TEXT).rules);
  assert.deepEqual(groupNames(groups), ['Waiting', 'Engineering', 'Planning', 'Tasks', 'Other']);
  assert.equal(groups[0].items[0].movedTo, 'Waiting');
});

test('moveRow to the usual group clears the custom group from the row', () => {
  const rules = parseRules(RULES_TEXT).rules;
  const groups = moveRow(moveRow(groupsFor(RULES_TEXT), FIX_LOGIN_PAGE, 'Waiting', rules), FIX_LOGIN_PAGE, 'Engineering', rules);
  assert.deepEqual(groupNames(groups), ['Engineering', 'Planning', 'Tasks', 'Other']);
  assert.equal('movedTo' in groups[0].items[0], false);
});

test('moveRow drops a custom group when the last row leaves', () => {
  const rules = parseRules(RULES_TEXT).rules;
  const groups = moveRow(moveRow(groupsFor(RULES_TEXT), FIX_LOGIN_PAGE, 'Waiting', rules), FIX_LOGIN_PAGE, 'Review', rules);
  assert.deepEqual(groupNames(groups), ['Review', 'Engineering', 'Planning', 'Tasks', 'Other']);
});

test('moveRow keeps the place of a rule group that receives a moved row', () => {
  const rules = parseRules(RULES_TEXT).rules;
  const groups = moveRow(groupsFor(RULES_TEXT), TEAM_WIKI_PAGE, 'Planning', rules);
  assert.deepEqual(groupNames(groups), ['Engineering', 'Planning', 'Tasks', 'Other']);
});

test('moveRow keeps the place of a database group that receives a moved row', () => {
  const groups = moveRow(groupsFor(''), TEAM_WIKI_PAGE, 'Roadmap', []);
  assert.deepEqual(groupNames(groups), ['Tasks', 'Roadmap', 'Other']);
});

test('moveTargets leaves out a database group that received a moved row', () => {
  const groups = moveRow(groupsFor(''), TEAM_WIKI_PAGE, 'Roadmap', []);
  const tasksRow = groups.find((group) => group.name === 'Tasks').items[0];
  assert.deepEqual(moveTargets(groups, tasksRow, 'Tasks'), []);
});

test('moveRow leaves the groups unchanged when a reload has removed the page', () => {
  const original = groupsFor(RULES_TEXT);
  assert.deepEqual(moveRow(original, 'removed-page', 'Waiting', parseRules(RULES_TEXT).rules), original);
});

test('moveTargets lists the custom groups without Action needed', () => {
  const groups = groupsFor(RULES_TEXT, { ...movedTo(fixLoginRow(), 'Waiting'), ...flagged(planningRow()) });
  const tasksRow = groups.find((group) => group.name === 'Tasks').items[0];
  assert.deepEqual(moveTargets(groups, tasksRow, 'Tasks'), ['Waiting']);
});

test('moveTargets offers the usual group for a row in a custom group, and leaves out the current group', () => {
  const groups = groupsFor(RULES_TEXT, { ...movedTo(fixLoginRow(), 'Waiting'), ...movedTo(planningRow(), 'Review') });
  const waitingRow = groups.find((group) => group.name === 'Waiting').items[0];
  assert.deepEqual(moveTargets(groups, waitingRow, 'Waiting'), ['Review', 'Engineering']);
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
    {},
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
