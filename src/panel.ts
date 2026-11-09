import * as NotionTweaksApi from './notion-api.ts';
import * as NotionTweaksGrouping from './grouping.ts';
import * as NotionTweaksSchedule from './schedule.ts';
import * as NotionTweaksPicker from './picker.ts';
import type { InboxType, Space } from './notion-api.ts';
import type { Group, Row } from './grouping.ts';
import type { ScheduledComment } from './schedule.ts';

export interface ReadyView {
  status: 'ready';
  groups: Group[];
  canLoadMore: boolean;
  groupErrors: Map<string, string | undefined>;
  refreshing?: boolean;
}

export type View = { status: 'loading' } | { status: 'error'; message: string } | ReadyView;

type PanelView = View & {
  inboxType: InboxType;
  unreadCount?: number;
  currentId?: string;
  spaces: Space[];
  spaceId?: string;
  scheduled: ScheduledComment[];
};

export interface Handlers {
  onReload(): void;
  onLoadMore(): void;
  onFilter(inboxType: InboxType): void;
  onSpace(spaceId: string): void;
  onArchive(items: Row[], groupName: string): void;
  onUnarchive(items: Row[], groupName: string): void;
  onMove(item: Row, target: string): void;
  onMoveDatabase(item: Row, target: string): void;
  onRead(item: Row, groupName: string): void;
  onOpen(item: Row, groupName: string): void;
  onReplyLater(item: Row): void;
  onSendNow(id: string): void;
  onCancelComment(id: string): void;
}

export interface Reply {
  text: string;
  sendAt: number;
}

type MoveOption = HTMLOptionElement & { isNewGroup?: boolean; onDatabase?: boolean };

const CONFIRM_MS = 3000;
const MIDDLE_BUTTON = 1;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SCHEDULE_VALUE = 'schedule';
const FILTER_OPTIONS: { value: InboxType; label: string }[] = [
  { value: NotionTweaksApi.INBOX_TYPE.ALL, label: 'All' },
  { value: NotionTweaksApi.INBOX_TYPE.UNREAD, label: 'Unread' },
];
const collapsedGroups = new Set<string>();
let isScheduledCollapsed = false;
const root = document.getElementById('root')!;
const newGroupDialog = document.getElementById('new-group') as HTMLDialogElement;
const replyDialog = document.getElementById('reply-later') as HTMLDialogElement;
const replyText = replyDialog.querySelector('textarea')!;
const replyError = replyDialog.querySelector<HTMLElement>('.error')!;

const { el } = NotionTweaksPicker;

