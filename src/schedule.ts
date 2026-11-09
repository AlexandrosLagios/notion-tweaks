import type { Comment } from './notion-api.ts';

export const SCHEDULE_KEY = 'scheduledComments';
export const OVERDUE_AFTER_MS = 5 * 60_000;
export const MIN_LEAD_MS = 60_000;
const ALARM_PREFIX = 'comment:';
const HOUR_MS = 60 * 60_000;
const MORNING_HOUR = 9;
const AFTERNOON_HOUR = 13;
const MONDAY = 1;

export const STATUS = {
  PENDING: 'pending',
  OVERDUE: 'overdue',
  FAILED: 'failed',
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

export type ScheduledComment = Comment & {
  id: string;
  sendAt: number;
  title: string;
  path: string;
  status: Status;
  error?: string;
};

export const addEntry = (list: ScheduledComment[], entry: ScheduledComment) =>
  [...list, entry].sort((a, b) => a.sendAt - b.sendAt);

export const removeEntry = (list: ScheduledComment[], id: string) => list.filter((entry) => entry.id !== id);

export const withStatus = (list: ScheduledComment[], id: string, status: Status, error?: string) =>
  list.map((entry) => (entry.id === id ? { ...entry, status, error } : entry));

export const alarmName = (id: string) => `${ALARM_PREFIX}${id}`;

export const idOfAlarm = (name: string) => (name.startsWith(ALARM_PREFIX) ? name.slice(ALARM_PREFIX.length) : undefined);

// A reply that posts much later than planned can be wrong, so a late alarm asks the user instead of sending.
export const isOverdue = (entry: ScheduledComment, now: number) => now - entry.sendAt > OVERDUE_AFTER_MS;

export const markOverdue = (list: ScheduledComment[], now: number) =>
  list.map((entry) => (entry.status === STATUS.PENDING && isOverdue(entry, now) ? { ...entry, status: STATUS.OVERDUE } : entry));

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// The error names the earliest time, so a day and month swap or an AM for PM shows at a glance.
export function sendAtError(sendAt: number, now: number) {
  if (Number.isNaN(sendAt)) {
    return 'Pick a date and time.';
  }
  return sendAt - now < MIN_LEAD_MS ? `Pick a time after ${timeFormat.format(now + MIN_LEAD_MS)}.` : undefined;
}

function dayAt(now: number, daysLater: number, hour: number) {
  const date = new Date(now);
  date.setDate(date.getDate() + daysLater);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

export const defaultSendAt = (now: number) => dayAt(now, 1, MORNING_HOUR);

const daysToNextMonday = (now: number) => ((MONDAY + 6 - new Date(now).getDay()) % 7) + 1;

// A preset at the same time as an earlier one drops out, such as next Monday on a Sunday.
export function presets(now: number) {
  const list = [
    { label: 'In 1 hour', sendAt: now + HOUR_MS },
    { label: 'Tomorrow morning', sendAt: defaultSendAt(now) },
    { label: 'Tomorrow afternoon', sendAt: dayAt(now, 1, AFTERNOON_HOUR) },
    { label: 'Next Monday morning', sendAt: dayAt(now, daysToNextMonday(now), MORNING_HOUR) },
  ];
  return list.filter(({ sendAt }, index) => list.findIndex((preset) => preset.sendAt === sendAt) === index);
}

// The only Chrome calls of this module, so the tests run the rest without Chrome.
export const readSchedule = async () =>
  (await chrome.storage.local.get<{ [SCHEDULE_KEY]?: ScheduledComment[] }>(SCHEDULE_KEY))[SCHEDULE_KEY] ?? [];

export const saveSchedule = (list: ScheduledComment[]) => chrome.storage.local.set({ [SCHEDULE_KEY]: list });

export const needsDecision = (list: ScheduledComment[]) => list.some((entry) => entry.status !== STATUS.PENDING);
