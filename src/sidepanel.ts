import * as NotionTweaksApi from './notion-api.ts';
import * as NotionTweaksGrouping from './grouping.ts';
import * as NotionTweaksPanel from './panel.ts';
import * as NotionTweaksSchedule from './schedule.ts';
import type { InboxType, Space } from './notion-api.ts';
import type { Group, Row, Rule } from './grouping.ts';
import type { Handlers, View } from './panel.ts';
import type { ScheduledComment } from './schedule.ts';

interface SpacesOfUser {
  userId: string | undefined;
  list: Space[];
}

interface LastList {
  userId: string;
  spaceId: string;
  inboxType: InboxType;
  size: number;
  groups: Group[];
  canLoadMore: boolean;
}

const PAGE_SIZE = 100;
const LOADING: View = { status: 'loading' };
const archivedIds = new Set<string>();
const pendingWrites = new Map<string, Promise<unknown>>();

let userId: string;
let spaceId: string;
// The workspaces of one account, kept together with the account that they belong to.
let spaces: SpacesOfUser = { userId: undefined, list: [] };
// The account whose workspaces are loaded or loading in this Chrome session.
let spacesFetchedFor: string | undefined;
let latestLoadId = 0;
let size = PAGE_SIZE;
let view: View = LOADING;
let inboxType: InboxType = NotionTweaksApi.INBOX_TYPE.ALL;
let unreadCount: number | undefined;
// The last count that the panel saw. A higher count means new notifications.
let countBaseline: number | undefined;
let currentId: string | undefined;
let rules: Rule[] = [];
let movedRows: Record<string, Row> = {};
let listIsStale = false;
let scheduled: ScheduledComment[] = [];

const spacesOfUser = () => (spaces.userId === userId ? spaces.list : []);

const render = () =>
  NotionTweaksPanel.render(
    { ...view, inboxType, unreadCount, currentId, spaces: spacesOfUser(), spaceId, scheduled },
    handlers,
  );

// A row saved before the workspace picker existed has no spaceId, and belongs to the workspace that loads first.
const isInSpace = (row: Row) => !row.spaceId || row.spaceId === spaceId;

// A write waits only for earlier writes of the same notifications, so an undo cannot overtake its archive.
function enqueueWrite(notificationIds: string[], write: () => Promise<unknown>) {
  const earlierWrites = notificationIds.map((id) => pendingWrites.get(id));
  const result = Promise.allSettled(earlierWrites).then(write);
  notificationIds.forEach((id) => pendingWrites.set(id, result));
  return result;
}

function refreshUnreadCount(forSpaceId: string) {
  NotionTweaksApi.updateUnreadCount(forSpaceId).catch(console.error);
}

function refreshIfStale() {
  if (listIsStale && view.status === 'ready' && !view.refreshing && !NotionTweaksPanel.isBusy()) {
    listIsStale = false;
    refresh();
  }
}

function showUnreadCount(count: number | undefined) {
  if (count !== undefined && countBaseline !== undefined && count > countBaseline) {
    listIsStale = true;
  }
  countBaseline = count;
  unreadCount = count;
  NotionTweaksPanel.showUnreadCount(count);
  refreshIfStale();
}

// ponytail: one panel writes the flags; read them before each write if two windows ever overwrite each other.
function saveRows() {
  if (view.status !== 'ready') {
    return;
  }
  const rows = view.groups.flatMap((group) => group.items).filter((item) => item.movedTo && !item.archived);
  const otherSpaceRows = Object.values(movedRows).filter((row) => !isInSpace(row));
  movedRows = Object.fromEntries(
    [...otherSpaceRows, ...rows.map((row) => ({ ...row, spaceId }))].map((row) => [row.pageKey, row]),
  );
  chrome.storage.local.set({ flaggedRows: movedRows }).catch(console.error);
  const groups = view.groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.archived) }))
    .filter((group) => group.items.length);
  chrome.storage.session
    .set({ lastList: { userId, spaceId, inboxType, size, groups, canLoadMore: view.canLoadMore } })
    .catch(console.error);
}

async function saveChosenSpace(id: string | undefined) {
  const { spaceIds = {} } = await chrome.storage.local.get<{ spaceIds?: Record<string, string> }>('spaceIds');
  const { [userId]: _, ...otherUsers } = spaceIds;
  await chrome.storage.local.set({ spaceIds: id ? { ...otherUsers, [userId]: id } : otherUsers });
}

function keepSpaces(forUserId: string, list: Space[]) {
  spaces = { userId: forUserId, list };
  chrome.storage.session.set({ spaces }).catch(console.error);
}

