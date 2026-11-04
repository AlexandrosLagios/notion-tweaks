const NotionTweaksApi = (() => {
  const NOTION_ORIGIN = 'https://app.notion.com';
  const ACTIVE_USER_COOKIE = 'notion_user_id';
  const ANY_USER = 'any-user';
  const INBOX_TYPE = {
    ALL: 'unread_and_read',
    UNREAD: 'unread_only',
  };
  const UNREAD_COUNT_REQUEST_SIZE = 20;
  const IN_PLACE_TIMEOUT_MS = 5000;
  const HTTP_UNAUTHORIZED = 401;

  const pageUrl = (path) => `${NOTION_ORIGIN}${path}`;

  class NotionApiError extends Error {
    constructor(endpoint, detail) {
      super(`Notion changed ${endpoint} (${detail}). Use the Notion inbox for now.`);
    }
  }

  class SignedOutError extends Error {
    constructor() {
      super('Sign in to Notion.');
    }
  }

  async function post(endpoint, body, options) {
    const response = await fetch(`${NOTION_ORIGIN}/api/v3/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...options,
    });
    if (response.status === HTTP_UNAUTHORIZED) {
      throw new SignedOutError();
    }
    if (!response.ok) {
      throw new NotionApiError(endpoint, `HTTP ${response.status}`);
    }
    return response.json();
  }

  // Runs in the Notion tab, so the function can use no outside values.
  function readCookie(name) {
    const entry = document.cookie.split('; ').find((cookie) => cookie.startsWith(`${name}=`));
    return entry && decodeURIComponent(entry.slice(name.length + 1));
  }

  async function activeUserId() {
    const [tab] = await chrome.tabs.query({ url: `${NOTION_ORIGIN}/*` });
    if (!tab) {
      return ANY_USER;
    }
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readCookie,
        args: [ACTIVE_USER_COOKIE],
      });
      return result ?? ANY_USER;
    } catch {
      return ANY_USER;
    }
  }

  async function findSpaceId(userId) {
    const spacesByUser = await post('getSpaces', {});
    const user = spacesByUser[userId] ?? Object.values(spacesByUser)[0];
    // ponytail: first space of the active user; add a space picker when an account has several.
    const [spaceId] = Object.keys(user?.space ?? {});
    if (!spaceId) {
      throw new SignedOutError();
    }
    return spaceId;
  }

  async function loadNotifications(spaceId, size, type) {
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

  async function loadUnreadCount(spaceId) {
    const { results } = await post('getUserNotificationsInitial', { spaceId, size: UNREAD_COUNT_REQUEST_SIZE });
    // ponytail: only `mentions` moved in the probe, for all four notification types; add the other counts if the badge falls short.
    return results[0].unread.mentions;
  }

  function updateNotifications(spaceId, changes) {
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

  function archiveNotifications(spaceId, notificationIds) {
    const args = { archived_at: Date.now(), read: true, visited: true };
    return updateNotifications(spaceId, notificationIds.map((id) => ({ id, args })));
  }

  function restoreNotifications(spaceId, notificationIds, unreadIds) {
    return updateNotifications(
      spaceId,
      notificationIds.map((id) => ({
        id,
        args: { archived_at: null, visited: false, read: !unreadIds.includes(id) },
      })),
    );
  }

  function markNotificationsRead(spaceId, notificationIds) {
    return updateNotifications(spaceId, notificationIds.map((id) => ({ id, args: { read: true } })));
  }

  // Runs in the main world of the Notion tab, so the function can use no outside values.
  function navigateInPlace(url, timeoutMs) {
    const target = new URL(url);
    const isSamePage = location.pathname.endsWith(target.pathname.split('/').pop());
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

  async function openPage(path) {
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
        target: { tabId: tab.id },
        world: 'MAIN',
        func: navigateInPlace,
        args: [url, IN_PLACE_TIMEOUT_MS],
      });
    } catch {
      await chrome.tabs.update(tab.id, { url });
    }
  }

  return {
    INBOX_TYPE,
    pageUrl,
    activeUserId,
    findSpaceId,
    loadNotifications,
    loadUnreadCount,
    archiveNotifications,
    restoreNotifications,
    markNotificationsRead,
    openPage,
  };
})();
