const NotionTweaksApi = (() => {
  const ACTIVE_USER_COOKIE = 'notion_user_id';
  const INBOX_TYPE = 'unread_and_read';

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

  async function post(endpoint, body) {
    const response = await fetch(`${location.origin}/api/v3/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  async function loadNotifications(spaceId, size) {
    const response = await post('getNotificationLog', {
      spaceId,
      size,
      type: INBOX_TYPE,
      supportsConnectorInstallApprovedNotifications: true,
    });
    if (!Array.isArray(response.notificationIds) || !response.recordMap) {
      throw new NotionApiError('getNotificationLog', 'unexpected response');
    }
    return response;
  }

  async function archiveNotifications(spaceId, notificationIds) {
    const archivedAt = Date.now();
    await post('saveTransactionsMain', {
      requestId: crypto.randomUUID(),
      transactions: [
        {
          id: crypto.randomUUID(),
          spaceId,
          operations: notificationIds.map((id) => ({
            pointer: { table: 'notification', id, spaceId },
            path: [],
            args: { archived_at: archivedAt, read: true, visited: true },
            command: 'update',
          })),
        },
      ],
    });
  }

  return { activeUserId, findSpaceId, loadNotifications, archiveNotifications };
})();
