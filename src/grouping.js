const NotionTweaksGrouping = (() => {
  const OTHER_GROUP = 'Other';
  const UNTITLED = 'Untitled';
  const MAX_PARENT_DEPTH = 10;
  const DATABASE_ID_AT_END = /([0-9a-f]{32})$/i;

  const PARENT_TABLE = {
    BLOCK: 'block',
    COLLECTION: 'collection',
  };

  const TYPE_LABELS = {
    'user-mentioned': 'Mention',
    'permission-group-mentioned': 'Group mention',
    commented: 'Comment',
    'grouped-commented': 'Comment',
    'block-property-edited': 'Update',
    'grouped-block-property-updated': 'Update',
    reacted: 'Reaction',
  };

  const compactId = (id) => id.replaceAll('-', '').toLowerCase();

  const record = (recordMap, table, id) => recordMap[table]?.[id]?.value?.value;

  const plainText = (richText) =>
    (richText ?? [])
      .map((part) => part[0])
      .join('')
      .trim();

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
          databaseName: plainText(collection.name),
        };
      }
      if (block.parent_table !== PARENT_TABLE.BLOCK) {
        return null;
      }
      block = record(recordMap, 'block', block.parent_id);
    }
    return null;
  }

  function actorsOf(recordMap, notification) {
    const childIds = notification.child_notification_ids ?? [];
    const activityIds = [
      notification.activity_id,
      ...childIds.map((id) => record(recordMap, 'notification', id)?.activity_id),
    ];
    const names = activityIds
      .flatMap((id) => record(recordMap, 'activity', id)?.edits ?? [])
      .flatMap((edit) => edit.authors ?? [])
      .map((author) => record(recordMap, author.table, author.id)?.name)
      .filter(Boolean);
    return [...new Set(names)];
  }

  function groupNameOf(database, rules) {
    if (!database) {
      return OTHER_GROUP;
    }
    const rule = rules.find((candidate) => [database.databaseId, database.collectionId].includes(candidate.databaseId));
    return rule?.group ?? (database.databaseName || UNTITLED);
  }

  function summarize(name, items) {
    return { name, unread: items.filter((item) => item.unread).length, items };
  }

  function groupNotifications({ notificationIds, recordMap }, rules) {
    const itemsByGroup = new Map();

    for (const id of notificationIds) {
      const notification = record(recordMap, 'notification', id);
      if (!notification) {
        continue;
      }
      const name = groupNameOf(resolveDatabaseId(recordMap, notification), rules);
      const page = record(recordMap, 'block', notification.navigable_block_id);
      if (!itemsByGroup.has(name)) {
        itemsByGroup.set(name, []);
      }
      itemsByGroup.get(name).push({
        id,
        pageId: compactId(notification.navigable_block_id),
        title: plainText(page?.properties?.title) || UNTITLED,
        type: TYPE_LABELS[notification.type] ?? notification.type,
        actors: actorsOf(recordMap, notification),
        unread: !notification.read,
        endTime: Number(notification.end_time),
      });
    }

    const ruleGroups = [...new Set(rules.map((rule) => rule.group))];
    const rank = (group) => [
      group.name === OTHER_GROUP ? 2 : ruleGroups.includes(group.name) ? 0 : 1,
      ruleGroups.indexOf(group.name),
      -group.items[0].endTime,
    ];
    return [...itemsByGroup]
      .map(([name, items]) => summarize(name, items.sort((a, b) => b.endTime - a.endTime)))
      .sort((a, b) => {
        const [first, second] = [rank(a), rank(b)];
        return first[0] - second[0] || first[1] - second[1] || first[2] - second[2];
      });
  }

  function withoutNotifications(groups, notificationIds) {
    const removed = new Set(notificationIds);
    return groups
      .map((group) => summarize(group.name, group.items.filter((item) => !removed.has(item.id))))
      .filter((group) => group.items.length > 0);
  }

  return { parseRules, resolveDatabaseId, groupNotifications, withoutNotifications };
})();

if (typeof module !== 'undefined') {
  module.exports = NotionTweaksGrouping;
}
