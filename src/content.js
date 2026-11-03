(() => {
  const TOGGLE_PANEL = 'toggle-panel';
  const PAGE_SIZE = 100;
  const LOADING = { status: 'loading' };
  const archivedIds = new Set();

  let spaceId;
  let latestLoadId = 0;
  let size = PAGE_SIZE;
  let view = LOADING;
  let inboxType = NotionTweaksApi.INBOX_TYPE.ALL;
  let unreadCount;

  const render = () => NotionTweaksPanel.render({ ...view, inboxType, unreadCount }, handlers);

  function refreshUnreadCount(forSpaceId) {
    NotionTweaksApi.loadUnreadCount(forSpaceId)
      .then((count) => {
        unreadCount = count;
        NotionTweaksPanel.showUnreadCount(count);
      })
      .catch(console.error);
  }

  async function cachedSpaceId() {
    const userId = NotionTweaksApi.activeUserId();
    const { spaceIds = {} } = await chrome.storage.local.get('spaceIds');
    if (!spaceIds[userId]) {
      spaceIds[userId] = await NotionTweaksApi.findSpaceId(userId);
      await chrome.storage.local.set({ spaceIds });
    }
    return spaceIds[userId];
  }

  async function load() {
    const loadId = ++latestLoadId;
    try {
      const [{ rulesText = '' }, currentSpaceId] = await Promise.all([
        chrome.storage.sync.get('rulesText'),
        cachedSpaceId(),
      ]);
      refreshUnreadCount(currentSpaceId);
      const response = await NotionTweaksApi.loadNotifications(currentSpaceId, size, inboxType);
      if (loadId !== latestLoadId) {
        return;
      }
      spaceId = currentSpaceId;
      view = {
        status: 'ready',
        groups: NotionTweaksGrouping.markArchived(
          NotionTweaksGrouping.groupNotifications(response, NotionTweaksGrouping.parseRules(rulesText).rules),
          archivedIds,
        ),
        canLoadMore: response.notificationIds.length >= size,
        groupErrors: {},
      };
    } catch (error) {
      await chrome.storage.local.remove('spaceIds');
      if (loadId !== latestLoadId) {
        return;
      }
      view = { status: 'error', message: error.message };
    }
    render();
  }

  function refresh() {
    view = view.status === 'ready' ? { ...view, refreshing: true } : LOADING;
    render();
    load();
  }

  const handlers = {
    onReload: refresh,
    onLoadMore() {
      size += PAGE_SIZE;
      refresh();
    },
    onFilter(nextType) {
      inboxType = nextType;
      chrome.storage.local.set({ inboxType });
      size = PAGE_SIZE;
      view = LOADING;
      refresh();
    },
    async onArchive(notificationIds, groupName) {
      notificationIds.forEach((id) => archivedIds.add(id));
      view = {
        ...view,
        groups: NotionTweaksGrouping.markArchived(view.groups, archivedIds),
        groupErrors: { ...view.groupErrors, [groupName]: undefined },
      };
      render();
      try {
        await NotionTweaksApi.archiveNotifications(spaceId, notificationIds);
        refreshUnreadCount(spaceId);
      } catch (error) {
        notificationIds.forEach((id) => archivedIds.delete(id));
        view = {
          ...view,
          groups: NotionTweaksGrouping.markArchived(view.groups, archivedIds),
          groupErrors: { ...view.groupErrors, [groupName]: error.message },
        };
        render();
      }
    },
    onOpen(item) {
      if (!item.unread) {
        return;
      }
      view = { ...view, groups: NotionTweaksGrouping.markRead(view.groups, item.id) };
      render();
      NotionTweaksApi.markNotificationRead(spaceId, item.id)
        .then(() => refreshUnreadCount(spaceId))
        .catch(console.error);
    },
  };

  async function openPanel() {
    size = PAGE_SIZE;
    NotionTweaksPanel.open();
    const stored = await chrome.storage.local.get('inboxType');
    inboxType = stored.inboxType ?? inboxType;
    refresh();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message !== TOGGLE_PANEL) {
      return;
    }
    sendResponse(true);
    if (NotionTweaksPanel.isOpen()) {
      NotionTweaksPanel.close();
      return;
    }
    openPanel();
  });
})();
