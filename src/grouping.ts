// ponytail: Notion records stay untyped; type a record when a change depends on its fields.
export type RecordMap = Record<string, any>;
type Decoration = [string, string];
type RichText = [string, Decoration[]?][];

export interface NotificationLog {
  notificationIds: string[];
  recordMap: RecordMap;
}

export interface Database {
  databaseId: string;
  collectionId: string;
  databaseName: string;
}

export interface Rule {
  databaseId: string;
  group: string;
}

export interface Row {
  id: string;
  pageKey: string;
  homeGroup: string;
  ids: string[];
  unreadIds: string[];
  path: string;
  discussionId: string | null;
  title: string;
  verbs: string[];
  actors: string[];
  preview: string | null;
  endTime: number;
  database?: Database | null;
  movedTo?: string;
  archived?: boolean;
  spaceId?: string;
}

export interface Group {
  name: string;
  unread: number;
  activeCount: number;
  items: Row[];
}

const OTHER_GROUP = 'Other';
export const ACTION_NEEDED_GROUP = 'Action needed';
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

const TYPE_VERBS: Record<string, string> = {
  'user-mentioned': 'mentioned you',
  'permission-group-mentioned': 'mentioned your group',
  commented: 'commented',
  'grouped-commented': 'commented',
  'block-property-edited': 'updated',
  'grouped-block-property-updated': 'updated',
  reacted: 'reacted',
};

const compactId = (id: string) => id.replaceAll('-', '').toLowerCase();

const record = (recordMap: RecordMap, table: string, id: string | undefined) =>
  id === undefined ? undefined : recordMap[table]?.[id]?.value?.value;

const byNewest = (a: any, b: any) => Number(b.end_time) - Number(a.end_time);

const byNewestRow = (a: Row, b: Row) => b.endTime - a.endTime;

const isCustomGroup = ({ name, items }: Group) => name !== ACTION_NEEDED_GROUP && items.every((row) => row.movedTo);

// A row that a flag saved before custom groups existed has no movedTo.
const savedGroupOf = (row: Row) => row.movedTo ?? ACTION_NEEDED_GROUP;

const decorationValue = (decorations: Decoration[] | undefined, name: string) => decorations?.find(([candidate]) => candidate === name)?.[1];

function mentionText(recordMap: RecordMap, decorations: Decoration[] | undefined): string {
  const userName = record(recordMap, 'notion_user', decorationValue(decorations, DECORATION.USER))?.name;
  if (userName) {
    return `@${userName}`;
  }
  const page = record(recordMap, 'block', decorationValue(decorations, DECORATION.PAGE));
  // An empty recordMap stops a title that mentions itself.
  return plainText({}, page?.properties?.title);
}

