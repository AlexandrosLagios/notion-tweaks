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

async function capturePost(userId: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return new Response('{}');
  };
  try {
    await postComment(
      { userId, spaceId: replyTransaction.spaceId, discussionId: replyComment.args.parent_id, text: 'test 2' },
      { requestId: reply.body.requestId, transactionId: replyTransaction.id, commentId: replyComment.pointer.id, now: CREATED_TIME },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test('postComment sends the reply operations of the Notion web client, without the seen-record updates', async () => {
  const [{ url, init }] = await capturePost(USER_ID);
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

test('postComment picks the account and the workspace with the headers of the Notion web client', async () => {
  const [{ init }] = await capturePost(USER_ID);
  const headers = init.headers as Record<string, string>;
  assert.equal(headers['x-notion-active-user-header'], USER_ID);
  assert.equal(headers['x-notion-space-id'], reply.headers['x-notion-space-id']);
});

test('postComment sends no account header when the account is unknown', async () => {
  const [{ init }] = await capturePost('any-user');
  assert.equal('x-notion-active-user-header' in (init.headers as Record<string, string>), false);
});
