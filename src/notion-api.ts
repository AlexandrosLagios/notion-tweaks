import type { NotificationLog } from './grouping.ts';

const NOTION_ORIGIN = 'https://app.notion.com';
const ACTIVE_USER_COOKIE = 'notion_user_id';
const ANY_USER = 'any-user';
export const INBOX_TYPE = {
  ALL: 'unread_and_read',
  UNREAD: 'unread_only',
} as const;
export type InboxType = (typeof INBOX_TYPE)[keyof typeof INBOX_TYPE];

export interface Space {
  id: string;
  name: string;
}
const UNREAD_COUNT_REQUEST_SIZE = 20;
const IN_PLACE_TIMEOUT_MS = 5000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVER_ERROR = 500;
const MAX_BADGE_COUNT = 99;

export const pageUrl = (path: string) => `${NOTION_ORIGIN}${path}`;

class NotionApiError extends Error {
  constructor(endpoint: string, detail: string) {
    super(`Notion changed ${endpoint} (${detail}). Use the Notion inbox for now.`);
  }
}

class NotionDownError extends Error {
  constructor(endpoint: string, status: number) {
    super(`Notion did not answer ${endpoint} (HTTP ${status}). Try again in a minute.`);
  }
}

class SignedOutError extends Error {
  constructor() {
    super('Sign in to Notion.');
  }
}

async function post(
  endpoint: string,
  body: unknown,
  options?: RequestInit & { headers?: Record<string, string> },
): Promise<any> {
  const response = await fetch(`${NOTION_ORIGIN}/api/v3/${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(body),
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (response.status === HTTP_UNAUTHORIZED) {
    throw new SignedOutError();
  }
  if (response.status >= HTTP_SERVER_ERROR) {
    throw new NotionDownError(endpoint, response.status);
  }
  if (!response.ok) {
    const { message } = await response.json().catch(() => ({}));
    throw new NotionApiError(endpoint, message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`);
  }
  return response.json();
}

