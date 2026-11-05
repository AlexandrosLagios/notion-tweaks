# notion-tweaks

The source of Inbox Tweaks for Notion, a Chrome extension that gives the Notion inbox groups, an "Action needed" section, and undo. The extension is not affiliated with Notion Labs, Inc. See the [privacy policy](https://gist.github.com/AlexandrosLagios/f7af4c566213874c72fd5a5e0089923c). When you change `PRIVACY.md`, update the gist as well.

The extension adds a Chrome side panel for the Notion web app at `https://app.notion.com`. The panel shows the inbox notifications in groups. By default, each group collects the notifications of one database, and you can create your own groups in the panel. The panel uses internal Notion endpoints, so a Notion release can break the panel.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on "Developer mode".
3. Select "Load unpacked", and select this directory.

After a change to `manifest.json` or `src/background.js`, select the reload icon of the extension on `chrome://extensions`. After a change to another file, close the side panel and open the side panel again.

## Groups

The panel needs no setup. A notification goes to a group with the name of its database. Databases with the same name share a group. The "Other" group holds the notifications of pages outside a database.

### Create a custom group

1. Point to a row, and select "Move".
2. Select "New group…".
3. Type the group name, and select "Create".

The row moves to the new group at once. A move applies to the whole page, and a new comment on the page joins the moved row.

To add another row, point to the row, select "Move", and select the group. To return a row, select "Move", and select the group that the row came from. A custom group disappears when the last row leaves the group.

A custom group works like the "Action needed" section. The group shows under both filters, and also when the row is older than the loaded list. "Archive" removes the row from the group, and "Undo" returns the row. A custom group exists only in this Chrome profile. The custom groups show after "Action needed" and before the other groups, in name order.

### Add database rules

A rule sends all the notifications of a database to a group. A rule can also separate two databases with the same name.

1. Open the extension options from `chrome://extensions`.
2. Write one rule per line: `<database URL or id> = <group name>`.
3. Select "Save".
4. Select "Reload" in the panel.

Copy the database URL from the address bar of the full-page database. The options page does not save a line without `=`, without a database id, or without a group name. Several databases can share one group name. The line order sets the group order.

## Use the panel

1. Select the extension icon in the Chrome toolbar. The side panel opens, and Chrome makes room for the panel.
2. To open a notification, select the row. The Notion tab opens the page without a reload and goes to the comment. The extension marks the row as read.
3. To open a notification in a new tab, hold Cmd and select the row.
4. To archive one row, point to the row, and select "Archive".
5. To archive a group, select "Archive" in the group header, and then select "Archive <count>?" within 3 seconds.
6. To show only the unread notifications, select "Unread" in the header. The panel keeps the selection.

To collect the notifications that need your action, point to a row, and select "Action". The row moves to the "Action needed" section at the top. A new comment on that page joins the row. To take the row out of the section, select "No action", or archive the row.

The section shows under both filters, and also when the row is older than the loaded list, because the extension saves a copy of each row in the section in `chrome.storage.local`. The section exists only in this Chrome profile. A notification that you archive in the native Notion inbox stays in the section until you select "No action".

A row holds all the notifications of one page. The row shows who acted and the text of the newest comment. "Archive" applies to all the notifications of the row.

An archived row dims at once and stays in place, so the other rows do not move under the pointer. "Undo" restores the row and its read state. "Reload" removes the archived rows. When Notion rejects a request, the row returns to the earlier state and an error line shows below the group header.

The badge next to the title shows the number of unread notifications. The badge loads separately, so the list does not wait for the badge.

## Publish

1. Update `version` in `manifest.json`.
2. Run `scripts/package.sh`. The script writes the ZIP to `dist/`.
3. Upload the ZIP in the Chrome Developer Dashboard. `store/listing.md` holds the text for each field.

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
5. Select "Move" on a row, and create a group. Close the panel, and open the panel again. Make sure that the row stays in the group.
