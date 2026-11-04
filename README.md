# notion-tweaks

Chrome extension with tweaks for notion.so, starting with inbox grouping by parent database.

The extension adds a Chrome side panel for the Notion web app at `https://app.notion.com`. The panel shows the inbox notifications in groups. Each group collects the notifications of one or more databases. The panel uses internal Notion endpoints, so a Notion release can break the panel.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on "Developer mode".
3. Select "Load unpacked", and select this directory.

After a change to `manifest.json` or `src/background.js`, select the reload icon of the extension on `chrome://extensions`. After a change to another file, close the side panel and open the side panel again.

## Configure the groups

1. Open the extension options from `chrome://extensions`.
2. Write one rule per line: `<database URL or id> = <group name>`.
3. Select "Save".

Copy the database URL from the address bar of the full-page database. The options page does not save a line without `=`, without a database id, or without a group name. Several databases can share one group name. The line order sets the group order. A notification that matches no rule goes to a group with the name of its database. The "Other" group holds the notifications of pages outside a database.

## Use the panel

1. Select the extension icon in the Chrome toolbar. The side panel opens, and Chrome makes room for the panel.
2. To open a notification, select the row. The Notion tab opens the page without a reload and goes to the comment. The extension marks the row as read.
3. To open a notification in a new tab, hold Cmd and select the row.
4. To archive one row, point to the row, and select "Archive".
5. To archive a group, select "Archive" in the group header, and then select "Archive <count>?" within 3 seconds.
6. To show only the unread notifications, select "Unread" in the header. The panel keeps the selection.

A row holds all the notifications of one page. The row shows who acted and the text of the newest comment. "Archive" applies to all the notifications of the row.

An archived row dims at once and stays in place, so the other rows do not move under the pointer. "Undo" restores the row and its read state. "Reload" removes the archived rows. When Notion rejects a request, the row returns to the earlier state and an error line shows below the group header.

The badge next to the title shows the number of unread notifications. The badge loads separately, so the list does not wait for the badge.

## Test

Run the unit tests with Node.js 22 or later:

```sh
node --test
```

The unit tests cover `src/grouping.js` and `manifest.json`. Do the manual check below after a change to `src/notion-api.js`, `src/panel.js`, or `src/sidepanel.js`:

1. Load the unpacked extension, and open the panel.
2. Select a row. Make sure that the Notion tab opens the page without a reload.
3. Archive a row. Find the notification in the "Archived" filter of the native Notion inbox.
4. Select "Undo". Make sure that the notification returns to the native Notion inbox.
