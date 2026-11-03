# notion-tweaks

Chrome extension with tweaks for notion.so, starting with inbox grouping by parent database.

The extension adds a panel to the Notion web app at `https://app.notion.com`. The panel shows the inbox notifications in groups. Each group collects the notifications of one or more databases. The panel uses internal Notion endpoints, so a Notion release can break the panel.

## Install

1. Open `chrome://extensions` in Chrome.
2. Turn on "Developer mode".
3. Select "Load unpacked", and select this directory.
4. Reload every open Notion tab.

## Configure the groups

1. Open the extension options from `chrome://extensions`.
2. Write one rule per line: `<database URL or id> = <group name>`.
3. Select "Save".

Copy the database URL from the address bar of the full-page database. The options page does not save a line without `=`, without a database id, or without a group name. Several databases can share one group name. The line order sets the group order. A notification that matches no rule goes to the "Other" group.

## Use the panel

1. Open a Notion tab.
2. Select the extension icon in the Chrome toolbar. The panel opens at the right side of the page.
3. To archive a group, select "Archive", and then select "Archive <count>?" within 3 seconds.

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
