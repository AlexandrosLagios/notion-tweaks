export const SCHEDULE_KEY = 'scheduledComments';
export const OVERDUE_AFTER_MS = 5 * 60_000;
export const MIN_LEAD_MS = 60_000;
const ALARM_PREFIX = 'comment:';

export const STATUS = {
  PENDING: 'pending',
  OVERDUE: 'overdue',
  FAILED: 'failed',
} as const;
export type Status = (typeof STATUS)[keyof typeof STATUS];

export interface ScheduledComment {
  id: string;
  userId: string;
  spaceId: string;
  discussionId: string;
  text: string;
  sendAt: number;
  title: string;
  path: string;
  status: Status;
  error?: string;
}

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

export function sendAtError(sendAt: number, now: number) {
  if (Number.isNaN(sendAt)) {
    return 'Pick a date and time.';
  }
  return sendAt - now < MIN_LEAD_MS ? 'Pick a time at least 1 minute from now.' : undefined;
}

// The only Chrome calls of this module, so the tests run the rest without Chrome.
export const readSchedule = async () =>
  (await chrome.storage.local.get<{ [SCHEDULE_KEY]?: ScheduledComment[] }>(SCHEDULE_KEY))[SCHEDULE_KEY] ?? [];

export const saveSchedule = (list: ScheduledComment[]) => chrome.storage.local.set({ [SCHEDULE_KEY]: list });

export const needsDecision = (list: ScheduledComment[]) => list.some((entry) => entry.status !== STATUS.PENDING);
