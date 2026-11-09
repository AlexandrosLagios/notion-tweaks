# Privacy policy for Enhanced Notion

Effective date: 2026-11-09

Enhanced Notion is a Chrome extension that shows your Notion inbox in a side panel, and sends your Notion comments at a time that you choose. The extension is not affiliated with Notion Labs, Inc.

## What the extension handles

The extension reads these items from your Notion account:

- Notification titles and types.
- Page titles and database names.
- Comment text.
- The names of the people and bots that caused a notification.
- Your Notion user id, and the ids and names of your workspaces.
- The text of a comment that you schedule, and the ids of its page, block, and thread.

The extension uses these items only to show your inbox and to do what you ask, such as to archive a notification, to mark a notification as read, or to send a comment.

On a Notion page, the extension reads a comment box only when you select its clock button. The extension reads no other page content.

## Where the data goes

The extension sends requests only to `https://app.notion.com`, with your existing Notion session. At the time that you choose, the extension posts your scheduled comment as you. Every minute, the extension asks Notion for the unread count of the workspace that the panel showed last. The extension has no server of its own. The extension sends no data to the developer or to any other party. The extension contains no analytics, no advertising, and no tracking.

## What the extension stores

The extension stores these items in your browser:

- The id of the workspace that you chose, and your All or Unread selection, in `chrome.storage.local`.
- A copy of each row that you move to "Action needed" or to another group, in `chrome.storage.local`. The copy holds the title, the names, the comment preview of the row, and the name of the group.
- The last list that the panel showed, the names of your workspaces, and the unread count, in `chrome.storage.session`. Chrome keeps this storage in memory, and clears it when Chrome closes.
- Each scheduled comment, in `chrome.storage.local`, until the extension sends the comment or you cancel it. The entry holds the comment text, the page title and path, the ids of the comment target, and the send time.
- Your group rules, in `chrome.storage.sync`. If you turn on Chrome sync, Google syncs these rules between your Chrome browsers.

To delete all these items, remove the extension from Chrome.

## Sale and sharing

The developer does not sell or transfer your data, and does not use your data for any purpose that is not related to the extension. The use of your data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Contact

Use the support email address on the Chrome Web Store listing of the extension.
