# Chrome Web Store listing

Copy each field below into the Chrome Developer Dashboard. Upload the ZIP from `scripts/package.sh`.

## Store listing tab

**Title** comes from the manifest: Inbox Tweaks for Notion

**Summary** comes from the manifest.

**Category:** Productivity, Workflow and planning

**Language:** English

**Store icon:** `icons/icon-128.png`

**Screenshots:** `store/screenshot-1.png`, `store/screenshot-2.png`

**Small promo tile:** `store/promo-tile.png`

**Description:**

```text
Sort your Notion inbox into groups, mark what needs your action, and clear the rest.

- Group notifications by database, with no setup.
- Create your own groups in the panel, and move a page or a whole database to a group.
- Mark what needs your action. Those rows stay at the top until you are done, even when you show only unread notifications.
- Get one row per page, even when a page has many notifications.
- Archive a row or a whole group, with Undo right in the row.
- Keep your place. The list does not move under your pointer when you archive.
- See the unread count on the toolbar icon, with no Notion tab open.
- Keep the inbox in a Chrome side panel, next to any tab, at the width you choose.

Your data stays in your browser. The extension talks only to Notion, with your existing session. It has no server, no analytics, and no tracking.

Known limit: The extension uses internal Notion endpoints, so a Notion release can break it until the extension is updated.

This extension is not affiliated with, or endorsed by, Notion Labs, Inc.
```

## Privacy tab

**Single purpose:**

```text
Show the Notion inbox in a side panel, where the user can group, mark, open, and archive notifications.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `sidePanel` | The inbox is shown in the Chrome side panel, which stays open while the user reads a page. |
| `storage` | Saves the group rules, the All or Unread selection, the chosen workspace, and a copy of each row in Action needed or moved to a group in the browser. Keeps the last list and the unread count in memory until Chrome closes, so the panel opens at once. |
| `alarms` | Checks the unread count every minute, to show the count on the toolbar icon while the panel is closed. |
| `scripting` | Opens a selected page in the existing Notion tab without a reload, and reads which Notion account is active in that tab. |
| Host permission `https://app.notion.com/*` | Loads the inbox from Notion, and sends the archive and read updates that the user asks for. The extension accesses no other site. |

**Remote code:** No, I am not using remote code.

**Data usage:** Select "Personally identifiable information" (names of people in notifications) and "Website content" (titles and comment text). Select all three certifications.

**Privacy policy URL:** https://gist.github.com/AlexandrosLagios/f7af4c566213874c72fd5a5e0089923c

## Distribution tab

**Payments:** Free

**Visibility:** Public

**Regions:** All regions

## Test instructions tab

```text
Sign in to any Notion account at https://app.notion.com, and make sure that the inbox has at least one notification. To create one, ask another member to mention you in a comment. Select the extension icon to open the side panel. Select a row to open the page. Point to a row, and select Action, Move, or Archive. To create a group, select Move, and select New group. To move a whole database, select Move, and select a group under All of <database>.
```
