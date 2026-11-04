(() => {
  const PAGE_SIZE = 100;
  const LOADING = { status: 'loading' };
  const COUNT_REFRESH_MS = 60_000;
  const archivedIds = new Set();
  const pendingWrites = new Map();

  let spaceId;
  let latestLoadId = 0;
  let size = PAGE_SIZE;
  let view = LOADING;
  let inboxType = NotionTweaksApi.INBOX_TYPE.ALL;
  let unreadCount;
  let currentId;

  const render = () => NotionTweaksPanel.render({ ...view, inboxType, unreadCount, currentId }, handlers);

  // A write waits only for earlier writes of the same notifications, so an undo cannot overtake its archive.
  function enqueueWrite(notificationIds, write) {
    const earlierWrites = notificationIds.map((id) => pendingWrites.get(id));
    const result = Promise.allSettled(earlierWrites).then(write);
    notificationIds.forEach((id) => pendingWrites.set(id, result));
    return result;
  }

  function refreshUnreadCount(forSpaceId) {
    NotionTweaksApi.loadUnreadCount(forSpaceId)
      .then((count) => {
        unreadCount = count;
        NotionTweaksPanel.showUnreadCount(count);
      })
      .catch(console.error);
  }

  async function cachedSpaceId() {
    const userId = await NotionTweaksApi.activeUserId();
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

  function showRowChange(changeGroups, groupName, error) {
    if (view.status !== 'ready') {
      return;
    }
    view = {
      ...view,
      groups: changeGroups(view.groups),
      groupErrors: { ...view.groupErrors, [groupName]: error },
    };
    render();
  }

  async function changeArchivedState(notificationIds, groupName, archive, write) {
    const apply = (archived) =>
      notificationIds.forEach((id) => (archived ? archivedIds.add(id) : archivedIds.delete(id)));
    const showArchivedState = (error) =>
      showRowChange((groups) => NotionTweaksGrouping.markArchived(groups, archivedIds), groupName, error);
    apply(archive);
    showArchivedState();
    try {
      await enqueueWrite(notificationIds, write);
      refreshUnreadCount(spaceId);
    } catch (error) {
      apply(!archive);
      showArchivedState(error.message);
    }
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
      render();
      load();
    },
    onArchive(notificationIds, groupName) {
      changeArchivedState(notificationIds, groupName, true, () =>
        NotionTweaksApi.archiveNotifications(spaceId, notificationIds),
      );
    },
    onUnarchive(items, groupName) {
      const notificationIds = items.flatMap((item) => item.ids);
      const unreadIds = items.flatMap((item) => item.unreadIds);
      changeArchivedState(notificationIds, groupName, false, () =>
        NotionTweaksApi.restoreNotifications(spaceId, notificationIds, unreadIds),
      );
    },
    async onRead(item, groupName) {
      const { id, unreadIds } = item;
      if (!unreadIds.length) {
        return;
      }
      const showUnreadIds = (ids, error) =>
        showRowChange((groups) => NotionTweaksGrouping.withUnreadIds(groups, id, ids), groupName, error);
      showUnreadIds([]);
      try {
        await enqueueWrite(unreadIds, () => NotionTweaksApi.markNotificationsRead(spaceId, unreadIds));
        refreshUnreadCount(spaceId);
      } catch (error) {
        showUnreadIds(unreadIds, error.message);
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
  };

  chrome.storage.local.get('inboxType').then((stored) => {
    inboxType = stored.inboxType ?? inboxType;
    refresh();
  });

  setInterval(() => {
    if (spaceId) {
      refreshUnreadCount(spaceId);
    }
  }, COUNT_REFRESH_MS);
})();
