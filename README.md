# notion-tweaks

Chrome extension with tweaks for notion.so, starting with inbox grouping by parent database.

The extension adds a panel to the Notion web app at `https://app.notion.com`. The panel shows the inbox notifications in groups. Each group collects the notifications of one or more databases. The panel uses internal Notion endpoints, so a Notion release can break the panel.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on "Developer mode".
3. Select "Load unpacked", and select this directory.

After a change to `manifest.json` or `src/background.js`, select the reload icon of the extension on `chrome://extensions`. After a change to another file, reload the Notion tab. The toolbar click reads the panel scripts from disk.

## Configure the groups

1. Open the extension options from `chrome://extensions`.
2. Write one rule per line: `<database URL or id> = <group name>`.
3. Select "Save".

Copy the database URL from the address bar of the full-page database. The options page does not save a line without `=`, without a database id, or without a group name. Several databases can share one group name. The line order sets the group order. A notification that matches no rule goes to a group with the name of its database. The "Other" group holds the notifications of pages outside a database.

## Use the panel

1. Open a Notion tab.
2. Select the extension icon in the Chrome toolbar. The panel opens at the right side of the page.
3. To archive one notification, point to the row, and select "Archive".
4. To archive a group, select "Archive" in the group header, and then select "Archive <count>?" within 3 seconds.
5. To open a notification, select the row. The extension marks the notification as read.
6. To show only the unread notifications, select "Unread" in the header. The panel keeps the selection.

The badge next to the title shows the number of unread notifications. The badge loads separately, so the list does not wait for the badge.

An archived row dims at once and stays in place, so the other rows do not move under the pointer. "Reload" removes the archived rows. When Notion rejects the archive, the row returns and an error line shows below the group header.

The extension has no undo for an archive.

## Test

Run the unit tests with Node.js 22 or later:

```sh
node --test
```

The unit tests cover `src/grouping.js`. Do the manual check below after a change to `src/notion-api.js` or `src/panel.js`:

1. Load the unpacked extension, and open the panel.
2. Compare the group totals with the native Notion inbox.
3. Archive a small group.
4. Find the archived notifications in the "Archived" filter of the native Notion inbox.
