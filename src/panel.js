const NotionTweaksPanel = (() => {
  const CONFIRM_MS = 3000;
  const MIDDLE_BUTTON = 1;
  const MINUTE_MS = 60_000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const FILTER_OPTIONS = [
    { value: NotionTweaksApi.INBOX_TYPE.ALL, label: 'All' },
    { value: NotionTweaksApi.INBOX_TYPE.UNREAD, label: 'Unread' },
  ];
  const collapsedGroups = new Set();
  const root = document.getElementById('root');
  const newGroupDialog = document.getElementById('new-group');

  function el(tag, props = {}, ...children) {
    const element = Object.assign(document.createElement(tag), props);
    element.append(...children);
    return element;
  }

  function age(endTime) {
    const elapsed = Date.now() - endTime;
    if (elapsed < HOUR_MS) {
      return `${Math.max(1, Math.round(elapsed / MINUTE_MS))}m`;
    }
    if (elapsed < DAY_MS) {
      return `${Math.round(elapsed / HOUR_MS)}h`;
    }
    if (elapsed < 7 * DAY_MS) {
      return `${Math.round(elapsed / DAY_MS)}d`;
    }
    return new Date(endTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function actorText(actors) {
    if (actors.length <= 2) {
      return actors.join(', ');
    }
    return `${actors.slice(0, 2).join(', ')} +${actors.length - 2}`;
  }

  function sentence(item) {
    return [actorText(item.actors), item.verbs.join(', ')].filter(Boolean).join(' ');
  }

  // After the first click of a double click, the row under the pointer can change, so the second click does nothing.
  const isRepeatClick = (event) => event.detail > 1;

  function rowAction(item, groupName, { onArchive, onUnarchive }) {
    const button = el('button', { textContent: item.archived ? 'Undo' : 'Archive' });
    button.addEventListener('click', (event) => {
      if (isRepeatClick(event)) {
        return;
      }
      if (item.archived) {
        onUnarchive([item], groupName);
      } else {
        onArchive([item], groupName);
      }
    });
    return button;
  }

  function flagAction(item, groupName, { onMove }) {
    const isFlagged = groupName === NotionTweaksGrouping.ACTION_NEEDED_GROUP;
    const button = el('button', { textContent: isFlagged ? 'No action' : 'Action' });
    button.addEventListener('click', (event) => {
      if (!isRepeatClick(event)) {
        onMove(item, isFlagged ? item.homeGroup : NotionTweaksGrouping.ACTION_NEEDED_GROUP);
      }
    });
    return button;
  }

  function askGroupName() {
    const input = newGroupDialog.querySelector('input');
    input.value = '';
    newGroupDialog.returnValue = '';
    newGroupDialog.showModal();
    return new Promise((resolve) => {
      newGroupDialog.addEventListener('close', () => resolve(newGroupDialog.returnValue && input.value.trim()), {
        once: true,
      });
    });
  }

  // ponytail: one select per row; fill the options on focus if a long list renders slowly.
  function moveAction(item, groupName, groups, { onMove }) {
    const newGroup = el('option', { textContent: 'New group…' });
    const select = el(
      'select',
      { ariaLabel: 'Move to a group' },
      el('option', { value: '', textContent: 'Move', hidden: true }),
      ...NotionTweaksGrouping.moveTargets(groups, item, groupName).map((name) =>
        el('option', { value: name, textContent: name }),
      ),
      newGroup,
    );
    select.addEventListener('change', async () => {
      const target = newGroup.selected ? await askGroupName() : select.value;
      select.value = '';
      if (target) {
        onMove(item, target);
      }
    });
    return select;
  }

  function rowLink(item, groupName, { onOpen, onRead }) {
    const link = el('a', {
      href: NotionTweaksApi.pageUrl(item.path),
      target: '_blank',
      textContent: item.title,
    });
    link.addEventListener('click', (event) => {
      if (isRepeatClick(event)) {
        event.preventDefault();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) {
        onRead(item, groupName);
        return;
      }
      event.preventDefault();
      onOpen(item, groupName);
    });
    link.addEventListener('auxclick', (event) => {
      if (event.button === MIDDLE_BUTTON) {
        onRead(item, groupName);
      }
    });
    return link;
  }

  function groupAction(group, { onArchive, onUnarchive }) {
    const button = el('button', { textContent: group.activeCount ? 'Archive' : 'Undo' });
    let confirmTimer;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isRepeatClick(event)) {
        return;
      }
      if (!group.activeCount) {
        onUnarchive(group.items, group.name);
        return;
      }
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        onArchive(
          group.items.filter((item) => !item.archived),
          group.name,
        );
        return;
      }
      button.textContent = `Archive ${group.activeCount}?`;
      confirmTimer = setTimeout(() => {
        confirmTimer = undefined;
        button.textContent = 'Archive';
      }, CONFIRM_MS);
    });
    return button;
  }

  function rowClass(item, currentId) {
    const state = item.archived ? 'archived' : item.unreadIds.length ? 'unread' : '';
    return `${state} ${item.id === currentId ? 'current' : ''}`.trim();
  }

  function row(item, groupName, view, handlers) {
    const preview = item.preview ? [el('p', { className: 'preview', textContent: item.preview })] : [];
    return el(
      'li',
      { className: rowClass(item, view.currentId) },
      el(
        'div',
        { className: 'row' },
        rowLink(item, groupName, handlers),
        el('span', { className: 'age', textContent: age(item.endTime) }),
        el(
          'div',
          { className: 'row-actions' },
          rowAction(item, groupName, handlers),
          ...(item.archived
            ? []
            : [flagAction(item, groupName, handlers), moveAction(item, groupName, view.groups, handlers)]),
        ),
      ),
      el('small', { textContent: sentence(item) }),
      ...preview,
    );
  }

  function groupSection(group, view, handlers) {
    const details = el(
      'details',
      {
        open: !collapsedGroups.has(group.name),
        className: group.name === NotionTweaksGrouping.ACTION_NEEDED_GROUP ? 'action-needed' : '',
      },
      el(
        'summary',
        {},
        el('span', { textContent: group.name }),
        el('span', {
          className: 'count',
          textContent: group.activeCount ? `${group.unread} unread, ${group.activeCount}` : 'Archived',
        }),
        groupAction(group, handlers),
      ),
    );
    details.addEventListener('toggle', () => {
      if (details.open) {
        collapsedGroups.delete(group.name);
      } else {
        collapsedGroups.add(group.name);
      }
    });
    const error = view.groupErrors.get(group.name);
    if (error) {
      details.append(el('p', { className: 'error', textContent: error }));
    }
    details.append(el('ul', {}, ...group.items.map((item) => row(item, group.name, view, handlers))));
    return details;
  }

  function body(view, handlers) {
    if (view.status === 'loading') {
      return [el('p', { textContent: 'Loading…' })];
    }
    if (view.status === 'error') {
      return [el('p', { className: 'error', textContent: view.message })];
    }
    const sections = view.groups.map((group) => groupSection(group, view, handlers));
    if (view.canLoadMore) {
      const loadMore = el('button', { textContent: 'Load more' });
      loadMore.addEventListener('click', handlers.onLoadMore);
      sections.push(loadMore);
    }
    return sections.length ? sections : [el('p', { textContent: 'No notifications.' })];
  }

  function filterSelect(inboxType, onFilter) {
    const select = el(
      'select',
      { ariaLabel: 'Status' },
      ...FILTER_OPTIONS.map(({ value, label }) => el('option', { value, textContent: label })),
    );
    select.value = inboxType;
    select.addEventListener('change', () => onFilter(select.value));
    return select;
  }

  function render(view, handlers) {
    const reload = el('button', { textContent: 'Reload' });
    reload.addEventListener('click', handlers.onReload);
    const scrollTop = root.querySelector('.panel')?.scrollTop ?? 0;
    const panel = el(
      'div',
      { className: 'panel' },
      el(
        'header',
        {},
        el(
          'strong',
          {},
          view.refreshing ? 'Updating…' : 'Inbox',
          el('span', {
            className: 'badge',
            title: 'Unread notifications',
            textContent: view.unreadCount,
            hidden: !view.unreadCount,
          }),
        ),
        filterSelect(view.inboxType, handlers.onFilter),
        reload,
      ),
      ...body(view, handlers),
    );
    root.replaceChildren(panel);
    panel.scrollTop = scrollTop;
  }

  // Updates only the badge: a full render during a click would replace the button under the pointer and lose the click.
  function showUnreadCount(count) {
    const badge = root.querySelector('.badge');
    if (badge) {
      badge.textContent = count;
      badge.hidden = !count;
    }
  }

  return { render, showUnreadCount };
})();
