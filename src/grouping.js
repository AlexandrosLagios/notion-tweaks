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

  const TIER = {
    ACTION_NEEDED: 0,
    CUSTOM: 1,
    RULE: 2,
    DATABASE: 3,
    OTHER: 4,
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

  const isCustomGroup = ({ name, items }) => name !== ACTION_NEEDED_GROUP && items.every((row) => row.movedTo);

  // A row that a flag saved before custom groups existed has no movedTo.
  const savedGroupOf = (row) => row.movedTo ?? ACTION_NEEDED_GROUP;

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

  // A line without "=", a database id, or a group name gives no rule.
  function parseRules(text) {
    const rules = [];
    text.split('\n').forEach((rawLine) => {
      // The panel writes `<id> = <group>`, so a group name can hold "=".
      const spacedSeparator = rawLine.indexOf(' = ');
      const separator = spacedSeparator === -1 ? rawLine.lastIndexOf('=') : spacedSeparator + 1;
      const path = rawLine.slice(0, separator).trim().split(/[?#]/)[0];
      const match = path.split('/').pop().replaceAll('-', '').match(DATABASE_ID_AT_END);
      const group = rawLine.slice(separator + 1).trim();
      const databaseId = match?.[1].toLowerCase();
      if (separator !== -1 && databaseId && group && !rules.some((rule) => rule.databaseId === databaseId)) {
        rules.push({ databaseId, group });
      }
    });
    return rules;
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

  function toRow(recordMap, notifications, homeGroup, database) {
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
      database,
    };
  }

  const databaseGroupName = (database) => database.databaseName || UNTITLED;

  const isRuleFor = (database, rule) => [database.databaseId, database.collectionId].includes(rule?.databaseId);

  const uniqueWithout = (names, excluded) => [...new Set(names)].filter((name) => name !== excluded);

  function groupNameOf(database, rules) {
    if (!database) {
      return OTHER_GROUP;
    }
    return rules.find((rule) => isRuleFor(database, rule))?.group ?? databaseGroupName(database);
  }

  function setRule(rulesText, database, group) {
    const isRuleOf = (line) => isRuleFor(database, parseRules(line)[0]);
    const lines = rulesText.split('\n').filter((line) => line.trim());
    const position = lines.findIndex(isRuleOf);
    const kept = lines.filter((line) => !isRuleOf(line));
    if (group !== databaseGroupName(database)) {
      kept.splice(position === -1 ? kept.length : position, 0, `${database.databaseId} = ${group}`);
    }
    return kept.join('\n');
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
    const tierOf = (group) => {
      if (group.name === ACTION_NEEDED_GROUP) {
        return TIER.ACTION_NEEDED;
      }
      if (group.name === OTHER_GROUP) {
        return TIER.OTHER;
      }
      if (ruleGroups.includes(group.name)) {
        return TIER.RULE;
      }
      return isCustomGroup(group) ? TIER.CUSTOM : TIER.DATABASE;
    };
    return [...groups].sort(
      (a, b) =>
        tierOf(a) - tierOf(b) ||
        ruleGroups.indexOf(a.name) - ruleGroups.indexOf(b.name) ||
        (tierOf(a) === TIER.CUSTOM ? a.name.localeCompare(b.name) : byNewestRow(a.items[0], b.items[0])),
    );
  }

  function mergeSavedRow(saved, fresh) {
    const olderIds = saved.ids.filter((id) => !fresh.ids.includes(id));
    return {
      ...fresh,
      movedTo: savedGroupOf(saved),
      ids: [...fresh.ids, ...olderIds],
      unreadIds: [...fresh.unreadIds, ...saved.unreadIds.filter((id) => olderIds.includes(id))],
    };
  }

  function groupNotifications({ notificationIds, recordMap }, rules, movedRows) {
    const newestFirst = notificationIds
      .map((id) => record(recordMap, 'notification', id))
      .filter(Boolean)
      .sort(byNewest);
    const pages = Map.groupBy(newestFirst, (notification) => notification.navigable_block_id ?? notification.id);
    const placedRows = [...pages.values()].map((notifications) => {
      const database = resolveDatabaseId(recordMap, notifications[0]);
      const row = toRow(recordMap, notifications, groupNameOf(database, rules), database);
      const saved = movedRows[row.pageKey];
      return saved ? mergeSavedRow(saved, row) : row;
    });
    const loadedPages = new Set(placedRows.map((row) => row.pageKey));
    const savedOnlyRows = Object.values(movedRows)
      .filter((row) => !loadedPages.has(row.pageKey))
      .map((row) => ({ ...row, movedTo: savedGroupOf(row) }));
    return groupRows([...placedRows, ...savedOnlyRows], rules);
  }

  function groupRows(rows, rules) {
    const rowsByGroup = Map.groupBy(rows, (row) => row.movedTo ?? row.homeGroup);
    return sortGroups([...rowsByGroup].map(([name, items]) => summarize(name, items.sort(byNewestRow))), rules);
  }

  // Applies changed rules to the shown rows. A row outside a database, or saved before rows held their database, stays in its group.
  function regroup(groups, rules) {
    const rows = groups
      .flatMap((group) => group.items)
      .map((row) => (row.database ? { ...row, homeGroup: groupNameOf(row.database, rules) } : row));
    return groupRows(rows, rules);
  }

  function moveRow(groups, pageKey, targetName, rules) {
    const found = groups.flatMap((group) => group.items).find((item) => item.pageKey === pageKey);
    if (!found) {
      return groups;
    }
    const { movedTo, ...row } = found;
    const moved = targetName === row.homeGroup ? row : { ...row, movedTo: targetName };
    const without = groups.map((group) => summarize(group.name, group.items.filter((item) => item !== found)));
    const targetItems = without.find((group) => group.name === targetName)?.items ?? [];
    const others = without.filter((group) => group.items.length > 0 && group.name !== targetName);
    return sortGroups([...others, summarize(targetName, [...targetItems, moved].sort(byNewestRow))], rules);
  }

  function moveTargets(groups, item, currentGroup) {
    const customGroups = groups.filter(isCustomGroup).map(({ name }) => name);
    return uniqueWithout([...customGroups, item.homeGroup], currentGroup);
  }

  function databaseMoveTargets(groups, item) {
    const names = groups.map(({ name }) => name).filter((name) => name !== ACTION_NEEDED_GROUP && name !== OTHER_GROUP);
    return uniqueWithout([...names, databaseGroupName(item.database)], item.homeGroup);
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
    moveTargets,
    databaseMoveTargets,
    databaseGroupName,
    setRule,
    regroup,
    markArchived,
    withUnreadIds,
  };
})();

if (typeof module !== 'undefined') {
  module.exports = NotionTweaksGrouping;
}