async function chosenSpaceId() {
  userId = await NotionTweaksApi.activeUserId();
  const { spaceIds = {} } = await chrome.storage.local.get<{ spaceIds?: Record<string, string> }>('spaceIds');
  if (spaceIds[userId]) {
    return spaceIds[userId];
  }
  spacesFetchedFor = userId;
  keepSpaces(userId, await NotionTweaksApi.listSpaces(userId));
  await saveChosenSpace(spaces.list[0].id);
  return spaces.list[0].id;
}

// getSpaces takes about 4 seconds, so the list of workspaces loads after the inbox, once per account and Chrome session.
function refreshSpaces() {
  if (spacesFetchedFor === userId) {
    return;
  }
  const requestedUserId = userId;
  spacesFetchedFor = requestedUserId;
  NotionTweaksApi.listSpaces(requestedUserId)
    .then((list) => {
      keepSpaces(requestedUserId, list);
      if (requestedUserId === userId) {
        NotionTweaksPanel.showSpaces(list, spaceId, handlers.onSpace);
      }
    })
    .catch((error) => {
      spacesFetchedFor = undefined;
      console.error(error);
    });
}

async function load() {
  const loadId = ++latestLoadId;
  try {
    const currentSpaceId = await chosenSpaceId();
    refreshUnreadCount(currentSpaceId);
    const response = await NotionTweaksApi.loadNotifications(currentSpaceId, size, inboxType);
    if (loadId !== latestLoadId) {
      return;
    }
    spaceId = currentSpaceId;
    listIsStale = false;
    const movedRowsOfSpace = Object.fromEntries(Object.entries(movedRows).filter(([, row]) => isInSpace(row)));
    view = {
      status: 'ready',
      groups: NotionTweaksGrouping.markArchived(
        NotionTweaksGrouping.groupNotifications(response, rules, movedRowsOfSpace),
        archivedIds,
      ),
      canLoadMore: response.notificationIds.length >= size,
      groupErrors: new Map(),
    };
    saveRows();
    chrome.storage.local.set({ spaceId }).catch(console.error);
    render();
    refreshSpaces();
  } catch (error) {
    chrome.storage.session.remove('lastList').catch(console.error);
    // A network error keeps the chosen workspace. Another error can mean another account or a removed workspace.
    if (!(error instanceof TypeError)) {
      await saveChosenSpace(undefined);
      await chrome.storage.local.remove('spaceId');
    }
    if (loadId === latestLoadId) {
      view = { status: 'error', message: (error as Error).message };
      render();
    }
  }
}

function refresh() {
  view = view.status === 'ready' ? { ...view, refreshing: true } : LOADING;
  render();
  load();
}

function reloadFromStart() {
  size = PAGE_SIZE;
  view = LOADING;
  render();
  load();
}

function showRowChange(changeGroups: (groups: Group[]) => Group[], groupName: string, error?: string) {
  if (view.status === 'ready') {
    view = {
      ...view,
      groups: changeGroups(view.groups),
      groupErrors: new Map(view.groupErrors).set(groupName, error),
    };
    render();
    saveRows();
  }
}

async function changeArchivedState(items: Row[], groupName: string, archive: boolean, write: () => Promise<unknown>) {
  const notificationIds = items.flatMap((item) => item.ids);
  const apply = (archived: boolean) =>
    notificationIds.forEach((id) => (archived ? archivedIds.add(id) : archivedIds.delete(id)));
  const showArchivedState = (error?: string) =>
    showRowChange((groups) => NotionTweaksGrouping.markArchived(groups, archivedIds), groupName, error);
  apply(archive);
  showArchivedState();
  try {
    await enqueueWrite(notificationIds, write);
    refreshUnreadCount(spaceId);
  } catch (error) {
    apply(!archive);
    showArchivedState((error as Error).message);
  }
}

