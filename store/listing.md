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
Clear your Notion inbox faster, in a side panel that stays open while you read.

- Group notifications by database, or by your own rules.
- Flag what needs your action. Flagged rows stay at the top until you are done.
- Open a notification in place. The page opens without a reload and goes to the comment.
- See who acted and what they wrote, without opening the page.
- Get one row per page, even when a page has many notifications.
- Archive at once, with Undo. The list does not move under your pointer.
- Show all notifications or only unread ones, with an unread count.

Your data stays in your browser. The extension talks only to Notion, with your existing session. It has no server, no analytics, and no tracking.

To use your own groups, right-click the extension icon, select Options, and add one line per database: <database URL> = <group name>.

Known limits: The extension shows the first workspace of your account. It uses internal Notion endpoints, so a Notion release can break it until the extension is updated.

This extension is not affiliated with, or endorsed by, Notion Labs, Inc.
```

## Privacy tab

**Single purpose:**

```text
Show the Notion inbox in a side panel, where the user can group, flag, open, and archive notifications.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `sidePanel` | The inbox is shown in the Chrome side panel, which stays open while the user reads a page. |
| `storage` | Saves the group rules, the All or Unread selection, the workspace id, and a copy of each flagged row in the browser. |
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
Sign in to any Notion account at https://app.notion.com, and make sure that the inbox has at least one notification. To create one, ask another member to mention you in a comment. Select the extension icon to open the side panel. Select a row to open the page. Point to a row, and select Flag or Archive.
```