function age(endTime: number) {
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

function actorText(actors: string[]) {
  if (actors.length <= 2) {
    return actors.join(', ');
  }
  return `${actors.slice(0, 2).join(', ')} +${actors.length - 2}`;
}

function sentence(item: Row) {
  return [actorText(item.actors), item.verbs.join(', ')].filter(Boolean).join(' ');
}

// After the first click of a double click, the row under the pointer can change, so the second click does nothing.
const isRepeatClick = (event: MouseEvent) => event.detail > 1;

function rowAction(item: Row, groupName: string, { onArchive, onUnarchive }: Handlers) {
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

function flagAction(item: Row, groupName: string, { onMove }: Handlers) {
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
  const input = newGroupDialog.querySelector('input')!;
  input.value = '';
  newGroupDialog.returnValue = '';
  newGroupDialog.showModal();
  return new Promise<string>((resolve) => {
    newGroupDialog.addEventListener('close', () => resolve(newGroupDialog.returnValue && input.value.trim()), {
      once: true,
    });
  });
}

const replyPicker = NotionTweaksPicker.createPicker(scheduleReply);
replyDialog.querySelector('.picker-slot')!.replaceWith(replyPicker.element);
document.head.append(el('style', { textContent: NotionTweaksPicker.PICKER_STYLE }));
let replySendAt = 0;

// A preset click and the Schedule button both end here, so both check the reply and the time.
function scheduleReply(sendAt: number) {
  const error = replyText.value.trim() ? NotionTweaksSchedule.sendAtError(sendAt, Date.now()) : 'Write a reply.';
  replyError.textContent = error ?? '';
  replyError.hidden = !error;
  if (!error) {
    replySendAt = sendAt;
    replyDialog.close(SCHEDULE_VALUE);
  }
}

replyDialog.querySelector('form')!.addEventListener('submit', (event) => {
  if (event.submitter?.getAttribute('value') === SCHEDULE_VALUE) {
    event.preventDefault();
    scheduleReply(replyPicker.chosen());
  }
});

export function askReply(title: string) {
  replyDialog.querySelector('.dialog-title')!.textContent = title;
  replyText.value = '';
  replyPicker.reset(Date.now());
  replyError.hidden = true;
  replyDialog.returnValue = '';
  replyDialog.showModal();
  return new Promise<Reply | undefined>((resolve) => {
    replyDialog.addEventListener(
      'close',
      () =>
        resolve(replyDialog.returnValue === SCHEDULE_VALUE ? { text: replyText.value.trim(), sendAt: replySendAt } : undefined),
      { once: true },
    );
  });
}

function replyAction(item: Row, { onReplyLater }: Handlers) {
  const button = el('button', { textContent: 'Reply later' });
  button.addEventListener('click', (event) => {
    if (!isRepeatClick(event)) {
      onReplyLater(item);
    }
  });
  return button;
}

const moveOptions = (targets: string[], onDatabase: boolean) => [
  ...targets.map((name) => el('option', { value: name, textContent: name, onDatabase })),
  el('option', { textContent: 'New group…', isNewGroup: true, onDatabase }),
];

// ponytail: one select per row; fill the options on focus if a long list renders slowly.
function moveAction(item: Row, groupName: string, groups: Group[], { onMove, onMoveDatabase }: Handlers) {
  const pageOptions = moveOptions(NotionTweaksGrouping.moveTargets(groups, item, groupName), false);
  const select = el(
    'select',
    { ariaLabel: 'Move to a group' },
    el('option', { value: '', textContent: 'Move', hidden: true }),
    ...(item.database
      ? [
          el('optgroup', { label: 'This page' }, ...pageOptions),
          el(
            'optgroup',
            { label: `All of ${NotionTweaksGrouping.databaseGroupName(item.database)}` },
            ...moveOptions(NotionTweaksGrouping.databaseMoveTargets(groups, item), true),
          ),
        ]
      : pageOptions),
  );
  select.addEventListener('change', async () => {
    const option = select.selectedOptions[0] as MoveOption;
    const target = option.isNewGroup ? await askGroupName() : option.value;
    select.value = '';
    if (target) {
      (option.onDatabase ? onMoveDatabase : onMove)(item, target);
    }
  });
  return select;
}

function rowLink(item: Row, groupName: string, { onOpen, onRead }: Handlers) {
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

function groupAction(group: Group, { onArchive, onUnarchive }: Handlers) {
  const button = el('button', { textContent: group.activeCount ? 'Archive' : 'Undo' });
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
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

function rowClass(item: Row, currentId: string | undefined) {
  const state = item.archived ? 'archived' : item.unreadIds.length ? 'unread' : '';
  return `${state} ${item.id === currentId ? 'current' : ''}`.trim();
}

function row(item: Row, groupName: string, view: PanelView & ReadyView, handlers: Handlers) {
  const preview = item.preview ? [el('p', { className: 'preview', textContent: item.preview })] : [];
  const canReply = Boolean(item.discussionId && !item.archived);
  return el(
    'li',
    { className: `${rowClass(item, view.currentId)} ${canReply ? 'can-reply' : ''}`.trim() },
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
        ...(canReply ? [replyAction(item, handlers)] : []),
      ),
    ),
    el('small', { textContent: sentence(item) }),
    ...preview,
  );
}

function groupSection(group: Group, view: PanelView & ReadyView, handlers: Handlers) {
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

const sendTime = (sendAt: number) =>
  new Date(sendAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function scheduledStatus({ status, sendAt, error }: ScheduledComment) {
  if (status === NotionTweaksSchedule.STATUS.OVERDUE) {
    return `Not sent at ${sendTime(sendAt)}, because Chrome was closed`;
  }
  return status === NotionTweaksSchedule.STATUS.FAILED ? `Not sent: ${error}` : `Sends ${sendTime(sendAt)}`;
}

function scheduledRow(entry: ScheduledComment, { onSendNow, onCancelComment }: Handlers) {
  const link = el('a', { href: NotionTweaksApi.pageUrl(entry.path), target: '_blank', textContent: entry.title });
  link.addEventListener('click', (event) => {
    event.preventDefault();
    NotionTweaksApi.openPage(entry.path).catch(console.error);
  });
  const cancel = el('button', { textContent: 'Cancel' });
  cancel.addEventListener('click', () => onCancelComment(entry.id));
  const sendNow = el('button', { textContent: 'Send now' });
  sendNow.addEventListener('click', () => onSendNow(entry.id));
  const actions = entry.status === NotionTweaksSchedule.STATUS.PENDING ? [cancel] : [sendNow, cancel];
  return el(
    'li',
    { className: entry.status },
    el('div', { className: 'row' }, link, el('div', { className: 'row-actions' }, ...actions)),
    el('small', { textContent: scheduledStatus(entry) }),
    el('p', { className: 'preview', textContent: entry.text }),
  );
}

function scheduledSection(scheduled: ScheduledComment[], handlers: Handlers) {
  if (!scheduled.length) {
    return [];
  }
  const details = el(
    'details',
    { open: !isScheduledCollapsed, className: 'scheduled' },
    el('summary', {}, el('span', { textContent: 'Scheduled' }), el('span', { className: 'count', textContent: String(scheduled.length) })),
    el('ul', {}, ...scheduled.map((entry) => scheduledRow(entry, handlers))),
  );
  details.addEventListener('toggle', () => {
    isScheduledCollapsed = !details.open;
  });
  return [details];
}

function body(view: PanelView, handlers: Handlers) {
  if (view.status === 'loading') {
    return [el('p', { textContent: 'Loading…' })];
  }
  if (view.status === 'error') {
    return [el('p', { className: 'error', textContent: view.message })];
  }
  const sections: HTMLElement[] = view.groups.map((group) => groupSection(group, view, handlers));
  if (view.canLoadMore) {
    const loadMore = el('button', { textContent: 'Load more' });
    loadMore.addEventListener('click', handlers.onLoadMore);
    sections.push(loadMore);
  }
  return sections.length ? sections : [el('p', { textContent: 'No notifications.' })];
}

function choiceSelect<T extends string>(
  props: Partial<HTMLSelectElement>,
  options: { value: T; label: string }[],
  value: T,
  onChange: (value: T) => void,
) {
  const select = el(
    'select',
    props,
    ...options.map(({ value: optionValue, label }) => el('option', { value: optionValue, textContent: label })),
  );
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T));
  return select;
}

const spaceSelect = (spaces: Space[], spaceId: string | undefined, onSpace: (spaceId: string) => void) =>
  spaces.length < 2
    ? []
    : [
        choiceSelect(
          { ariaLabel: 'Workspace', className: 'space' },
          spaces.map(({ id, name }) => ({ value: id, label: name })),
          spaceId ?? '',
          onSpace,
        ),
      ];

export function render(view: PanelView, handlers: Handlers) {
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
        view.status === 'ready' && view.refreshing ? 'Updating…' : 'Inbox',
        el('span', {
          className: 'badge',
          title: 'Unread notifications',
          textContent: String(view.unreadCount ?? ''),
          hidden: !view.unreadCount,
        }),
      ),
      ...spaceSelect(view.spaces, view.spaceId, handlers.onSpace),
      choiceSelect({ ariaLabel: 'Status' }, FILTER_OPTIONS, view.inboxType, handlers.onFilter),
      reload,
    ),
    ...scheduledSection(view.scheduled, handlers),
    ...body(view, handlers),
  );
  root.replaceChildren(panel);
  panel.scrollTop = scrollTop;
}

// Updates only the badge: a full render during a click would replace the button under the pointer and lose the click.
export function showUnreadCount(count: number | undefined) {
  const badge = root.querySelector<HTMLElement>('.badge');
  if (badge) {
    badge.textContent = String(count ?? '');
    badge.hidden = !count;
  }
}

// Swaps only the workspace menu, so the rows under the pointer stay in place.
export function showSpaces(spaces: Space[], spaceId: string | undefined, onSpace: (spaceId: string) => void) {
  root.querySelector('header .space')?.remove();
  root.querySelector('header strong')?.after(...spaceSelect(spaces, spaceId, onSpace));
}

// A full render replaces the element under the pointer or in focus.
export const isBusy = () =>
  root.matches(':hover') ||
  newGroupDialog.open ||
  replyDialog.open ||
  (document.hasFocus() && document.activeElement instanceof HTMLSelectElement);
