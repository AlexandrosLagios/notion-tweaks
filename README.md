# notion-tweaks

The source of Enhanced Notion, a Chrome extension that gives the Notion inbox groups, an "Action needed" section, and undo, and that sends Notion comments at a time that you choose. The extension is not affiliated with Notion Labs, Inc. See the [privacy policy](https://gist.github.com/AlexandrosLagios/f7af4c566213874c72fd5a5e0089923c). When you change `PRIVACY.md`, update the gist as well.

The extension adds a Chrome side panel for the Notion web app at `https://app.notion.com`. The panel shows the inbox notifications in groups. By default, each group collects the notifications of one database, and you can create your own groups in the panel. A content script adds a clock button to each Notion comment box. The extension uses internal Notion endpoints and props, so a Notion release can break the extension.

## Install

1. Run `npm run build`. The script writes `src/*.js` next to `src/*.ts`.
2. Open `chrome://extensions` in Chrome.
3. Turn on "Developer mode".
4. Select "Load unpacked", and select this directory.

After a change, run `npm run build` again. After a change to `manifest.json`, `src/background.ts`, or `src/notion-api.ts`, select the reload icon of the extension on `chrome://extensions`. After a change to `src/content.ts`, `src/content-main.ts`, or `src/picker.ts`, reload the extension, and then reload each Notion tab. A Notion tab keeps the earlier content script until the tab reloads. After a change to another file, close the side panel and open the side panel again.

## Groups

The panel needs no setup. A notification goes to a group with the name of its database. Databases with the same name share a group. The "Other" group holds the notifications of pages outside a database.

### Create a custom group

1. Point to a row, and select "Move".
2. Select "New group…".
3. Type the group name, and select "Create".

The row moves to the new group at once. A move applies to the whole page, and a new comment on the page joins the moved row.

To add another row, point to the row, select "Move", and select the group. To return a row, select "Move", and select the group that the row came from. A custom group disappears when the last row leaves the group.

A custom group works like the "Action needed" section. The group shows under both filters, and also when the row is older than the loaded list. "Archive" removes the row from the group, and "Undo" returns the row. A custom group exists only in this Chrome profile. The custom groups show after "Action needed" and before the other groups, in name order.

### Move a whole database

A database rule sends all the notifications of a database to a group. A rule can also separate two databases with the same name.

1. Point to a row of the database, and select "Move".
2. Under "All of <database>", select a group, or select "New group…".

All the rows of the database move at once. To remove the rule, select "Move", and select the database name under "All of <database>". Several databases can share one group. The rule groups show in the order that you create the rules. The rules are in `chrome.storage.sync`, so Chrome sync copies the rules to your other Chrome browsers. A row outside a database has no "All of" section.

## Use the panel

1. Select the extension icon in the Chrome toolbar. The side panel opens, and Chrome makes room for the panel.
2. To open a notification, select the row. The Notion tab opens the page without a reload and goes to the comment. The extension marks the row as read.
3. To open a notification in a new tab, hold Cmd and select the row.
4. To archive one row, point to the row, and select "Archive".
5. To archive a group, select "Archive" in the group header, and then select "Archive <count>?" within 3 seconds.
6. To show only the unread notifications, select "Unread" in the header. The panel keeps the selection.
7. To show another workspace, select the workspace in the header. The menu shows only when your account has two or more workspaces. The panel keeps the selection for each Notion account. After you join a workspace, select "Reload" to show the workspace in the menu.

To collect the notifications that need your action, point to a row, and select "Action". The row moves to the "Action needed" section at the top. A new comment on that page joins the row. To take the row out of the section, select "No action", or archive the row.

The section shows under both filters, and also when the row is older than the loaded list, because the extension saves a copy of each row in the section in `chrome.storage.local`. The section exists only in this Chrome profile. A notification that you archive in the native Notion inbox stays in the section until you select "No action".

A row holds all the notifications of one page. The row shows who acted and the text of the newest comment. "Archive" applies to all the notifications of the row.

An archived row dims at once and stays in place, so the other rows do not move under the pointer. "Undo" restores the row and its read state. "Reload" removes the archived rows. When Notion rejects a request, the row returns to the earlier state and an error line shows below the group header.

The toolbar icon and the badge next to the title show the number of unread notifications. The extension checks the count every minute, also when the panel is closed. The count is for the workspace that the panel showed last.

The panel shows the last list at once when it opens, with "Updating…" in the header, and then loads the current list. When the unread count goes up, the panel loads the list again. The panel waits until the pointer leaves the panel, so the list does not change under the pointer. Like "Reload", this load removes the archived rows.

## Schedule a comment

A scheduled comment posts as you, with your Notion session, at the time that you choose. A comment from the clock button keeps its mentions, links, and formatting. A reply from the panel takes plain text only.

To reply later from the panel:

1. Point to a row with a comment, and select "Reply later".
2. Type the reply.
3. Select a preset time, or select a date and a time, and then select "Schedule".

To send a comment later from a Notion page:

1. Type the comment in a Notion comment box. The box can be a reply in a thread, a page comment, or a comment on selected text.
2. Select the clock button next to the send button.
3. Select a preset time, or select a date and a time, and then select "Schedule".

The extension clears the comment box. The "Scheduled" section at the top of the panel lists each comment that is not sent yet. To remove a comment, select "Cancel". The send time must be at least 1 minute ahead.

A comment posts only while Chrome is open. When Chrome is closed or the computer sleeps at the send time, and the time is more than 5 minutes ago, the comment does not post. The row shows "Not sent", with "Send now" and "Cancel". When Notion refuses a comment, the row shows the reason from Notion, and "Send now" tries again.

A reply from the panel can fail in a thread that you do not follow, because only the Notion page knows your follow state. Cancel that reply, and schedule the reply from the page with the clock button.

A comment on selected text posts without the highlight in the page text.

## Publish

1. Update `version` in `manifest.json`.
2. Run `scripts/package.sh`. The script builds the extension and writes the ZIP to `dist/`.
3. Run `node scripts/submit-checklist.ts <last tag>`. The script writes `dist/upload-<version>/` with the ZIP, the store images, and `submit-checklist.html`.
4. Open `submit-checklist.html`, and follow the steps in the Chrome Developer Dashboard. The page holds only the fields of `store/listing.md` that changed since the tag.

## Test

The source is TypeScript. Node.js runs the tests on the `.ts` files directly, and `tsc` checks the types. Run the checks with Node.js 26 or later:

```sh
npm install
npm test
npm run check
```

The unit tests cover `src/grouping.ts`, `src/schedule.ts`, the comment requests of `src/notion-api.ts`, and `manifest.json`. Do the manual check below after a change to `src/notion-api.ts`, `src/panel.ts`, or `src/sidepanel.ts`:

1. Run `npm run build`, load this directory as an unpacked extension, and open the panel.
2. Select a row. Make sure that the Notion tab opens the page without a reload.
3. Archive a row. Find the notification in the "Archived" filter of the native Notion inbox.
4. Select "Undo". Make sure that the notification returns to the native Notion inbox.
5. Select "Move" on a row, and create a group. Close the panel, and open the panel again. Make sure that the row stays in the group.

Do these checks too after a change to `src/background.ts` or `src/sidepanel.ts`:

1. Close the panel, and wait one minute. Make sure that the toolbar icon shows the unread count.
2. Open the panel. Make sure that the last list shows at once, with "Updating…" in the header.
3. Select "Move" on a row in a database, and select a group under "All of <database>". Make sure that all the rows of the database move.

Do these checks too after a change to `src/content.ts`, `src/content-main.ts`, `src/picker.ts`, `src/schedule.ts`, or the comment requests in `src/notion-api.ts`:

1. Reload the Notion tab. Make sure that each comment box shows the clock button next to the send button.
2. Type a reply in a thread, select the clock button, and schedule the reply 2 minutes ahead. Make sure that the reply posts at that time.
3. Select "Reply later" on a row in the panel, and schedule a reply 2 minutes ahead. Make sure that the reply posts at that time.
