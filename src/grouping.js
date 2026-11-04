const NotionTweaksGrouping = (() => {
  const OTHER_GROUP = 'Other';
  const ACTION_NEEDED_GROUP = 'Action needed';
  const UNTITLED = 'Untitled';
  const MAX_PARENT_DEPTH = 10;
  const DATABASE_ID_AT_END = /([0-9a-f]{32})$/i;
  const MENTION_TOKEN = '‣';

  const PARENT_TABLE = {
    BLOCK: 'block',
    COLLECTION: 'collection',
  };

  const DECORATION = {
    USER: 'u',
    PAGE: 'p',
  };

  const TYPE_VERBS = {
    'user-mentioned': 'mentioned you',
    'permission-group-mentioned': 'mentioned your group',
    commented: 'commented',
    'grouped-commented': 'commented',
    'block-property-edited': 'updated',
    'grouped-block-property-updated': 'updated',
    reacted: 'reacted',
  };

  const compactId = (id) => id.replaceAll('-', '').toLowerCase();

  const record = (recordMap, table, id) => recordMap[table]?.[id]?.value?.value;

  const byNewest = (a, b) => Number(b.end_time) - Number(a.end_time);

  const byNewestRow = (a, b) => b.endTime - a.endTime;

  const decorationValue = (decorations, name) => decorations?.find(([candidate]) => candidate === name)?.[1];

  function mentionText(recordMap, decorations) {
    const userName = record(recordMap, 'notion_user', decorationValue(decorations, DECORATION.USER))?.name;
    if (userName) {
      return `@${userName}`;
    }
    const page = record(recordMap, 'block', decorationValue(decorations, DECORATION.PAGE));
    // An empty recordMap stops a title that mentions itself.
    return plainText({}, page?.properties?.title);
  }

  function plainText(recordMap, richText) {
    return (richText ?? [])
      .map(([text, decorations]) => (text === MENTION_TOKEN ? mentionText(recordMap, decorations) : text))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseRules(text) {
    const rules = [];
    const errors = [];
    const seen = new Set();

    text.split('\n').forEach((rawLine, index) => {
      const line = index + 1;
      if (!rawLine.trim()) {
        return;
      }
      const separator = rawLine.lastIndexOf('=');
      if (separator === -1) {
        errors.push({ line, reason: 'missing "="' });
        return;
      }
      const path = rawLine.slice(0, separator).trim().split(/[?#]/)[0];
      const lastSegment = path.split('/').pop().replaceAll('-', '');
      const match = lastSegment.match(DATABASE_ID_AT_END);
      if (!match) {
        errors.push({ line, reason: 'no database id' });
        return;
      }
      const group = rawLine.slice(separator + 1).trim();
      if (!group) {
        errors.push({ line, reason: 'no group name' });
        return;
      }
      const databaseId = match[1].toLowerCase();
      if (!seen.has(databaseId)) {
        seen.add(databaseId);
        rules.push({ databaseId, group });
      }
    });

    return { rules, errors };
  }

  function resolveDatabaseId(recordMap, notification) {
    let block = record(recordMap, 'block', notification.navigable_block_id);
    for (let depth = 0; block && depth <= MAX_PARENT_DEPTH; depth++) {
      if (block.parent_table === PARENT_TABLE.COLLECTION) {
        const collection = record(recordMap, 'collection', block.parent_id);
        if (!collection) {
          return null;
        }
        return {
          databaseId: compactId(collection.parent_id),
          collectionId: compactId(collection.id),
          databaseName: plainText(recordMap, collection.name),
        };
      }
      if (block.parent_table !== PARENT_TABLE.BLOCK) {
        return null;
      }
      block = record(recordMap, 'block', block.parent_id);
    }
    return null;
  }

  const childrenOf = (recordMap, notification) =>
    (notification.child_notification_ids ?? []).map((id) => record(recordMap, 'notification', id)).filter(Boolean);

  const editsOf = (recordMap, notification) =>
    [notification, ...childrenOf(recordMap, notification)].flatMap(
      (entry) => record(recordMap, 'activity', entry.activity_id)?.edits ?? [],
    );

  function actorsOf(recordMap, notification) {
    return editsOf(recordMap, notification)
      .flatMap((edit) => edit.authors ?? [])
      .map((author) => record(recordMap, author.table, author.id)?.name)
      .filter(Boolean);
  }

  function previewOf(recordMap, notification) {
    const [newest] = editsOf(recordMap, notification)
      .map((edit) => ({
        timestamp: edit.timestamp,
        comment: record(recordMap, 'comment', edit.comment_id) ?? edit.comment_data,
      }))
      .filter(({ comment }) => comment?.text && comment.alive !== false)
      .sort((a, b) => b.timestamp - a.timestamp);
    return newest && plainText(recordMap, newest.comment.text);
  }

  function discussionIdOf(recordMap, notification) {
    return [notification, ...childrenOf(recordMap, notification).sort(byNewest)]
      .map((entry) => entry.discussion_id ?? record(recordMap, 'activity', entry.activity_id)?.discussion_id)
      .find(Boolean);
  }

  function toRow(recordMap, notifications, homeGroup) {
    const [newest] = notifications;
    const newestValue = (read) => notifications.map(read).find(Boolean) ?? null;
    const discussionId = newestValue((notification) => discussionIdOf(recordMap, notification));
    const blockId = newest.navigable_block_id;
    const page = record(recordMap, 'block', blockId);
    return {
      id: newest.id,
      pageKey: blockId ?? newest.id,
      homeGroup,
      ids: notifications.map((notification) => notification.id),
      unreadIds: notifications.filter((notification) => !notification.read).map((notification) => notification.id),
      path: blockId ? `/p/${compactId(blockId)}${discussionId ? `?d=${compactId(discussionId)}` : ''}` : '/',
      title: plainText(recordMap, page?.properties?.title) || UNTITLED,
      verbs: [...new Set(notifications.map((notification) => TYPE_VERBS[notification.type] ?? notification.type))],
      actors: [...new Set(notifications.flatMap((notification) => actorsOf(recordMap, notification)))],
      preview: newestValue((notification) => previewOf(recordMap, notification)),
      endTime: Number(newest.end_time),
    };
  }

  function groupNameOf(database, rules) {
    if (!database) {
      return OTHER_GROUP;
    }
    const rule = rules.find((candidate) => [database.databaseId, database.collectionId].includes(candidate.databaseId));
    return rule?.group ?? (database.databaseName || UNTITLED);
  }

  function summarize(name, items) {
    const active = items.filter((item) => !item.archived);
    return {
      name,
      unread: active.flatMap((item) => item.unreadIds).length,
      activeCount: active.length,
      items,
    };
  }

  const mapItems = (groups, change) => groups.map((group) => summarize(group.name, group.items.map(change)));

  function sortGroups(groups, rules) {
    const ruleGroups = [...new Set(rules.map((rule) => rule.group))];
    const tierOf = (name) => {
      if (name === ACTION_NEEDED_GROUP) {
        return -1;
      }
      return name === OTHER_GROUP ? 2 : ruleGroups.includes(name) ? 0 : 1;
    };
    const rank = (group) => [tierOf(group.name), ruleGroups.indexOf(group.name), -group.items[0].endTime];
    return [...groups].sort((a, b) => {
      const [first, second] = [rank(a), rank(b)];
      return first[0] - second[0] || first[1] - second[1] || first[2] - second[2];
    });
  }

  function mergeFlaggedRow(saved, fresh) {
    const olderIds = saved.ids.filter((id) => !fresh.ids.includes(id));
    return {
      ...fresh,
      ids: [...fresh.ids, ...olderIds],
      unreadIds: [...fresh.unreadIds, ...saved.unreadIds.filter((id) => olderIds.includes(id))],
    };
  }

  function groupNotifications({ notificationIds, recordMap }, rules, flaggedRows) {
    const newestFirst = notificationIds
      .map((id) => record(recordMap, 'notification', id))
      .filter(Boolean)
      .sort(byNewest);
    const pages = Map.groupBy(newestFirst, (notification) => notification.navigable_block_id ?? notification.id);
    const placedRows = [...pages.values()].map((notifications) => {
      const homeGroup = groupNameOf(resolveDatabaseId(recordMap, notifications[0]), rules);
      const row = toRow(recordMap, notifications, homeGroup);
      const saved = flaggedRows[row.pageKey];
      return saved ? { group: ACTION_NEEDED_GROUP, row: mergeFlaggedRow(saved, row) } : { group: homeGroup, row };
    });
    const loadedPages = new Set(placedRows.map(({ row }) => row.pageKey));
    const savedOnlyRows = Object.values(flaggedRows)
      .filter((row) => !loadedPages.has(row.pageKey))
      .map((row) => ({ group: ACTION_NEEDED_GROUP, row }));
    const rowsByGroup = Map.groupBy([...placedRows, ...savedOnlyRows], ({ group }) => group);
    const groups = [...rowsByGroup].map(([name, entries]) =>
      summarize(name, entries.map(({ row }) => row).sort(byNewestRow)),
    );
    return sortGroups(groups, rules);
  }

  function moveRow(groups, rowId, targetName, rules) {
    const moved = groups.flatMap((group) => group.items).find((item) => item.id === rowId);
    const without = groups.map((group) => summarize(group.name, group.items.filter((item) => item !== moved)));
    const targetItems = without.find((group) => group.name === targetName)?.items ?? [];
    const others = without.filter((group) => group.items.length > 0 && group.name !== targetName);
    return sortGroups([...others, summarize(targetName, [...targetItems, moved].sort(byNewestRow))], rules);
  }

  function markArchived(groups, archivedIds) {
    return mapItems(groups, (item) => ({ ...item, archived: item.ids.every((id) => archivedIds.has(id)) }));
  }

  function withUnreadIds(groups, rowId, unreadIds) {
    return mapItems(groups, (item) => (item.id === rowId ? { ...item, unreadIds } : item));
  }

  return {
    ACTION_NEEDED_GROUP,
    parseRules,
    resolveDatabaseId,
    groupNotifications,
    moveRow,
    markArchived,
    withUnreadIds,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = NotionTweaksGrouping;
}