function plainText(recordMap: RecordMap, richText: RichText | undefined): string {
  return (richText ?? [])
    .map(([text, decorations]) => (text === MENTION_TOKEN ? mentionText(recordMap, decorations) : text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

// A line without "=", a database id, or a group name gives no rule.
export function parseRules(text: string) {
  const rules: Rule[] = [];
  text.split('\n').forEach((rawLine) => {
    // The panel writes `<id> = <group>`, so a group name can hold "=".
    const spacedSeparator = rawLine.indexOf(' = ');
    const separator = spacedSeparator === -1 ? rawLine.lastIndexOf('=') : spacedSeparator + 1;
    const path = rawLine.slice(0, separator).trim().split(/[?#]/)[0];
    const match = path.split('/').pop()!.replaceAll('-', '').match(DATABASE_ID_AT_END);
    const group = rawLine.slice(separator + 1).trim();
    const databaseId = match?.[1].toLowerCase();
    if (separator !== -1 && databaseId && group && !rules.some((rule) => rule.databaseId === databaseId)) {
      rules.push({ databaseId, group });
    }
  });
  return rules;
}

export function resolveDatabaseId(recordMap: RecordMap, notification: any): Database | null {
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

const childrenOf = (recordMap: RecordMap, notification: any): any[] =>
  (notification.child_notification_ids ?? []).map((id: string) => record(recordMap, 'notification', id)).filter(Boolean);

const editsOf = (recordMap: RecordMap, notification: any): any[] =>
  [notification, ...childrenOf(recordMap, notification)].flatMap(
    (entry) => record(recordMap, 'activity', entry.activity_id)?.edits ?? [],
  );

function actorsOf(recordMap: RecordMap, notification: any): string[] {
  return editsOf(recordMap, notification)
    .flatMap((edit) => edit.authors ?? [])
    .map((author) => record(recordMap, author.table, author.id)?.name)
    .filter(Boolean);
}

function previewOf(recordMap: RecordMap, notification: any) {
  const [newest] = editsOf(recordMap, notification)
    .map((edit) => ({
      timestamp: edit.timestamp,
      comment: record(recordMap, 'comment', edit.comment_id) ?? edit.comment_data,
    }))
    .filter(({ comment }) => comment?.text && comment.alive !== false)
    .sort((a, b) => b.timestamp - a.timestamp);
  return newest && plainText(recordMap, newest.comment.text);
}

const newestEntriesOf = (recordMap: RecordMap, notification: any) => [notification, ...childrenOf(recordMap, notification).sort(byNewest)];

const discussionOf = (recordMap: RecordMap, entry: any) => entry.discussion_id ?? record(recordMap, 'activity', entry.activity_id)?.discussion_id;

function discussionIdOf(recordMap: RecordMap, notification: any): string | undefined {
  return newestEntriesOf(recordMap, notification)
    .map((entry) => discussionOf(recordMap, entry))
    .find(Boolean);
}

// The newest place that a notification points at: a comment discussion, and the block that holds the comment or the mention.
function targetOf(recordMap: RecordMap, notification: any) {
  return newestEntriesOf(recordMap, notification)
    .map((entry) => {
      const discussionId = discussionOf(recordMap, entry);
      const blockId: string | undefined =
        record(recordMap, 'activity', entry.activity_id)?.mentioned_block_id ?? record(recordMap, 'discussion', discussionId)?.parent_id;
      return discussionId || blockId ? { discussionId, blockId } : undefined;
    })
    .find(Boolean);
}

function pathOf(pageId: string | undefined, target: ReturnType<typeof targetOf> | null) {
  if (!pageId) {
    return '/';
  }
  const query = target?.discussionId ? `?d=${compactId(target.discussionId)}` : '';
  const hash = target?.blockId && target.blockId !== pageId ? `#${compactId(target.blockId)}` : '';
  return `/p/${compactId(pageId)}${query}${hash}`;
}

function toRow(recordMap: RecordMap, notifications: any[], homeGroup: string, database: Database | null): Row {
  const [newest] = notifications;
  const newestValue = <T>(read: (notification: any) => T) => notifications.map(read).find(Boolean) ?? null;
  const discussionId = newestValue((notification) => discussionIdOf(recordMap, notification));
  const blockId = newest.navigable_block_id;
  const page = record(recordMap, 'block', blockId);
  return {
    id: newest.id,
    pageKey: blockId ?? newest.id,
    homeGroup,
    ids: notifications.map((notification) => notification.id),
    unreadIds: notifications.filter((notification) => !notification.read).map((notification) => notification.id),
    path: pathOf(blockId, newestValue((notification) => targetOf(recordMap, notification))),
    discussionId,
    title: plainText(recordMap, page?.properties?.title) || UNTITLED,
    verbs: [...new Set(notifications.map((notification) => TYPE_VERBS[notification.type] ?? notification.type))],
    actors: [...new Set(notifications.flatMap((notification) => actorsOf(recordMap, notification)))],
    preview: newestValue((notification) => previewOf(recordMap, notification)),
    endTime: Number(newest.end_time),
    database,
  };
}

export const databaseGroupName = (database: Database) => database.databaseName || UNTITLED;

const isRuleFor = (database: Database, rule: Rule | undefined) =>
  !!rule && [database.databaseId, database.collectionId].includes(rule.databaseId);

const uniqueWithout = (names: string[], excluded: string) => [...new Set(names)].filter((name) => name !== excluded);

function groupNameOf(database: Database | null | undefined, rules: Rule[]) {
  if (!database) {
    return OTHER_GROUP;
  }
  return rules.find((rule) => isRuleFor(database, rule))?.group ?? databaseGroupName(database);
}

export function setRule(rulesText: string, database: Database, group: string) {
  const isRuleOf = (line: string) => isRuleFor(database, parseRules(line)[0]);
  const lines = rulesText.split('\n').filter((line) => line.trim());
  const position = lines.findIndex(isRuleOf);
  const kept = lines.filter((line) => !isRuleOf(line));
  if (group !== databaseGroupName(database)) {
    kept.splice(position === -1 ? kept.length : position, 0, `${database.databaseId} = ${group}`);
  }
  return kept.join('\n');
}

function summarize(name: string, items: Row[]): Group {
  const active = items.filter((item) => !item.archived);
  return {
    name,
    unread: active.flatMap((item) => item.unreadIds).length,
    activeCount: active.length,
    items,
  };
}

const mapItems = (groups: Group[], change: (item: Row) => Row) => groups.map((group) => summarize(group.name, group.items.map(change)));

function sortGroups(groups: Group[], rules: Rule[]) {
  const ruleGroups = [...new Set(rules.map((rule) => rule.group))];
  const tierOf = (group: Group) => {
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

function mergeSavedRow(saved: Row, fresh: Row): Row {
  const olderIds = saved.ids.filter((id) => !fresh.ids.includes(id));
  return {
    ...fresh,
    movedTo: savedGroupOf(saved),
    ids: [...fresh.ids, ...olderIds],
    unreadIds: [...fresh.unreadIds, ...saved.unreadIds.filter((id) => olderIds.includes(id))],
  };
}

export function groupNotifications(
  { notificationIds, recordMap }: NotificationLog,
  rules: Rule[],
  movedRows: Record<string, Row>,
) {
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

function groupRows(rows: Row[], rules: Rule[]) {
  const rowsByGroup = Map.groupBy(rows, (row) => row.movedTo ?? row.homeGroup);
  return sortGroups([...rowsByGroup].map(([name, items]) => summarize(name, items.sort(byNewestRow))), rules);
}

// Applies changed rules to the shown rows. A row outside a database, or saved before rows held their database, stays in its group.
export function regroup(groups: Group[], rules: Rule[]) {
  const rows = groups
    .flatMap((group) => group.items)
    .map((row) => (row.database ? { ...row, homeGroup: groupNameOf(row.database, rules) } : row));
  return groupRows(rows, rules);
}

export function moveRow(groups: Group[], pageKey: string, targetName: string, rules: Rule[]) {
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

export function moveTargets(groups: Group[], item: Row, currentGroup: string) {
  const customGroups = groups.filter(isCustomGroup).map(({ name }) => name);
  return uniqueWithout([...customGroups, item.homeGroup], currentGroup);
}

export function databaseMoveTargets(groups: Group[], item: Row) {
  const names = groups.map(({ name }) => name).filter((name) => name !== ACTION_NEEDED_GROUP && name !== OTHER_GROUP);
  return uniqueWithout([...names, databaseGroupName(item.database!)], item.homeGroup);
}

export function markArchived(groups: Group[], archivedIds: Set<string>) {
  return mapItems(groups, (item) => ({ ...item, archived: item.ids.every((id) => archivedIds.has(id)) }));
}

export function withUnreadIds(groups: Group[], rowId: string, unreadIds: string[]) {
  return mapItems(groups, (item) => (item.id === rowId ? { ...item, unreadIds } : item));
}
