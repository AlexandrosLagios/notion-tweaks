(() => {
  const TOGGLE_PANEL = 'toggle-panel';
  const PAGE_SIZE = 100;
  const LOADING = { status: 'loading' };

  let spaceId;
  let latestLoadId = 0;
  let size = PAGE_SIZE;
  let view = LOADING;

  const render = () => NotionTweaksPanel.render(view, handlers);

  async function load() {
    const loadId = ++latestLoadId;
    try {
      const { rulesText = '' } = await chrome.storage.sync.get('rulesText');
      spaceId = await NotionTweaksApi.findSpaceId();
      const response = await NotionTweaksApi.loadNotifications(spaceId, size);
      if (loadId !== latestLoadId) {
        return;
      }
      view = {
        status: 'ready',
        groups: NotionTweaksGrouping.groupNotifications(response, NotionTweaksGrouping.parseRules(rulesText).rules),
        canLoadMore: response.notificationIds.length >= size,
        groupErrors: {},
      };
    } catch (error) {
      if (loadId !== latestLoadId) {
        return;
      }
      view = { status: 'error', message: error.message };
    }
    render();
  }

  const handlers = {
    onReload() {
      view = LOADING;
      render();
      load();
    },
    onLoadMore() {
      size += PAGE_SIZE;
      load();
    },
    async onArchive(group) {
      try {
        await NotionTweaksApi.archiveNotifications(
          spaceId,
          group.items.map((item) => item.id),
        );
        await load();
      } catch (error) {
        view = { ...view, groupErrors: { ...view.groupErrors, [group.name]: error.message } };
        render();
      }
    },
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message !== TOGGLE_PANEL) {
      return;
    }
    if (NotionTweaksPanel.isOpen()) {
      NotionTweaksPanel.close();
      return;
    }
    size = PAGE_SIZE;
    view = LOADING;
    NotionTweaksPanel.open();
    render();
    load();
  });
})();
