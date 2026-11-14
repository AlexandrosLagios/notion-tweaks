import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spacesOf, postComment } from '../src/notion-api.ts';
import captures from './fixtures/comment-requests.json' with { type: 'json' };

const space = (name: string) => ({ spaceId: 'x', value: { value: { name }, role: 'editor' } });
const spacesByUser = {
  u1: { space: { s1: space('Work'), s2: space('Personal') } },
  u2: { space: { s3: space('Other account') } },
};

test('spacesOf lists the workspaces of the user with their names', () => {
  assert.deepEqual(spacesOf(spacesByUser, 'u1'), [
    { id: 's1', name: 'Work' },
    { id: 's2', name: 'Personal' },
  ]);
});

test('spacesOf falls back to the first user when the user is unknown', () => {
  assert.deepEqual(spacesOf(spacesByUser, 'any-user'), [
    { id: 's1', name: 'Work' },
    { id: 's2', name: 'Personal' },
  ]);
});

const { reply } = captures;
const [replyTransaction] = reply.body.transactions;
const replyComment = replyTransaction.operations[0] as {
  pointer: { id: string };
  args: { created_time: number; parent_id: string };
};
const CREATED_TIME = replyComment.args.created_time;
const USER_ID = reply.headers['x-notion-active-user-header'];

type Comment = Parameters<typeof postComment>[0];
type Ids = Parameters<typeof postComment>[1];

async function capturePost(comment: Comment, ids: Ids) {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response('{}');
  };
  try {
    await postComment(comment, ids);
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

const postReply = (userId: string) =>
  capturePost(
    { userId, spaceId: replyTransaction.spaceId, discussionId: replyComment.args.parent_id, text: 'test 2' },
    {
      requestId: reply.body.requestId,
      transactionId: replyTransaction.id,
      discussionId: 'unused',
      seenRecordId: 'unused',
      commentId: replyComment.pointer.id,
      now: CREATED_TIME,
    },
  );

test('postComment sends the reply operations of the Notion web client, without the seen-record updates', async () => {
  const [{ url, init }] = await postReply(USER_ID);
  const operations = structuredClone(replyTransaction.operations).filter(
    (operation) => operation.pointer.table !== 'user_seen_record',
  );
  // The web client stamps the last edit 1 ms after the creation.
  (operations.at(-1)!.args as { last_edited_time: number }).last_edited_time = CREATED_TIME;
  assert.equal(url, `https://app.notion.com/api/v3/${reply.endpoint}`);
  assert.deepEqual(JSON.parse(init.body as string), {
    requestId: reply.body.requestId,
    transactions: [{ id: replyTransaction.id, spaceId: replyTransaction.spaceId, operations }],
  });
});

type Operation = { command: string; pointer: { table: string; id: string }; args: Record<string, unknown> };

const SEEN_TABLE = 'user_seen_record';
// The web client stamps the last visit a few ms after the creation, and the reply repeats the last-visit update.
const withCreationTimes = (operations: Operation[], createdTime: number) =>
  operations
    .filter((operation, index) => !(operation.pointer.table === SEEN_TABLE && operations.findIndex((other) => JSON.stringify(other) === JSON.stringify(operation)) !== index))
    .map((operation) =>
      operation.pointer.table === SEEN_TABLE && 'last_seen_at' in operation.args
        ? { ...operation, args: { ...operation.args, last_seen_at: createdTime } }
        : operation.command === 'update' && operation.pointer.table === 'comment' && 'last_edited_time' in operation.args
          ? { ...operation, args: { ...operation.args, last_edited_time: createdTime } }
          : operation,
    );

test('postComment follows the thread with the seen record of the user, as the Notion web client does', async () => {
  const operations = replyTransaction.operations as Operation[];
  const seenRecordId = operations.find(({ pointer }) => pointer.table === SEEN_TABLE)!.pointer.id;
  const [{ init }] = await capturePost(
    { userId: USER_ID, spaceId: replyTransaction.spaceId, discussionId: replyComment.args.parent_id, seenRecordId, text: 'test 2' },
    {
      requestId: reply.body.requestId,
      transactionId: replyTransaction.id,
      discussionId: 'unused',
      seenRecordId: 'unused',
      commentId: replyComment.pointer.id,
      now: CREATED_TIME,
    },
  );
  assert.deepEqual(JSON.parse(init.body as string).transactions[0].operations, withCreationTimes(operations, CREATED_TIME));
});

test('postComment picks the account and the workspace with the headers of the Notion web client', async () => {
  const [{ init }] = await postReply(USER_ID);
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['x-notion-active-user-header'], USER_ID);
  assert.equal(headers['x-notion-space-id'], reply.headers['x-notion-space-id']);
});

