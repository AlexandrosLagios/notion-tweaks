import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OVERDUE_AFTER_MS,
  MIN_LEAD_MS,
  STATUS,
  addEntry,
  removeEntry,
  withStatus,
  alarmName,
  idOfAlarm,
  isOverdue,
  markOverdue,
  sendAtError,
  needsDecision,
} from '../src/schedule.ts';
import type { ScheduledComment } from '../src/schedule.ts';

const NOW = Date.UTC(2026, 10, 9, 9, 0);
const DAY = 24 * 60 * 60_000;

const entry = (id: string, sendAt: number, status: ScheduledComment['status'] = STATUS.PENDING): ScheduledComment => ({
  id,
  userId: 'u1',
  spaceId: 's1',
  discussionId: 'd1',
  text: `reply ${id}`,
  sendAt,
  title: 'Page',
  path: '/p/page',
  status,
});

test('addEntry keeps the list in send order', () => {
  const list = addEntry([entry('late', NOW + 2000)], entry('early', NOW + 1000));
  assert.deepEqual(
    list.map(({ id }) => id),
    ['early', 'late'],
  );
});

test('removeEntry drops only the entry with the id', () => {
  const list = removeEntry([entry('a', NOW), entry('b', NOW)], 'a');
  assert.deepEqual(
    list.map(({ id }) => id),
    ['b'],
  );
});

test('withStatus sets the status and the error of one entry', () => {
  const [a, b] = withStatus([entry('a', NOW), entry('b', NOW)], 'a', STATUS.FAILED, 'HTTP 500');
  assert.equal(a.status, STATUS.FAILED);
  assert.equal(a.error, 'HTTP 500');
  assert.equal(b.status, STATUS.PENDING);
});

test('the alarm name holds the entry id, and other alarms give no id', () => {
  assert.equal(idOfAlarm(alarmName('abc')), 'abc');
  assert.equal(idOfAlarm('unread-count'), undefined);
});

test('an entry is overdue only more than 5 minutes after its send time', () => {
  assert.equal(isOverdue(entry('a', NOW), NOW + OVERDUE_AFTER_MS), false);
  assert.equal(isOverdue(entry('a', NOW), NOW + OVERDUE_AFTER_MS + 1), true);
});

test('markOverdue marks only pending entries that are more than 5 minutes late', () => {
  const list = markOverdue(
    [entry('late', NOW - OVERDUE_AFTER_MS - 1), entry('due', NOW - 1000), entry('failed', NOW - DAY, STATUS.FAILED)],
    NOW,
  );
  assert.deepEqual(
    list.map(({ id, status }) => [id, status]),
    [
      ['late', STATUS.OVERDUE],
      ['due', STATUS.PENDING],
      ['failed', STATUS.FAILED],
    ],
  );
});

test('sendAtError refuses a time in the past, a time less than 1 minute ahead, and no time', () => {
  assert.match(sendAtError(NOW - 1, NOW)!, /at least 1 minute/);
  assert.match(sendAtError(NOW + MIN_LEAD_MS - 1, NOW)!, /at least 1 minute/);
  assert.match(sendAtError(Number.NaN, NOW)!, /time/i);
  assert.equal(sendAtError(NOW + MIN_LEAD_MS, NOW), undefined);
});

test('needsDecision is true while an entry is overdue or failed', () => {
  assert.equal(needsDecision([entry('a', NOW)]), false);
  assert.equal(needsDecision([entry('a', NOW), entry('b', NOW, STATUS.OVERDUE)]), true);
  assert.equal(needsDecision([entry('a', NOW, STATUS.FAILED)]), true);
});
