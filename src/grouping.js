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

  const plainText = (richText) => (richText ?? []).map((part) => part[0]).join('');

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

  function groupNotifications({ notificationIds, recordMap }, rules) {
    const groupOrder = [...new Set(rules.map((rule) => rule.group)), OTHER_GROUP];
    const itemsByGroup = new Map(groupOrder.map((name) => [name, []]));

    for (const id of notificationIds) {
      const notification = record(recordMap, 'notification', id);
      if (!notification) {
        continue;
      }
      const database = resolveDatabaseId(recordMap, notification);
      const rule = database
        ? rules.find((candidate) => [database.databaseId, database.collectionId].includes(candidate.databaseId))
        : undefined;
      const page = record(recordMap, 'block', notification.navigable_block_id);
      itemsByGroup.get(rule ? rule.group : OTHER_GROUP).push({
        id,
        pageId: compactId(notification.navigable_block_id),
        title: plainText(page?.properties?.title) || UNTITLED,
        type: TYPE_LABELS[notification.type] ?? notification.type,
        unread: !notification.read,
        endTime: Number(notification.end_time),
      });
    }

    return groupOrder
      .map((name) => {
        const items = itemsByGroup.get(name).sort((a, b) => b.endTime - a.endTime);
        return { name, unread: items.filter((item) => item.unread).length, items };
      })
      .filter((group) => group.items.length > 0);
  }

  return { parseRules, resolveDatabaseId, groupNotifications };
})();

if (typeof module !== 'undefined') {
  module.exports = NotionTweaksGrouping;
}
