import * as NotionTweaksApi from './notion-api.ts';
import * as NotionTweaksSchedule from './schedule.ts';
import type { ScheduledComment } from './schedule.ts';

const UNREAD_ALARM = 'unread-count';
const BADGE_COLOR = '#2383e2';
const DECISION_BADGE_COLOR = '#d9730d';
const NOT_FOLLOWED_HINT = 'If you do not follow this thread, cancel this reply and schedule it from the page with the clock button.';
const { SCHEDULE_KEY, STATUS, readSchedule, saveSchedule } = NotionTweaksSchedule;

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.alarms.get(UNREAD_ALARM).then(async (alarm) => {
  if (!alarm) {
    await chrome.alarms.create(UNREAD_ALARM, { periodInMinutes: 1 });
  }
});

// ponytail: the color shows only next to an unread count; add a badge text if an overdue reply goes unseen.
const showDecisionBadge = (list: ScheduledComment[]) =>
  chrome.action.setBadgeBackgroundColor({
    color: NotionTweaksSchedule.needsDecision(list) ? DECISION_BADGE_COLOR : BADGE_COLOR,
  });

let listWrites: Promise<unknown> = Promise.resolve();

// One list write at a time, so an alarm, a "Send now" click, and a new entry cannot overwrite each other or post twice.
// ponytail: Cancel in the panel still writes the list itself; route it through the worker if a cancel ever gets lost.
function serialize<T>(task: () => Promise<T>) {
  const result = listWrites.then(task);
  listWrites = result.catch(console.error);
  return result;
}

const enqueueSend = (id: string, onlyIfOnTime: boolean) => serialize(() => send(id, onlyIfOnTime)).catch(console.error);

async function schedule(entry: ScheduledComment) {
  const error = NotionTweaksSchedule.sendAtError(entry.sendAt, Date.now());
  if (!error) {
    await saveSchedule(NotionTweaksSchedule.addEntry(await readSchedule(), entry));
    await chrome.alarms.create(NotionTweaksSchedule.alarmName(entry.id), { when: entry.sendAt });
  }
  return { error };
}

async function send(id: string, onlyIfOnTime: boolean) {
  const list = await readSchedule();
  const entry = list.find((candidate) => candidate.id === id);
  if (!entry || (onlyIfOnTime && entry.status !== STATUS.PENDING)) {
    return;
  }
  if (onlyIfOnTime && NotionTweaksSchedule.isOverdue(entry, Date.now())) {
    await saveSchedule(NotionTweaksSchedule.withStatus(list, id, STATUS.OVERDUE));
    return;
  }
  await saveSchedule(NotionTweaksSchedule.removeEntry(list, id));
  try {
    await NotionTweaksApi.postComment(entry);
  } catch (error) {
    // The panel cannot read the seen record id, so its reply fails in a thread that the user does not follow.
    const hint = 'discussionId' in entry && !entry.seenRecordId ? ` ${NOT_FOLLOWED_HINT}` : '';
    const failed = { ...entry, status: STATUS.FAILED, error: (error as Error).message + hint };
    await saveSchedule(NotionTweaksSchedule.addEntry(await readSchedule(), failed));
  }
}

// An extension update clears the alarms, and a closed Chrome misses them, so each worker start checks the list.
async function resumeSchedule() {
  const stored = await readSchedule();
  const list = NotionTweaksSchedule.markOverdue(stored, Date.now());
  if (list.some((entry, index) => entry !== stored[index])) {
    await saveSchedule(list);
  }
  await Promise.all(
    list
      .filter((entry) => entry.status === STATUS.PENDING)
      .map(async ({ id, sendAt }) => {
        const name = NotionTweaksSchedule.alarmName(id);
        if (!(await chrome.alarms.get(name))) {
          await chrome.alarms.create(name, { when: sendAt });
        }
      }),
  );
  await showDecisionBadge(list);
}

chrome.alarms.onAlarm.addListener(async ({ name }) => {
  const commentId = NotionTweaksSchedule.idOfAlarm(name);
  if (commentId) {
    enqueueSend(commentId, true);
    return;
  }
  if (name !== UNREAD_ALARM) {
    return;
  }
  const { spaceId } = await chrome.storage.local.get<{ spaceId?: string }>('spaceId');
  if (spaceId) {
    await NotionTweaksApi.updateUnreadCount(spaceId).catch(console.error);
  }
});

// The panel and the comment box button add entries here, so the worker is the only writer of a new entry.
chrome.runtime.onMessage.addListener((message: { sendNow?: string; schedule?: ScheduledComment }, _sender, sendResponse) => {
  if (message.sendNow) {
    enqueueSend(message.sendNow, false);
  }
  if (message.schedule) {
    const entry = message.schedule;
    serialize(() => schedule(entry)).then(sendResponse, (error: Error) => sendResponse({ error: error.message }));
    return true;
  }
  return undefined;
});

chrome.storage.local.onChanged.addListener(({ [SCHEDULE_KEY]: change }) => {
  if (change) {
    showDecisionBadge((change.newValue as ScheduledComment[] | undefined) ?? []).catch(console.error);
  }
});

resumeSchedule().catch(console.error);