const handlers: Handlers = {
  onReload() {
    spacesFetchedFor = undefined;
    refresh();
  },
  onLoadMore() {
    size += PAGE_SIZE;
    refresh();
  },
  onFilter(nextType) {
    inboxType = nextType;
    chrome.storage.local.set({ inboxType });
    reloadFromStart();
  },
  async onSpace(nextSpaceId) {
    await saveChosenSpace(nextSpaceId);
    countBaseline = undefined;
    reloadFromStart();
  },
  onArchive(items, groupName) {
    changeArchivedState(items, groupName, true, () =>
      NotionTweaksApi.archiveNotifications(
        spaceId,
        items.flatMap((item) => item.ids),
      ),
    );
  },
  onUnarchive(items, groupName) {
    countBaseline = undefined;
    changeArchivedState(items, groupName, false, () =>
      NotionTweaksApi.restoreNotifications(
        spaceId,
        items.flatMap((item) => item.ids),
        items.flatMap((item) => item.unreadIds),
      ),
    );
  },
  onMove(item, target) {
    showRowChange((groups) => NotionTweaksGrouping.moveRow(groups, item.pageKey, target, rules), target);
  },
  async onMoveDatabase(item, target) {
    // Chrome sync can bring rules from another browser, so the change starts from the stored rules.
    const { rulesText = '' } = await chrome.storage.sync.get<{ rulesText?: string }>('rulesText');
    const nextRulesText = NotionTweaksGrouping.setRule(rulesText, item.database!, target);
    rules = NotionTweaksGrouping.parseRules(nextRulesText);
    chrome.storage.sync.set({ rulesText: nextRulesText }).catch(console.error);
    showRowChange((groups) => NotionTweaksGrouping.regroup(groups, rules), target);
  },
  async onRead(item, groupName) {
    const { id, unreadIds } = item;
    if (!unreadIds.length) {
      return;
    }
    const showUnreadIds = (ids: string[], error?: string) =>
      showRowChange((groups) => NotionTweaksGrouping.withUnreadIds(groups, id, ids), groupName, error);
    showUnreadIds([]);
    try {
      await enqueueWrite(unreadIds, () => NotionTweaksApi.markNotificationsRead(spaceId, unreadIds));
      refreshUnreadCount(spaceId);
    } catch (error) {
      showUnreadIds(unreadIds, (error as Error).message);
    }
  },
  onOpen(item, groupName) {
    currentId = item.id;
    if (item.unreadIds.length) {
      handlers.onRead(item, groupName);
    } else {
      render();
    }
    NotionTweaksApi.openPage(item.path).catch(console.error);
  },
  async onReplyLater(item) {
    const reply = await NotionTweaksPanel.askReply(item.title);
    if (!reply || !item.discussionId) {
      return;
    }
    const entry: ScheduledComment = {
      id: crypto.randomUUID(),
      userId,
      spaceId,
      discussionId: item.discussionId,
      title: item.title,
      path: item.path,
      status: NotionTweaksSchedule.STATUS.PENDING,
      ...reply,
    };
    await NotionTweaksSchedule.saveSchedule(NotionTweaksSchedule.addEntry(await NotionTweaksSchedule.readSchedule(), entry));
    await chrome.alarms.create(NotionTweaksSchedule.alarmName(entry.id), { when: entry.sendAt });
  },
  // The worker is the only sender, so a comment never posts from two places.
  onSendNow(id) {
    chrome.runtime.sendMessage({ sendNow: id }).catch(console.error);
  },
  async onCancelComment(id) {
    await chrome.alarms.clear(NotionTweaksSchedule.alarmName(id));
    await NotionTweaksSchedule.saveSchedule(NotionTweaksSchedule.removeEntry(await NotionTweaksSchedule.readSchedule(), id));
  },
};

chrome.storage.session.onChanged.addListener(({ unreadCount: change }) => {
  if (change) {
    showUnreadCount(change.newValue as number | undefined);
  }
});
chrome.storage.local.onChanged.addListener(({ [NotionTweaksSchedule.SCHEDULE_KEY]: change }) => {
  if (change) {
    scheduled = (change.newValue as ScheduledComment[] | undefined) ?? [];
    render();
  }
});
document.documentElement.addEventListener('pointerleave', refreshIfStale);
document.addEventListener('focusout', () => setTimeout(refreshIfStale));

Promise.all([
  chrome.storage.local.get<{ inboxType?: InboxType; flaggedRows?: Record<string, Row> }>(['inboxType', 'flaggedRows']),
  chrome.storage.sync.get<{ rulesText?: string }>('rulesText'),
  NotionTweaksSchedule.readSchedule(),
  chrome.storage.session.get<{ lastList?: LastList; spaces?: SpacesOfUser; unreadCount?: number }>([
    'lastList',
    'spaces',
    'unreadCount',
  ]),
]).then(([stored, synced, storedSchedule, session]) => {
  scheduled = storedSchedule;
  inboxType = stored.inboxType ?? inboxType;
  movedRows = stored.flaggedRows ?? movedRows;
  rules = NotionTweaksGrouping.parseRules(synced.rulesText ?? '');
  unreadCount = session.unreadCount;
  countBaseline = unreadCount;
  spaces = session.spaces ?? spaces;
  spacesFetchedFor = spaces.userId;
  const cached = session.lastList;
  if (cached?.inboxType === inboxType) {
    ({ userId, spaceId, size } = cached);
    view = { status: 'ready', groups: cached.groups, canLoadMore: cached.canLoadMore, groupErrors: new Map() };
  }
  refresh();
});
