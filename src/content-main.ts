// Runs in the main world of the Notion page, because only there can a script read the React props of a comment box.
// The isolated content script asks with an event on the comment box, and reads the answer from a data attribute.
// The props are Notion internals: when Notion renames one, the answer is null, and the comment box gets no clock button.

interface Fiber {
  memoizedProps?: Record<string, any>;
  return?: Fiber;
}

type Draft = [string, unknown[]?][];

const childOf = (node: any, key: string) => (node instanceof Map ? node.get(key) : node?.[key]);

// The seen record of the user in the thread also holds the follow state, and only the page cache holds its id.
function seenRecordIdOf(environment: any, userId: string, discussionId: string): string | undefined {
  const path = ['inMemoryRecordCache', 'data', 'data', userId, 'inner', 'data', 'user_seen_record'];
  const table = path.reduce(childOf, environment.defaultRecordCache);
  const records = table instanceof Map ? [...table.values()] : Object.values(table ?? {});
  return records.map((entry: any) => entry?.value?.value ?? entry?.value).find((record) => record?.parent_id === discussionId)?.id;
}

const quoteOf = (blockId: string) =>
  [...document.querySelectorAll(`[data-block-id="${blockId}"] .notion-temporary-comment`)]
    .map(({ textContent }) => textContent)
    .join('') || undefined;

function readTarget(box: Element) {
  const key = Object.keys(box).find((name) => name.startsWith('__reactFiber$'));
  let fiber = key ? (box as unknown as Record<string, Fiber>)[key] : undefined;
  while (fiber && !fiber.memoizedProps?.discussionInputStore) {
    fiber = fiber.return;
  }
  if (!fiber) {
    return null;
  }
  const { inReplyToDiscussionId, blockStore, discussionInputStore } = fiber.memoizedProps!;
  const userId: string | undefined = discussionInputStore.environment.currentUser._id;
  const spaceId: string | undefined = discussionInputStore.spaceId;
  if (!userId || !spaceId || !(inReplyToDiscussionId || blockStore.id)) {
    return null;
  }
  const draft: Draft = discussionInputStore.instanceState.textStore.getValue() ?? [];
  return {
    userId,
    spaceId,
    ...(inReplyToDiscussionId
      ? {
          discussionId: inReplyToDiscussionId,
          seenRecordId: seenRecordIdOf(discussionInputStore.environment, userId, inReplyToDiscussionId),
        }
      : { blockId: blockStore.id, quote: quoteOf(blockStore.id) }),
    // The textbox shows a mention by name, and the draft shows only a mention token.
    text: box.querySelector<HTMLElement>('[role=textbox]')?.innerText.trim() || draft.map(([text]) => text).join(''),
    richText: draft,
  };
}

document.addEventListener('enhanced-notion:read-target', ({ target }) => {
  const box = target as HTMLElement;
  let answer = null;
  try {
    answer = readTarget(box);
  } catch (error) {
    console.debug('Enhanced Notion cannot read the comment box', error);
  }
  box.dataset.enhancedNotionTarget = JSON.stringify(answer);
});
