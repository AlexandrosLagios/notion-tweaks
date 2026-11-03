const NotionTweaksPanel = (() => {
  const HOST_ID = 'notion-tweaks-panel';
  const CONFIRM_MS = 3000;
  const MINUTE_MS = 60_000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  const collapsedGroups = new Set();

  const STYLE = `
    :host { all: initial; }
    .panel {
      position: fixed; top: 0; right: 0; z-index: 2147483000;
      box-sizing: border-box; width: 380px; height: 100vh; overflow-y: auto; padding: 12px 14px;
      font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color-scheme: light dark; background: Canvas; color: CanvasText;
      border-left: 1px solid color-mix(in srgb, CanvasText 15%, transparent);
      box-shadow: -4px 0 16px rgb(0 0 0 / 0.2);
    }
    header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    header strong { flex: 1; font-size: 15px; }
    summary { display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer; font-weight: 600; }
    summary::before { content: '▸'; opacity: 0.6; }
    details[open] > summary::before { content: '▾'; }
    .count { flex: 1; font-size: 12px; font-weight: 400; opacity: 0.6; }
    ul { list-style: none; margin: 0 0 8px; padding: 0; }
    li { position: relative; padding: 6px 0 6px 14px; border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); }
    li.unread::before { content: ''; position: absolute; left: 2px; top: 13px; width: 6px; height: 6px; border-radius: 50%; background: #2383e2; }
    a { color: inherit; text-decoration: none; }
    a:hover { text-decoration: underline; }
    small { display: block; font-size: 12px; opacity: 0.6; }
    button {
      font: inherit; font-size: 12px; padding: 2px 8px; cursor: pointer;
      color: inherit; background: transparent; border-radius: 4px;
      border: 1px solid color-mix(in srgb, CanvasText 20%, transparent);
    }
    .error { color: #e03e3e; }
  `;

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

  function archiveButton(group, onArchive) {
    const button = el('button', { textContent: 'Archive' });
    let confirmTimer;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (confirmTimer) {
        clearTimeout(confirmTimer);
        button.disabled = true;
        button.textContent = 'Archiving…';
        onArchive(group);
        return;
      }
      button.textContent = `Archive ${group.items.length}?`;
      confirmTimer = setTimeout(() => {
        confirmTimer = undefined;
        button.textContent = 'Archive';
      }, CONFIRM_MS);
    });
    return button;
  }

  function groupSection(group, error, onArchive) {
    const details = el(
      'details',
      { open: !collapsedGroups.has(group.name) },
      el(
        'summary',
        {},
        el('span', { textContent: group.name }),
        el('span', { className: 'count', textContent: `${group.unread} unread · ${group.items.length}` }),
        archiveButton(group, onArchive),
      ),
    );
    details.addEventListener('toggle', () => {
      if (details.open) {
        collapsedGroups.delete(group.name);
      } else {
        collapsedGroups.add(group.name);
      }
    });
    if (error) {
      details.append(el('p', { className: 'error', textContent: error }));
    }
    details.append(
      el(
        'ul',
        {},
        ...group.items.map((item) =>
          el(
            'li',
            { className: item.unread ? 'unread' : '' },
            el('a', { href: `${location.origin}/p/${item.pageId}`, textContent: item.title }),
            el('small', { textContent: `${item.type} · ${age(item.endTime)}` }),
          ),
        ),
      ),
    );
    return details;
  }

  function body(view, handlers) {
    if (view.status === 'loading') {
      return [el('p', { textContent: 'Loading…' })];
    }
    if (view.status === 'error') {
      return [el('p', { className: 'error', textContent: view.message })];
    }
    const sections = view.groups.map((group) => groupSection(group, view.groupErrors[group.name], handlers.onArchive));
    if (view.canLoadMore) {
      const loadMore = el('button', { textContent: 'Load more' });
      loadMore.addEventListener('click', handlers.onLoadMore);
      sections.push(loadMore);
    }
    return sections.length ? sections : [el('p', { textContent: 'The inbox is empty.' })];
  }

  function shadowRoot() {
    return document.getElementById(HOST_ID)?.shadowRoot;
  }

  function open() {
    if (!shadowRoot()) {
      const host = el('div', { id: HOST_ID });
      host.attachShadow({ mode: 'open' });
      document.body.append(host);
    }
  }

  function close() {
    document.getElementById(HOST_ID)?.remove();
  }

  function render(view, handlers) {
    const root = shadowRoot();
    if (!root) {
      return;
    }
    const reload = el('button', { textContent: 'Reload' });
    reload.addEventListener('click', handlers.onReload);
    const closeButton = el('button', { textContent: 'Close' });
    closeButton.addEventListener('click', close);
    root.replaceChildren(
      el('style', { textContent: STYLE }),
      el(
        'div',
        { className: 'panel' },
        el('header', {}, el('strong', { textContent: 'Inbox groups' }), reload, closeButton),
        ...body(view, handlers),
      ),
    );
  }

  return { open, close, isOpen: () => Boolean(shadowRoot()), render };
})();
