const NotionTweaksApi = (() => {
  const ACTIVE_USER_COOKIE = 'notion_user_id';
  const INBOX_TYPE = {
    ALL: 'unread_and_read',
    UNREAD: 'unread_only',
  };
  const UNREAD_COUNT_REQUEST_SIZE = 20;

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
    const response = await fetch(`${location.origin}/api/v3/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...options,
    });
    if (!response.ok) {
      throw new NotionApiError(endpoint, `HTTP ${response.status}`);
    }
    return response.json();
  }

  function activeUserId() {
    const cookie = document.cookie.split('; ').find((entry) => entry.startsWith(`${ACTIVE_USER_COOKIE}=`));
    return cookie && decodeURIComponent(cookie.slice(ACTIVE_USER_COOKIE.length + 1));
  }

  async function findSpaceId(userId) {
    if (!userId) {
      throw new SignedOutError();
    }
    const spacesByUser = await post('getSpaces', {});
    // ponytail: first space of the active user; add a space picker when an account has several.
    const [spaceId] = Object.keys(spacesByUser[userId]?.space ?? {});
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

  function updateNotifications(spaceId, notificationIds, args) {
    return post(
      'saveTransactionsMain',
      {
        requestId: crypto.randomUUID(),
        transactions: [
          {
            id: crypto.randomUUID(),
            spaceId,
            operations: notificationIds.map((id) => ({
              pointer: { table: 'notification', id, spaceId },
              path: [],
              args,
              command: 'update',
            })),
          },
        ],
      },
      // A write takes about 1.6 s, and a click on a row can leave the page first.
      // ponytail: keepalive caps the body at 64 KB, about 380 rows; split the request if a group gets that large.
      { keepalive: true },
    );
  }

  function archiveNotifications(spaceId, notificationIds) {
    return updateNotifications(spaceId, notificationIds, { archived_at: Date.now(), read: true, visited: true });
  }

  function markNotificationRead(spaceId, notificationId) {
    return updateNotifications(spaceId, [notificationId], { read: true });
  }

  return {
    INBOX_TYPE,
    activeUserId,
    findSpaceId,
    loadNotifications,
    loadUnreadCount,
    archiveNotifications,
    markNotificationRead,
  };
})();
