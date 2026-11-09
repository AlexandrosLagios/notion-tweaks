import * as NotionTweaksApi from './notion-api.ts';
import * as NotionTweaksSchedule from './schedule.ts';
import type { ScheduledComment } from './schedule.ts';

const UNREAD_ALARM = 'unread-count';
const BADGE_COLOR = '#2383e2';
const DECISION_BADGE_COLOR = '#d9730d';
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

let sends = Promise.resolve();

// One send at a time, so an alarm and a "Send now" click cannot both read the entry and post it twice.
// ponytail: the panel also writes the list; route its writes through the worker if an edit ever gets lost.
function enqueueSend(id: string, onlyIfOnTime: boolean) {
  sends = sends.then(() => send(id, onlyIfOnTime)).catch(console.error);
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
    const failed = { ...entry, status: STATUS.FAILED, error: (error as Error).message };
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

chrome.runtime.onMessage.addListener((message: { sendNow?: string }) => {
  if (message.sendNow) {
    enqueueSend(message.sendNow, false);
  }
});

chrome.storage.local.onChanged.addListener(({ [SCHEDULE_KEY]: change }) => {
  if (change) {
    showDecisionBadge((change.newValue as ScheduledComment[] | undefined) ?? []).catch(console.error);
  }
});

resumeSchedule().catch(console.error);