// Runs in the Notion tab, so the function can use no outside values.
function readCookie(name: string) {
  const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`));
  return entry && decodeURIComponent(entry.slice(name.length + 1));
}

export async function activeUserId(): Promise<string> {
  const [tab] = await chrome.tabs.query({ url: `${NOTION_ORIGIN}/*` });
  if (!tab) {
    return ANY_USER;
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      func: readCookie,
      args: [ACTIVE_USER_COOKIE],
    });
    return result ?? ANY_USER;
  } catch {
    return ANY_USER;
  }
}

export function spacesOf(spacesByUser: Record<string, any>, userId: string): Space[] {
  const user = spacesByUser[userId] ?? Object.values(spacesByUser)[0];
  return Object.entries(user?.space ?? {}).map(([id, entry]: [string, any]) => ({ id, name: entry.value?.value?.name ?? id }));
}

export async function listSpaces(userId: string) {
  const spaces = spacesOf(await post('getSpaces', {}), userId);
  if (!spaces.length) {
    throw new SignedOutError();
  }
  return spaces;
}

export async function loadNotifications(spaceId: string, size: number, type: InboxType): Promise<NotificationLog> {
  const response = await post('getNotificationLog', {
    spaceId,
    size,
    type,
    supportsConnectorInstallApprovedNotifications: true,
  });
  if (!Array.isArray(response.notificationIds) || !response.recordMap) {
    throw new NotionApiError('getNotificationLog', 'unexpected response');
  }
  return response;
}

async function loadUnreadCount(spaceId: string): Promise<number> {
  const { results } = await post('getUserNotificationsInitial', { spaceId, size: UNREAD_COUNT_REQUEST_SIZE });
  // ponytail: only `mentions` moved in the probe, for all four notification types; add the other counts if the badge falls short.
  return results[0].unread.mentions;
}

const badgeText = (count: number) => (count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count || ''));

// Sets the toolbar badge, and passes the count to an open panel through chrome.storage.session.
export async function updateUnreadCount(spaceId: string) {
  try {
    const count = await loadUnreadCount(spaceId);
    await Promise.all([
      chrome.action.setBadgeText({ text: badgeText(count) }),
      chrome.storage.session.set({ unreadCount: count }),
    ]);
  } catch (error) {
    chrome.action.setBadgeText({ text: '' });
    chrome.storage.session.remove('unreadCount');
    throw error;
  }
}

function updateNotifications(spaceId: string, changes: { id: string; args: Record<string, unknown> }[]) {
  return post(
    'saveTransactionsMain',
    {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: changes.map(({ id, args }) => ({
            pointer: { table: 'notification', id, spaceId },
            path: [],
            args,
            command: 'update',
          })),
        },
      ],
    },
    // A write takes about 1.6 s, and the side panel can close first.
    // ponytail: keepalive caps the body at 64 KB, about 380 rows; split the request if a group gets that large.
    { keepalive: true },
  );
}

export function archiveNotifications(spaceId: string, notificationIds: string[]) {
  const args = { archived_at: Date.now(), read: true, visited: true };
  return updateNotifications(spaceId, notificationIds.map((id) => ({ id, args })));
}

export function restoreNotifications(spaceId: string, notificationIds: string[], unreadIds: string[]) {
  return updateNotifications(
    spaceId,
    notificationIds.map((id) => ({
      id,
      args: { archived_at: null, visited: false, read: !unreadIds.includes(id) },
    })),
  );
}

export function markNotificationsRead(spaceId: string, notificationIds: string[]) {
  return updateNotifications(spaceId, notificationIds.map((id) => ({ id, args: { read: true } })));
}

// A reply goes into a discussion. A new comment starts a discussion on a block, and quotes the selected text, if any.
// The seen record of the user in a discussion also holds the follow state. Its id is random, so only a Notion page knows it.
// The panel shows the text. A comment from a Notion comment box also keeps the rich text, with its mentions, links, and formatting.
export type RichText = [string, unknown[]?][];
export type Comment = { userId: string; spaceId: string; text: string; richText?: RichText } & (
  | { discussionId: string; seenRecordId?: string }
  | { blockId: string; quote?: string }
);

interface Operation {
  pointer: { table: string; id: string; spaceId: string };
  path: string[];
  command: string;
  args: unknown;
}

interface Ids {
  requestId: string;
  transactionId: string;
  discussionId: string;
  seenRecordId: string;
  commentId: string;
  now: number;
}

const newIds = (): Ids => ({
  requestId: crypto.randomUUID(),
  transactionId: crypto.randomUUID(),
  discussionId: crypto.randomUUID(),
  seenRecordId: crypto.randomUUID(),
  commentId: crypto.randomUUID(),
  now: Date.now(),
});

// The same operations as the Notion web client. A reply without the seen record id leaves out the follow update,
// and Notion refuses such a reply in a thread that the user does not follow.
// ponytail: a quoted comment has no highlight in the block text, because Notion writes the highlight as a CRDT operation.
export function postComment(target: Comment, ids = newIds()) {
  const { userId, spaceId, text } = target;
  const { requestId, transactionId, commentId, now } = ids;
  const isReply = 'discussionId' in target;
  const discussionId = isReply ? target.discussionId : ids.discussionId;
  const discussion = { table: 'discussion', id: discussionId, spaceId };
  const comment = { table: 'comment', id: commentId, spaceId };
  const createdBy = { created_by_id: userId, created_by_table: 'notion_user' };
  const seenRecordId = isReply ? target.seenRecordId : ids.seenRecordId;
  const seen = { table: 'user_seen_record', id: seenRecordId!, spaceId };
  const seenRecord = { user_id: userId, space_id: spaceId, parent_id: discussionId, parent_table: 'discussion' };
  const operations: Operation[] = [
    {
      pointer: comment,
      path: [],
      command: 'set',
      args: {
        id: commentId,
        parent_id: discussionId,
        parent_table: 'discussion',
        alive: true,
        space_id: spaceId,
        created_time: now,
        last_edited_time: now,
        version: 1,
      },
    },
    { pointer: discussion, path: ['comments'], command: 'listAfter', args: { id: commentId } },
    { pointer: comment, path: ['text'], command: 'set', args: target.richText ?? [[text]] },
    ...(seenRecordId
      ? [
          { pointer: seen, path: [], command: 'update', args: { ...seenRecord, last_seen_at: now } },
          { pointer: seen, path: [], command: 'update', args: { ...seenRecord, subscription_state: 'subscribed' } },
        ]
      : []),
  ];
  if (isReply) {
    operations.push({ pointer: comment, path: [], command: 'update', args: { ...createdBy, last_edited_time: now } });
  } else {
    operations.unshift({
      pointer: discussion,
      path: [],
      command: 'update',
      args: {
        type: 'default',
        parent_id: target.blockId,
        parent_table: 'block',
        resolved: false,
        ...(target.quote && { context: [[target.quote, [['m', discussionId]]]] }),
        space_id: spaceId,
      },
    });
    operations.push(
      { pointer: { table: 'block', id: target.blockId, spaceId }, path: ['discussions'], command: 'listAfter', args: { id: discussionId } },
      { pointer: comment, path: [], command: 'update', args: createdBy },
    );
  }
  return post(
    'saveTransactionsFanout',
    { requestId, transactions: [{ id: transactionId, spaceId, operations }] },
    {
      headers: {
        'x-notion-space-id': spaceId,
        ...(userId === ANY_USER ? {} : { 'x-notion-active-user-header': userId }),
      },
    },
  );
}

// Runs in the main world of the Notion tab, so the function can use no outside values.
function navigateInPlace(url: string, timeoutMs: number) {
  const target = new URL(url);
  const isSamePage = location.pathname.endsWith(target.pathname.split('/').pop()!);
  const titleBefore = document.title;
  history.pushState(null, '', url);
  dispatchEvent(new PopStateEvent('popstate', { state: null }));
  if (!isSamePage) {
    setTimeout(() => {
      if (location.href === url && document.title === titleBefore) {
        location.assign(url);
      }
    }, timeoutMs);
  }
}

export async function openPage(path: string) {
  const url = pageUrl(path);
  const tabs = await chrome.tabs.query({ url: `${NOTION_ORIGIN}/*`, currentWindow: true });
  const tab = tabs.find((candidate) => candidate.active) ?? tabs[0];
  if (!tab) {
    await chrome.tabs.create({ url });
    return;
  }
  await chrome.tabs.update(tab.id, { active: true });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id! },
      world: 'MAIN',
      func: navigateInPlace,
      args: [url, IN_PLACE_TIMEOUT_MS],
    });
  } catch {
    await chrome.tabs.update(tab.id, { url });
  }
}
