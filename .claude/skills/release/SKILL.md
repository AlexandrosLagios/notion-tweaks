---
name: release
description: Use when releasing a new version of this extension to the Chrome Web Store, or when asked to ship, publish, or bump the version. Checks the repository, bumps the version, builds the ZIP, tags and pushes main, and then hands the dashboard upload to the user, because Chrome blocks browser tools on the Web Store.
---

# release

Prepare a new version of Enhanced Notion, and hand the upload to the user.

A request for a release authorizes the commit, the tag, and the push to `main`. Never submit to the store for the user. Chrome blocks browser tools on the Web Store, and the submission is theirs.

Shell variables do not persist between commands, and the working directory can reset. Start each command below with `root=/Users/alexandroslagios/src/Personal/notion-tweaks`, and set `last_tag` to the tag from step 1.

## 1. Check the repository

```sh
git -C "$root" fetch origin --tags
git -C "$root" status -sb
git -C "$root" describe --tags --abbrev=0
```

- Stop when the branch is not `main`, or when `main` is behind `origin/main`.
- Stop when the tree has changes. Other sessions can work in this checkout. Ask the user what to do, and never stash, commit, or discard changes that you did not make.
- When no tag exists, ask the user which commit they last submitted. Tag that commit with its manifest version, and push the tag.

## 2. Review what changed

```sh
git -C "$root" log "$last_tag"..HEAD --oneline
git -C "$root" diff "$last_tag"..HEAD --stat
git -C "$root" diff "$last_tag"..HEAD -- manifest.json
```

Stop when the log is empty. Do each action that applies:

| Change since the last tag | Action |
| --- | --- |
| `permissions` or `host_permissions` | Warn the user. A new permission can disable the extension for current users until they accept it, and it can lengthen the review. Update the justifications in `store/listing.md`. |
| New data that the extension stores or sends | Make sure that `PRIVACY.md` and the data usage line in `store/listing.md` describe the data. |
| `PRIVACY.md` | Update the public gist: `gh gist edit f7af4c566213874c72fd5a5e0089923c -f PRIVACY.md "$root/PRIVACY.md"`. |
| `store/listing.md` or a store image | Add the changed fields to the dashboard list for step 6. |
| The `description` in `manifest.json` | Make sure that the text has at most 132 characters. |

## 3. Choose the version

- Use a patch version for fixes.
- Use a minor version for new features.
- Use a major version only when the user asks.

The version must be higher than the last tag, or the dashboard rejects the ZIP. Ask the user only when the choice is unclear.

## 4. Test

1. Run `npm test` and `npm run check` in `$root`. Stop on any failure.
2. Run `npm run build` in `$root`. Ask the user to reload the unpacked extension and do the manual check in `README.md`. Browser tools cannot open extension pages, so an agent cannot do this check.
3. Wait for the answer, unless the user already confirmed the check for this code.

## 5. Build and push

1. Set `version` in `$root/manifest.json` to the new version.
2. Run the command below. Replace `X.Y.Z` with the new version.

```sh
cd "$root" && [ "$(git branch --show-current)" = main ] && node --test 2>&1 | grep -E '^ℹ fail 0$' && npm run --silent check && "$root/scripts/package.sh" && python3 -c "import json,zipfile; assert json.loads(zipfile.ZipFile('$root/dist/enhanced-notion-X.Y.Z.zip').read('manifest.json'))['version'] == 'X.Y.Z'" && git add manifest.json && git commit -m "chore: release X.Y.Z" && git tag vX.Y.Z && git push origin main vX.Y.Z
```

Commit changes from step 2 in earlier commits, so that this commit holds only the version.

## 6. Hand over the upload

Run the command below. Replace `X.Y.Z` with the new version.

```sh
cd "$root" && node scripts/submit-checklist.ts "$last_tag" && open "$root/dist/upload-X.Y.Z/submit-checklist.html" && open -R "$root/dist/upload-X.Y.Z/enhanced-notion-X.Y.Z.zip"
```

The script writes `dist/upload-X.Y.Z/` with the ZIP, the store images to upload, and `submit-checklist.html`. The page links the dashboard, and holds only the dashboard fields that changed since the last tag. Each text field has a Copy button. The script reads the fields from `store/listing.md`, so keep each field in that file as a `**Label:**` line, a `text` block, or a row of the permission table.

Tell the user to follow the page from top to bottom. Do not repeat the fields in chat.

When the previous version is still in review, tell the user before they upload. They choose to wait, or to cancel that review.

Report the version as ready to submit, not as released. A release is live only after the user submits it and Google approves it. Review usually takes a few days, and can take a few weeks.

## When Google rejects a version

The rejection email names the violated policy. Fix the cause, and release a new patch version. When only the listing was wrong, correct the listing in the dashboard, and submit again without a new version.