test('postComment sends no account header when the account is unknown', async () => {
  const [{ init }] = await postReply('any-user');
  assert.equal('x-notion-active-user-header' in (init.headers as Record<string, string>), false);
});

interface Capture {
  body: { requestId: string; transactions: { id: string; spaceId: string; operations: unknown[] }[] };
}

async function postNewDiscussion(capture: Capture, text: string, quote?: string) {
  const [transaction] = capture.body.transactions;
  const operations = transaction.operations as Operation[];
  const discussion = operations.find(({ command, pointer }) => command === 'update' && pointer.table === 'discussion')!;
  const comment = operations.find(({ command, pointer }) => command === 'set' && pointer.table === 'comment')!;
  const [{ init }] = await capturePost(
    { userId: USER_ID, spaceId: transaction.spaceId, blockId: discussion.args.parent_id as string, text, ...(quote && { quote }) },
    {
      requestId: capture.body.requestId,
      transactionId: transaction.id,
      discussionId: discussion.pointer.id,
      seenRecordId: operations.find(({ pointer }) => pointer.table === SEEN_TABLE)!.pointer.id,
      commentId: comment.pointer.id,
      now: comment.args.created_time as number,
    },
  );
  const expected = withCreationTimes(
    operations.filter(({ command }) => command !== 'addAnnotation'),
    comment.args.created_time as number,
  );
  assert.deepEqual(JSON.parse(init.body as string), {
    requestId: capture.body.requestId,
    transactions: [{ id: transaction.id, spaceId: transaction.spaceId, operations: expected }],
  });
}

test('postComment sends the page comment operations of the Notion web client', () =>
  postNewDiscussion(captures['page-comment'], 'test 1'));

test('postComment quotes the selected text of a new comment, without the text highlight', () =>
  postNewDiscussion(captures['selected-text-comment'], 'test 4', 'selected text'));

test('postComment posts the rich text of the draft, with its mentions, links, and formatting', async () => {
  const richText: [string, string[][]?][] = [['Hi '], ['‣', [['u', 'u1']]], [' see '], ['docs', [['a', 'https://example.com']]], [' now', [['b']]]];
  const [{ init }] = await capturePost(
    { userId: USER_ID, spaceId: 's1', discussionId: 'd1', text: 'Hi @Maria see docs now', richText },
    undefined,
  );
  const operations: (Operation & { path: string[] })[] = JSON.parse(init.body as string).transactions[0].operations;
  const textOperation = operations.find(({ pointer, path }) => pointer.table === 'comment' && path[0] === 'text');
  assert.deepEqual(textOperation?.args, richText);
});

test('a server error says that Notion did not answer, because Notion did not change the request', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
  try {
    await assert.rejects(
      postComment({ userId: USER_ID, spaceId: 's1', discussionId: 'd1', text: 'x' }),
      { message: 'Notion did not answer saveTransactionsFanout (HTTP 502). Try again in a minute.' },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a refused request carries the reason that Notion gives', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ name: 'ValidationError', message: 'Invalid input.' }), { status: 400 });
  try {
    await assert.rejects(postComment({ userId: USER_ID, spaceId: 's1', discussionId: 'd1', text: 'x' }), /HTTP 400: Invalid input\./);
  } finally {
    globalThis.fetch = realFetch;
  }
});
